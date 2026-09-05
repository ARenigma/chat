import { backGuardCount, consumeBack, registerBackGuard } from '../src/lib/backGuard';

describe('backGuard: the stack is the order', () => {
  afterEach(() => {
    expect(backGuardCount()).toBe(0);
  });

  it('is a no-op with nothing registered', () => {
    expect(consumeBack()).toBe(false);
  });

  it('consults the innermost guard first and stops at the first that takes the press', () => {
    const calls: string[] = [];
    const outer = registerBackGuard(() => {
      calls.push('outer');
      return true;
    });
    const inner = registerBackGuard(() => {
      calls.push('inner');
      return true;
    });
    expect(consumeBack()).toBe(true);
    expect(calls).toEqual(['inner']);
    inner();
    outer();
  });

  it('falls through a guard that declines', () => {
    const calls: string[] = [];
    const outer = registerBackGuard(() => {
      calls.push('outer');
      return true;
    });
    const inner = registerBackGuard(() => {
      calls.push('inner');
      return false;
    });
    expect(consumeBack()).toBe(true);
    expect(calls).toEqual(['inner', 'outer']);
    inner();
    outer();
  });

  it('returns false when every guard declines, so the caller navigates', () => {
    const remove = registerBackGuard(() => false);
    expect(consumeBack()).toBe(false);
    remove();
  });

  it('removes by identity, from the middle, and tolerates a double removal', () => {
    const a = registerBackGuard(() => false);
    const b = registerBackGuard(() => true);
    const c = registerBackGuard(() => false);
    expect(backGuardCount()).toBe(3);
    b();
    b();
    expect(backGuardCount()).toBe(2);
    // With b gone, c declines and a declines: nothing takes it.
    expect(consumeBack()).toBe(false);
    a();
    c();
  });
});
