/**
 * What a recharge attempt IS, for the member, from its ledger status and age.
 *
 * `created` means an order exists and no gateway verdict has arrived. Minutes
 * after the checkout opened that is honestly "Pending". But nothing ever moves
 * an abandoned order off `created` (create-order sets no expiry, and a closed
 * checkout sends no webhook), so a month-old `created` row labelled "Pending",
 * or "Bill follows once it clears", promised a payment that is never coming
 * (S22, 2026-09-29). Past the window it is "Not completed": no money moved.
 *
 * One rule for Recharge history and Bills & invoices, so they cannot disagree.
 */
export type PaymentState = 'paid' | 'pending' | 'incomplete' | 'failed' | 'refunded';

/** How long an unverified order may honestly be called pending. */
export const PENDING_WINDOW_MS = 30 * 60 * 1000;

export function paymentState(
  status: 'created' | 'succeeded' | 'failed' | 'refunded',
  createdAt: string,
  now: number = Date.now(),
): PaymentState {
  switch (status) {
    case 'succeeded':
      return 'paid';
    case 'failed':
      return 'failed';
    case 'refunded':
      return 'refunded';
    case 'created': {
      const at = Date.parse(createdAt);
      return Number.isFinite(at) && now - at < PENDING_WINDOW_MS ? 'pending' : 'incomplete';
    }
  }
}

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  paid: 'Paid',
  pending: 'Pending',
  incomplete: 'Not completed',
  failed: 'Failed',
  refunded: 'Refunded',
};
