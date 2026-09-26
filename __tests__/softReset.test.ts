/**
 * Tests for src/lib/events.ts — emitSoftReset / listenSoftReset.
 *
 * Verifies the module-level Set implementation (no eventemitter3) delivers
 * events to listeners and that unsubscribing stops delivery.
 *
 * nav-migration §9 step 2.
 */

import { emitSoftReset, listenSoftReset } from '../src/lib/events';

describe('emitSoftReset / listenSoftReset', () => {
  it('calls registered listeners when emitted', () => {
    const fn = jest.fn();
    const unlisten = listenSoftReset(fn);
    try {
      emitSoftReset();
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      unlisten();
    }
  });

  it('calls all registered listeners', () => {
    const a = jest.fn();
    const b = jest.fn();
    const ua = listenSoftReset(a);
    const ub = listenSoftReset(b);
    try {
      emitSoftReset();
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    } finally {
      ua();
      ub();
    }
  });

  it('stops calling a listener after it unsubscribes', () => {
    const fn = jest.fn();
    const unlisten = listenSoftReset(fn);
    unlisten();
    emitSoftReset();
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not fire remaining listeners after one unsubscribes', () => {
    const a = jest.fn();
    const b = jest.fn();
    const ua = listenSoftReset(a);
    const ub = listenSoftReset(b);
    ua(); // unsubscribe a only
    try {
      emitSoftReset();
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledTimes(1);
    } finally {
      ub();
    }
  });

  it('calling unlisten twice is safe', () => {
    const fn = jest.fn();
    const unlisten = listenSoftReset(fn);
    unlisten();
    expect(() => unlisten()).not.toThrow();
    emitSoftReset();
    expect(fn).not.toHaveBeenCalled();
  });
});
