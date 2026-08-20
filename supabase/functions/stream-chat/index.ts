/**
 * POST /functions/v1/stream-chat
 *
 * Debits exactly one token, then streams the companion's reply as SSE:
 *   event: balance  {"balance": 41}      once, before the first token
 *   event: chunk    {"text": "Hey"}      per upstream delta
 *   event: end      {}                   reply persisted, stream complete
 *   event: stream_error {"code": "..."}  terminal; any debit has been refunded
 *
 * Non-obvious invariants:
 *   - Chat ownership is verified server-side. This function holds the service
 *     role key, which bypasses RLS, so `chatId` from the client is untrusted
 *     input until it has been matched against `auth.uid()`.
 *   - The token is refunded if the upstream call never produced text, so a
 *     provider outage is never billed to the user.
 *   - Wire framing and upstream parsing both go through `_shared/sse.ts`; the
 *     naive `chunk.split("\n")` approach drops deltas whenever a `data:` line
 *     straddles a network chunk boundary.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';
import { corsHeaders, jsonHeaders, sseHeaders } from '../_shared/cors.ts';
import { createSSEParser, encodeSSE, openAIDelta } from '../_shared/sse.ts';
import { getPersona } from '../_shared/personas.ts';
import { getSystemPrompt } from '../_shared/prompts.ts';
import { HISTORY_LIMIT, MAX_MESSAGE_CHARS, MESSAGE_COST } from '../_shared/ledger.ts';
import { isUuid, type StreamErrorCode } from '../_shared/protocol.ts';

// Overridable so the end-to-end suite can point at a deterministic SSE stub
// (scripts/openai-stub.mjs) instead of burning real tokens on every device in the
// matrix. Also the seam for Azure OpenAI or an OpenAI-compatible gateway.
const OPENAI_BASE_URL = Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1';
const OPENAI_URL = `${OPENAI_BASE_URL}/chat/completions`;
const MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

interface DebitResult {
  success: boolean;
  new_balance?: number;
  error?: string;
}

interface StoredMessage {
  sender: 'user' | 'assistant';
  content: string;
}

function fail(code: StreamErrorCode, status: number): Response {
  return new Response(JSON.stringify({ error: code }), { status, headers: jsonHeaders });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return fail('BAD_REQUEST', 405);
  }

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!openaiKey || !supabaseUrl || !serviceKey) {
    console.error('stream-chat: missing required secret');
    return fail('INTERNAL', 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // --- Identity -----------------------------------------------------------
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return fail('UNAUTHORIZED', 401);
  }
  const { data: userData, error: authErr } = await supabase.auth.getUser(
    authHeader.slice('Bearer '.length),
  );
  const user = userData?.user;
  if (authErr || !user) {
    return fail('UNAUTHORIZED', 401);
  }

  // --- Input --------------------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('BAD_REQUEST', 400);
  }
  const { chatId, personaId, message } = (body ?? {}) as Record<string, unknown>;
  const trimmed = typeof message === 'string' ? message.trim() : '';

  if (!isUuid(chatId) || typeof personaId !== 'string') {
    return fail('BAD_REQUEST', 400);
  }
  if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_CHARS) {
    return fail('BAD_REQUEST', 400);
  }
  const persona = getPersona(personaId);
  if (!persona) {
    return fail('BAD_REQUEST', 400);
  }

  // --- Authorisation: the service role bypasses RLS, so check by hand -----
  const { data: chat, error: chatErr } = await supabase
    .from('chats')
    .select('id, user_id, persona_id')
    .eq('id', chatId)
    .maybeSingle();

  if (chatErr) {
    console.error('stream-chat: chat lookup failed', chatErr.message);
    return fail('INTERNAL', 500);
  }
  if (!chat || chat.user_id !== user.id) {
    return fail('FORBIDDEN', 403);
  }
  if (chat.persona_id !== persona.id) {
    return fail('BAD_REQUEST', 400);
  }

  // --- Context (read before the write, so it holds prior turns only) ------
  const { data: history } = await supabase
    .from('messages')
    .select('sender, content')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  const priorTurns: StoredMessage[] = ((history ?? []) as StoredMessage[]).slice().reverse();

  // --- Atomic token debit -------------------------------------------------
  const { data: debit, error: debitErr } = await supabase.rpc('deduct_user_token', {
    p_user_id: user.id,
    p_cost: MESSAGE_COST,
  });
  const wallet = debit as DebitResult | null;

  if (debitErr || !wallet?.success || typeof wallet.new_balance !== 'number') {
    return fail('INSUFFICIENT_TOKENS', 402);
  }
  const balance = wallet.new_balance;

  const refund = async (): Promise<void> => {
    const { error } = await supabase.rpc('credit_user_token', {
      p_user_id: user.id,
      p_amount: MESSAGE_COST,
    });
    if (error) {
      console.error('stream-chat: refund failed', error.message);
    }
  };

  // --- Persist the user turn ---------------------------------------------
  const { error: userInsertErr } = await supabase
    .from('messages')
    .insert({ chat_id: chatId, sender: 'user', content: trimmed });

  if (userInsertErr) {
    console.error('stream-chat: user message insert failed', userInsertErr.message);
    await refund();
    return fail('INTERNAL', 500);
  }

  // --- Stream -------------------------------------------------------------
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: string, payload: unknown): void => {
        if (!open) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(encodeSSE(event, payload)));
        } catch {
          open = false; // Client hung up mid-write.
        }
      };
      const finish = (): void => {
        if (open) {
          open = false;
          controller.close();
        }
      };

      send('balance', { balance });

      let completeText = '';
      try {
        const upstream = await fetch(OPENAI_URL, {
          method: 'POST',
          signal: req.signal,
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: MODEL,
            stream: true,
            messages: [
              { role: 'system', content: getSystemPrompt(persona.id) },
              ...priorTurns.map(m => ({
                role: m.sender === 'assistant' ? 'assistant' : 'user',
                content: m.content,
              })),
              { role: 'user', content: trimmed },
            ],
          }),
        });

        if (!upstream.ok || !upstream.body) {
          console.error('stream-chat: upstream status', upstream.status);
          await refund();
          send('stream_error', { code: 'UPSTREAM_FAILED' });
          finish();
          return;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSSEParser();

        const drain = (events: ReturnType<typeof parser.push>): void => {
          for (const evt of events) {
            const text = openAIDelta(evt.data);
            if (text !== '') {
              completeText += text;
              send('chunk', { text });
            }
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          drain(parser.push(decoder.decode(value, { stream: true })));
        }
        drain(parser.flush());
      } catch (err) {
        console.error('stream-chat: stream aborted', err instanceof Error ? err.name : 'unknown');
        if (completeText === '') {
          await refund();
          send('stream_error', { code: 'UPSTREAM_FAILED' });
          finish();
          return;
        }
      }

      if (completeText === '') {
        await refund();
        send('stream_error', { code: 'UPSTREAM_FAILED' });
        finish();
        return;
      }

      const { error: assistantInsertErr } = await supabase
        .from('messages')
        .insert({ chat_id: chatId, sender: 'assistant', content: completeText });

      if (assistantInsertErr) {
        console.error('stream-chat: assistant insert failed', assistantInsertErr.message);
      }

      send('end', {});
      finish();
    },
  });

  return new Response(stream, { headers: sseHeaders });
});
