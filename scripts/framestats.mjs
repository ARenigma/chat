#!/usr/bin/env node
/**
 * Frame timing from the device, per window, as a pass/fail gate.
 *
 * `MainActivity.kt` has cited this script since the refresh-rate vote landed —
 * "reports each window's block from `dumpsys gfxinfo framestats` separately for
 * exactly this reason" — and until now it did not exist. A comment naming a tool
 * nobody can run is a claim a reader cannot check, which is the thing RULE 1
 * exists to stop.
 *
 * ---------------------------------------------------------------------------
 * What it reads, and why it parses the way it does
 * ---------------------------------------------------------------------------
 * `adb shell dumpsys gfxinfo <pkg> framestats` emits, for each window:
 *
 *   Window: com.companionchat/com.companionchat.MainActivity
 *   ---PROFILEDATA---
 *   Flags,IntendedVsync,Vsync,OldestInputEvent,...,FrameCompleted,...
 *   0,176961891521459,176961891521459,...
 *   ---PROFILEDATA---
 *
 * Two things about that format decide this script's shape, and both were read
 * off a real device rather than a doc page (the vitals page documents the
 * budgets but not the columns):
 *
 *  1. **The column set varies by API level.** The Redmi (API 29) emits 16
 *     columns and no `GpuCompleted`; newer platforms add it. So every field is
 *     looked up BY HEADER NAME. An index would silently read the wrong column
 *     on one of the two phones this project ships to.
 *  2. **The ring buffer is small and must be reset.** It holds ~120 frames and
 *     `framestats` returns whatever is left in it. A dump without `--reset`
 *     first mixes in whatever the app was doing minutes ago; on the first try
 *     here it returned a histogram and no PROFILEDATA block at all.
 *
 * `Flags != 0` rows are skipped. A non-zero flag means the frame was affected by
 * something outside the app's control — the window's first draw, a layer resize
 * — and counting them measures the platform, not us.
 *
 * ---------------------------------------------------------------------------
 * The budget is DERIVED, not assumed
 * ---------------------------------------------------------------------------
 * The plan that asked for this script specified "vs 8.33ms", which is the 120Hz
 * budget and correct for the S22. It is wrong for the Redmi, which is a 60Hz
 * panel: every frame would fail a gate it never had a chance at. So the budget
 * comes from the observed vsync period — the median gap between consecutive
 * `IntendedVsync` values — and is printed, which also answers the question
 * MainActivity's comment actually poses: is the panel in its fast mode or not.
 *
 * https://developer.android.com/topic/performance/vitals/render
 *
 *   node scripts/framestats.mjs --reset            # zero the buffer and exit
 *   node scripts/framestats.mjs                    # report + gate
 *   node scripts/framestats.mjs --budget 8.33      # force a budget
 *   node scripts/framestats.mjs --json             # machine-readable
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGE = 'com.companionchat';

/** Share of frames that must land inside the budget for the gate to pass. */
const REQUIRED_SHARE = 0.95;

function resolveAdb() {
  if (process.env.ADB && existsSync(process.env.ADB)) return process.env.ADB;
  const sdk = readFileSync(
    join(ROOT, 'android', 'local.properties'),
    'utf8',
  ).match(/^sdk\.dir=(.+)$/m)?.[1];
  const candidates = [
    sdk ? join(sdk, 'platform-tools', 'adb') : '',
    '/opt/homebrew/share/android-commandlinetools/platform-tools/adb',
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
  ];
  return candidates.find(path => path && existsSync(path)) ?? 'adb';
}

const ADB = resolveAdb();

function arg(name, fallback = undefined) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}
const flag = name => process.argv.includes(`--${name}`);

const pkg = arg('package', PACKAGE);
const serial = arg('serial', process.env.ANDROID_SERIAL);

