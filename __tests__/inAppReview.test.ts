const mockStore = new Map<string, string>();
const mockRequest = jest.fn<Promise<boolean>, []>();

jest.mock('../src/lib/storage', () => ({
  storage: {
    get: (k: string) => mockStore.get(k) ?? null,
    set: (k: string, v: string) => {
      mockStore.set(k, v);
    },
    remove: (k: string) => {
      mockStore.delete(k);
    },
  },
}));

import { NativeModules, Platform } from 'react-native';

type Mod = typeof import('../src/lib/inAppReview');
// The module captures NativeModules.InAppReview at import, so the stub is set
// before the first (lazy) require rather than before the hoisted imports.
(NativeModules as Record<string, unknown>).InAppReview = { request: mockRequest };
const { shouldAskForReview, maybeAskForReview } = jest.requireActual(
  '../src/lib/inAppReview',
) as Mod;

describe('shouldAskForReview', () => {
  it('asks only for 4 and 5 stars', () => {
    expect([1, 2, 3].map(n => shouldAskForReview(n, false))).toEqual([false, false, false]);
    expect([4, 5].map(n => shouldAskForReview(n, false))).toEqual([true, true]);
  });
  it('never asks twice', () => {
    expect(shouldAskForReview(5, true)).toBe(false);
  });
});

describe('maybeAskForReview', () => {
  beforeEach(() => {
    mockStore.clear();
    mockRequest.mockReset().mockResolvedValue(true);
    jest.replaceProperty(Platform, 'OS', 'android');
  });

  it('does nothing below 4 stars', async () => {
    await maybeAskForReview(3);
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockStore.size).toBe(0);
  });

  it('asks once for a good rating, then never again', async () => {
    await maybeAskForReview(5);
    await maybeAskForReview(4);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('marks asked before the native call', async () => {
    mockRequest.mockImplementation(() => {
      expect(mockStore.size).toBe(1);
      return Promise.resolve(true);
    });
    await maybeAskForReview(5);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('swallows a native failure and still counts as asked', async () => {
    mockRequest.mockRejectedValue(new Error('boom'));
    await expect(maybeAskForReview(5)).resolves.toBeUndefined();
    await maybeAskForReview(5);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
