import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
  ICON_FAMILY,
  ICON_GLYPH,
  ICON_GLYPH_ACTIVE,
} from '../src/theme/icons.generated';
import { cmapOf } from './helpers/ttf';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/**
 * The icon set is Phosphor, one face, and nothing else.
 *
 * Amit, 2026-09-26: "we have lucide and heroicons right now scattered..
 * completely shift to phosphor for every icon/glyph removing heroicons and
 * lucide completely". The scatter was three faces at once — Heroicons outline,
 * Heroicons solid, and a Lucide subset for the nine icons Heroicons had no twin
 * for — so "completely" is asserted from both ends: the old packages, imports
 * and font files are gone, and every name the app can ask for resolves to a
 * glyph the shipped font actually contains.
 *
 * SCOPE: the React Native app, its build scripts, and since 2026-09-26
 * ("phosphor all the way") the Next.js admin console too. The admin renders
 * Phosphor through `@phosphor-icons/react` (SVG in the DOM is fine on the
 * web); the app keeps the font, because the React Native port depends on the
 * banned react-native-svg.
 */

type IconsJson = {
  family: string;
  glyphs: Record<string, string>;
  active: Record<string, string>;
};
const config = JSON.parse(read('design/icons.json')) as IconsJson;
const real = (m: Record<string, string>): [string, string][] =>
  Object.entries(m).filter(([k]) => !k.startsWith('$'));

/** Every source file of the app and its tooling, scanned rather than listed. */
function appSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) {
        out.push(full);
      }
    }
  };
  for (const dir of ['src', 'scripts', '__tests__']) {
    walk(join(ROOT, dir));
  }
  for (const file of ['App.tsx', 'index.js']) {
    out.push(join(ROOT, file));
  }
  return out;
}

