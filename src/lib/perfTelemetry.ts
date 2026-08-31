import { InteractionManager, Platform } from 'react-native';
import { track } from './telemetry';

/**
 * First-party perf signals. No analytics SDK (manifest + data-safety).
 * Prop keys stay off the PII regex: surface, kind, ms, dropped, hz, cache.
 */

let lastJankAt = 0;

export function startFrameWatch(): () => void {
  let last = 0;
  let raf = 0;
  const step = (now: number) => {
    if (last > 0) {
      const delta = now - last;
      // 32ms ≈ two missed 60 Hz frames. Throttle so a janky scroll is one row.
      if (delta > 32 && now - lastJankAt > 4000) {
        lastJankAt = now;
        track('frame_jank', {
          ms: Math.round(delta),
          hz: Platform.OS === 'android' ? 60 : 60,
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
