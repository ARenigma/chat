#!/usr/bin/env node
/**
 * Icon font generator: design/icons.json -> the bundled icon fonts + a glyph map.
 *
 * Mirrors gen-tokens.mjs. The config is the source of truth; this turns it into
 * artifacts and a `--check` mode gates drift in CI, exactly like the token and
 * theme generators.
 *
 * WHY A FONT (not SVG). react-native-svg is banned here (it throws
 * synchronouslyUpdateUIProps inside Reanimated views and kills touch on the
 * subtree, RULE 5), and our Icon sits inside animated Pressables everywhere. A
 * font glyph is plain <Text>: safe in Reanimated, tintable via `color`, scaled
 * by `fontSize`.
 *
 * WHY HEROICONS, TWO FACES. Amit's call: move off Lucide to Heroicons so the
 * icon set has a REAL solid/outline (fill/unfill) pair instead of a single
 * stroke face. Heroicons ships matched 24x24 outline AND solid SVGs for every
 * icon (node_modules/heroicons/24/{outline,solid}), so for each semantic icon we
 * take BOTH svgs, give them the SAME Private-Use codepoint, and build two fonts:
 *
 *   - assets/fonts/Heroicons.ttf       family 'Heroicons'       (outline glyphs)
 *   - assets/fonts/HeroiconsSolid.ttf  family 'HeroiconsSolid'  (solid glyphs)
 *
 * ICON_FILL_ON_ACTIVE is now `true`: Icon.tsx renders the outline family by
 * default and swaps to the solid family when `active`, so a favourited heart, a
 * selected nav tab, or the filled portion of a rating star renders as a genuine
 * filled glyph rather than the old over-drawn outline hack.
 *
 * HYBRID FALLBACK TO LUCIDE. A handful of semantic icons have NO correct
 * Heroicons equivalent (double-tick read receipt, muted mic, camera-flip,
 * keyboard, sticker, a bare dot, an ear, wind). Rather than substitute a
 * wrong-meaning Heroicons glyph, those stay on the Lucide face for that one
 * glyph: design/icons.json's `heroicons` map sets them to null, and this
 * generator keeps assets/fonts/Lucide.ttf (subset to just those glyphs) and
 * marks them per-name in ICON_FAMILY_BY_NAME. Lucide has no solid twin, so a
 * fallback glyph renders the same face in both states (colour carries `active`).
 *
 * DEV-ONLY TOOLING (RULE 5 is about RUNTIME deps; these are build-time):
 *   - `heroicons`   the source SVGs (MIT, Tailwind Labs)
 *   - `fantasticon` SVG-folder -> TTF, offline, with an explicit codepoints map
 *   - `lucide-static` the fallback face + its native codepoints
 * REQUIRES: python3 with fonttools (rename the font family; subset Lucide).
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { generateFonts, FontAssetType } from 'fantasticon';
import paper from 'paper-jsdom';
import { PaperOffset } from 'paperjs-offset';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = join(ROOT, 'design/icons.json');
const FONTS = join(ROOT, 'assets/fonts');
const OUT_TS = join(ROOT, 'src/theme/icons.generated.ts');
const HEROICONS = join(ROOT, 'node_modules/heroicons/24');
const LUCIDE = join(ROOT, 'node_modules/lucide-static');

const HERO_FAMILY = 'Heroicons';
const HERO_FAMILY_FILLED = 'HeroiconsSolid';
const LUCIDE_FAMILY = 'Lucide';

const OUT_HERO = join(FONTS, `${HERO_FAMILY}.ttf`);
const OUT_HERO_SOLID = join(FONTS, `${HERO_FAMILY_FILLED}.ttf`);
const OUT_LUCIDE = join(FONTS, `${LUCIDE_FAMILY}.ttf`);
const OUT_HERO_LICENSE = join(FONTS, 'LICENSE-Heroicons.txt');
const OUT_LUCIDE_LICENSE = join(FONTS, 'LICENSE-Lucide.txt');

/** First Private-Use codepoint the Heroicons glyphs are packed from. */
const HERO_CP_START = 0xe001;
/** unitsPerEm the fonts are normalised to, matching the Lucide face's 1000. */
const FONT_HEIGHT = 1000;

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

