import { readFileSync } from 'fs';
import { join } from 'path';

import {
  backBarrierCount,
  backGuardCount,
  consumeBack,
  registerBackBarrier,
  registerBackGuard,
} from '../src/lib/backGuard';

describe('backGuard: the stack is the order', () => {
  afterEach(() => {
    expect(backGuardCount()).toBe(0);
    expect(backBarrierCount()).toBe(0);
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

  it('gives each registration its own entry, so the same guard can be held twice', () => {
    // Removal used to be by GUARD identity, which meant two screens holding the
    // same memoised function could not each remove their own registration.
    const guard = () => false;
    const first = registerBackGuard(guard);
    const second = registerBackGuard(guard);
    expect(backGuardCount()).toBe(2);
    first();
    expect(backGuardCount()).toBe(1);
    second();
  });
});

describe('backGuard: a barrier is the floor of the screen on top', () => {
  afterEach(() => {
    expect(backGuardCount()).toBe(0);
    expect(backBarrierCount()).toBe(0);
  });

  /*
   * The defect this stack had until 2026-09-13, reproduced at the level it
   * actually lives at.
   *
   * App.tsx keeps HomeScreen mounted under every pushed screen, so Home's
   * search guard — registered while its search field is open — stayed on this
   * stack while a chat covered Home. The chat had no guard of its own (no live
   * session), so the press fell to Home's guard, which returned true after
   * closing a search field nobody could see, and `consumeBack` reported the
   * press as handled: App never popped the chat. The app-bar arrow calls the
   * screen's own handler and never touches this stack, which is exactly why it
   * kept working and hid the bug.
   */
  it('does not offer the press to a covered screen, so the covering screen pops', () => {
    const calls: string[] = [];
    const homeSearch = registerBackGuard(() => {
      calls.push('home-search');
      return true;
    });
    const chat = registerBackBarrier();

    // Nothing open in the chat: the press must reach App.tsx's route handler.
    expect(consumeBack()).toBe(false);
    expect(calls).toEqual([]);

    chat();
    // Home uncovered again: its search guard answers back, as it must.
    expect(consumeBack()).toBe(true);
    expect(calls).toEqual(['home-search']);
    homeSearch();
  });

  it('still consults the covering screen own guards, which sit above its barrier', () => {
    // The ordering `useBackBarrier` buys with useLayoutEffect: the barrier is
    // pushed before the screen's own guards, so it cuts off what is underneath
    // without cutting off the screen holding it — a live paid session still
    // gets its confirm dialog on hardware back.
    const calls: string[] = [];
    const homeSearch = registerBackGuard(() => {
      calls.push('home-search');
      return true;
    });
    const chat = registerBackBarrier();
    const session = registerBackGuard(() => {
      calls.push('chat-session');
      return true;
    });

    expect(consumeBack()).toBe(true);
    expect(calls).toEqual(['chat-session']);
    session();
    chat();
    homeSearch();
  });

  it('stops at the topmost barrier only, so nested covers do not leak either', () => {
    const calls: string[] = [];
    const homeSearch = registerBackGuard(() => {
      calls.push('home-search');
      return true;
    });
    const list = registerBackBarrier();
    const listGuard = registerBackGuard(() => {
      calls.push('chats-list');
      return true;
    });
    // A chat opened from the chats list covers BOTH screens under it.
    const chat = registerBackBarrier();

    expect(consumeBack()).toBe(false);
    expect(calls).toEqual([]);

    // Popping the chat hands back to the list, not past it to Home.
    chat();
    expect(consumeBack()).toBe(true);
    expect(calls).toEqual(['chats-list']);

    listGuard();
    list();
    homeSearch();
  });

  it('lets a guard above the barrier decline and fall through to the barrier', () => {
    // A declining guard is not a handled press: the walk continues down and
    // stops at the floor, which is still "not handled" so the caller navigates.
    const calls: string[] = [];
    const homeSearch = registerBackGuard(() => {
      calls.push('home-search');
      return true;
    });
    const chat = registerBackBarrier();
    const chatGuard = registerBackGuard(() => {
      calls.push('chat');
      return false;
    });

    expect(consumeBack()).toBe(false);
    expect(calls).toEqual(['chat']);

    chatGuard();
    chat();
    homeSearch();
  });
});

/**
 * The barrier only works if every covering screen drops one, and "remember to
 * add a line" is not a mechanism — it is a thing the ninth screen forgets.
 *
 * So the list is DERIVED from App.tsx rather than written here: any screen it
 * renders must either drop a barrier or be named below with a reason. A new
 * pushed screen fails this until its author makes that choice deliberately.
 */
describe('every covering screen drops a barrier', () => {
  const app = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');

  /*
   * Screens that must NOT drop a barrier, each because it is not covering
   * anything — a barrier here would silence guards that are legitimately live.
   */
  const EXEMPT: Record<string, string> = {
    // The roots themselves. Home is what everything else covers, and its own
    // search guard is the guard the barrier exists to silence.
    HomeScreen: 'the member root — nothing is under it',
    ProviderHomeScreen: 'the provider root — nothing is under it',
    // Tabs, not pushes: they are siblings inside the home shell, rendered in a
    // TabLayer, and back from one goes to Home rather than popping a layer.
    FavouritesScreen: 'a tab inside the home shell, not a pushed layer',
    CallsScreen: 'a tab inside the home shell, not a pushed layer',
    // Pre-auth and full-screen takeovers. Nothing is mounted beneath them at
    // all, so there is no covered guard to silence.
    SplashScreen: 'pre-auth, nothing mounted beneath it',
    OnboardingScreen: 'pre-auth, nothing mounted beneath it',
    WelcomePappalScreen: 'pre-auth, nothing mounted beneath it',
    ProfileSetupScreen: 'pre-auth, nothing mounted beneath it',
    PermissionsScreen: 'pre-auth, nothing mounted beneath it',
    PolicyGateScreen: 'pre-auth, nothing mounted beneath it',
    // An overlay App.tsx closes itself, above consumeBack() in its own handler,
    // so it never reaches the guard stack.
    RechargeScreen: 'an overlay App.tsx closes before consumeBack() runs',
  };

  /** Screens that do not live in `src/screens`, by the name App.tsx renders. */
  const ELSEWHERE: Record<string, string> = {
    ChatScreenV2: 'src/chat-v2/ChatScreenV2.tsx',
  };

  /*
   * The `V\d+` tail is load-bearing: the chat screen is `ChatScreenV2`, and a
   * pattern that stopped at `Screen\b` matched nothing there — so the one
   * covering screen with a paid session behind its back press was the one
   * screen this derivation could not see.
   */
  const rendered: readonly string[] = [...new Set(
    [...app.matchAll(/<([A-Z][A-Za-z]*Screen(?:V\d+)?)\b/g)].flatMap(
      ([, name]) => (name === undefined ? [] : [name]),
    ),
  )].sort();

  it.each(rendered)('%s', name => {
    const reason = EXEMPT[name];
    if (reason !== undefined) {
      expect(reason.length).toBeGreaterThan(0);
      return;
    }
    const source = readFileSync(
      join(__dirname, '..', ELSEWHERE[name] ?? `src/screens/${name}.tsx`),
      'utf8',
    );
    expect(source).toContain('useBackBarrier()');
  });

  it('finds the screens at all, so a changed render shape cannot empty the list', () => {
    // A regex that matched nothing would make every assertion above vacuous.
    expect(rendered.length).toBeGreaterThanOrEqual(20);
    expect(rendered).toContain('ChatScreenV2');
  });
});
