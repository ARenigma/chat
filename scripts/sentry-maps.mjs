#!/usr/bin/env node
/**
 * Upload the JS bundle and its source map to Sentry for a Play build.
 *
 * WHY THIS IS A SCRIPT AND NOT THE GRADLE PLUGIN.
 *
 * `@sentry/react-native`'s sentry.gradle IS applied for `release` and
 * `closedTest` (android/app/build.gradle guards on `wantsRelease ||
 * wantsClosedTest`), and it demonstrably runs: the build log carries its
 * "Reading source map" and "Modules collected" lines. It then does not upload,
 * and it does not say why. Two Play builds shipped with no symbolication
 * before anyone noticed, because the absence looks exactly like success:
 * BUILD SUCCESSFUL, an AAB on disk, and nothing in Sentry until you go and
 * look for the release.
 *
 * A step that can skip itself silently is not a step. This one exits non-zero
 * when it cannot do its job, so a build that should have symbols and does not
 * fails at the point of the mistake rather than at the point of the crash.
 *
 * Usage, versionCode required because Play builds demand an explicit one and
 * the dist MUST equal it or the stack frames do not resolve:
 *
 *   node scripts/sentry-maps.mjs --version-code 10207 [--variant closedTest]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

const variant = arg('variant') ?? 'closedTest';
const versionCode = arg('version-code') ?? process.env.CI_PIPELINE_IID ?? null;

if (versionCode === null) {
  console.error(
    'sentry-maps: --version-code is required.\n' +
      '  It becomes the Sentry `dist`, and a dist that disagrees with the\n' +
      '  installed versionCode resolves no frames at all.',
  );
  process.exit(1);
}

const props = readFileSync(join(ROOT, 'android/gradle.properties'), 'utf8');
const versionName = /^VERSION_NAME=(.+)$/m.exec(props)?.[1]?.trim();
if (versionName === undefined) {
  console.error('sentry-maps: no VERSION_NAME in android/gradle.properties');
  process.exit(1);
}

// The release name Sentry.init reports at runtime is `<applicationId>@<versionName>+<versionCode>`.
// It has to match here exactly or the upload lands on a release nothing reports to.
const release = `com.companionchat@${versionName}+${versionCode}`;

const bundle = join(
  ROOT,
  `android/app/build/generated/assets/react/${variant}/index.android.bundle`,
);
const map = join(
  ROOT,
  `android/app/build/generated/sourcemaps/react/${variant}/index.android.bundle.map`,
);

for (const [what, path] of [
  ['bundle', bundle],
  ['source map', map],
]) {
  if (!existsSync(path)) {
    console.error(
      `sentry-maps: no ${what} at ${path}\n` +
        `  Build the variant first: npm run android:bundle:closed`,
    );
    process.exit(1);
  }
}

// The token is read from android/sentry.properties, which is gitignored. Passing
// it through the environment rather than a flag keeps it out of the process list.
const sentryProps = readFileSync(
  join(ROOT, 'android/sentry.properties'),
  'utf8',
);
const token = /^auth\.token=(.+)$/m.exec(sentryProps)?.[1]?.trim();
const org = /^defaults\.org=(.+)$/m.exec(sentryProps)?.[1]?.trim();
const project = /^defaults\.project=(.+)$/m.exec(sentryProps)?.[1]?.trim();

if (token === undefined || org === undefined || project === undefined) {
  console.error(
    'sentry-maps: android/sentry.properties needs auth.token, defaults.org, defaults.project',
  );
  process.exit(1);
}

const env = {
  ...process.env,
  SENTRY_AUTH_TOKEN: token,
  SENTRY_ORG: org,
  SENTRY_PROJECT: project,
};
const run = args =>
  execFileSync('sentry-cli', args, { env, stdio: 'inherit', cwd: ROOT });

console.log(
  `sentry-maps: ${release} (dist ${versionCode}, variant ${variant})`,
);
run(['releases', 'new', release]);
run([
  'sourcemaps',
  'upload',
  '--release',
  release,
  '--dist',
  versionCode,
  '--strip-prefix',
  ROOT,
  bundle,
  map,
]);
console.log(`sentry-maps OK - ${release}`);
