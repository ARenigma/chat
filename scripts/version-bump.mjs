#!/usr/bin/env node
/**
 * Moves VERSION_NAME on by one patch digit.
 *
 * ADR-0008 said a version name that increments itself stops meaning anything,
 * and that still holds for the number users see on Play: major and minor are
 * judgement calls and stay hand-edited. The patch digit on an internal build is
 * different. It is not a claim about the release, it is a sequence number so a
 * tester can tell 1.0.4 from 1.0.3 in the update prompt, and making a person
 * type it is how you get two builds sharing a version and an update nobody is
 * offered.
 *
 * So: patch is mechanical, major and minor are not. Editing
 * android/gradle.properties by hand for those is the intended path.
 *
 *   node scripts/version-bump.mjs           1.0.1 -> 1.0.2
 *   node scripts/version-bump.mjs minor     1.0.9 -> 1.1.0
 *   node scripts/version-bump.mjs major     1.4.2 -> 2.0.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PROPS = fileURLToPath(
  new URL('../android/gradle.properties', import.meta.url),
);
const part = process.argv[2] ?? 'patch';

if (!['major', 'minor', 'patch'].includes(part)) {
  console.error(`Unknown part "${part}". Expected major, minor or patch.`);
  process.exit(1);
}

const text = readFileSync(PROPS, 'utf8');
const match = /^VERSION_NAME=(\d+)\.(\d+)\.(\d+)$/m.exec(text);
if (match === null) {
  console.error(
    'VERSION_NAME is missing or malformed in android/gradle.properties.',
  );
  process.exit(1);
}

const [major, minor, patch] = match.slice(1, 4).map(Number);
const next =
  part === 'major'
    ? [major + 1, 0, 0]
    : part === 'minor'
    ? [major, minor + 1, 0]
    : [major, minor, patch + 1];

// Guarded because the internal versionCode is major*10000 + minor*100 + patch,
// so a minor or patch reaching 100 would collide with the next place up and stop
// being monotonic. Failing here beats a tester silently never being offered a
// build again.
if (next[1] > 99 || next[2] > 99) {
  console.error(
    `Refusing to produce ${next.join(
      '.',
    )}: minor and patch must stay under 100,\n` +
      'because the internal versionCode packs them as MAJOR*10000 + MINOR*100 + PATCH.\n' +
      'Bump the next place up instead.',
  );
  process.exit(1);
}

const from = match[0].split('=')[1];
const to = next.join('.');
writeFileSync(PROPS, text.replace(match[0], `VERSION_NAME=${to}`));

const code = next[0] * 10000 + next[1] * 100 + next[2];
console.log(`VERSION_NAME ${from} -> ${to}  (internal versionCode ${code})`);
