#!/usr/bin/env node
/**
 * Manifest gate: the permission set, plus the two attributes a merge could hand
 * back to a library without anybody noticing, `allowBackup="false"` on the
 * application, and the ABSENCE of `screenOrientation` on the launcher activity.
 *
 * Checks the source manifest, and, when a release build has been run, the
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
  // Added with push. This is a permission the Play listing has to justify, and
  // the justification is the product's core loop: without it a reply reaches a
  // backgrounded app nowhere at all. It grants no access to data, only the
  // ability to draw a notification the user can turn off in Settings.
  'android.permission.POST_NOTIFICATIONS',
  // Added with voice notes, and it is the most expensive entry on this list: it
  // is the first permission here that reaches a sensor, and it moved out of
  // FORBIDDEN below rather than being appended to a growing set.
  //
  // Deliberately NOT in ALLOWED_FROM_LIBRARIES even though
  // react-native-nitro-sound declares it. That set exists for permissions a
  // dependency needs and we do not use; the microphone is a product decision
  // this app owns, so it is declared in our own source manifest and required
  // here. The cost is paid twice over: the Play Data Safety form gains an Audio
  // row, and the privacy page loses the sentence that said no microphone.
  //
  // What this gate can no longer do, stated plainly rather than left to be
  // discovered: while RECORD_AUDIO was forbidden, no dependency could quietly
  // acquire the microphone. Now only a *new* permission is caught. The narrower
  // protection left is that recording is confined to src/lib/recorder.ts, which
  // a contract assertion checks.
  'android.permission.RECORD_AUDIO',
  // LiveKit's two-way communication audio device module changes routing and
  // volume. This is a normal permission with no runtime prompt or Data Safety
  // collection row.
  // https://docs.livekit.io/transport/media/publish/
  'android.permission.MODIFY_AUDIO_SETTINGS',
  // LiveKit and Agora use the legacy Bluetooth stack to route call audio on
  // Android 11 and below. Both declarations are capped at API 30 in the source
  // manifest, as Android's permission migration guide requires.
  // developer.android.com/develop/connectivity/bluetooth/bt-permissions
  'android.permission.BLUETOOTH',
  'android.permission.BLUETOOTH_ADMIN',
  // Added with photo capture (#8): the "+" in the composer can take a live photo
  // to send. Like RECORD_AUDIO it is a sensor permission this app owns as a
  // product decision, declared in our own manifest and requested at runtime in
  // Composer before launchCamera. It moved out of FORBIDDEN below. The Play Data
  // Safety form gains a Photos/Camera row and the privacy page must say a photo
  // is only captured when the user taps Camera and is sent as a message.
  'android.permission.CAMERA',
  // ── Call / foreground-service permissions (ADR-0020) ────────────────────
  // These five permissions are owned by the app's call feature and are
  // required by AndroidX Core-Telecom and the call foreground service.
  //
  // MANAGE_OWN_CALLS: Required by the ConnectionService binding that
  //   registers our calls with the system telecom stack.
  //   Ref: developer.android.com/guide/topics/connectivity/telecom/selfManaged
  //
  // FOREGROUND_SERVICE: Declared so the call FGS can be started with
  //   startForegroundService(); without this the service crashes on API 28+.
  //   Ref: developer.android.com/guide/components/foreground-services
  //
  // FOREGROUND_SERVICE_PHONE_CALL / FOREGROUND_SERVICE_MICROPHONE /
  // FOREGROUND_SERVICE_CAMERA: API 34+ requires the specific FGS *type*
  //   to be declared in the manifest. The call service uses all three
  //   channels (voice, audio, video). Omitting any type that the service
  //   uses causes an immediate crash on Android 14+ devices.
  //   Ref: developer.android.com/about/versions/14/changes/fgs-types-required
  'android.permission.MANAGE_OWN_CALLS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_PHONE_CALL',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.FOREGROUND_SERVICE_CAMERA',
  // Added with Cashfree recharge (ADR-0022). The Cashfree PG SDK's analytics
  // reads ConnectivityManager.getActiveNetworkInfo() WITHOUT a permission check,
  // so its absence is not "degrade to UNKNOWN" (that is Sentry's behaviour) but a
  // SecurityException that crashes checkout the instant Pay is tapped. It used to
  // be stripped via tools:node="remove"; payments make it app-owned now. Normal
  // (non-dangerous) permission: no runtime prompt, no Play Data Safety row.
  // developer.android.com/training/basics/network-ops/managing
  'android.permission.ACCESS_NETWORK_STATE',
]);

/**
 * Permitted in the merged output but NOT declared by us.
 *
 * These are the permissions firebase-messaging merges in, which is precisely
 * the case this script exists to surface, so they are named, with a reason,
 * rather than pattern-matched away.
 *
 * WAKE_LOCK is how a push wakes a sleeping device long enough to hand the
 * message to the app. c2dm RECEIVE is the transport permission FCM's own
 * receiver is protected by. Neither grants access to user data, neither is
 * user-visible on Play, and neither is optional if push exists at all, the
 * only way to drop them is to drop notifications.
 *
 * The distinction from ALLOWED matters: ALLOWED is also the *required* set, so
 * anything listed there must appear in our source manifest. Declaring a
 * library's permission ourselves would be a claim we do not own.
 */
