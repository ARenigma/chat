import { InteractionManager } from 'react-native';
import { track } from './telemetry';
import { readRefreshRate } from './windowChrome';

/**
 * First-party perf signals. No analytics SDK (manifest + data-safety).
 * Prop keys stay off the PII regex: surface, kind, ms, dropped, hz, cache.
 */

let lastJankAt = 0;

/**
 * Common Android panel intervals in ms — 60/90/120/144 Hz. The observed frame
 * interval is snapped to the nearest of these so a noisy sample cannot drift the
 * jank threshold.
 *
 * This is the FALLBACK now, not the only source: `readRefreshRate()` asks the
 * display what mode it is actually in (WindowChromeModule.getRefreshRate), and
 * the inference carries the first ~20 frames until that answer lands, plus any
 * platform where it cannot be read. The inference alone could never tell a
 * 60 Hz panel from a 120 Hz panel dropping every other frame, because both
 * produce a ~16.7 ms median.
 * https://developer.android.com/media/optimize/performance/frame-rate
 */
const KNOWN_INTERVALS_MS = [1000 / 144, 1000 / 120, 1000 / 90, 1000 / 60];

function nearestInterval(sample: number): number {
  let best = KNOWN_INTERVALS_MS[KNOWN_INTERVALS_MS.length - 1] ?? 1000 / 60;
  let bestDist = Infinity;
  for (const iv of KNOWN_INTERVALS_MS) {
    const d = Math.abs(iv - sample);
    if (d < bestDist) {
      bestDist = d;
      best = iv;
    }
  }
  return best;
}

/**
 * Report dropped frames, relative to the display's ACTUAL refresh rate.
 *
 * The previous watcher hardcoded 60 Hz and a 32 ms (two-frame) threshold, which
 * on a 120 Hz panel — the Galaxy S22 this app targets — is FOUR missed frames
 * before anything is logged, so most jank went unreported and every row was
 * mislabelled 60 Hz. The refresh interval is now inferred from the median of a
 * rolling window of rAF deltas (the on-time frames dominate the median; jank
 * frames are the long tail) and snapped to the nearest known panel rate. A frame
 * that overruns two of those intervals is jank; reports are throttled to one per
 * 4 s so a janky scroll is a single row. JankStats would give this from
 * FrameMetrics natively — deferred as a dependency decision (ADR-0025 scope).
 * https://developer.android.com/topic/performance/vitals/render
 */
export function startFrameWatch(): () => void {
  let last = 0;
  let raf = 0;
  const window: number[] = [];
  let intervalMs = 1000 / 60; // until enough samples land, assume 60 Hz
  /*
   * Once the display tells us its mode, stop guessing. `measured` latches so a
   * late-arriving native answer is not then overwritten by the rAF median on
   * the next frame — the whole point is that the read beats the inference.
   */
  let measured = false;
  void readRefreshRate().then(hz => {
    if (hz !== null) {
      intervalMs = 1000 / hz;
      measured = true;
    }
  });
  const step = (now: number) => {
    if (last > 0) {
      const delta = now - last;
      // Feed the estimator only plausible frame deltas (a backgrounded tab or a
      // GC pause produces huge gaps that are not the panel's cadence).
      if (delta >= 4 && delta <= 40) {
        window.push(delta);
        if (window.length > 60) {
          window.shift();
        }
        if (!measured && window.length >= 20) {
          const sorted = [...window].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)] ?? intervalMs;
          intervalMs = nearestInterval(median);
        }
      }
      // Janky if the frame overran two refresh intervals. Throttled to one row.
      if (delta > intervalMs * 2 && now - lastJankAt > 4000) {
        lastJankAt = now;
        track('frame_jank', {
          ms: Math.round(delta),
          hz: Math.round(1000 / intervalMs),
          surface: 'ui',
        });
      }
    }
    last = now;
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

export function trackScreenOpened(kind: string): void {
  const t0 = Date.now();
  InteractionManager.runAfterInteractions(() => {
    track('screen_opened', { kind, ms: Date.now() - t0 });
  });
}

export function trackSheetClosed(kind: string, openedAt: number): void {
  track('sheet_closed', { kind, ms: Math.max(0, Date.now() - openedAt) });
}

export function trackQuerySlow(kind: string, ms: number, cache: 'hit' | 'miss'): void {
  if (ms < 400) return;
  track('query_slow', { kind, ms: Math.round(ms), cache: cache === 'hit' ? 1 : 0 });
}
