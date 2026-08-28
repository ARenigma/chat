#!/usr/bin/env node
/**
 * Icon font generator: design/icons.json -> the bundled Lucide font + a glyph map.
 *
 * Mirrors gen-tokens.mjs. The config is the source of truth; this turns it into
 * artifacts and a `--check` mode gates drift in CI, exactly like the token and
 * theme generators.
 *
 * WHY A FONT (not SVG). react-native-svg is banned here (it throws
 * synchronouslyUpdateUIProps inside Reanimated views and kills touch on the
 * subtree), and our Icon sits inside animated Pressables everywhere. A font
 * glyph is plain <Text>: safe in Reanimated, tintable via `color`, scaled by
 * `fontSize`.
 *
 * WHY LUCIDE, PREBUILT. Amit's call (wave-3): Lucide across the whole app for its
 * clean consistent stroke. Lucide ships a ready-made icon font in the
 * `lucide-static` package (lucide.ttf + codepoints.json), so — unlike the old
 * Material Symbols pipeline that downloaded a variable font and instanced it —
 * this just copies that font (renaming its family to `Lucide` so RN resolves it
 * by the repo's family==filename convention) and reads the codepoints. The
 * strokes are baked into the glyphs, which is why the on-device weight is
 * Lucide's own rather than a runtime stroke width.
 *
 * NO FILL VARIANT. Lucide is a single stroke set with no filled twin, so unlike
 * Material Symbols there is one face; the active/selected state is carried by
 * colour alone (ICON_FILL_ON_ACTIVE = false).
 *
 * REQUIRES: python3 with fonttools (only to rewrite the font's family name).
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = join(ROOT, 'design/icons.json');
const FONTS = join(ROOT, 'assets/fonts');
const OUT_TS = join(ROOT, 'src/theme/icons.generated.ts');
const LUCIDE = join(ROOT, 'node_modules/lucide-static');
const FAMILY = 'Lucide';
const OUT_TTF = join(FONTS, `${FAMILY}.ttf`);
const OUT_LICENSE = join(FONTS, 'LICENSE-Lucide.txt');
const CHECK = process.argv.includes('--check');

function die(msg) {
  console.error(`gen-icons-font: ${msg}`);
  process.exit(1);
}

function haveFontTools() {
  try {
    execFileSync('python3', ['-c', 'import fontTools'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Rewrite the font's family name so RN resolves it as `Lucide` (family==file). */
function renameFamily(ttf, family) {
  execFileSync('python3', [
    '-c',
    [
      'import sys',
      'from fontTools.ttLib import TTFont',
      'f=TTFont(sys.argv[1]); fam=sys.argv[2]',
      'for r in f["name"].names:',
      '  if r.nameID in (1,4,6,16): r.string=fam',
      '  if r.nameID in (2,17): r.string="Regular"',
      'f.save(sys.argv[1])',
    ].join('\n'),
    ttf,
    family,
  ]);
}

function main() {
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const cpPath = join(LUCIDE, 'font/codepoints.json');
  if (!existsSync(cpPath)) {
    die(
      'lucide-static not installed. Run: npm install --save-dev lucide-static',
    );
  }
  const cp = JSON.parse(readFileSync(cpPath, 'utf8'));

  const names = Object.entries(cfg.glyphs).filter(([k]) => !k.startsWith('$'));
  const glyphs = {};
  const missing = [];
  for (const [semantic, lucideName] of names) {
    const code = cp[lucideName];
    if (code === undefined) {
      missing.push(`${semantic} -> ${lucideName}`);
      continue;
    }
    glyphs[semantic] = String.fromCodePoint(code);
  }
  if (missing.length) {
    die(`icon names not in Lucide: ${missing.join(', ')}`);
  }

  const ts = renderTs(glyphs);

  if (CHECK) {
    const current = existsSync(OUT_TS) ? readFileSync(OUT_TS, 'utf8') : '';
    if (current !== ts) {
      die('src/theme/icons.generated.ts is stale. Run `npm run icons:font`.');
    }
    if (!existsSync(OUT_TTF)) {
      die(`missing font ${OUT_TTF}. Run \`npm run icons:font\`.`);
    }
    if (!existsSync(OUT_LICENSE)) {
      die(`missing ${OUT_LICENSE}. Run \`npm run icons:font\`.`);
    }
    console.log(
      `icons OK, ${Object.keys(glyphs).length} glyphs, family=${FAMILY}`,
    );
    return;
  }

  if (!haveFontTools()) {
    die(
      'needs fonttools (to rename the font family). Run: python3 -m pip install fonttools',
    );
  }

  mkdirSync(FONTS, { recursive: true });
  copyFileSync(join(LUCIDE, 'font/lucide.ttf'), OUT_TTF);
  // Subset to only the ~40 glyphs we use: the full Lucide font is 2035 glyphs
  // (~840KB); the app uses under forty. pyftsubset cuts it to ~30KB, the same
  // lean-asset discipline the Material Symbols pipeline followed.
  const unicodes = Object.values(glyphs)
    .map(ch => `U+${ch.codePointAt(0).toString(16).toUpperCase()}`)
    .join(',');
  execFileSync('python3', [
    '-m',
    'fontTools.subset',
    OUT_TTF,
    `--unicodes=${unicodes}`,
    `--output-file=${OUT_TTF}`,
    '--name-IDs=*',
    '--recalc-timestamp',
  ]);
  renameFamily(OUT_TTF, FAMILY);
  copyFileSync(join(LUCIDE, 'LICENSE'), OUT_LICENSE);
  writeFileSync(OUT_TS, ts);
  console.log(
    `icons OK, ${
      Object.keys(glyphs).length
    } glyphs, family=${FAMILY}, ${Math.round(
      readFileSync(OUT_TTF).length / 1024,
    )}KB`,
  );
}

function renderTs(glyphs) {
  const names = Object.keys(glyphs).sort();
  const entries = names
    .map(n => `  ${n}: ${JSON.stringify(glyphs[n])},`)
    .join('\n');
  const union = names.map(n => `'${n}'`).join(' | ');
  return `/**
 * GENERATED by scripts/gen-icons-font.mjs from design/icons.json. Do not edit.
 *
 * Each value is a Lucide codepoint as a string, rendered as <Text> in
 * src/components/Icon.tsx in the '${FAMILY}' family. Lucide is a single stroke
 * set with no filled variant, so both family constants are the same face and the
 * active state is carried by colour (ICON_FILL_ON_ACTIVE = false).
 */

export const ICON_FAMILY = '${FAMILY}' as const;
export const ICON_FAMILY_FILLED = '${FAMILY}' as const;
export const ICON_FILL_ON_ACTIVE = false as const;

export type IconName = ${union};

export const ICON_GLYPH: Record<IconName, string> = {
${entries}
};
`;
}

main();