/** Rewrite a font's family name so RN resolves it by family==filename. */
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

/**
 * Convert a stroke-only Heroicons OUTLINE svg into a filled-path svg.
 *
 * THE GOTCHA THIS EXISTS FOR. svgicons2svgfont (under fantasticon) FILLS a
 * path's `d` and ignores `fill="none" stroke=...`. Heroicons /24/outline are
 * stroke-only, so fed raw they collapse into filled silhouettes — the outline
 * face would look almost identical to the solid one and `active` would toggle
 * nothing visible. So each stroked path is expanded to a filled outline (a
 * hollow ring, two contours) with paper.js first; the result is a real filled
 * path the font tool renders correctly. Solid svgs are already filled and skip
 * this. Verified: raw outline heart = 1 contour ~83% of the solid area; expanded
 * = 2 contours, a thin ring.
 */
function strokeToFillSvg(svgString) {
  const m = /stroke-width="([\d.]+)"/.exec(svgString);
  const strokeW = m ? parseFloat(m[1]) : 1.5;
  paper.project.clear();
  const imported = paper.project.importSVG(svgString, { expandShapes: true });
  const outlined = [];
  const walk = it => {
    if (it.className === 'Path' || it.className === 'CompoundPath') {
      outlined.push(
        PaperOffset.offsetStroke(it, strokeW / 2, {
          cap: 'round',
          join: 'round',
          insert: false,
        }),
      );
    }
    if (it.children) it.children.forEach(walk);
  };
  walk(imported);
  if (outlined.length === 0) {
    die('stroke expansion produced no paths');
  }
  const united = outlined.reduce((a, b) => (a ? a.unite(b) : b), null);
  const d = united.pathData;
  // fill-rule evenodd so the expanded ring's inner contour reads as a hole
  // regardless of the winding the union emitted.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill-rule="evenodd" d="${d}"/></svg>`;
}

/**
 * Build one Heroicons face from a folder of per-semantic SVGs.
 *
 * fantasticon keys glyphs by the svg filename, so each icon's svg is written as
 * `<semantic>.svg` and `codepoints[semantic]` fixes its Private-Use codepoint —
 * the SAME map is passed for both outline and solid, which is what makes the two
 * faces share a codepoint per icon.
 */
