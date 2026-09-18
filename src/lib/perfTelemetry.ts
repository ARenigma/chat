import { useEffect } from 'react';
import { InteractionManager } from 'react-native';
import { runOnJS, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { track } from './telemetry';
import { readRefreshRate } from './windowChrome';

/**
 * First-party perf signals. No analytics SDK (manifest + data-safety).
 * Prop keys stay off the PII regex: surface, kind, ms, dropped, hz, cache.
 */

function reportJank(ms: number, hz: number): void {
  track('frame_jank', { ms: Math.round(ms), hz: Math.round(hz), surface: 'ui' });
}

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
  'worklet';
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
 * On the UI thread, via Reanimated's `useFrameCallback` — not the JS thread's
 * `requestAnimationFrame` this used to run on (M17, 2026-09-17 audit). A
 * JS-thread rAF only measures whether the JS thread got to run on time; it is
 * blind to a stall entirely on the UI/Fabric side (an expensive Reanimated
 * worklet, a slow native commit) with the JS thread sitting idle — exactly
 * the kind of jank a Reanimated-heavy screen is most likely to produce.
 * `useFrameCallback` schedules its loop with `scheduleOnUI`, so the same
 * measurement now happens on the thread the jank actually happens on, with no
 * new dependency: Reanimated is already installed, JankStats would still be
 * one and is not added here.
 *
 * The previous watcher hardcoded 60 Hz and a 32 ms (two-frame) threshold, which
 * on a 120 Hz panel — the Galaxy S22 this app targets — is FOUR missed frames
 * before anything is logged, so most jank went unreported and every row was
 * mislabelled 60 Hz. The refresh interval is now inferred from the median of a
 * rolling window of frame deltas (the on-time frames dominate the median; jank
 * frames are the long tail) and snapped to the nearest known panel rate. A frame
 * that overruns two of those intervals is jank; reports are throttled to one per
 * 4 s so a janky scroll is a single row.
 * https://developer.android.com/topic/performance/vitals/render
 */
export function useFrameWatch(): void {
  const windowSV = useSharedValue<number[]>([]);
  const intervalMsSV = useSharedValue(1000 / 60); // until enough samples land, assume 60 Hz
  /*
   * Once the display tells us its mode, stop guessing. `measured` latches so a
   * late-arriving native answer is not then overwritten by the frame-delta
   * median on the next frame — the whole point is that the read beats the
   * inference.
   */
  const measuredSV = useSharedValue(false);
  const lastJankAtSV = useSharedValue(0);

  useEffect(() => {
    void readRefreshRate().then(hz => {
      if (hz !== null) {
        intervalMsSV.value = 1000 / hz;
        measuredSV.value = true;
      }
    });
  }, [intervalMsSV, measuredSV]);

  useFrameCallback(frameInfo => {
    'worklet';
    const delta = frameInfo.timeSincePreviousFrame;
    if (delta === null) {
      return;
    }
    // Feed the estimator only plausible frame deltas (a backgrounded tab or a
    // GC pause produces huge gaps that are not the panel's cadence).
    if (delta >= 4 && delta <= 40) {
      const samples = windowSV.value;
      samples.push(delta);
      if (samples.length > 60) {
        samples.shift();
      }
      windowSV.value = samples;
      if (!measuredSV.value && samples.length >= 20) {
        const sorted = [...samples].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] ?? intervalMsSV.value;
        intervalMsSV.value = nearestInterval(median);
      }
    }
    // Janky if the frame overran two refresh intervals. Throttled to one row.
    if (
      delta > intervalMsSV.value * 2 &&
      frameInfo.timestamp - lastJankAtSV.value > 4000
    ) {
      lastJankAtSV.value = frameInfo.timestamp;
      runOnJS(reportJank)(delta, 1000 / intervalMsSV.value);
    }
  });
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
