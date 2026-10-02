/**
 * reportSwallowed files an offline device as ONE grouped warning per context,
 * and everything else as an error exactly as before (PAPPAL-3/5/6/8/9 were
 * network blips filed as separate errors).
 */
const mockCaptureException = jest.fn();
const mockCaptureMessage = jest.fn();

jest.mock('@sentry/react-native', () => ({
  captureException: (...a: unknown[]) => mockCaptureException(...a),
  captureMessage: (...a: unknown[]) => mockCaptureMessage(...a),
  init: jest.fn(),
  wrap: (c: unknown) => c,
}));

import { isNetworkFailure, reportSwallowed } from '../src/lib/sentry';

beforeEach(() => {
  mockCaptureException.mockClear();
  mockCaptureMessage.mockClear();
});

describe('reportSwallowed', () => {
  it('groups a network failure as a warning, by context', () => {
    reportSwallowed('recoverRinging', new TypeError('Network request failed'));
    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      '[recoverRinging] network unavailable',
      expect.objectContaining({
        level: 'warning',
        fingerprint: ['network-unavailable', 'recoverRinging'],
      }),
    );
  });

  it('keeps a real failure an error, with its SQLSTATE', () => {
    reportSwallowed('recoverPending', { code: '42501', message: 'permission denied for table calls' });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    const [err, opts] = mockCaptureException.mock.calls[0] as [Error, { tags: Record<string, string> }];
    expect(err.message).toBe('[recoverPending] permission denied for table calls');
    expect(opts.tags).toEqual({ context: 'recoverPending', sqlstate: '42501' });
  });

  it('does not mistake an auth error for the network', () => {
    expect(isNetworkFailure('JWT issued at future')).toBe(false);
    expect(isNetworkFailure('TypeError: Network request failed')).toBe(true);
    expect(isNetworkFailure('Failed to fetch')).toBe(true);
  });
});