describe('the icon set is Phosphor alone', () => {
  const pkg = JSON.parse(read('package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  it('depends on neither Heroicons nor Lucide', () => {
    const banned = Object.keys(allDeps).filter(d =>
      /heroicons|lucide/i.test(d),
    );
    expect(banned).toEqual([]);
    // The lockfile too: a package removed from package.json but left in the
    // lock still installs on `npm ci`.
    expect(read('package-lock.json')).not.toMatch(
      /"node_modules\/(heroicons|lucide[^"]*)"/,
    );
  });

  it('takes Phosphor as a pinned, build-time-only dependency', () => {
    // Pinned exactly: the generator hashes the SVGs into the font, so a caret
    // range would let `npm install` move every glyph without a diff to review.
    expect(pkg.devDependencies?.['@phosphor-icons/core']).toMatch(
      /^\d+\.\d+\.\d+$/,
    );
    // Never a runtime dependency: nothing Phosphor ships to the APK except the
    // font the generator builds (RULE 5).
    expect(pkg.dependencies?.['@phosphor-icons/core']).toBeUndefined();
    expect(Object.keys(allDeps)).not.toContain('@phosphor-icons/react');
    expect(Object.keys(allDeps)).not.toContain('phosphor-react-native');
  });

  it('imports neither set anywhere in the app or its tooling', () => {
    const offenders = appSources().filter(file =>
      /(?:from\s+|require\(\s*|import\(\s*)['"][^'"]*(heroicons|lucide)[^'"]*['"]/i.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(offenders.map(f => relative(ROOT, f))).toEqual([]);
  });

  it('ships exactly one icon face, and no old one', () => {
    const fonts = readdirSync(join(ROOT, 'assets/fonts'));
    expect(fonts.filter(f => /heroicons|lucide/i.test(f))).toEqual([]);
    expect(ICON_FAMILY).toBe('Phosphor');
    expect(config.family).toBe(ICON_FAMILY);
    // React Native resolves a bundled face by `fonts/<family>.ttf` in the APK
    // assets, which android/app/build.gradle mounts from this directory.
    expect(fonts).toContain(`${ICON_FAMILY}.ttf`);
    expect(fonts).toContain('LICENSE-Phosphor.txt');
  });
});

describe('every icon name resolves to a glyph the font draws', () => {
  const lookup = cmapOf(
    readFileSync(join(ROOT, `assets/fonts/${ICON_FAMILY}.ttf`)),
  );
  const glyphs = real(config.glyphs);
  const active = real(config.active);

  it('generates exactly the names design/icons.json declares', () => {
    expect(Object.keys(ICON_GLYPH).sort()).toEqual(
      glyphs.map(([name]) => name).sort(),
    );
    expect(Object.keys(ICON_GLYPH_ACTIVE).sort()).toEqual(
      active.map(([name]) => name).sort(),
    );
  });

  it('maps every generated codepoint to a real glyph in Phosphor.ttf', () => {
    // Glyph index 0 is .notdef, the tofu box: a codepoint the map names but
    // the font lacks renders as that, silently, on the device.
    //
    // The parser proves itself first: a codepoint the font cannot contain must
    // come back 0, or the check below would pass for any font at all.
    expect(lookup(0x41)).toBe(0);
    expect(lookup(0xf8ff)).toBe(0);
    const missing = [
      ...Object.entries(ICON_GLYPH),
      ...Object.entries(ICON_GLYPH_ACTIVE).map(
        ([name, ch]) => [`${name} (active)`, ch] as const,
      ),
    ]
      .filter(
        ([, ch]) => ch !== undefined && lookup(ch.codePointAt(0) ?? 0) === 0,
      )
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it('gives `active` a different glyph, never the regular one again', () => {
    for (const [name] of active) {
      const key = name as keyof typeof ICON_GLYPH;
      expect({
        name,
        same: ICON_GLYPH_ACTIVE[key] === ICON_GLYPH[key],
      }).toEqual({
        name,
        same: false,
      });
    }
  });

  it('only ever fills with a Phosphor fill-weight glyph', () => {
    // An `active` entry that is not a fill would make selection change nothing
    // a member can see. Every other entry is regular or, for a mark with no
    // unselected state, fill — never a third weight in the same face.
    for (const [name, phosphor] of active) {
      expect({ name, phosphor }).toEqual({
        name,
        phosphor: expect.stringMatching(/-fill$/),
      });
    }
    for (const [, phosphor] of glyphs) {
      expect(phosphor).not.toMatch(/-(bold|light|thin|duotone)$/);
    }
  });

  it('has a fill for every name any call site renders `active`', () => {
    /*
     * A name with no ICON_GLYPH_ACTIVE entry does not fail: Icon falls back to
     * the regular glyph, and the selected state quietly becomes colour-only,
     * the state-by-hue failure the fill exists to prevent. Heroicons hid this
     * by giving every icon a solid twin; the Phosphor map lists fills
     * explicitly, so the call sites are SCANNED, never listed, and the next
     * `active` on a new name fails here instead of on a device.
     *
     * A literal `name="x"` is checked directly. A computed name is resolved
     * through the one pattern its file uses; a computed name in a file with no
     * resolver below fails rather than being skipped.
     */
    const RESOLVERS: Record<string, RegExp> = {
      // MEMBER_TABS / PROVIDER_TABS: { name, glyph: 'home', ... } (step 5 shell)
      'src/shell/bottom-bar/BottomBar.tsx': /glyph: '(\w+)'/g,
    };
    const names = new Map<string, string>(); // name -> first call site
    let dynamicSites = 0;
    for (const file of appSources().filter(f => f.includes('/src/'))) {
      const src = readFileSync(file, 'utf8');
      const rel = relative(ROOT, file);
      for (const m of src.matchAll(/<Icon\b([\s\S]*?)\/>/g)) {
        const props = m[1] ?? '';
        if (!/\bactive\b/.test(props)) {
          continue;
        }
        const literal = /\bname="(\w+)"/.exec(props);
        if (literal?.[1] !== undefined) {
          names.set(literal[1], rel);
          continue;
        }
        const resolver = RESOLVERS[rel];
        expect({ rel, resolvable: resolver !== undefined }).toEqual({
          rel,
          resolvable: true,
        });
        dynamicSites += 1;
        for (const r of src.matchAll(resolver ?? /$^/g)) {
          names.set(r[1] ?? '', rel);
        }
      }
    }
    // The scan found what is known to be there, so a regex that silently
    // matched nothing cannot pass this.
    // One dynamic site: the bottom bar (step 5 shell). UsageLedger icons are
    // now literal names (name="call", name="video", name="chat").
    expect(dynamicSites).toBe(1);
    expect([...names.keys()]).toEqual(
      expect.arrayContaining(['home', 'heart', 'person', 'chat', 'star']),
    );
    const unfilled = [...names].filter(([n]) => !(n in ICON_GLYPH_ACTIVE));
    expect(unfilled).toEqual([]);
  });

  it('draws every outline glyph in ONE weight, bold', () => {
    // Owner, 2026-10-10, from a Phosphor regular / bold / Tabler comparison:
    // bold (about 2.25px at 24dp) for the whole set, fills unchanged. The
    // generator reads this and refuses anything but regular or bold.
    expect((config as { outlineWeight?: string }).outlineWeight).toBe('bold');
    expect(read('scripts/gen-icons-font.mjs')).toContain("const OUTLINE_WEIGHTS = new Set(['regular', 'bold']);");
  });

  it('draws list rows in the regular list weight, controls in bold', () => {
    // Owner, 2026-10-11: "settings icon seem too bold". A column of bold row
    // icons reads heavy; one bold glyph alone in a bar does not.
    expect((config as { listWeight?: string }).listWeight).toBe('regular');
    expect(read('src/components/Icon.tsx')).toContain('(list ? ICON_GLYPH_LIST[name] : undefined)');
    const row = read('src/screens/SettingsSheet.tsx');
    expect(row).toMatch(/name=\{icon\}[\s\S]{0,200}\blist\b/);
    // The bar's glyphs never take the list weight.
    expect(read('src/shell/bottom-bar/BottomBar.tsx')).not.toMatch(/<Icon[^>]*\blist\b/);
  });

  it('draws the provider-type marks as filled Phosphor glyphs', () => {
    // Astrologer = filled moon-stars (owner decision 2026-09-26). Listener =
    // filled butterfly since 2026-10-12 (Amit: the filled flower "looks like
    // setting not flower"), after the flower (10-10) and the lotus (09-27)
    // that replaced a headset which read as a call-centre agent. Not the ear
    // or the sparkle, which `listen` and `unwind` already draw.
    expect(config.glyphs.listener).toBe('butterfly-fill');
    expect(config.glyphs.listener).not.toBe(config.glyphs.listen);
    expect(config.glyphs.listener).not.toBe(config.glyphs.unwind);
    expect(config.glyphs.astrologer).toBe('moon-stars-fill');
  });
});

describe('the admin console uses Phosphor too', () => {
  const { readFileSync: rf, readdirSync: rd } = require('fs') as typeof import('fs');
  const { join: j } = require('path') as typeof import('path');
  const root = j(__dirname, '..', 'admin');
  it('depends on @phosphor-icons/react, exactly pinned, and not lucide-react', () => {
    const pkg = JSON.parse(rf(j(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@phosphor-icons/react']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(JSON.stringify(pkg)).not.toMatch(/lucide/);
    expect(rf(j(root, 'components.json'), 'utf8')).not.toMatch(/lucide/);
  });
  it('imports no lucide icon anywhere in its source', () => {
    const offenders: string[] = [];
    for (const dir of ['app', 'components', 'lib']) {
      for (const f of rd(j(root, dir), { recursive: true }) as string[]) {
        if (!/\.(ts|tsx)$/.test(f)) continue;
        if (/lucide/.test(rf(j(root, dir, f), 'utf8'))) offenders.push(`${dir}/${f}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
