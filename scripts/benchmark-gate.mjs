#!/usr/bin/env node
/**
 * benchmark-gate.mjs — exit non-zero if a Macrobenchmark metric regressed.
 *
 * Reads the JSON that androidx Macrobenchmark writes after a connected test
 * run and gates on named per-metric percentiles.
 *
 * ---------------------------------------------------------------------------
 * What was verified vs. what was assumed (2026-09-06)
 * ---------------------------------------------------------------------------
 * VERIFIED:
 *   - The benchmark class that produces the JSON is CriticalJourneyBenchmark.kt
 *     (android/baselineprofile/src/main/java/com/companionchat/baselineprofile/).
 *     It uses FrameTimingMetric() with 10 iterations.
 *   - The Gradle invocation that triggers a run is documented in package.json
 *     as `android:benchmark:startup` (for StartupBenchmark) and the feel
 *     benchmark invocation is shown in the --help output below.
 *   - No benchmarkData.json file exists in this repo at time of writing — the
 *     benchmark has never been run inside the repo tree. If the file is absent,
 *     this script exits 1 with a clear message naming the command that
 *     produces it.
 *
 * ASSUMED (from published docs, not verified against a real output file):
 *   - Output location:
 *       android/baselineprofile/build/outputs/
 *         connected_android_test_additional_output/nonMinifiedInternal/
 *         connected/<device>/<ClassName>_<methodName>_benchmarkData.json
 *     https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview
 *   - Each file is a JSON object with a top-level "benchmarks" array. Each
 *     element has:
 *       name: string            — test method name (e.g. "homeScrollFrames")
 *       className: string       — fully-qualified class
 *       metrics: Record<string, { minimum, maximum, median, runs: number[] }>
 *     https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics
 *   - FrameTimingMetric emits at minimum: frameDurationCpuMs, frameOverrunMs
 *     (frameDurationGpuMs may be absent on older devices / API < 31).
 *   - The "runs" array holds one value per iteration (10 values by default).
 *
 * If the real schema differs, this script emits a descriptive error naming the
 * offending field rather than silently reading zero or wrong numbers.
 *
 * ---------------------------------------------------------------------------
 * Default thresholds (from the W0 plan)
 * ---------------------------------------------------------------------------
 * frameDurationCpuMs P95 < 8.3ms  — within one 120Hz frame budget
 * frameDurationCpuMs P99 < 16.7ms — no double-budget frame
 * frameOverrunMs P95  ≤ 0ms       — no consistent GPU overrun
 *
 * https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview
 * https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics
 *
 * ---------------------------------------------------------------------------
 * Usage
 * ---------------------------------------------------------------------------
 *   node scripts/benchmark-gate.mjs
 *   node scripts/benchmark-gate.mjs --benchmark homeScrollFrames
 *   node scripts/benchmark-gate.mjs --metric frameDurationCpuMs --p95 8.3 --p99 16.7
 *   node scripts/benchmark-gate.mjs --json path/to/benchmarkData.json
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function arg(name, fallback = undefined) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

/**
 * Thresholds from W0 plan: P95 < 8.3ms, P99 < 16.7ms, frameOverrunMs P95 ≤ 0.
 * https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics
 */
const DEFAULTS = {
  metric: 'frameDurationCpuMs',
  p95Limit: 8.3,
  p99Limit: 16.7,
  overrunMetric: 'frameOverrunMs',
  overrunP95Limit: 0,
};

/**
 * The Macrobenchmark output directory for the :baselineprofile module's
 * nonMinifiedInternal build type.
 * https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview
 */
const BENCHMARK_OUTPUT_DIR = join(
  ROOT,
  'android',
  'baselineprofile',
  'build',
  'outputs',
  'connected_android_test_additional_output',
  'nonMinifiedInternal',
  'connected',
);

/** Walk dir recursively, collecting all *benchmarkData.json paths. */
function findBenchmarkFiles(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findBenchmarkFiles(child));
    } else if (entry.name.endsWith('benchmarkData.json')) {
      results.push(child);
    }
  }
  return results;
}

/** Percentile from a sorted array (same formula as framestats.mjs). */
function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const at = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[at];
}

/**
 * Parse a benchmarkData.json file.
 * Throws a descriptive error if the expected schema is absent so a schema
 * change is caught immediately rather than producing a silent wrong result.
 */
