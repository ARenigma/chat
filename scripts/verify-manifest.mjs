#!/usr/bin/env node
/**
 * Play Store permission gate.
 *
 * Checks the source manifest, and — when a release build has been run — the
 * *merged* manifest too, which is the only artefact that reflects what a
 * transitive dependency actually contributed.
 *
 * Exit code 1 fails the build.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = join(ROOT, 'android/app/src/main/AndroidManifest.xml');

const ALLOWED = new Set([
  'android.permission.INTERNET',
  'android.permission.VIBRATE',
]);

/**
 * androidx.core declares an app-scoped signature permission so that
 * `ContextCompat.registerReceiver` can protect non-exported dynamic receivers.
 * It is namespaced to our own applicationId, its protectionLevel is `signature`,
 * and Play never surfaces it to users. Removing it would disable a security
 * mechanism, not a capability, so it is allowed by pattern rather than by name.
 */
const ALLOWED_PATTERNS = [
  /^com\.companionchat\.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION$/,
];

const isAllowed = permission =>
  ALLOWED.has(permission) ||
  ALLOWED_PATTERNS.some(pattern => pattern.test(permission));

const FORBIDDEN = [
  'com.google.android.gms.permission.AD_ID',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.READ_CONTACTS',
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.READ_PHONE_STATE',
  'android.permission.QUERY_ALL_PACKAGES',
];

const failures = [];
const notes = [];

/** Permissions actually requested — `tools:node="remove"` entries are removals. */
function declaredPermissions(xml) {
  return [...xml.matchAll(/<uses-permission[^>]*>/g)]
    .filter(([tag]) => !tag.includes('tools:node="remove"'))
    .map(([tag]) => tag.match(/android:name="([^"]+)"/)?.[1])
    .filter(Boolean);
}

function check(label, xml) {
  const declared = declaredPermissions(xml);

  for (const permission of declared) {
    if (!isAllowed(permission)) {
      failures.push(`${label}: unauthorised permission ${permission}`);
    }
  }
  for (const permission of FORBIDDEN) {
    if (declared.includes(permission)) {
      failures.push(`${label}: forbidden permission ${permission}`);
    }
  }
  for (const permission of ALLOWED) {
    if (!declared.includes(permission)) {
      failures.push(`${label}: missing required permission ${permission}`);
    }
  }
  if (!/android:allowBackup="false"/.test(xml)) {
    failures.push(`${label}: android:allowBackup must be "false"`);
  }
  notes.push(
    `${label}: ${declared.length} permission(s) — ${declared.join(', ')}`,
  );
}

if (!existsSync(SOURCE)) {
  console.error(`verify-manifest: ${SOURCE} not found`);
  process.exit(1);
}
check('source', readFileSync(SOURCE, 'utf8'));

const MERGED_DIR = join(
  ROOT,
  'android/app/build/intermediates/merged_manifests',
);
/**
 * Release variants only. React Native's debug manifest legitimately adds
 * SYSTEM_ALERT_WINDOW so the dev menu can draw over the app, and debug artefacts
 * are never distributed — auditing them reports a violation that cannot ship.
 */
const merged = existsSync(MERGED_DIR)
  ? readdirSync(MERGED_DIR, { recursive: true, encoding: 'utf8' }).filter(
      p =>
        p.endsWith('AndroidManifest.xml') &&
        /(^|[/\\])release([/\\]|$)/i.test(p),
    )
  : [];

if (merged.length === 0) {
  notes.push(
    'merged manifest: no release variant built yet — run `npm run android:release` ' +
      'to verify what dependencies actually contribute',
  );
} else {
  for (const relative of merged) {
    check(
      `merged(${relative})`,
      readFileSync(join(MERGED_DIR, relative), 'utf8'),
    );
  }
}

for (const note of notes) {
  console.log(`  ${note}`);
}

if (failures.length > 0) {
  console.error('\nverify-manifest FAILED');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log('\nverify-manifest OK');