async function buildHeroFace(variant, family, out, semanticToHero, codepoints) {
  const srcDir = join(HEROICONS, variant); // 'outline' | 'solid'
  const tmp = join(tmpdir(), `pappal-hero-${variant}-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (const [semantic, heroName] of Object.entries(semanticToHero)) {
    const svg = join(srcDir, `${heroName}.svg`);
    if (!existsSync(svg)) {
      die(`heroicons has no 24/${variant}/${heroName}.svg (for ${semantic})`);
    }
    if (variant === 'outline') {
      writeFileSync(
        join(tmp, `${semantic}.svg`),
        strokeToFillSvg(readFileSync(svg, 'utf8')),
      );
    } else {
      copyFileSync(svg, join(tmp, `${semantic}.svg`));
    }
  }
  const res = await generateFonts(
    {
      inputDir: tmp,
      outputDir: tmp,
      name: family,
      fontTypes: [FontAssetType.TTF],
      assetTypes: [],
      codepoints,
      fontHeight: FONT_HEIGHT,
      normalize: true,
    },
    false,
  );
  const ttf = res.assetsOut[FontAssetType.TTF];
  if (ttf === undefined) {
    die(`fantasticon produced no TTF for ${family}`);
  }
  writeFileSync(out, ttf);
  renameFamily(out, family);
  rmSync(tmp, { recursive: true, force: true });
}

async function main() {
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const lucideCpPath = join(LUCIDE, 'font/codepoints.json');
  if (!existsSync(lucideCpPath)) {
    die(
      'lucide-static not installed. Run: npm install --save-dev lucide-static',
    );
  }
  const lucideCp = JSON.parse(readFileSync(lucideCpPath, 'utf8'));

  const lucideNames = Object.entries(cfg.glyphs).filter(
    ([k]) => !k.startsWith('$'),
  );
  const heroMap = cfg.heroicons ?? {};

  // Partition every semantic icon into a Heroicons glyph or a Lucide fallback.
  const heroSemantic = {}; // semantic -> heroicons name
  const lucideFallback = {}; // semantic -> lucide name
  const missingHero = [];
  for (const [semantic, lucideName] of lucideNames) {
    const hero = heroMap[semantic];
    if (hero === undefined) {
      missingHero.push(semantic);
    } else if (hero === null) {
      lucideFallback[semantic] = lucideName;
    } else {
      heroSemantic[semantic] = hero;
    }
  }
  if (missingHero.length) {
    die(
      `design/icons.json "heroicons" is missing entries (set a Heroicons name ` +
        `or null for a Lucide fallback): ${missingHero.join(', ')}`,
    );
  }

  // Deterministic codepoints: sorted Heroicons semantic names, packed from
  // HERO_CP_START. Lucide fallbacks keep their native Lucide codepoints; the two
  // faces never share a cmap, so a numeric overlap between the two schemes is
  // harmless (each glyph is only ever looked up in its own family).
  const heroSorted = Object.keys(heroSemantic).sort();
  const heroCodepoints = {};
  heroSorted.forEach((semantic, i) => {
    heroCodepoints[semantic] = HERO_CP_START + i;
  });

  const glyphs = {}; // semantic -> glyph char
  const familyByName = {}; // semantic -> outline family
  const familyFilledByName = {}; // semantic -> solid family
  for (const semantic of Object.keys(heroSemantic)) {
    glyphs[semantic] = String.fromCodePoint(heroCodepoints[semantic]);
    familyByName[semantic] = HERO_FAMILY;
    familyFilledByName[semantic] = HERO_FAMILY_FILLED;
  }
  const missingLucide = [];
  for (const [semantic, lucideName] of Object.entries(lucideFallback)) {
    const code = lucideCp[lucideName];
    if (code === undefined) {
      missingLucide.push(`${semantic} -> ${lucideName}`);
      continue;
    }
    glyphs[semantic] = String.fromCodePoint(code);
    // Lucide has no solid twin, so both states resolve to the one Lucide face.
    familyByName[semantic] = LUCIDE_FAMILY;
    familyFilledByName[semantic] = LUCIDE_FAMILY;
  }
  if (missingLucide.length) {
    die(
      `Lucide fallback names not in lucide-static: ${missingLucide.join(', ')}`,
    );
  }

  const ts = renderTs(glyphs, familyByName, familyFilledByName);
  const usesLucide = Object.keys(lucideFallback).length > 0;

  if (CHECK) {
    const current = existsSync(OUT_TS) ? readFileSync(OUT_TS, 'utf8') : '';
    if (current !== ts) {
      die('src/theme/icons.generated.ts is stale. Run `npm run icons:font`.');
    }
    for (const f of [OUT_HERO, OUT_HERO_SOLID, OUT_HERO_LICENSE]) {
      if (!existsSync(f)) die(`missing ${f}. Run \`npm run icons:font\`.`);
    }
    if (usesLucide) {
      for (const f of [OUT_LUCIDE, OUT_LUCIDE_LICENSE]) {
        if (!existsSync(f)) die(`missing ${f}. Run \`npm run icons:font\`.`);
      }
    }
    console.log(
      `icons OK, ${Object.keys(glyphs).length} glyphs ` +
        `(${heroSorted.length} Heroicons, ${
          Object.keys(lucideFallback).length
        } Lucide fallback)`,
    );
    return;
  }

  if (!haveFontTools()) {
    die('needs fonttools. Run: python3 -m pip install fonttools');
  }

  mkdirSync(FONTS, { recursive: true });

  // paper.js runs on the 24x24 Heroicons grid; strokeToFillSvg uses it.
  paper.setup(new paper.Size(24, 24));

  // Two Heroicons faces, same codepoints per icon.
  await buildHeroFace(
    'outline',
    HERO_FAMILY,
    OUT_HERO,
    heroSemantic,
    heroCodepoints,
  );
  await buildHeroFace(
    'solid',
    HERO_FAMILY_FILLED,
    OUT_HERO_SOLID,
    heroSemantic,
    heroCodepoints,
  );
  copyFileSync(join(ROOT, 'node_modules/heroicons/LICENSE'), OUT_HERO_LICENSE);

  // The Lucide fallback face, subset to just the fallback glyphs at their native
  // codepoints — the same lean-asset discipline the old full-Lucide pipeline had.
  if (usesLucide) {
    copyFileSync(join(LUCIDE, 'font/lucide.ttf'), OUT_LUCIDE);
    const unicodes = Object.entries(lucideFallback)
      .map(([, name]) => `U+${lucideCp[name].toString(16).toUpperCase()}`)
      .join(',');
    execFileSync('python3', [
      '-m',
      'fontTools.subset',
      OUT_LUCIDE,
      `--unicodes=${unicodes}`,
      `--output-file=${OUT_LUCIDE}`,
      '--name-IDs=*',
      '--recalc-timestamp',
    ]);
    renameFamily(OUT_LUCIDE, LUCIDE_FAMILY);
    copyFileSync(join(LUCIDE, 'LICENSE'), OUT_LUCIDE_LICENSE);
  }

  writeFileSync(OUT_TS, ts);
  console.log(
    `icons OK, ${Object.keys(glyphs).length} glyphs ` +
      `(${heroSorted.length} Heroicons, ${
        Object.keys(lucideFallback).length
      } Lucide fallback), ` +
      `${Math.round(readFileSync(OUT_HERO).length / 1024)}KB + ` +
      `${Math.round(readFileSync(OUT_HERO_SOLID).length / 1024)}KB solid`,
  );
}

