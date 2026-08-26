#!/usr/bin/env node
/**
 * Icon font generator: design/icons.json -> two subset static fonts + a glyph map.
 *
 * Mirrors gen-tokens.mjs. The config is the source of truth; this turns it into
 * artifacts and a `--check` mode gates drift in CI, exactly like the token and
 * theme generators.
 *
 * WHY A FONT. react-native-svg is banned here (it throws
 * synchronouslyUpdateUIProps inside Reanimated views and kills touch on the
 * subtree), and the previous hand-drawn Icon.tsx encoded each glyph as border
 * geometry — which is what made `bubble` an empty box and `phone` a smile arc at
 * display size. Material Symbols shipped as a font is tintable via `color`,
 * renders as plain <Text> (safe inside Reanimated), and gives the whole set from
 * one small file.
 *
 * WHY TWO FILES. React Native Android cannot animate or even select a
 * variable-font axis at runtime. So `weight` and `style` are baked at generation
 * time, and the FILL axis — which we want for the active/selected state — is
 * shipped as two static instances (FILL 0 and FILL 1) that the Icon swaps
 * between. This is the config's `fillOnActive`.
 *
 * WHY SUBSET. The full Material Symbols Rounded static instance is ~1.5MB and
 * carries ~3600 glyphs. We use ~30. pyftsubset cuts each instance to ~20-30KB,
 * so both instances together cost less than one weight of Nunito.
 *
 * REQUIRES: python3 with fonttools + brotli (`python3 -m pip install fonttools
 * brotli`). The generator checks and prints the install line if missing rather
 * than emitting a broken font.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = join(ROOT, 'design/icons.json');
const FONTS = join(ROOT, 'assets/fonts');
const OUT_TS = join(ROOT, 'src/theme/icons.generated.ts');
const CACHE = join(ROOT, '.icon-cache');
const CHECK = process.argv.includes('--check');

/** The variable font per style, from the google/material-design-icons repo. */
const VARIABLE = {
  rounded: 'MaterialSymbolsRounded%5BFILL%2CGRAD%2Copsz%2Cwght%5D',
  outlined: 'MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D',
  sharp: 'MaterialSymbolsSharp%5BFILL%2CGRAD%2Copsz%2Cwght%5D',
};
const REPO =
  'https://raw.githubusercontent.com/google/material-design-icons/master/variablefont';

/** The PostScript family name we reference from React Native, per style + fill. */
const familyName = (style, fill) =>
  `MaterialSymbols${cap(style)}${fill ? 'Fill' : ''}`;
const cap = s => s[0].toUpperCase() + s.slice(1);

function die(msg) {
  console.error(`gen-icons-font: ${msg}`);
  process.exit(1);
}

