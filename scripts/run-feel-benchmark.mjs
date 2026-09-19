#!/usr/bin/env node
/**
 * Runs only FeelBenchmark against a physical device, after deleting stale
 * reports, then gates the fresh Macrobenchmark JSON. A zero exit therefore
 * means both instrumentation and frame thresholds passed.
 */
import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT_DIR = join(
  ROOT,
  'android',
  'baselineprofile',
  'build',
  'outputs',
  'connected_android_test_additional_output',
  'nonMinifiedInternal',
);
const FEEL_CLASS = 'com.companionchat.baselineprofile.FeelBenchmark';

rmSync(OUTPUT_DIR, { recursive: true, force: true });

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(
  './gradlew',
  [
    ':baselineprofile:connectedNonMinifiedInternalAndroidTest',
    `-Pandroid.testInstrumentationRunnerArguments.class=${FEEL_CLASS}`,
    '-Pandroid.testInstrumentationRunnerArguments.androidx.benchmark.enabledRules=Macrobenchmark',
    '-PreactNativeArchitectures=arm64-v8a',
    '--no-parallel',
    ...process.argv.slice(2),
  ],
  join(ROOT, 'android'),
);

run(process.execPath, [
  join(ROOT, 'scripts', 'benchmark-gate.mjs'),
  '--strict',
]);
