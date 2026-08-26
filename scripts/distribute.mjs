#!/usr/bin/env node
/**
 * Sends the signed `internal` APK to Firebase App Distribution.
 *
 * The `internal` variant, not `release`, and that is the whole point of this
 * script. `internal` is `initWith release` plus the Firebase App Distribution
 * SDK, so a tester gets the real in-app update prompt: open the app, see "a new
 * version is available", accept, done. `release` deliberately carries only the
 * no-op stub of that SDK, because a Play build must not be able to sideload
 * APKs. Distributing `release` would work and testers would never be prompted
 * again, which is the failure this script exists to prevent.
 *
 * Reads the app and project ids from constants rather than env, since neither is
 * a secret: both ship inside every APK.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APK = join(
  ROOT,
  'android/app/build/outputs/apk/internal/app-internal.apk',
);
const APP_ID = '1:305484620007:android:ab6201497a877f32074242';
const PROJECT = 'chat-d8c87';
/** Both founders plus anyone else testing. Managed in the Firebase console. */
const GROUP = 'internal-testers';

const gradleProps = readFileSync(
  join(ROOT, 'android/gradle.properties'),
  'utf8',
);
const version = /^VERSION_NAME=(.+)$/m.exec(gradleProps)?.[1]?.trim();
if (version === undefined) {
  console.error(
    'distribute FAILED: VERSION_NAME is missing from android/gradle.properties.',
  );
  process.exit(1);
}

if (!existsSync(APK)) {
  console.error(
    'distribute FAILED: no signed internal APK.\n' +
      'Run `npm run android:internal` first. If it produced an unsigned APK,\n' +
      'android/keystore.properties is missing, see android/keystore.properties.example.',
  );
  process.exit(1);
}

/**
 * Refuse to upload an APK older than the version it claims to be.
 *
 * The mistake this catches is bumping VERSION_NAME and then distributing without
 * rebuilding, which uploads the previous binary under the new number. Testers are
 * prompted, install, and get the same app: the worst kind of failure, because
 * everything reports success.
 *
 * mtime rather than reading versionName out of the APK: that needs aapt2 from
 * the Android SDK, and a distribute script that depends on build tools is a
 * script that breaks on a machine that can only upload.
 *
 * What it does NOT catch is distributing the same version twice. There is no
 * `releases:list` in the Firebase CLI to check against, so that is handled by
 * `npm run ship:testers`, which bumps before it builds. Stated rather than
 * implied, because a guard you believe is wider than it is is worse than none.
 */
const propsTime = statSync(join(ROOT, 'android/gradle.properties')).mtimeMs;
if (statSync(APK).mtimeMs < propsTime) {
  console.error(
    `distribute FAILED: the internal APK is older than VERSION_NAME (${version}).\n` +
      'Run `npm run android:internal` to rebuild, or `npm run ship:testers` to do\n' +
      'the bump, the build and the upload in the right order.',
  );
  process.exit(1);
}

/**
 * Warn if the Firebase App Testers API is off.
 *
 * This is the check that would have saved an afternoon. Uploading and
 * distributing use `firebaseappdistribution.googleapis.com`, which is enabled by
 * default, so the CLI reports complete success. The in-app prompt uses a
 * *different* API, `firebaseapptesters.googleapis.com`, which is NOT enabled by
 * default and which nothing in the upload path touches. With it off, every
 * tester sees "does not have access to test CompanionChat" and the console shows
 * them correctly invited, so the error points at the account while the cause is a
 * project setting.
 *
 * A warning rather than a failure, and gcloud is optional: a machine that can
 * upload should not be blocked from uploading because it lacks a second CLI.
 */
try {
  const enabled = execFileSync(
    'gcloud',
    [
      'services',
      'list',
      '--enabled',
      '--project',
      PROJECT,
      '--format=value(config.name)',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  if (!enabled.includes('firebaseapptesters.googleapis.com')) {
    console.warn(
      '\nWARNING: the Firebase App Testers API is disabled on ' +
        `${PROJECT}.\n` +
        'This upload will succeed and no tester will be able to sign in to the\n' +
        'in-app update prompt. Enable it with:\n\n' +
        `  gcloud services enable firebaseapptesters.googleapis.com --project ${PROJECT}\n`,
    );
  }
} catch {
  // No gcloud, or no permission to list services. Not worth blocking on.
}

const commit = execFileSync('git', ['log', '-1', '--pretty=%h %s'], {
  encoding: 'utf8',
}).trim();

execFileSync(
  'firebase',
  [
    'appdistribution:distribute',
    APK,
    '--app',
    APP_ID,
    '--project',
    PROJECT,
    '--groups',
    GROUP,
    '--release-notes',
    `${version}\n\n${commit}`,
  ],
  { stdio: 'inherit' },
);
