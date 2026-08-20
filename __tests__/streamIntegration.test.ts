import { spawn, type ChildProcess } from 'child_process';
import { join } from 'path';
import { createSSEParser, openAIDelta } from '../supabase/functions/_shared/sse';

/**
 * The only test that exercises the streaming contract over a real socket.
 *
 * `sse.test.ts` proves the parser against hand-written strings; this proves it
 * against bytes that actually crossed a TCP connection, from the same stub the
 * device suite uses. It is the cheapest possible check that the client can read
 * what the server writes — no emulator, no Supabase, no OpenAI.
 *
 * `openai-stub.mjs` deliberately splits every `data:` line across two socket
 * writes, so a parser that assumed chunk boundaries align with frames fails here.
 */

const PORT = 8797;
const URL = `http://127.0.0.1:${PORT}/v1/chat/completions`;
const REPLY = 'I hear you. That sounds genuinely tiring.';

interface Consumed {
  status: number;
  text: string;
  frames: number;
  aborted: boolean;
}

async function consume(model: string): Promise<Consumed> {
  const response = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
  });

  if (!response.body) {
    return { status: response.status, text: '', frames: 0, aborted: false };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSSEParser();
  let text = '';
  let frames = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        frames += 1;
        text += openAIDelta(event.data);
      }
    }
    for (const event of parser.flush()) {
      frames += 1;
      text += openAIDelta(event.data);
    }
  } catch {
    return { status: response.status, text, frames, aborted: true };
  }

  return { status: response.status, text, frames, aborted: false };
}

describe('streaming over a real socket', () => {
  let stub: ChildProcess;

  beforeAll(async () => {
    stub = spawn(process.execPath, [join(__dirname, '../scripts/openai-stub.mjs')], {
      env: { ...process.env, STUB_PORT: String(PORT) },
      stdio: 'ignore',
    });

    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const probe = await fetch(`http://127.0.0.1:${PORT}/healthz`);
        if (probe.ok) {
          return;
        }
      } catch {
        // Not listening yet.
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('the OpenAI stub never started listening');
  }, 20_000);

  afterAll(() => {
    stub?.kill('SIGTERM');
  });

  it('reassembles frames split across socket writes into the exact reply', async () => {
    const result = await consume('gpt-4o-mini');
    expect(result.status).toBe(200);
    expect(result.text).toBe(REPLY);
  }, 20_000);

  it('sees one frame per delta plus the terminator', async () => {
    const result = await consume('gpt-4o-mini');
    expect(result.frames).toBe(REPLY.split(' ').length + 1);
  }, 20_000);

  it('surfaces an upstream failure as a non-2xx before any delta', async () => {
    const result = await consume('fail-upstream');
    expect(result.status).toBe(500);
    expect(result.text).toBe('');
  }, 20_000);

  it('keeps the partial reply when the socket dies mid-stream', async () => {
    const result = await consume('fail-midstream');
    expect(result.aborted).toBe(true);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text.length).toBeLessThan(REPLY.length);
    // This is exactly the case where the Edge Function persists what it has
    // rather than refunding: see `completeText === ''` in stream-chat/index.ts.
    expect(REPLY.startsWith(result.text)).toBe(true);
  }, 20_000);
});
