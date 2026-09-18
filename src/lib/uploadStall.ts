/**
 * A STALL detector for an XHR upload, shared by `api/attachments.ts` and
 * `api/voice.ts` rather than duplicated between them (2026-09-17 audit): the
 * two files' upload functions are otherwise near-identical and this is exactly
 * the kind of small piece of logic that drifts out of step when it is copied
 * — the failure mode this repo has already been bitten by more than once.
 *
 * WHY A STALL DETECTOR AND NOT A WALL-CLOCK TIMEOUT.
 *
 * Both files used to set `xhr.timeout` to a fixed 30 seconds, added on
 * 2026-09-09 because a stalled upload otherwise never settled its promise at
 * all, hanging the send spinner forever. That fixed a real bug but created a
 * smaller one: `xhr.timeout` bounds TOTAL transfer time, not stall time, so a
 * large file on a slow but genuinely moving connection is killed at 30 s
 * exactly as dead as a truly stuck one. On the network conditions this
 * product actually ships into, a multi-megabyte photo can easily still be
 * uploading — correctly — past that mark.
 *
 * This watches `xhr.upload`'s own `progress` events instead: every tick resets
 * a timer, and only the ABSENCE of forward motion for `stallMs` aborts the
 * request. A slow upload that is still receiving bytes is never killed; one
 * that has genuinely stopped moving is killed in `stallMs`, not left to hang.
 */
export function armStallDetector(xhr: XMLHttpRequest, stallMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const reset = () => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => xhr.abort(), stallMs);
  };

  // Armed once immediately, before `xhr.send()`, so a connection that never
  // opens at all — no progress event ever fires — is still bounded.
  reset();
  xhr.upload.addEventListener('progress', reset);

  return () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
