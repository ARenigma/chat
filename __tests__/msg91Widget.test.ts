/**
 * The MSG91 widget client.
 *
 * Worth testing because of one property of their API that has already caused two
 * bugs elsewhere in this repo: failures arrive inside HTTP 200 with
 * `type: 'error'`. A client that trusts the status code reports every rejected
 * code as a success. `send-sms` and `verify-phone` were both written around this,
 * and these tests pin the same rule on the device side.
 */
jest.mock('../src/lib/env', () => ({
  ENV: {
    supabaseUrl: 'https://your-project.supabase.co',
    supabaseAnonKey: 'placeholder-anon-key',
    sentryDsn: '',
    appEnv: 'test',
    msg91WidgetId: 'widget-under-test',
    msg91WidgetToken: 'token-under-test',
  },
  AUTH_REDIRECT_URL: 'companionchat://auth-callback',
  assertEnv: () => undefined,
}));

import { retryOtp, sendOtp, verifyOtp, widgetConfigured } from '../src/lib/msg91Widget';

/** Whatever MSG91 would have returned, as an HTTP 200 with a JSON body. */
function respondWith(body: unknown, ok = true): jest.Mock {
  const mock = jest.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the widget client', () => {
  it('is configured when both build values are present', () => {
    expect(widgetConfigured()).toBe(true);
  });

  it('sends the widget pair and the identifier, and returns the request id', async () => {
    const fetchMock = respondWith({ type: 'success', message: 'req-123' });

    const outcome = await sendOtp('919876543210');

    expect(outcome).toEqual({ ok: true, reqId: 'req-123' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://control.msg91.com/api/v5/widget/sendOtpMobile');
    expect(JSON.parse(String(init.body))).toEqual({
      widgetId: 'widget-under-test',
      tokenAuth: 'token-under-test',
      // Digits with the country code and no plus, which is what MSG91 wants and
      // exactly what normalisePhone already produces.
      identifier: '919876543210',
    });
  });

  it('treats an error inside a 200 as a failure', async () => {
    respondWith({ type: 'error', message: 'Invalid OTP', hasError: true });

    const outcome = await verifyOtp('req-123', '000000');

    expect(outcome).toEqual({ ok: false, reason: 'wrong-code' });
  });

  it('distinguishes an expired code from a wrong one', async () => {
    respondWith({ type: 'error', message: 'OTP expired, please retry' });
    await expect(verifyOtp('req-123', '000000')).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });

    respondWith({ type: 'error', message: 'Maximum limit reached' });
    await expect(verifyOtp('req-123', '000000')).resolves.toEqual({
      ok: false,
      reason: 'too-many',
    });

    // Anything unrecognised must not be guessed at. The caller's copy for
    // `rejected` says nothing specific, which is the honest answer.
    respondWith({ type: 'error', message: 'Something we have never seen' });
    await expect(verifyOtp('req-123', '000000')).resolves.toEqual({
      ok: false,
      reason: 'rejected',
    });
  });

  it('refuses a success that carries no access token', async () => {
    // A 200 with an empty message would otherwise be read as verified, and the
    // client would then post an empty token to verify-phone.
    respondWith({ type: 'success', message: '' });

    await expect(verifyOtp('req-123', '123456')).resolves.toEqual({
      ok: false,
      reason: 'rejected',
    });
  });

  it('refuses a send that carries no request id', async () => {
    respondWith({ type: 'success', message: '' });

    await expect(sendOtp('919876543210')).resolves.toEqual({ ok: false, reason: 'rejected' });
  });

  it('keeps the original request id across a resend', async () => {
    // MSG91 answers a retry with a confirmation string, not a new id. Taking the
    // message as the id here would break the verification that follows.
    respondWith({ type: 'success', message: 'OTP sent successfully' });

    await expect(retryOtp('req-123')).resolves.toEqual({ ok: true, reqId: 'req-123' });
  });

  it('reports a thrown request as a network failure, not a rejection', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    await expect(sendOtp('919876543210')).resolves.toEqual({ ok: false, reason: 'network' });
  });

  it('reads the body of a non-2xx rather than throwing on the status', async () => {
    respondWith({ type: 'error', message: 'Invalid OTP' }, false);

    await expect(verifyOtp('req-123', '000000')).resolves.toEqual({
      ok: false,
      reason: 'wrong-code',
    });
  });
});