function haveFontTools() {
  try {
    execFileSync('python3', ['-c', 'import fontTools, brotli'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) {
    die(`download failed ${res.status}: ${url}`);
  }
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const style = cfg.style;
  if (!VARIABLE[style]) {
    die(`unknown style "${style}" — expected rounded | outlined | sharp`);
  }

  // Resolve every glyph name to a codepoint from the published map, so a typo in
  // the config fails here rather than rendering an invisible tofu box on device.
  const names = Object.entries(cfg.glyphs).filter(([k]) => !k.startsWith('$'));
  const cpMap = await codepoints(style);
  const glyphs = {};
  const missing = [];
  const unicodes = [];
  for (const [semantic, symbol] of names) {
    const cp = cpMap.get(symbol);
    if (cp === undefined) {
      missing.push(`${semantic} -> ${symbol}`);
      continue;
    }
    glyphs[semantic] = String.fromCodePoint(parseInt(cp, 16));
    unicodes.push(`U+${cp.toUpperCase()}`);
  }
  if (missing.length) {
    die(`glyph names not in Material Symbols: ${missing.join(', ')}`);
  }

  const ts = renderTs(cfg, style, glyphs);

  if (CHECK) {
    const current = existsSync(OUT_TS) ? readFileSync(OUT_TS, 'utf8') : '';
    if (current !== ts) {
      die('src/theme/icons.generated.ts is stale. Run `npm run icons`.');
    }
    // The fonts the map references must exist.
    for (const fill of cfg.fillOnActive ? [0, 1] : [0]) {
      const f = join(FONTS, `${familyName(style, fill)}.ttf`);
      if (!existsSync(f)) {
        die(`missing font ${f}. Run \`npm run icons\`.`);
      }
    }
    console.log(
      `icons OK, ${Object.keys(glyphs).length} glyphs, style=${style}`,
    );
    return;
  }

  if (!haveFontTools()) {
    die('needs fonttools. Run: python3 -m pip install fonttools brotli');
  }

  mkdirSync(CACHE, { recursive: true });
  mkdirSync(FONTS, { recursive: true });

  const variableTtf = join(CACHE, `${style}-variable.ttf`);
  if (!existsSync(variableTtf)) {
    await download(`${REPO}/${VARIABLE[style]}.ttf`, variableTtf);
  }

  const fills = cfg.fillOnActive ? [0, 1] : [0];
  for (const fill of fills) {
    const family = familyName(style, fill);
    const instanced = join(CACHE, `${family}-instance.ttf`);
    // 1. Pin the variable axes to a single static instance.
    execFileSync('python3', [
      '-m',
      'fontTools.varLib.instancer',
      variableTtf,
      `wght=${cfg.weight}`,
      `opsz=${cfg.opticalSize}`,
      `FILL=${fill}`,
      'GRAD=0',
      '-o',
      instanced,
    ]);
    // 2. Subset to only the glyphs we use, and rename the family so RN resolves
    //    the filled and unfilled instances as distinct faces.
    execFileSync('python3', [
      '-m',
      'fontTools.subset',
      instanced,
      `--unicodes=${unicodes.join(',')}`,
      `--output-file=${join(FONTS, `${family}.ttf`)}`,
      `--name-IDs=*`,
      `--recalc-timestamp`,
    ]);
    renameFamily(join(FONTS, `${family}.ttf`), family);
  }

  writeFileSync(OUT_TS, ts);
  rmSync(CACHE, { recursive: true, force: true });
  const sizes = fills
    .map(f => {
      const p = join(FONTS, `${familyName(style, f)}.ttf`);
      return `${familyName(style, f)}=${Math.round(
        readFileSync(p).length / 1024,
      )}KB`;
    })
    .join(', ');
  console.log(
    `icons OK, ${Object.keys(glyphs).length} glyphs, style=${style} w${
      cfg.weight
    }, ${sizes}`,
  );
}

/** Rewrite the font's family name so two instances are distinct faces on Android. */
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

async function codepoints(style) {
  const url = `${REPO}/${VARIABLE[style]}.codepoints`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) {
    die(`codepoints download failed ${res.status}`);
  }
  const map = new Map();
  for (const line of (await res.text()).split('\n')) {
    const [name, cp] = line.trim().split(' ');
    if (name && cp) {
      map.set(name, cp);
    }
  }
  return map;
}

function renderTs(cfg, style, glyphs) {
  const names = Object.keys(glyphs).sort();
  const entries = names
    .map(n => `  ${n}: ${JSON.stringify(glyphs[n])},`)
    .join('\n');
  const union = names.map(n => `'${n}'`).join(' | ');
  return `/**
 * GENERATED by scripts/gen-icons-font.mjs from design/icons.json. Do not edit.
 *
 * Each value is the Material Symbols ${style} codepoint as a string, rendered as
 * <Text> in src/components/Icon.tsx. Family baked at weight ${cfg.weight},
 * optical size ${cfg.opticalSize}. Two faces: '${familyName(style, false)}'
 * (outlined) and '${familyName(style, true)}' (filled, the active state).
 */

export const ICON_FAMILY = '${familyName(style, false)}' as const;
export const ICON_FAMILY_FILLED = '${familyName(
    style,
    cfg.fillOnActive,
  )}' as const;
export const ICON_FILL_ON_ACTIVE = ${cfg.fillOnActive} as const;

export type IconName = ${union};

export const ICON_GLYPH: Record<IconName, string> = {
${entries}
};
`;
}

main().catch(e => die(String(e)));