function parseBenchmarkFile(filePath) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`benchmark-gate: cannot parse ${filePath}: ${err.message}`);
  }
  if (!Array.isArray(raw.benchmarks)) {
    throw new Error(
      `benchmark-gate: ${filePath} is missing the top-level "benchmarks" array.\n` +
        `The schema may have changed. Verify against:\n` +
        `  https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics`,
    );
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Collect files to gate
// ---------------------------------------------------------------------------
const explicitJson = arg('json') ? resolve(arg('json')) : null;

let benchmarkFiles;
if (explicitJson) {
  if (!existsSync(explicitJson)) {
    process.stderr.write(`benchmark-gate: file not found: ${explicitJson}\n`);
    process.exit(1);
  }
  benchmarkFiles = [explicitJson];
} else {
  benchmarkFiles = findBenchmarkFiles(BENCHMARK_OUTPUT_DIR);
}

if (benchmarkFiles.length === 0) {
  process.stderr.write(
    `benchmark-gate: no benchmarkData.json found.\n\n` +
      `Expected under:\n` +
      `  ${BENCHMARK_OUTPUT_DIR}/<device>/\n\n` +
      `Produce the file by running the benchmark on a physical device:\n\n` +
      `  # Startup benchmark (package.json android:benchmark:startup):\n` +
      `  npm run android:benchmark:startup\n\n` +
      `  # Feel benchmark (FeelBenchmark, once the class exists per W0):\n` +
      `  cd android && ./gradlew :baselineprofile:connectedNonMinifiedInternalAndroidTest \\\n` +
      `    -Pandroid.testInstrumentationRunnerArguments.class=` +
      `com.companionchat.baselineprofile.FeelBenchmark \\\n` +
      `    -Pandroid.testInstrumentationRunnerArguments.androidx.benchmark.enabledRules=Macrobenchmark \\\n` +
      `    -PreactNativeArchitectures=arm64-v8a --no-parallel\n\n` +
      `Note: Macrobenchmark requires a physical device (not an emulator) for\n` +
      `reliable frame-timing results; this gate does not suppress that check.\n\n` +
      `https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview\n`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Apply gates
// ---------------------------------------------------------------------------
const benchmarkFilter = arg('benchmark');
const strict = process.argv.includes('--strict');
const metricName = arg('metric', DEFAULTS.metric);
const p95Limit = Number(arg('p95', DEFAULTS.p95Limit));
const p99Limit = Number(arg('p99', DEFAULTS.p99Limit));
const overrunMetric = arg('overrun-metric', DEFAULTS.overrunMetric);
const overrunP95Limit = Number(arg('overrun-p95', DEFAULTS.overrunP95Limit));

let failed = false;
let checkedEntries = 0;

for (const filePath of benchmarkFiles) {
  const data = parseBenchmarkFile(filePath);

  const entries = benchmarkFilter
    ? data.benchmarks.filter(b => b.name === benchmarkFilter)
    : data.benchmarks;

  if (benchmarkFilter && entries.length === 0) {
    process.stderr.write(
      `benchmark-gate: no benchmark named "${benchmarkFilter}" in ${filePath}.\n` +
        `Available names: ${data.benchmarks.map(b => b.name).join(', ')}\n`,
    );
    process.exit(1);
  }

  for (const bench of entries) {
    checkedEntries += 1;
    const label = `${bench.className ?? ''}#${bench.name}`;
    const metrics = bench.metrics ?? {};

    process.stdout.write(`\n${label}\n`);

    // Primary metric --------------------------------------------------------
    if (metricName in metrics) {
      const m = metrics[metricName];
      if (!Array.isArray(m.runs)) {
        throw new Error(
          `benchmark-gate: "${metricName}" in ${label} has no "runs" array.\n` +
            `Schema may have changed — see:\n` +
            `  https://developer.android.com/topic/performance/benchmarking/macrobenchmark-metrics`,
        );
      }
      const sorted = [...m.runs].sort((a, b) => a - b);
      const p95 = percentile(sorted, 95);
      const p99 = percentile(sorted, 99);
      const pass95 = p95 <= p95Limit;
      const pass99 = p99 <= p99Limit;
      if (!pass95 || !pass99) failed = true;
      process.stdout.write(
        `  ${metricName}\n` +
          `    P95  ${p95.toFixed(2)}ms  (limit ${p95Limit}ms)  ${
            pass95 ? 'PASS' : 'FAIL'
          }\n` +
          `    P99  ${p99.toFixed(2)}ms  (limit ${p99Limit}ms)  ${
            pass99 ? 'PASS' : 'FAIL'
          }\n`,
      );
    } else {
      if (strict) {
        failed = true;
        process.stderr.write(
          `benchmark-gate: required metric "${metricName}" is missing from ${label}\n`,
        );
      }
      process.stdout.write(
        `  "${metricName}" not present in this benchmark run\n` +
          `  (wrong class, not measured, or emulator-suppressed GPU metrics)\n`,
      );
    }

    // Overrun metric --------------------------------------------------------
    if (overrunMetric in metrics) {
      const m = metrics[overrunMetric];
      if (Array.isArray(m.runs)) {
        const sorted = [...m.runs].sort((a, b) => a - b);
        const p95 = percentile(sorted, 95);
        const passOverrun = p95 <= overrunP95Limit;
        if (!passOverrun) failed = true;
        process.stdout.write(
          `  ${overrunMetric}\n` +
            `    P95  ${p95.toFixed(2)}ms  (limit ${overrunP95Limit}ms)  ${
              passOverrun ? 'PASS' : 'FAIL'
            }\n`,
        );
      } else if (strict) {
        failed = true;
        process.stderr.write(
          `benchmark-gate: required metric "${overrunMetric}" in ${label} has no runs array\n`,
        );
      }
    } else if (strict) {
      failed = true;
      process.stderr.write(
        `benchmark-gate: required metric "${overrunMetric}" is missing from ${label}\n`,
      );
    }
  }
}

if (strict && checkedEntries === 0) {
  failed = true;
  process.stderr.write(
    'benchmark-gate: strict mode found no benchmark entries to gate\n',
  );
}

process.stdout.write('\n');
process.exit(failed ? 1 : 0);
