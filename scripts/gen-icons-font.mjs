#!/usr/bin/env node
/**
 * Icon font generator: design/icons.json -> assets/fonts/Phosphor.ttf + a glyph map.
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
 * WHY PHOSPHOR, ONE FACE. Amit's call, 2026-09-26: move every glyph to
 * Phosphor and remove Heroicons and Lucide completely. The app had been running
 * three faces (Heroicons outline, Heroicons solid, a Lucide subset for the nine
 * icons Heroicons had no twin for). Phosphor covers all of them, and it ships
 * its weights as separate SVGs in ONE naming scheme (`heart` / `heart-fill`), so
 * a regular glyph and its fill glyph can live in the SAME font at two
 * codepoints. That removes the per-icon family table the three-face setup
 * needed: every glyph is `fontFamily: 'Phosphor'`, and `active` picks a
 * codepoint rather than a face.
 *
 * WHAT GOES IN THE FONT. Exactly the glyphs design/icons.json names: every
 * `glyphs` entry (the config's `outlineWeight`, or fill for a name ending
 * `-fill`), plus
 * every `active` entry (always a `-fill`). A Phosphor name used by two semantic
 * entries is one glyph, not two.
 *
 * NO STROKE EXPANSION. The Heroicons pipeline had to run paper.js over every
 * outline SVG, because Heroicons outline is stroke-only and the font tool fills
 * a path's `d` and ignores `stroke`. Phosphor's core SVGs are already filled
 * outlines at every weight (checked: regular `heart.svg` is one path whose
 * inner contour winds the other way), so they go into the font as they are,
 * and `paper-jsdom` + `paperjs-offset` left with that step.
 *
 * DETERMINISTIC, ON PURPOSE. Two runs from the same config produce the same
 * bytes, so a regenerated font that did not change is not a diff. svg2ttf is
 * already pinned to `ts: 0` by fantasticon; the one thing that was stamping the
 * clock in was fontTools, whose save() recalculates head.modified by default
 * (the old pipeline changed all three .ttf files on every run for that reason
 * alone). The family rename below opens the font with recalcTimestamp=False.
 *
 * DEV-ONLY TOOLING (RULE 5 is about RUNTIME deps; these are build-time):
 *   - `@phosphor-icons/core` the source SVGs (MIT, Phosphor Icons), pinned exact
 *   - `fantasticon`          SVG folder -> TTF, offline, explicit codepoints
 * REQUIRES: python3 with fonttools (rename the font family).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = join(ROOT, 'design/icons.json');
const FONTS = join(ROOT, 'assets/fonts');
const OUT_TS = join(ROOT, 'src/theme/icons.generated.ts');
const PHOSPHOR = join(ROOT, 'node_modules/@phosphor-icons/core');

const FAMILY = 'Phosphor';
const OUT_FONT = join(FONTS, `${FAMILY}.ttf`);
const OUT_LICENSE = join(FONTS, 'LICENSE-Phosphor.txt');

/** First Private-Use codepoint the glyphs are packed from. */
const CP_START = 0xe001;
/**
 * unitsPerEm the font is normalised to. Kept at the 1000 every previous icon
 * face used, with the same ascent 1000 / descent 0 fantasticon writes, so the
 * glyph sits in its em box exactly where the old faces did and Icon.tsx's
 * square line-height box needs no change.
 */
const FONT_HEIGHT = 1000;

/**
 * The window of Phosphor's 256-unit grid that becomes the em: 3..253.
 *
 * WHY NOT THE WHOLE 256. TOKENS.icon is an INK-dp scale (design/tokens.json's
 * icon $note, ADR-0030): `fontSize = round(size * ICON_SCALE)` and the ink a
 * glyph draws inside that em is what the number means. The scale was
 * calibrated against a set whose full-bleed mark inked 19.97 of its 24 grid
 * units (0.832 of the em). Phosphor's full-bleed mark inks 208 of 256 (median
 * across the 55 icons here, measured with a fontTools BoundsPen over this
 * font), which is 0.8125: every icon 2.4% smaller than the size it was given,
 * and the xs/sm/2xl steps (12/16/32) more than 3% under their own dp.
 *
 * Mapping a 250-unit window onto the em instead puts that 208 at 0.832 again,
 * so every `size` in the app and ICON_SCALE keep the meaning they were chosen
 * with and none of them move (re-measured after the crop: median 19.968 of 24,
 * the old set's 19.97 to three figures).
 *
 * The crop is 3 units a side, inside Phosphor's own 16-unit padding. Three
 * glyphs reach past it horizontally, because Phosphor draws them to the grid
 * edge itself: `users` (2.2..253.8) and `video-camera` / `video-camera-slash`
 * (16..256, the lens). They overflow the em by at most 12 of 1000 units, 0.3dp
 * at the md step, and are named here so a device check knows where to look.
 */
