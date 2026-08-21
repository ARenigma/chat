#!/usr/bin/env node
/**
 * Emits the Android launcher icons from the masters in `design/brand/`.
 *
 * Same reasoning as `gen-tokens.mjs`: the densities are derived, not drawn. Ten
 * hand-resized PNGs is ten chances for one of them to be the old mark, and the
 * one that goes stale is always the density you do not own a device for.
 *
 * The masters come out of Figma at 1024 and are committed, so this runs offline
 * and a regenerated icon is a reviewable diff rather than a trip to a design
 * tool. `sips` ships with macOS; `--check` mode is what CI uses, and it needs no
 * resizing at all, so a Linux runner can still gate on it.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RES = join(ROOT, 'android/app/src/main/res');
const BRAND = join(ROOT, 'design/brand');
const CHECK = process.argv.includes('--check');

/** Density buckets, and the dp each icon kind is specified at. */
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const ICONS = [
  // Pre-API-26 launchers use these directly. minSdk is 24, so they are not
  // vestigial — two Android versions have no adaptive icon support at all.
  {
    master: 'icon-square.png',
    name: 'ic_launcher.png',
    dp: 48,
    edge: 'opaque',
  },
  {
    master: 'icon-round.png',
    name: 'ic_launcher_round.png',
    dp: 48,
    edge: 'alpha',
  },
  // Adaptive layers are specified at 108dp: the outer 18dp on each side is
  // parallax/mask bleed and is never guaranteed to be visible.
  {
    master: 'icon-foreground.png',
    name: 'ic_launcher_foreground.png',
    dp: 108,
    edge: 'alpha',
  },
  {
    master: 'icon-monochrome.png',
    name: 'ic_launcher_monochrome.png',
    dp: 108,
    edge: 'alpha',
  },
  // The notification small icon, at Android's 24dp status-bar size.
  //
  // Without this, firebase-messaging falls back to the launcher icon, and the
  // status bar flattens whatever it is given to pure alpha — which turned our
  // icon into a featureless white ring on the lock screen. Verified on device.
  // The monochrome master is already an alpha-only silhouette, which is exactly
  // what this slot wants, so it is the same art rather than a second drawing.
  {
    master: 'icon-monochrome.png',
    name: 'ic_notification.png',
    dp: 24,
    edge: 'alpha',
    dir: 'drawable',
  },
];

const px = (dp, scale) => Math.round(dp * scale);

/**
 * The top-left pixel of a PNG, as `[r, g, b, a]`.
 *
 * Only the first pixel, which is why this is short rather than a decoder: every
 * PNG filter type reduces to the raw bytes at x=0,y=0, because each one
 * references only the pixel to the left and the row above and both are zero
 * there. So un-filtering is unnecessary for exactly this question.
 */
