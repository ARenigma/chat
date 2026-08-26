import React from 'react';
import { DAILY_REFILL_TOKENS } from '../lib/tokenLedger';
import { formatRupees } from '../lib/rates';
import { useClaimTokens } from '../api/chat';
import { useStore } from '../store/useStore';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';

/**
 * The only paywall-shaped surface. Opened by tapping the balance pill or a
 * Recharge button, never by a balance change on its own, so it can never
 * interrupt a conversation.
 *
 * Framed in rupees, not tokens (ADR-0019): talk time is charged by the minute,
 * so the balance is money. The free grant is a starter credit rather than free
 * tokens; the full ₹-tier / UPI Recharge screen is a later build, and this sheet
 * is the interim top-up until it lands.
 */
export function RefillSheet() {
  const visible = useStore(s => s.refillVisible);
  const balance = useStore(s => s.balance);
  const close = useStore(s => s.closeRefill);
  const claim = useClaimTokens();

  return (
    <Sheet
      visible={visible}
      testID="refill-sheet"
      title={balance === 0 ? 'You’re Out of Balance' : `${formatRupees(balance)} balance`}
      // 'She’ll still be here' was a gendered pronoun left over from the
      // AI-persona era that ADR-0001 pivoted away from: the product is
      // human-to-human and a provider is any gender.
      body={
        `Talk time is charged by the minute, chat and calls alike, so your ` +
        `balance is money you spend as you go. Top up to keep the conversation ` +
        `going. They will still be here when you top up.`
      }
      // 'Not Now' moves into the sheet's own bar, leaving one full-width
      // primary, which is exactly the iOS sheet shape.
      onCancel={close}
      cancelLabel="Not Now"
      onClose={close}>
      <Button
        label={`Add ${formatRupees(DAILY_REFILL_TOKENS)} Credit`}
        busy={claim.isPending}
        busyLabel="Adding credit"
        onPress={() => claim.mutate()}
        testID="refill-claim"
      />
    </Sheet>
  );
}
