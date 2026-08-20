#!/usr/bin/env node
/**
 * Asserts the release APK ships Hermes bytecode, not plain JavaScript.
 *
 * Why this is worth a gate: if `hermesEnabled` is flipped, or the bundle task
 * silently falls back, the APK still installs and still runs — just slower, with
 * a longer cold start and no bytecode precompilation. Nothing fails, so nobody
 * notices. The only reliable tell is the 8-byte HBC magic at the head of
 * `assets/index.android.bundle`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APK_DIR = join(ROOT, 'android/app/build/outputs/apk/release');
const BUNDLE_ENTRY = 'assets/index.android.bundle';

// Hermes bytecode file magic: 0x1F19_03C1_03BC_1FC6, little-endian on disk.
const HBC_MAGIC = Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]);

function fail(message) {
  console.error(`verify-hermes FAILED: ${message}`);
  process.exit(1);
}

if (!existsSync(APK_DIR)) {
  fail(`${APK_DIR} not found — run \`npm run android:release\` first`);
}

const apks = readdirSync(APK_DIR).filter(f => f.endsWith('.apk'));
if (apks.length === 0) {
  fail('no APK in the release output directory');
}

for (const apk of apks) {
  const path = join(APK_DIR, apk);

  const listing = execFileSync('unzip', ['-l', path], { encoding: 'utf8' });
  if (!listing.includes(BUNDLE_ENTRY)) {
    fail(`${apk} contains no ${BUNDLE_ENTRY}`);
  }

  // `unzip -p` streams the entry to stdout; take the first 8 bytes.
  const head = execFileSync('unzip', ['-p', path, BUNDLE_ENTRY], {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  }).subarray(0, 8);

  if (!head.equals(HBC_MAGIC)) {
    fail(
      `${apk}: ${BUNDLE_ENTRY} is not Hermes bytecode ` +
        `(head was ${head.toString('hex')}, expected ${HBC_MAGIC.toString(
          'hex',
        )}). ` +
        'Check hermesEnabled in android/gradle.properties.',
    );
  }

  const sizeLine = listing
    .split('\n')
    .find(l => l.includes(BUNDLE_ENTRY))
    ?.trim();
  console.log(
    `  ok  ${apk}: Hermes bytecode confirmed — ${sizeLine ?? BUNDLE_ENTRY}`,
  );
}

console.log('\nverify-hermes OK');