const ALLOWED_FROM_LIBRARIES = new Set([
  'android.permission.WAKE_LOCK',
  'com.google.android.c2dm.permission.RECEIVE',
  // Play Billing embeds this permission in its own manifest; the integration
  // guide explicitly says applications should not duplicate it.
  // developer.android.com/google/play/billing/integrate
  'com.android.vending.BILLING',
  // AndroidX Core-Telecom owns call audio routing. Android 12+ requires
  // BLUETOOTH_CONNECT for paired communication devices. The app now owns
  // MODIFY_AUDIO_SETTINGS above because LiveKit also requires it.
  // developer.android.com/develop/connectivity/bluetooth/bt-permissions
  // developer.android.com/develop/connectivity/telecom/voip-app/api-updates
  'android.permission.BLUETOOTH_CONNECT',
  // Agora uses this normal permission to classify the active network and tune
  // media transport. It exposes no SSID or location to application code.
  'android.permission.ACCESS_WIFI_STATE',
  // Firebase Auth's reCAPTCHA dependency contributes this Google signature
  // permission. It is internal to Play services and is not requested at runtime.
  // developers.google.com/android/guides/permissions
  'com.google.android.providers.gsf.permission.READ_GSERVICES',
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
  ALLOWED_FROM_LIBRARIES.has(permission) ||
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
  // RECORD_AUDIO and CAMERA both used to be here. They are in ALLOWED now, with
  // the reason and the cost written above — the microphone for voice notes and
  // the camera for photo capture (#8), each a product decision the app owns.
  'android.permission.READ_PHONE_STATE',
  'android.permission.QUERY_ALL_PACKAGES',
];

const failures = [];
const notes = [];

/** Permissions actually requested, `tools:node="remove"` entries are removals. */
function declaredPermissions(xml) {
  return [...xml.matchAll(/<uses-permission[^>]*>/g)]
    .filter(([tag]) => !tag.includes('tools:node="remove"'))
    .map(([tag]) => tag.match(/android:name="([^"]+)"/)?.[1])
    .filter(Boolean);
}

function permissionTag(xml, permission) {
  return (
    [...xml.matchAll(/<uses-permission[^>]*>/g)]
      .map(([tag]) => tag)
      .find(tag => tag.includes(`android:name="${permission}"`)) ?? ''
  );
}

/**
 * Our own launcher activity's opening tag, in either manifest's spelling: the
 * source writes `.MainActivity` and the merger expands it against the namespace.
 *
 * Returned as a tag rather than searched for across the whole file because three
 * library activities merge in beside ours (Play Core's dialog wrapper and two
 * from GMS auth), and any of them could satisfy a file-wide attribute match
 * while MainActivity had lost the attribute.
 */
function launcherActivity(xml) {
  return (
    [...xml.matchAll(/<activity\b[^>]*>/g)]
      .map(([tag]) => tag)
      .find(tag =>
        /android:name="(?:\.|com\.companionchat\.)MainActivity"/.test(tag),
      ) ?? ''
  );
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
  for (const permission of [
    'android.permission.BLUETOOTH',
    'android.permission.BLUETOOTH_ADMIN',
  ]) {
    if (!/android:maxSdkVersion="30"/.test(permissionTag(xml, permission))) {
      failures.push(`${label}: ${permission} must stop at API 30`);
    }
  }
  if (!/android:allowBackup="false"/.test(xml)) {
    failures.push(`${label}: android:allowBackup must be "false"`);
  }
  /*
   * The ABSENCE of an orientation restriction, checked against the merged output
   * and not only against our own file.
   *
   * This check was inverted on 2026-08-26. It used to REQUIRE
   * `screenOrientation="portrait"`, which the app carried to avoid the input
   * method's fullscreen extract editor in landscape. That cause is now fixed at
   * source — every field goes through `src/components/TextField.tsx`, which
   * forces React Native's `disableFullscreenUI` on — so the restriction is gone
   * and https://developer.android.com/guide/topics/large-screens is satisfied.
   *
   * Checked against the MERGED manifest because an activity attribute is the one
   * claim here a dependency can hand back in silence: a library declaring
   * `screenOrientation` wins by default, which is precisely the mechanism
   * react-native-firebase already uses on the notification colour two elements
   * away. A dependency quietly re-locking the app to portrait is a large-screen
   * regression nobody would see on a phone.
   */
  const orientation = /android:screenOrientation="([^"]+)"/.exec(
    launcherActivity(xml),
  );
  if (orientation) {
    failures.push(
      `${label}: MainActivity must not restrict orientation, found "${orientation[1]}". ` +
        'Large-screen guidance forbids it and the reason it was locked is fixed ' +
        'in src/components/TextField.tsx.',
    );
  }
  /*
   * `configChanges` matters MORE without the lock than it did with it. Rotation,
   * split screen, freeform and a folding hinge all resize the window, and losing
   * these entries turns a configuration change into an activity restart, which
   * rebuilds the surface and costs somebody's half-typed message.
   */
  for (const required of ['orientation', 'screenSize', 'keyboardHidden']) {
    const configChanges = /android:configChanges="([^"]*)"/.exec(
      launcherActivity(xml),
    );
    if (!configChanges || !configChanges[1].includes(required)) {
      failures.push(
        `${label}: MainActivity configChanges must include ${required}`,
      );
    }
  }
  notes.push(
    `${label}: ${declared.length} permission(s), ${declared.join(', ')}`,
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
 * are never distributed, auditing them reports a violation that cannot ship.
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
    'merged manifest: no release variant built yet, run `npm run android:release` ' +
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
