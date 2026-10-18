
import { checkoutError } from '../src/lib/checkout';

describe('checkoutError', () => {
  it('tells a member who backed out that nothing was taken, without alarm', () => {
    expect(checkoutError({ code: 'action_cancelled', message: 'Payment failed: x (action_cancelled)' })).toEqual({
      cancelled: true,
      text: 'Payment not completed. No money was taken.',
    });
  });
  it('never shows the raw gateway text for a real failure', () => {
    const shown = checkoutError({ code: 'payment_failed', message: 'Payment failed: bank down (payment_failed)' });
    expect(shown.cancelled).toBe(false);
    expect(shown.text).toBe("Payment didn't go through. Please try again.");
  });
  it('keeps our own messages (e.g. a price change) as they are', () => {
    expect(checkoutError({ message: 'The price changed. Check the new total.' }).text).toBe(
      'The price changed. Check the new total.',
    );
  });
});