function renderTs(glyphs, familyByName, familyFilledByName) {
  const names = Object.keys(glyphs).sort();
  const glyphEntries = names
    .map(n => `  ${n}: ${JSON.stringify(glyphs[n])},`)
    .join('\n');
  const outlineEntries = names
    .map(n => `  ${n}: ${JSON.stringify(familyByName[n])},`)
    .join('\n');
  const solidEntries = names
    .map(n => `  ${n}: ${JSON.stringify(familyFilledByName[n])},`)
    .join('\n');
  const union = names.map(n => `'${n}'`).join(' | ');
  return `/**
 * GENERATED by scripts/gen-icons-font.mjs from design/icons.json. Do not edit.
 *
 * Each ICON_GLYPH value is a Private-Use codepoint rendered as <Text> in
 * src/components/Icon.tsx. Most icons are Heroicons and ship a matched outline
 * ('${HERO_FAMILY}') and solid ('${HERO_FAMILY_FILLED}') face at the same
 * codepoint, so \`active\` swaps to a genuine filled glyph
 * (ICON_FILL_ON_ACTIVE = true). A few icons with no correct Heroicons twin fall
 * back to the '${LUCIDE_FAMILY}' face (no solid variant; both states resolve to
 * it). ICON_FAMILY_BY_NAME / ICON_FAMILY_FILLED_BY_NAME carry the per-icon face.
 */

export const ICON_FAMILY = '${HERO_FAMILY}' as const;
export const ICON_FAMILY_FILLED = '${HERO_FAMILY_FILLED}' as const;
export const ICON_FILL_ON_ACTIVE = true as const;

export type IconName = ${union};

export const ICON_GLYPH: Record<IconName, string> = {
${glyphEntries}
};

/** The face that renders each icon in its default (outline / unfilled) state. */
export const ICON_FAMILY_BY_NAME: Record<IconName, string> = {
${outlineEntries}
};

/** The face that renders each icon when \`active\` (solid / filled). */
export const ICON_FAMILY_FILLED_BY_NAME: Record<IconName, string> = {
${solidEntries}
};
`;
}

main().catch(err => die(err?.stack ?? String(err)));