const EM_WINDOW = { origin: 3, size: 250 };

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

/**
 * Rewrite the font's family name so RN resolves it by family == filename, and
 * stamp the source hash into the unique-ID record (nameID 3) so `--check` can
 * tell a stale font from a current one without a font parser.
 */
/**
 * Read the built font's own cmap and fail unless every glyph sits at the
 * codepoint the TS map hands the app. The TS map is generated from
 * `codepoints`; this proves the FONT agrees, which no other check does.
 */
function verifyCmap(ttf, codepoints) {
  const out = execFileSync('python3', [
    '-c',
    [
      'import sys, json',
      'from fontTools.ttLib import TTFont',
      'cm=TTFont(sys.argv[1]).getBestCmap()',
      'print(json.dumps({str(k): v for k, v in cm.items()}))',
    ].join('\n'),
    ttf,
  ]).toString();
  const cmap = JSON.parse(out);
  const wrong = Object.entries(codepoints)
    .filter(([name, cp]) => cmap[String(cp)] !== name)
    .map(
      ([name, cp]) =>
        `${name} expected at U+${cp.toString(16).toUpperCase()}, font has ${
          cmap[String(cp)] ?? 'nothing'
        }`,
    );
  const extra = Object.keys(cmap).length - Object.keys(codepoints).length;
  if (wrong.length || extra !== 0) {
    die(
      `${ttf} does not match the glyph map (${extra} extra codepoints):\n  ${wrong
        .slice(0, 10)
        .join('\n  ')}`,
    );
  }
}

function renameFamily(ttf, family, sourceHash) {
  execFileSync('python3', [
    '-c',
    [
      'import sys',
      'from fontTools.ttLib import TTFont',
      // recalcTimestamp=False: see DETERMINISTIC in the header.
      'f=TTFont(sys.argv[1], recalcTimestamp=False); fam=sys.argv[2]',
      'for r in f["name"].names:',
      '  if r.nameID in (1,4,6,16): r.string=fam',
      '  if r.nameID in (2,17): r.string="Regular"',
      '  if r.nameID == 3: r.string=fam+":"+sys.argv[3]',
      'f.save(sys.argv[1])',
    ].join('\n'),
    ttf,
    family,
    sourceHash,
  ]);
}

/** The package's own version, read from its manifest rather than assumed. */
function phosphorVersion() {
  const manifest = join(PHOSPHOR, 'package.json');
  if (!existsSync(manifest)) {
    die(
      '@phosphor-icons/core not installed. Run: npm ci (it is a pinned devDependency).',
    );
  }
  return JSON.parse(readFileSync(manifest, 'utf8')).version;
}

/**
 * The ONE outline weight every plain name draws in (design/icons.json
 * `outlineWeight`): `regular` or `bold`. Bold since 2026-10-10 (owner, from a
 * Phosphor regular / bold / Tabler comparison). One weight only: a second
 * outline weight would be a second visual system inside one font.
 */
const OUTLINE_WEIGHTS = new Set(['regular', 'bold']);
let outlineWeight = 'regular';
/**
 * The weight a LIST ROW draws its outline glyphs in (design/icons.json
 * `listWeight`), when it differs from `outlineWeight`. Owner, 2026-10-11: bold
 * suits a glyph that stands alone (bar, header, composer) but a column of bold
 * row icons in Settings read too heavy, so rows draw regular. Two weights, each
 * with one job; every plain glyph gets a `<name>--list` twin in the face.
 */
let listWeight = 'regular';
// One hyphen and no real Phosphor name ends in it: fantasticon slugs glyph
// names (a `--` collapsed to `-`), and a name it rewrites misses its codepoint
// and is auto-numbered from U+F101, which the app never asks for (2026-10-12:
// the Settings rows drew CJK fallback glyphs). verifyCmap below now fails that.
const LIST_SUFFIX = '-rowweight';

/**
 * `heart` -> assets/<outlineWeight>/heart(-bold).svg; `heart-fill` ->
 * assets/fill/heart-fill.svg. Phosphor suffixes every weight but regular.
 */
function svgPath(name) {
  if (name.endsWith(LIST_SUFFIX)) {
    const base = name.slice(0, -LIST_SUFFIX.length);
    const file = listWeight === 'regular' ? base : `${base}-${listWeight}`;
    return join(PHOSPHOR, 'assets', listWeight, `${file}.svg`);
  }
  if (name.endsWith('-fill')) {
    return join(PHOSPHOR, 'assets', 'fill', `${name}.svg`);
  }
  const file = outlineWeight === 'regular' ? name : `${name}-${outlineWeight}`;
  return join(PHOSPHOR, 'assets', outlineWeight, `${file}.svg`);
}