function adb(args) {
  const result = execFileSync(
    ADB,
    [...(serial ? ['-s', serial] : []), ...args],
    {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return result ?? '';
}

/**
 * One `Window: … ---PROFILEDATA--- … ---PROFILEDATA---` block per window, in
 * order. Kept separate rather than concatenated because that separation is the
 * whole reason MainActivity cites this script: an RN `<Modal>` is its own
 * window with its own refresh-rate vote, so its frames must be judged on their
 * own.
 */
function parseWindows(dump) {
  const windows = [];
  const lines = dump.split('\n');
  let name = null;
  let inBlock = false;
  let header = null;
  let rows = [];

  const flush = () => {
    if (header !== null) {
      windows.push({ name: name ?? '(unnamed window)', header, rows });
    }
    header = null;
    rows = [];
  };

  for (const line of lines) {
    const window = /^Window:\s*(.+)$/.exec(line.trim());
    if (window) {
      name = window[1];
      continue;
    }
    if (line.trim() === '---PROFILEDATA---') {
      if (inBlock) {
        flush();
        inBlock = false;
      } else {
        inBlock = true;
      }
      continue;
    }
    if (!inBlock || line.trim() === '') continue;

    // Trailing comma on every line, so a trailing empty field is expected.
    const cells = line.trim().replace(/,$/, '').split(',');
    if (header === null) {
      header = cells;
    } else {
      rows.push(cells);
    }
  }
  if (inBlock) flush();
  return windows;
}

function median(values) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const at = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[at];
}

/** Frame durations in ms, and the observed vsync period, for one window. */
function measure(window) {
  const column = name => {
    const at = window.header.indexOf(name);
    if (at === -1) {
      throw new Error(
        `framestats block for ${window.name} has no ${name} column. ` +
          `Columns present: ${window.header.join(', ')}`,
      );
    }
    return at;
  };
  const flags = column('Flags');
  const intended = column('IntendedVsync');
  const completed = column('FrameCompleted');

  const kept = window.rows.filter(cells => Number(cells[flags]) === 0);
  const durations = kept
    .map(cells => (Number(cells[completed]) - Number(cells[intended])) / 1e6)
    // A frame the driver never completed comes back as 0 or a sentinel; a
    // negative or absurd duration is not a measurement.
    .filter(ms => Number.isFinite(ms) && ms > 0 && ms < 10_000);

  // The gap between consecutive intended vsyncs IS the panel's period, as the
  // app saw it. Only adjacent pairs, and only plausible ones: a gap of several
  // frames means the app was idle, not that the panel slowed down.
  const stamps = kept
    .map(cells => Number(cells[intended]))
    .sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < stamps.length; i += 1) {
    const gap = (stamps[i] - stamps[i - 1]) / 1e6;
    if (gap > 1 && gap < 20) gaps.push(gap);
  }

  return {
    durations,
    vsyncPeriod: median(gaps),
    skipped: window.rows.length - kept.length,
  };
}

if (flag('reset')) {
  adb(['shell', 'dumpsys', 'gfxinfo', pkg, 'reset']);
  process.stdout.write(
    `framestats: buffer reset for ${pkg}. Drive the flow, then run again.\n`,
  );
  process.exit(0);
}

const dump = adb(['shell', 'dumpsys', 'gfxinfo', pkg, 'framestats']);
const windows = parseWindows(dump);

if (windows.length === 0) {
  process.stderr.write(
    `framestats: no PROFILEDATA block for ${pkg}.\n\n` +
      `The ring buffer is empty or drained. Reset it, drive the flow, then read:\n` +
      `  node scripts/framestats.mjs --reset\n` +
      `  <tap, scroll, open the panel>\n` +
      `  node scripts/framestats.mjs\n`,
  );
  process.exit(1);
}

const report = [];
let failed = false;

for (const window of windows) {
  const { durations, vsyncPeriod, skipped } = measure(window);
  if (durations.length === 0) {
    report.push({ window: window.name, frames: 0, skipped });
    continue;
  }

  const budget = Number(arg('budget', vsyncPeriod));
  // Two budgets missed is a dropped frame the user can see, which is the
  // threshold the plan named as 16.7ms against a 8.33ms budget.
  const hard = budget * 2;
  const sorted = [...durations].sort((a, b) => a - b);
  const withinBudget = durations.filter(ms => ms <= budget).length;
  const share = withinBudget / durations.length;
  const overHard = durations.filter(ms => ms > hard);

  const entry = {
    window: window.name,
    frames: durations.length,
    skipped,
    vsyncPeriodMs: Number(vsyncPeriod.toFixed(2)),
    inferredHz: Number((1000 / vsyncPeriod).toFixed(1)),
    budgetMs: Number(budget.toFixed(2)),
    withinBudgetShare: Number((share * 100).toFixed(1)),
    p50: Number(percentile(sorted, 50).toFixed(2)),
    p95: Number(percentile(sorted, 95).toFixed(2)),
    p99: Number(percentile(sorted, 99).toFixed(2)),
    worstMs: Number(sorted[sorted.length - 1].toFixed(2)),
    overHardCount: overHard.length,
    pass: share >= REQUIRED_SHARE && overHard.length === 0,
  };
  if (!entry.pass) failed = true;
  report.push(entry);
}

if (flag('json')) {
  process.stdout.write(
    `${JSON.stringify({ package: pkg, windows: report }, null, 2)}\n`,
  );
} else {
  for (const entry of report) {
    process.stdout.write(`\n${entry.window}\n`);
    if (!entry.frames) {
      process.stdout.write(
        `  no usable frames (${entry.skipped} skipped on flags)\n`,
      );
      continue;
    }
    process.stdout.write(
      `  panel      ${entry.vsyncPeriodMs}ms period (~${entry.inferredHz}Hz observed)\n` +
        `  budget     ${entry.budgetMs}ms, hard ${(entry.budgetMs * 2).toFixed(
          2,
        )}ms\n` +
        `  frames     ${entry.frames} measured, ${entry.skipped} skipped on flags\n` +
        `  within     ${entry.withinBudgetShare}% (need ${
          REQUIRED_SHARE * 100
        }%)\n` +
        `  p50/95/99  ${entry.p50} / ${entry.p95} / ${entry.p99}ms, worst ${entry.worstMs}ms\n` +
        `  over hard  ${entry.overHardCount}\n` +
        `  ${entry.pass ? 'PASS' : 'FAIL'}\n`,
    );
  }
}

process.exit(failed ? 1 : 0);
