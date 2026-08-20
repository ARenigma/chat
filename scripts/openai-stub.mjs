#!/usr/bin/env node
/**
 * A deterministic OpenAI-compatible SSE endpoint for the end-to-end suite.
 *
 * Real completions make device tests flaky and expensive: the reply text changes
 * every run, so no assertion can be exact, and every device in the matrix bills
 * real tokens. This serves a fixed reply with fixed chunk boundaries, which makes
 * "the transcript says X" a legitimate assertion.
 *
 * It also fakes the failure modes worth testing, selected by the `model` field
 * the Edge Function forwards:
 *   fail-upstream   -> 500 before any delta, so the token must be refunded
 *   fail-midstream  -> three deltas then an abrupt socket close
 *   slow            -> 400 ms between deltas, for the streaming-UI assertions
 *
 * Deliberately dependency-free and http-only; it never leaves the CI network.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 8788);
const REPLY =
  process.env.STUB_REPLY ?? 'I hear you. That sounds genuinely tiring.';

const frame = text =>
  `data: ${JSON.stringify({
    id: 'chatcmpl-stub',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  })}\n\n`;

const server = createServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200).end('ok');
    return;
  }
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }

  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
  }
  let model = '';
  try {
    model = JSON.parse(raw).model ?? '';
  } catch {
    model = '';
  }

  if (model === 'fail-upstream') {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'stubbed upstream failure' } }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const words = REPLY.split(' ');
  const gap = model === 'slow' ? 400 : 40;

  for (let i = 0; i < words.length; i += 1) {
    // Deliberately split one delta across two writes: the client-side parser has
    // to reassemble a `data:` line that straddles a chunk boundary.
    const payload = frame(i === 0 ? words[i] : ` ${words[i]}`);
    res.write(payload.slice(0, 12));
    res.write(payload.slice(12));

    if (model === 'fail-midstream' && i === 2) {
      res.destroy(); // Abrupt close: partial reply, no [DONE], no end event.
      return;
    }
    await new Promise(resolve => setTimeout(resolve, gap));
  }

  res.write('data: [DONE]\n\n');
  res.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `openai-stub listening on http://0.0.0.0:${PORT} — reply: "${REPLY}"`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
