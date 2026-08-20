import React from 'react';
import { DAILY_REFILL_TOKENS, LOW_BALANCE_THRESHOLD } from '../lib/tokenLedger';
import { useClaimTokens } from '../api/chat';
import { useStore } from '../store/useStore';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';

/**
 * The only paywall-shaped surface. Opened by tapping the counter or by a send
 * blocked on an empty wallet — never by a balance change on its own, so it can
 * never interrupt a conversation.
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
      title={balance === 0 ? 'You’re out of tokens' : `${balance ?? 0} tokens left`}
      body={
        `One message costs one token — nothing else spends them, not long replies ` +
        `and not long messages. The nudge appears below ${LOW_BALANCE_THRESHOLD}. ` +
        `She’ll still be here when you top up.`
      }
      onClose={close}>
      <Button
        label={claim.isPending ? 'Adding…' : `Add ${DAILY_REFILL_TOKENS} free tokens`}
        onPress={() => claim.mutate()}
        disabled={claim.isPending}
        testID="refill-claim"
      />
      <Button label="Not now" kind="secondary" onPress={close} />
    </Sheet>
  );
}
