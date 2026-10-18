/**
 * What the member reads when checkout ends without a payment. Backing out of
 * Cashfree (`action_cancelled`) is not a failure, so it is said neutrally and
 * says what they need to know — nothing was taken. The SDK's own text, with its
 * code in brackets, is telemetry (billing.ts tracks it), never copy.
 */
export function checkoutError(err: { message?: string; code?: unknown }): {
  cancelled: boolean;
  text: string;
} {
  if (err.code === 'action_cancelled') {
    return { cancelled: true, text: 'Payment not completed. No money was taken.' };
  }
  if (!err.message || err.message.startsWith('Payment failed:')) {
    return { cancelled: false, text: "Payment didn't go through. Please try again." };
  }
  return { cancelled: false, text: err.message };
}