function topLeftPixel(file) {
  const data = readFileSync(file);
  if (data.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`${file}: not a PNG`);
  }
  let pos = 8;
  let colour = null;
  let depth = null;
  const idat = [];
  while (pos < data.length) {
    const length = data.readUInt32BE(pos);
    const kind = data.toString('ascii', pos + 4, pos + 8);
    if (kind === 'IHDR') {
      depth = data[pos + 16];
      colour = data[pos + 17];
    } else if (kind === 'IDAT') {
      idat.push(data.subarray(pos + 8, pos + 8 + length));
    } else if (kind === 'IEND') {
      break;
    }
    pos += 12 + length;
  }
  if (depth !== 8) {
    throw new Error(`${file}: expected 8-bit, got ${depth}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const first = raw.subarray(1, 5); // skip the scanline's filter byte
  // Colour type 6 is RGBA, 2 is RGB (no alpha channel at all).
  return colour === 6
    ? [first[0], first[1], first[2], first[3]]
    : [first[0], first[1], first[2], 255];
}

/**
 * The check that this whole file exists to make possible.
 *
 * Figma pages carry their own background — #F5F5F5 by default — and an export of
 * a frame with no fill composites against it. The adaptive foreground therefore
 * arrived as an opaque light slab that covered the ink background layer
 * completely: a correct APK, a correct XML, and an icon that looked half drawn.
 * It cost a device build, a screenshot and a pixel probe to find, and it is one
 * byte to test for.
 */
function checkEdgeAlpha(icon, master) {
  const [, , , alpha] = topLeftPixel(master);
  if (icon.edge === 'alpha' && alpha !== 0) {
    return (
      `${icon.master}: corner pixel is opaque (alpha ${alpha}). This master must ` +
      'have a transparent surround — in Figma, set the page background to opacity 0.'
    );
  }
  if (icon.edge === 'opaque' && alpha !== 255) {
    return `${icon.master}: corner pixel is transparent (alpha ${alpha}); this master must be edge to edge.`;
  }
  return null;
}

function resize(master, out, size) {
  // execFileSync with an argument array — never a shell string, so a path with
  // a space cannot become two arguments.
  execFileSync(
    'sips',
    ['-z', String(size), String(size), master, '--out', out],
    {
      stdio: 'ignore',
    },
  );
}

const problems = [];
const written = [];

for (const icon of ICONS) {
  const master = join(BRAND, icon.master);
  if (!existsSync(master)) {
    problems.push(`missing master: design/brand/${icon.master}`);
    continue;
  }
  // Runs in both modes: generating from a bad master is the failure, so it is
  // worth refusing rather than propagating to twenty files.
  const edge = checkEdgeAlpha(icon, master);
  if (edge !== null) {
    problems.push(edge);
    continue;
  }
  const family = icon.dir ?? 'mipmap';
  for (const [bucket, scale] of Object.entries(DENSITY)) {
    const dir = join(RES, `${family}-${bucket}`);
    const out = join(dir, icon.name);
    const size = px(icon.dp, scale);

    if (CHECK) {
      if (!existsSync(out)) {
        problems.push(`missing: ${family}-${bucket}/${icon.name}`);
        continue;
      }
      // Compare mtimes rather than pixels: a master newer than its output is
      // the only staleness this can detect without an image decoder, and it is
      // the one that actually happens (mark redrawn, densities not regenerated).
      if (statSync(master).mtimeMs > statSync(out).mtimeMs + 1000) {
        problems.push(
          `stale: ${family}-${bucket}/${icon.name} is older than ${icon.master}`,
        );
      }
      continue;
    }

    mkdirSync(dir, { recursive: true });
    resize(master, out, size);
    written.push(`${family}-${bucket}/${icon.name} ${size}px`);
  }
}

// The Play Console's own 512x512 listing icon. Not part of the APK, which is
// why it lands in docs/play rather than res/.
const PLAY = join(ROOT, 'docs/play/assets');
if (!CHECK) {
  mkdirSync(PLAY, { recursive: true });
  resize(join(BRAND, 'icon-square.png'), join(PLAY, 'play-icon-512.png'), 512);
  written.push('docs/play/assets/play-icon-512.png 512px');
  // The feature graphic is 1024x500 already; copied so every asset the console
  // asks for is in one directory.
  writeFileSync(
    join(PLAY, 'feature-graphic-1024x500.png'),
    readFileSync(join(BRAND, 'feature-graphic.png')),
  );
  written.push('docs/play/assets/feature-graphic-1024x500.png');
}

if (CHECK) {
  if (problems.length > 0) {
    console.error('icons:check FAILED\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log(
    `icons:check OK — ${
      ICONS.length * Object.keys(DENSITY).length
    } density files present and current`,
  );
  process.exit(0);
}

// Generate mode has to fail on a bad master too, or `npm run icons` reports
// success having silently skipped the layer it refused to build.
if (problems.length > 0) {
  console.error('icons FAILED\n  ' + problems.join('\n  '));
  process.exit(1);
}

console.log(`icons OK — ${written.length} files\n  ${written.join('\n  ')}`);