function entries(map) {
  return Object.entries(map ?? {}).filter(([k]) => !k.startsWith('$'));
}

async function main() {
  const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  if (cfg.family !== FAMILY) {
    die(`design/icons.json "family" must be "${FAMILY}", got "${cfg.family}"`);
  }
  const version = phosphorVersion();
  outlineWeight = cfg.outlineWeight ?? 'regular';
  if (!OUTLINE_WEIGHTS.has(outlineWeight)) {
    die(
      `design/icons.json "outlineWeight" must be regular or bold, got "${outlineWeight}"`,
    );
  }
  listWeight = cfg.listWeight ?? outlineWeight;
  if (!OUTLINE_WEIGHTS.has(listWeight)) {
    die(
      `design/icons.json "listWeight" must be regular or bold, got "${listWeight}"`,
    );
  }
  const hasList = listWeight !== outlineWeight;

  const glyphs = entries(cfg.glyphs); // [semantic, phosphor]
  const active = entries(cfg.active); // [semantic, phosphor-fill]
  const semantic = new Set(glyphs.map(([s]) => s));

  const problems = [];
  for (const [s, name] of active) {
    if (!semantic.has(s)) {
      problems.push(`active.${s} has no entry in glyphs`);
    }
    // An `active` glyph that is not a fill would make `active` change nothing a
    // member can see; that is a config mistake, not a style.
    if (!name.endsWith('-fill')) {
      problems.push(`active.${s} -> ${name} must be a -fill glyph`);
    }
  }
  // The list twin of every plain glyph, when rows draw a different weight.
  const listGlyphs = hasList
    ? glyphs
        .filter(([, n]) => !n.endsWith('-fill'))
        .map(([sem, n]) => [sem, `${n}${LIST_SUFFIX}`])
    : [];
  const phosphorNames = [
    ...new Set([...glyphs, ...active, ...listGlyphs].map(([, n]) => n)),
  ].sort();
  for (const name of phosphorNames) {
    if (!existsSync(svgPath(name))) {
      problems.push(
        `@phosphor-icons/core ${version} has no ${name} (${svgPath(name).slice(
          ROOT.length,
        )})`,
      );
    }
  }
  if (problems.length) {
    die(`design/icons.json:\n  ${problems.join('\n  ')}`);
  }

  // Deterministic codepoints: the distinct Phosphor names, sorted, packed from
  // CP_START. Keyed by the PHOSPHOR name rather than the semantic one so an
  // `active` fill and a `glyphs` fill that happen to be the same drawing share
  // a codepoint.
  const codepoints = {};
  phosphorNames.forEach((name, i) => {
    codepoints[name] = CP_START + i;
  });

  // The hash covers everything that decides the font's bytes: the package
  // version, and each glyph's name, codepoint and SVG source. It is written into
  // both the TS header and the font, so `--check` fails if either is stale.
  const hash = createHash('sha256');
  hash.update(`@phosphor-icons/core@${version}\n`);
  hash.update(`em ${EM_WINDOW.origin} ${EM_WINDOW.size}\n`);
  for (const name of phosphorNames) {
    hash.update(`${name}\t${codepoints[name]}\t`);
    hash.update(readFileSync(svgPath(name)));
    hash.update('\n');
  }
  const sourceHash = hash.digest('hex').slice(0, 16);

  const ts = renderTs({
    version,
    sourceHash,
    glyph: Object.fromEntries(
      glyphs.map(([s, n]) => [s, String.fromCodePoint(codepoints[n])]),
    ),
    activeGlyph: Object.fromEntries(
      active.map(([s, n]) => [s, String.fromCodePoint(codepoints[n])]),
    ),
    listGlyph: Object.fromEntries(
      listGlyphs.map(([s, n]) => [s, String.fromCodePoint(codepoints[n])]),
    ),
  });

  if (CHECK) {
    const current = existsSync(OUT_TS) ? readFileSync(OUT_TS, 'utf8') : '';
    if (current !== ts) {
      die('src/theme/icons.generated.ts is stale. Run `npm run icons:font`.');
    }
    for (const f of [OUT_FONT, OUT_LICENSE]) {
      if (!existsSync(f)) die(`missing ${f}. Run \`npm run icons:font\`.`);
    }
    // fontTools writes the Windows name records as UTF-16BE and the Mac ones as
    // ASCII; either encoding of the unique ID is proof the font was built from
    // this exact source.
    if (haveFontTools()) {
      verifyCmap(OUT_FONT, codepoints);
    }
    const font = readFileSync(OUT_FONT);
    const id = `${FAMILY}:${sourceHash}`;
    const utf16be = Buffer.from(id, 'utf16le').swap16();
    if (!font.includes(id) && !font.includes(utf16be)) {
      die(`${OUT_FONT} is stale (no ${id}). Run \`npm run icons:font\`.`);
    }
    console.log(
      `icons:font OK, ${glyphs.length} icons, ${phosphorNames.length} Phosphor glyphs (${version}, ${sourceHash})`,
    );
    return;
  }

  if (!haveFontTools()) {
    die('needs fonttools. Run: python3 -m pip install fonttools');
  }

  mkdirSync(FONTS, { recursive: true });

  // fantasticon keys glyphs by svg filename, so each source is copied under its
  // Phosphor name and `codepoints` fixes where it lands.
  const tmp = join(tmpdir(), `pappal-phosphor-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const viewBox = `${EM_WINDOW.origin} ${EM_WINDOW.origin} ${EM_WINDOW.size} ${EM_WINDOW.size}`;
  for (const name of phosphorNames) {
    const svg = readFileSync(svgPath(name), 'utf8');
    if (!svg.includes('viewBox="0 0 256 256"')) {
      die(`${name}.svg is not on Phosphor's 256 grid; EM_WINDOW assumes it is`);
    }
    writeFileSync(
      join(tmp, `${name}.svg`),
      svg.replace('viewBox="0 0 256 256"', `viewBox="${viewBox}"`),
    );
  }
  const res = await generateFonts(
    {
      inputDir: tmp,
      outputDir: tmp,
      name: FAMILY,
      fontTypes: [FontAssetType.TTF],
      assetTypes: [],
      codepoints,
      fontHeight: FONT_HEIGHT,
      // Scales by the viewBox, not the ink: every SVG carries the same
      // EM_WINDOW viewBox, so the grid maps onto the 1000-unit em uniformly and
      // each glyph keeps Phosphor's own optical size relative to the others.
      normalize: true,
    },
    false,
  );
  const ttf = res.assetsOut[FontAssetType.TTF];
  if (ttf === undefined) {
    die('fantasticon produced no TTF');
  }
  writeFileSync(OUT_FONT, ttf);
  renameFamily(OUT_FONT, FAMILY, sourceHash);
  verifyCmap(OUT_FONT, codepoints);
  rmSync(tmp, { recursive: true, force: true });
  copyFileSync(join(PHOSPHOR, 'LICENSE'), OUT_LICENSE);

  writeFileSync(OUT_TS, ts);
  console.log(
    `icons:font OK, ${glyphs.length} icons, ${phosphorNames.length} Phosphor glyphs ` +
      `(${version}, ${sourceHash}), ${readFileSync(OUT_FONT).length} bytes`,
  );
}

