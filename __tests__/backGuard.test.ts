import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  backBarrierCount,
  backGuardCount,
  consumeBack,
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

/*
 * Navigation step 7 (nav-migration §4): the guard stack's barriers are gone.
 * They existed because the old tree kept Home mounted UNDER every pushed
 * screen, so a covered screen's guard heard a press meant for the one on
 * top. Under native-stack a covered screen hears nothing: tab roots register
 * their search back only while focused (`useSearchBack`), and a route that
 * must not simply leave stops its own removal with `usePreventRemove`
 * (https://reactnavigation.org/docs/preventing-going-back). The stack above
 * (`consumeBack`) is the library's own test until step 8 deletes it.
 */
describe('removals are guarded by the routes, not by barriers', () => {
  const root = join(__dirname, '..');
  const read = (path: string) => readFileSync(join(root, path), 'utf8');

  it('drops every useBackBarrier call and every useBackGuard use outside the library', () => {
    const walk = (dir: string): string[] =>
      readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory()
          ? walk(`${dir}/${entry.name}`)
          : /\.tsx?$/.test(entry.name)
            ? [`${dir}/${entry.name}`]
            : [],
      );
    const offenders = [...walk('src'), 'App.tsx']
      .filter(file => file !== 'src/lib/backGuard.ts')
      .filter(file =>
        /useBackBarrier\(|useBackGuard\(|consumeBack\(/.test(
          read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
        ),
      );
    expect(offenders).toEqual([]);
  });

  it.each([
    ['src/screens/routes/ChatRoute.tsx', 'usePreventRemove(sessionActive || replyActive'],
    ['src/screens/routes/CallRoute.tsx', "usePreventRemove(guard?.ending !== true"],
    ['src/screens/routes/MemberRoutes.tsx', "usePreventRemove(phase !== 'verify'"],
  ])('%s guards its own removal', (file, guard) => {
    expect(read(file)).toContain(guard);
  });

  it('keeps search back focus-scoped on every tab root that searches', () => {
    for (const file of ['src/screens/HomeScreen.tsx', 'src/screens/FavouritesScreen.tsx', 'src/screens/SettingsSheet.tsx']) {
      expect(read(file)).toContain('useSearchBack(searching, closeSearch)');
    }
    const hook = read('src/hooks/useSearchBack.ts');
    expect(hook).toContain('useFocusEffect(');
    expect(hook).toContain("BackHandler.addEventListener('hardwareBackPress'");
  });
});
