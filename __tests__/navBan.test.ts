import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Navigation step 8 (nav-migration §5 and §9): the hand-rolled navigator is
 * deleted, and these pins keep it deleted.
 *
 * Before react-navigation the app moved its own screens in JS: a pushed layer
 * over an always-mounted Home, a direction flag read by the enter/exit
 * builders, a transition lock for the texture promotion, a floating toolbar
 * and a back-guard stack walked at event time. Step 7 removed every use; step
 * 8 removed the definitions. A native-stack push is a fragment transition
 * composited by the platform, and a route that must not simply leave says so
 * with `usePreventRemove` (https://reactnavigation.org/docs/preventing-going-back).
 */
const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const withoutComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? walk(`${dir}/${entry.name}`)
      : /\.(ts|tsx|js)$/.test(entry.name)
        ? [`${dir}/${entry.name}`]
        : [],
  );

const BANNED = [
  'useScreenEnter',
  'screenOut',
  'navDirection',
  'setNavDirection',
  'homeShift',
  'revealHome',
  'useHomeRevealStyle',
  'transitioning',
  'setTransitioning',
  'topLevelIn',
  'topLevelOut',
  'TabLayer',
  'PushedLayer',
  'AfterPaint',
  'FloatingToolbar',
  'NAV_BAR_HEIGHT',
  'useBackBarrier',
  'consumeBack',
  'WalletLayer',
] as const;
const BANNED_WORD = new RegExp(`\\b(${BANNED.join('|')})\\b`);

describe('the hand-rolled navigator stays deleted', () => {
  const sources = [...walk('src'), 'App.tsx', 'index.js'].filter(
    f => !f.endsWith('.generated.ts'),
  );

  it('has no source that imports, defines or calls a banned name', () => {
    // Comments are stripped: several files explain what used to be here, and
    // a ban that cannot tell prose from code fails on its own history.
    const offenders = sources.flatMap(file => {
      const hit = BANNED_WORD.exec(withoutComments(read(file)));
      return hit === null ? [] : [`${file}: ${hit[1]}`];
    });
    expect(offenders).toEqual([]);
  });

  it('exports none of them from motion.ts', () => {
    const motion = withoutComments(read('src/theme/motion.ts'));
    const exported = [
      ...motion.matchAll(/export\s+(?:const|function|let|type|interface)\s+(\w+)/g),
    ].map(m => m[1]);
    expect(exported.filter(name => (BANNED as readonly string[]).includes(name ?? ''))).toEqual(
      [],
    );
    expect(exported.length).toBeGreaterThan(10);
  });

  it.each([
    'src/lib/routes.ts',
    'src/lib/backGuard.ts',
    'src/components/FloatingToolbar.tsx',
    'src/components/AfterPaint.tsx',
    'src/screens/ProviderHomeScreen.tsx',
  ])('%s is gone', file => {
    expect(existsSync(join(ROOT, file))).toBe(false);
  });

  it('imports links from src/lib/routes/links.ts, not the deleted shim', () => {
    const offenders = sources.filter(file =>
      /from\s+['"][./]*(?:lib\/)?routes['"]/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });
});

/*
 * Moved from the deleted backGuard.test.ts. The guard stack's barriers existed
 * because the old tree kept Home mounted UNDER every pushed screen, so a
 * covered screen's guard heard a press meant for the one on top. Under
 * native-stack a covered screen hears nothing: tab roots register their search
 * back only while focused (`useSearchBack`), and a route that must not simply
 * leave stops its own removal with `usePreventRemove`.
 */
describe('removals are guarded by the routes', () => {
  it.each([
    ['src/screens/routes/ChatRoute.tsx', 'usePreventRemove(sessionActive || replyActive'],
    ['src/screens/routes/CallRoute.tsx', "usePreventRemove(guard?.ending !== true"],
    ['src/screens/routes/MemberRoutes.tsx', "usePreventRemove(phase !== 'verify'"],
  ])('%s guards its own removal', (file, guard) => {
    expect(read(file)).toContain(guard);
  });

  it('keeps search back focus-scoped on every tab root that searches', () => {
    for (const file of [
      'src/screens/HomeScreen.tsx',
      'src/screens/FavouritesScreen.tsx',
      'src/screens/SettingsSheet.tsx',
    ]) {
      expect(read(file)).toContain('useSearchBack(searching, closeSearch)');
    }
    const hook = read('src/hooks/useSearchBack.ts');
    expect(hook).toContain('useFocusEffect(');
    expect(hook).toContain("BackHandler.addEventListener('hardwareBackPress'");
  });
});
