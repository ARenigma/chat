/**
 * The "Get paid" row's status line: one of three states, read from what the
 * server wrote about the payout account and the PAN (migrations 048, 049).
 *
 * The client never decides verification — `verification_status` and
 * `my_payout_readiness` are written server-side — so this only NAMES what the
 * server already said. Three states rather than the four the column holds,
 * because the row answers one question, "do I have to do something?":
 *
 *   verified       account and PAN both verified (`can_go_live`)
 *   pending        the check is running; nothing to do but wait
 *   action needed  nothing saved, a failed check, a saved-but-unchecked
 *                  account, or a verified account still missing its PAN
 *
 * Unknown (still loading) is its own answer so the row never flashes
 * "action needed" at somebody who is verified.
 */
import type { PayoutAccount, PayoutReadiness } from '../api/provider';

type GetPaidTone = 'verified' | 'pending' | 'action' | 'unknown';

export interface GetPaidStatus {
  tone: GetPaidTone;
  /** The row's detail line. */
  label: string;
}

export function getPaidStatus(
  readiness: PayoutReadiness | null | undefined,
  account: PayoutAccount | null | undefined,
): GetPaidStatus {
  if (readiness === undefined || account === undefined) {
    return { tone: 'unknown', label: 'Bank account or UPI, and PAN' };
  }
  if (readiness?.can_go_live === true) {
    return { tone: 'verified', label: 'Verified' };
  }
  if (account === null) {
    return { tone: 'action', label: 'Action needed: add a bank account or UPI' };
  }
  switch (account.verification_status) {
    case 'pending':
      return { tone: 'pending', label: 'Pending: we are checking your account' };
    case 'failed':
      return { tone: 'action', label: 'Action needed: the account check failed' };
    case 'unverified':
      return { tone: 'action', label: 'Action needed: verify your account' };
    case 'verified':
      return readiness?.pan_verified === true
        ? { tone: 'verified', label: 'Verified' }
        : { tone: 'action', label: 'Action needed: add your PAN' };
  }
}
