import {
  REDACTED,
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  scrubText,
  type ScrubbableEvent,
} from '../src/lib/sentry';

jest.mock('@sentry/react-native', () => ({ init: jest.fn() }));

const PROMPT = 'I have been feeling really low since the breakup with Sam';

/** Serialise the whole event and assert the secret is nowhere inside it. */
function expectAbsent(event: ScrubbableEvent | null, needle: string): void {
  expect(JSON.stringify(event)).not.toContain(needle);
}

describe('scrubText', () => {
  it('removes email addresses', () => {
    expect(scrubText('contact tester4@example.com now')).toBe(
      `contact ${REDACTED} now`,
    );
  });

  it('removes IPv4 addresses', () => {
    expect(scrubText('from 192.168.14.201')).toBe(`from ${REDACTED}`);
  });

  it('removes IPv6 addresses', () => {
    expect(scrubText('peer 2001:0db8:85a3:0000:8a2e:0370:7334 closed')).toBe(
      `peer ${REDACTED} closed`,
    );
  });

  it('removes phone numbers', () => {
    expect(scrubText('call +1 415 555 0134 back')).toBe(`call ${REDACTED} back`);
  });

  it('removes JWTs', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(scrubText(`token=${jwt}`)).not.toContain('eyJ');
  });

  it('removes bearer credentials while keeping the scheme readable', () => {
    expect(scrubText('Authorization: Bearer sbp_abc123def456')).toBe(
      `Authorization: Bearer ${REDACTED}`,
    );
  });

  it('leaves ordinary prose and ISO timestamps intact', () => {
    const line = 'stream ended at 2026-08-19T13:58:56Z after 42 chunks';
    expect(scrubText(line)).toBe(line);
  });
});

describe('sanitizeSentryEvent — message content', () => {
  it('redacts a captureMessage that carried the prompt', () => {
    const event = sanitizeSentryEvent({ message: PROMPT });
    expect(event?.message).toBe(REDACTED);
  });

  it('redacts extras keyed like content', () => {
    const event = sanitizeSentryEvent({
      extra: { message: PROMPT, content: PROMPT, prompt: PROMPT, chunkCount: 12 },
    });
    expect(event?.extra).toEqual({
      message: REDACTED,
      content: REDACTED,
      prompt: REDACTED,
      chunkCount: 12,
    });
    expectAbsent(event, 'breakup');
  });

  it('redacts nested content deep inside a context', () => {
    const event = sanitizeSentryEvent({
      contexts: { chat: { persona: 'nova', turns: [{ content: PROMPT }] } },
    });
    expectAbsent(event, 'breakup');
    expectAbsent(event, 'nova');
  });

  it('keeps non-sensitive diagnostics', () => {
    const event = sanitizeSentryEvent({ tags: { screen: 'chat', streaming: 'true' } });
    expect(event?.tags).toEqual({ screen: 'chat', streaming: 'true' });
  });

  it('caps recursion instead of hanging on a deep object', () => {
    interface Nest {
      next?: Nest;
      leaf?: string;
    }
    let deep: Nest = { leaf: 'bottom' };
    for (let i = 0; i < 40; i += 1) {
      deep = { next: deep };
    }
    const event = sanitizeSentryEvent({ extra: { deep } as Record<string, unknown> });
    expect(JSON.stringify(event)).toContain(REDACTED);
  });
});

describe('sanitizeSentryEvent — identifiers', () => {
  it('keeps the opaque user id and drops email, ip and username', () => {
    const event = sanitizeSentryEvent({
      user: {
        id: 'e9f1c0aa-0000-4000-8000-000000000001',
        email: 'someone@example.com',
        ip_address: '203.0.113.9',
        username: 'someone',
      },
    });
    expect(event?.user).toEqual({ id: 'e9f1c0aa-0000-4000-8000-000000000001' });
  });

  it('drops the user object entirely when there is no id', () => {
    const event = sanitizeSentryEvent({ user: { email: 'someone@example.com' } });
    expect(event?.user).toBeUndefined();
  });

  it('drops server_name', () => {
    const event = sanitizeSentryEvent({ server_name: 'pixel-8-amit' });
    expect(event?.server_name).toBeUndefined();
  });

  it('strips request headers, body and query string', () => {
    const event = sanitizeSentryEvent({
      request: {
        method: 'POST',
        url: 'https://x.supabase.co/functions/v1/stream-chat?apikey=secret',
        headers: { Authorization: 'Bearer secret-token' },
        data: { message: PROMPT },
        query_string: 'apikey=secret',
      },
    });
    expect(event?.request).toEqual({
      method: 'POST',
      url: 'https://x.supabase.co/functions/v1/stream-chat',
    });
    expectAbsent(event, 'secret');
    expectAbsent(event, 'breakup');
  });
});

describe('sanitizeSentryEvent — exceptions', () => {
  it('scrubs identifiers out of the exception value but keeps the type', () => {
    const event = sanitizeSentryEvent({
      exception: {
        values: [
          { type: 'TypeError', value: 'insert failed for someone@example.com at 10.0.0.4' },
        ],
      },
    });
    const first = event?.exception?.values?.[0];
    expect(first?.type).toBe('TypeError');
    expect(first?.value).toBe(`insert failed for ${REDACTED} at ${REDACTED}`);
  });

  it('deletes stack frame locals, which routinely hold the prompt', () => {
    const event = sanitizeSentryEvent({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'boom',
            stacktrace: { frames: [{ function: 'send', vars: { message: PROMPT } }] },
          },
        ],
      },
    });
    const frame = event?.exception?.values?.[0]?.stacktrace?.frames?.[0];
    expect(frame?.vars).toBeUndefined();
    expect(frame?.function).toBe('send');
    expectAbsent(event, 'breakup');
  });
});

describe('sanitizeSentryBreadcrumb', () => {
  it('strips console breadcrumbs to nothing but their shape', () => {
    const crumb = sanitizeSentryBreadcrumb({
      category: 'console',
      level: 'log',
      message: PROMPT,
      data: { arguments: [PROMPT] },
    });
    expect(crumb).toEqual({ category: 'console', level: 'log', message: REDACTED });
  });

  it('keeps method, de-queried url and status for http breadcrumbs', () => {
    const crumb = sanitizeSentryBreadcrumb({
      category: 'http',
      type: 'http',
      data: {
        method: 'POST',
        status_code: 402,
        url: 'https://x.supabase.co/rest/v1/messages?select=*&content=eq.secret',
        request_body: PROMPT,
      },
    });
    expect(crumb?.data).toEqual({
      method: 'POST',
      status_code: 402,
      url: 'https://x.supabase.co/rest/v1/messages',
    });
  });

  it('scrubs identifiers from other breadcrumb messages', () => {
    const crumb = sanitizeSentryBreadcrumb({
      category: 'auth',
      message: 'linked someone@example.com',
    });
    expect(crumb?.message).toBe(`linked ${REDACTED}`);
  });

  it('passes null through', () => {
    expect(sanitizeSentryBreadcrumb(null)).toBeNull();
  });

  it('sanitises breadcrumbs attached to an event', () => {
    const event = sanitizeSentryEvent({
      breadcrumbs: [{ category: 'console', message: PROMPT }],
    });
    expectAbsent(event, 'breakup');
  });
});

describe('sanitizeSentryEvent — contract', () => {
  it('passes null through', () => {
    expect(sanitizeSentryEvent(null)).toBeNull();
  });

  it('handles an empty event', () => {
    expect(sanitizeSentryEvent({})).toEqual({ user: undefined });
  });
});
