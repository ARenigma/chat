/**
 * Whether this build is still allowed to talk to the current server.
 *
 * **Why this exists.** On 2026-09-07 the database moved to migrations 077–079,
 * which changed the chat session contract: a provider's reply now sets
 * `responded_at` and leaves the request `pending`, and the MEMBER completes it
 * by calling `confirm_chat_session` from a consent sheet. The sheet shipped in
 * versionCode 10110. Two testers were on 10109, whose ChatScreen has no such
 * sheet — so their requests sat `pending` with `responded_at` set, forever. No
 * session, no timer, no tick, and calls blocked behind an active-session check
 * that could never be satisfied.
 *
 * Nothing was broken. Every layer did exactly what it was written to do, and
 * the result was a deadlock with **no error anywhere** — not on the device, not
 * in the logs, not in Sentry, because no exception was thrown. An old client
 * against a migrated server is not a bug to be caught by review; it is a state
 * to be refused. That is what this module is for.
 *
 * Pure, and `react-native`-free, for the reason `bloom.ts` and `onboarding.ts`
 * give: there is no renderer in devDependencies, so a lib file is the only
 * thing this repo can actually test.
 */

/**
 * The floor, as served by the `client_support` config domain.
 *
 * A separate domain rather than a field on `kill_switches` because the two have
 * opposite failure modes. A kill switch that fails open leaves a feature on,
 * which is recoverable. This one decides whether the app opens at all.
 */
export interface ClientSupportConfig {
  /**
   * The lowest versionCode allowed to run against the current server.
   *
   * `0` means "no floor", and that is the deliberate default — see
   * `FALLBACK_CLIENT_SUPPORT`.
   */
  min_version_code: number;
}

/**
 * **Fails open, and this is the most important line in the file.**
 *
 * The natural instinct for a gate is to fail closed: if you cannot prove the
 * client is supported, refuse. That is wrong here, and dangerously so. This
 * value is what applies when the config RPC could not be reached — which is
 * exactly the situation of someone on a train, on hotel wifi, or behind a
 * captive portal. Failing closed would turn "no network for ten seconds" into
 * "the app says I must update and will not open", with no way forward, because
 * the update itself needs the network the person does not have.
 *
 * A skew deadlock is bad. A brick is worse, and unlike a deadlock it would hit
 * people whose client is perfectly current. So the floor is 0 unless the server
 * is reachable AND says otherwise.
 */
export const FALLBACK_CLIENT_SUPPORT: ClientSupportConfig = {
  min_version_code: 0,
};

/** What the gate decided, and why. */
export type SupportVerdict =
  /** Run normally. */
  | { readonly state: 'supported' }
  /** Too old for this server. The only exit is a Play update. */
  | { readonly state: 'must-update'; readonly have: number; readonly need: number };

/**
 * Compare this build against the floor.
 *
 * Two "unknown" inputs both mean supported, and each is a deliberate escape
 * hatch rather than an oversight:
 *
 *   `have <= 0`   the native constant is missing or failed. That is every debug
 *                 build predating this module, every JS-only reload against an
 *                 older native shell, and any future host that does not
 *                 implement it. A dev whose Metro bundle is ahead of their
 *                 installed native code must not be locked out of their own app.
 *   `need <= 0`   no floor published, or config unreachable. See
 *                 `FALLBACK_CLIENT_SUPPORT`.
 *
 * Note the comparison is `have < need`, not `!==`. A client NEWER than the
 * floor is fine and common — that is every tester between two server
 * migrations, and it is the normal state of the world for anyone who updates
 * promptly.
 */
export function supportVerdict(have: number, need: number): SupportVerdict {
  if (!Number.isFinite(have) || have <= 0) {
    return { state: 'supported' };
  }
  if (!Number.isFinite(need) || need <= 0) {
    return { state: 'supported' };
  }
  if (have < need) {
    return { state: 'must-update', have, need };
  }
  return { state: 'supported' };
}
