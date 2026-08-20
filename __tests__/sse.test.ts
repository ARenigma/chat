import {
  createSSEParser,
  encodeSSE,
  openAIDelta,
  type SSEEvent,
} from '../supabase/functions/_shared/sse';

/** Feed a payload one character at a time — the worst realistic fragmentation. */
function pushByChar(text: string): SSEEvent[] {
  const parser = createSSEParser();
  const events: SSEEvent[] = [];
  for (const ch of text) {
    events.push(...parser.push(ch));
  }
  events.push(...parser.flush());
  return events;
}

describe('createSSEParser — framing', () => {
  it('parses a single named event', () => {
    const parser = createSSEParser();
    expect(parser.push('event: chunk\ndata: {"text":"hi"}\n\n')).toEqual([
      { event: 'chunk', data: '{"text":"hi"}', id: null },
    ]);
  });

  it('defaults the event name to message', () => {
    const parser = createSSEParser();
    expect(parser.push('data: hello\n\n')).toEqual([
      { event: 'message', data: 'hello', id: null },
    ]);
  });

  it('emits nothing until the terminating blank line arrives', () => {
    const parser = createSSEParser();
    expect(parser.push('event: chunk\ndata: {"text":"a"}\n')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ event: 'chunk', data: '{"text":"a"}', id: null }]);
  });

  it('joins multi-line data with newlines', () => {
    const parser = createSSEParser();
    expect(parser.push('data: line one\ndata: line two\n\n')[0]?.data).toBe('line one\nline two');
  });

  it('ignores comments and retry fields', () => {
    const parser = createSSEParser();
    expect(parser.push(': keep-alive\nretry: 5000\ndata: x\n\n')).toEqual([
      { event: 'message', data: 'x', id: null },
    ]);
  });

  it('carries the last id forward', () => {
    const parser = createSSEParser();
    const events = parser.push('id: 7\ndata: a\n\ndata: b\n\n');
    expect(events.map(e => e.id)).toEqual(['7', '7']);
  });

  it('strips exactly one space after the colon', () => {
    const parser = createSSEParser();
    expect(parser.push('data:  двойной\n\n')[0]?.data).toBe(' двойной');
  });

  it('treats a field with no colon as an empty value', () => {
    const parser = createSSEParser();
    expect(parser.push('data\n\n')[0]?.data).toBe('');
  });

  it('does not emit an event for a lone blank line', () => {
    const parser = createSSEParser();
    expect(parser.push('\n\n\n')).toEqual([]);
  });
});

describe('createSSEParser — fragmented buffers', () => {
  it('reassembles a payload split mid-token', () => {
    const parser = createSSEParser();
    expect(parser.push('event: chu')).toEqual([]);
    expect(parser.push('nk\ndata: {"te')).toEqual([]);
    expect(parser.push('xt":"hello"}')).toEqual([]);
    expect(parser.push('\n\n')).toEqual([
      { event: 'chunk', data: '{"text":"hello"}', id: null },
    ]);
  });

  it('survives one-character-at-a-time delivery', () => {
    const wire =
      'event: balance\ndata: {"balance":49}\n\n' +
      'event: chunk\ndata: {"text":"Hey"}\n\n' +
      'event: end\ndata: {}\n\n';
    expect(pushByChar(wire)).toEqual([
      { event: 'balance', data: '{"balance":49}', id: null },
      { event: 'chunk', data: '{"text":"Hey"}', id: null },
      { event: 'end', data: '{}', id: null },
    ]);
  });

  it('handles a CRLF pair split across two chunks', () => {
    const parser = createSSEParser();
    expect(parser.push('data: split\r')).toEqual([]);
    expect(parser.push('\n\r\n')).toEqual([{ event: 'message', data: 'split', id: null }]);
  });

  it('accepts a bare CR as a line terminator, holding the trailing one back', () => {
    const parser = createSSEParser();
    // The final CR is withheld: the next chunk may open with the LF that pairs it.
    expect(parser.push('data: mac\r\r')).toEqual([]);
    expect(parser.flush()).toEqual([{ event: 'message', data: 'mac', id: null }]);
  });

  it('dispatches on a CR-only blank line once the stream continues', () => {
    const parser = createSSEParser();
    expect(parser.push('data: mac\r\rdata: next')).toEqual([
      { event: 'message', data: 'mac', id: null },
    ]);
  });

  it('emits several events queued inside one chunk', () => {
    const parser = createSSEParser();
    const events = parser.push('data: a\n\ndata: b\n\ndata: c\n\n');
    expect(events.map(e => e.data)).toEqual(['a', 'b', 'c']);
  });

  it('flushes a final event the provider never blank-line-terminated', () => {
    const parser = createSSEParser();
    expect(parser.push('data: tail')).toEqual([]);
    expect(parser.flush()).toEqual([{ event: 'message', data: 'tail', id: null }]);
  });

  it('flushes nothing when the buffer is clean', () => {
    const parser = createSSEParser();
    parser.push('data: a\n\n');
    expect(parser.flush()).toEqual([]);
  });

  it('ignores empty chunks', () => {
    const parser = createSSEParser();
    expect(parser.push('')).toEqual([]);
  });

  it('does not merge deltas when a chunk boundary falls between two events', () => {
    const parser = createSSEParser();
    const first = parser.push('data: {"a":1}\n\ndata: {"b":2}\n');
    const second = parser.push('\n');
    expect([...first, ...second].map(e => e.data)).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe('openAIDelta', () => {
  it('extracts incremental content', () => {
    expect(openAIDelta('{"choices":[{"delta":{"content":"Hi"}}]}')).toBe('Hi');
  });

  it('returns empty for the terminator', () => {
    expect(openAIDelta('[DONE]')).toBe('');
  });

  it('returns empty for a role-only opening frame', () => {
    expect(openAIDelta('{"choices":[{"delta":{"role":"assistant"}}]}')).toBe('');
  });

  it('never throws on malformed JSON', () => {
    expect(openAIDelta('{"choices":[')).toBe('');
    expect(openAIDelta('not json at all')).toBe('');
    expect(openAIDelta('null')).toBe('');
    expect(openAIDelta('{"choices":[]}')).toBe('');
    expect(openAIDelta('')).toBe('');
  });

  it('ignores a non-string content field', () => {
    expect(openAIDelta('{"choices":[{"delta":{"content":42}}]}')).toBe('');
  });
});

describe('encodeSSE', () => {
  it('round-trips through the parser', () => {
    const wire = encodeSSE('chunk', { text: 'round trip' });
    const parser = createSSEParser();
    const [event] = parser.push(wire);
    expect(event?.event).toBe('chunk');
    expect(JSON.parse(event?.data ?? '{}')).toEqual({ text: 'round trip' });
  });

  it('keeps newline-bearing payloads on one wire line', () => {
    const wire = encodeSSE('chunk', { text: 'two\nlines' });
    expect(wire.split('\n')).toHaveLength(4); // event, data, blank, trailing
    const [event] = createSSEParser().push(wire);
    expect(JSON.parse(event?.data ?? '{}')).toEqual({ text: 'two\nlines' });
  });
});
