#!/usr/bin/env node
/**
 * Sends the signed release APK to Firebase App Distribution from this machine.
 *
 * The same thing CI does on every merge to main — this exists for the case where
 * CI cannot, because distribution needs a service account and a local `firebase
 * login` is enough. Reads the app and project ids from design-time constants
 * rather than env, since neither is a secret: both ship inside every APK.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APK = join(ROOT, 'android/app/build/outputs/apk/release/app-release.apk');
const APP_ID = '1:305484620007:android:ab6201497a877f32074242';
const PROJECT = 'chat-d8c87';

if (!existsSync(APK)) {
  console.error(
    'distribute FAILED: no signed release APK.\n' +
      'Run `npm run android:release` first. If it produced app-release-unsigned.apk,\n' +
      'android/keystore.properties is missing — see android/keystore.properties.example.',
  );
  process.exit(1);
}

const notes = execFileSync('git', ['log', '-1', '--pretty=%h %s'], {
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
    'founders',
    '--release-notes',
    notes,
  ],
  { stdio: 'inherit' },
);
