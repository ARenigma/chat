import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
  ICON_FAMILY,
  ICON_GLYPH,
  ICON_GLYPH_ACTIVE,
} from '../src/theme/icons.generated';

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
 * SCOPE: the React Native app and its build scripts. `admin/` is a separate
 * Next.js app with its own package.json whose shadcn components import
 * `lucide-react`; it ships nothing to the APK and is not covered by this
 * decision or by this file.
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

/**
 * The TTF's Unicode cmap, as a codepoint -> glyph index lookup.
 *
 * Format 4 only, because that is what svg2ttf (under fantasticon) writes for a
 * BMP Private-Use font, and failing on anything else is better than a lookup
 * that quietly returns 0 for every codepoint.
 */
function cmapOf(font: Buffer): (code: number) => number {
  const tables = font.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) {
    const rec = 12 + i * 16;
    if (font.toString('ascii', rec, rec + 4) === 'cmap') {
      cmap = font.readUInt32BE(rec + 8);
    }
  }
  expect(cmap).toBeGreaterThan(0);
  let sub = -1;
  const count = font.readUInt16BE(cmap + 2);
  for (let i = 0; i < count; i++) {
    const rec = cmap + 4 + i * 8;
    const platform = font.readUInt16BE(rec);
    const encoding = font.readUInt16BE(rec + 2);
    if (platform === 3 && encoding === 1) {
      sub = cmap + font.readUInt32BE(rec + 4);
    }
  }
  expect(sub).toBeGreaterThan(0);
  expect(font.readUInt16BE(sub)).toBe(4);
  // idDelta arithmetic is modulo 65536 by the spec; `%` rather than `& 0xffff`
  // because the lint config bans bitwise operators.
  const wrap16 = (n: number): number => ((n % 0x10000) + 0x10000) % 0x10000;
  const segX2 = font.readUInt16BE(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  return code => {
    for (let i = 0; i < segX2 / 2; i++) {
      const end = font.readUInt16BE(ends + i * 2);
      const start = font.readUInt16BE(starts + i * 2);
      if (code < start || code > end) {
        continue;
      }
      const delta = font.readInt16BE(deltas + i * 2);
      const range = font.readUInt16BE(ranges + i * 2);
      if (range === 0) {
        return wrap16(code + delta);
      }
      const g = font.readUInt16BE(ranges + i * 2 + range + (code - start) * 2);
      return g === 0 ? 0 : wrap16(g + delta);
    }
    return 0;
  };
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
      // TABS: { key, glyph: 'home', ... }
      'src/components/FloatingToolbar.tsx': /glyph: '(\w+)'/g,
      // <TabButton icon="chat" ... />
      'src/screens/ProviderHomeScreen.tsx': /<TabButton\s+icon="(\w+)"/g,
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
    expect(dynamicSites).toBe(2);
    expect([...names.keys()]).toEqual(
      expect.arrayContaining(['home', 'heart', 'person', 'chat', 'star']),
    );
    const unfilled = [...names].filter(([n]) => !(n in ICON_GLYPH_ACTIVE));
    expect(unfilled).toEqual([]);
  });

  it('draws the provider-type marks as filled Phosphor glyphs', () => {
    // Owner decision 2026-09-26: Listener = filled headset (or ear),
    // Astrologer = filled moon-stars (or sparkle).
    expect(config.glyphs.listener).toBe('headset-fill');
    expect(config.glyphs.astrologer).toBe('moon-stars-fill');
  });
});
