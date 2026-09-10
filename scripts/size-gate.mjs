#!/usr/bin/env node
/*
 * JS bundle size regression gate (CTO size gate §32).
 *
 * WHY the JS bundle and not the AAB. The delivered app size is dominated by the
 * Agora RTC native libraries (~28 MB rtc + ffmpeg per ABI), which are fixed and
 * already trimmed of unused extensions (see android/app/build.gradle
 * packagingOptions). The one size vector a code change can move without anyone
 * noticing is the JavaScript bundle: an accidental `import` of a heavy dependency
 * or of a large asset into JS lands here first and silently. This gate makes that
 * a build failure rather than a surprise in a release.
 *
 * The bundle is produced by `npm run bundle:android` (which `npm run verify`
 * already runs immediately before this gate), so this script only reads it.
 *
 * CEILING. Measured 2026-09-10: the release bundle is 5,516,544 bytes (5.26 MiB).
 * The ceiling is 6,000,000 bytes (~5.72 MiB), roughly 9% of headroom — enough for
 * ordinary feature growth, tight enough to catch a stray megabyte. Raise it
 * deliberately, in a commit whose message says what grew and why, the same rule
 * check-contrast.mjs holds for its thresholds.
 */

import { statSync } from 'node:fs';

const BUNDLE = '/tmp/companionchat.android.bundle';
const CEILING = 6_000_000;
const BASELINE = 5_516_544;

let size;
try {
  size = statSync(BUNDLE).size;
} catch {
  console.error(
    `size-gate: no bundle at ${BUNDLE}. Run \`npm run bundle:android\` first ` +
      `(\`npm run verify\` does this for you).`,
  );
  process.exit(1);
}

const mib = n => (n / 1024 / 1024).toFixed(2);
const pctOfCeiling = ((size / CEILING) * 100).toFixed(1);
const deltaVsBaseline = size - BASELINE;
const deltaStr = `${deltaVsBaseline >= 0 ? '+' : ''}${(
  deltaVsBaseline / 1024
).toFixed(0)} KiB vs baseline`;

if (size > CEILING) {
  console.error(
    `size-gate: FAIL — JS bundle is ${mib(
      size,
    )} MiB (${size} bytes), over the ` +
      `${mib(
        CEILING,
      )} MiB ceiling (${deltaStr}). Something heavy was pulled into ` +
      `the bundle; find it (\`npx react-native-bundle-visualizer\` or diff the last ` +
      `import change) rather than raising the ceiling to hide it.`,
  );
  process.exit(1);
}

console.log(
  `size-gate OK — JS bundle ${mib(size)} MiB (${pctOfCeiling}% of the ${mib(
    CEILING,
  )} MiB ceiling, ${deltaStr}).`,
);