function renderTs({ version, sourceHash, glyph, activeGlyph, listGlyph }) {
  const names = Object.keys(glyph).sort();
  const activeNames = Object.keys(activeGlyph).sort();
  const glyphEntries = names
    .map(n => `  ${n}: ${JSON.stringify(glyph[n])},`)
    .join('\n');
  const activeEntries = activeNames
    .map(n => `  ${n}: ${JSON.stringify(activeGlyph[n])},`)
    .join('\n');
  const listEntries = Object.keys(listGlyph)
    .sort()
    .map(n => `  ${n}: ${JSON.stringify(listGlyph[n])},`)
    .join('\n');
  const union = names.map(n => `'${n}'`).join(' | ');
  return `/**
 * GENERATED by scripts/gen-icons-font.mjs from design/icons.json. Do not edit.
 *
 * Source: @phosphor-icons/core ${version}, hash ${sourceHash}.
 *
 * Each value is a Private-Use codepoint in the '${FAMILY}' face, rendered as
 * <Text> in src/components/Icon.tsx. ICON_GLYPH is what every icon draws by
 * default; ICON_GLYPH_ACTIVE is the fill glyph \`active\` swaps to, for the
 * names that have one. One face holds both.
 */

export const ICON_FAMILY = '${FAMILY}' as const;

export type IconName = ${union};

export const ICON_GLYPH: Record<IconName, string> = {
${glyphEntries}
};

/** The fill glyph an \`active\` icon renders; absent names keep ICON_GLYPH. */
export const ICON_GLYPH_ACTIVE: Partial<Record<IconName, string>> = {
${activeEntries}
};

/**
 * The list-row weight (design/icons.json \`listWeight\`) a \`list\` icon renders;
 * absent names (fills, or no separate list weight) keep ICON_GLYPH.
 */
export const ICON_GLYPH_LIST: Partial<Record<IconName, string>> = {
${listEntries}
};
`;
}

main().catch(err => die(err?.stack ?? String(err)));
