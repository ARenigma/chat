/**
 * `requestIdleCallback` / `cancelIdleCallback` as React Native ships them.
 *
 * React Native implements both on the global object (Libraries/Core/Timers),
 * but its generated TypeScript types do not declare them, and the DOM lib is not
 * loaded in this project. Without these declarations `useReportFullyDrawn` — the
 * hook that calls `Activity.reportFullyDrawn()` for the startup metric Android
 * reads (developer.android.com/topic/performance/vitals/launch-time) — fails
 * `tsc` even though it is correct at runtime.
 *
 * Deliberately declared here rather than switched to `setTimeout`: the whole
 * point of the idle callback is to report *after* the first frame has settled,
 * which a timer cannot promise.
 */

interface IdleDeadline {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

interface IdleRequestOptions {
  timeout?: number;
}

declare function requestIdleCallback(
  callback: (deadline: IdleDeadline) => void,
  options?: IdleRequestOptions,
): number;

declare function cancelIdleCallback(handle: number): void;
