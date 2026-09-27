/**
 * When a provider's chat-request ring stops, as a local epoch-ms deadline.
 *
 * Local receipt time plus the ring length is the default (nav-migration §3,
 * A8): it is immune to a device clock that disagrees with the server's. But a
 * ring delivered LATE (doze, a reconnect) would then count down past the
 * server's own expiry and offer an Accept the server refuses. So the server's
 * `expires_at` caps it, trusted only when the device clock agrees with the
 * server's to within CLOCK_AGREEMENT_MS, judged by the request's `created_at`,
 * which a prompt delivery puts right at "now".
 */
const CLOCK_AGREEMENT_MS = 5_000;

export function chatRingDeadline(
  serverExpiresAt: string,
  serverCreatedAt: string | undefined,
  ringSeconds: number,
  now: number = Date.now(),
): number {
  const local = now + ringSeconds * 1000;
  const expires = Date.parse(serverExpiresAt);
  const created = serverCreatedAt === undefined ? Number.NaN : Date.parse(serverCreatedAt);
  if (Number.isNaN(expires) || Number.isNaN(created)) {
    return local;
  }
  // Only a prompt-looking delivery proves the clocks agree. Otherwise a slow
  // delivery and a skewed clock look the same from here, and shrinking the
  // ring for skew is the defect A8 fixed, so the local deadline stands.
  if (Math.abs(now - created) > CLOCK_AGREEMENT_MS) {
    return local;
  }
  return Math.min(local, expires);
}
