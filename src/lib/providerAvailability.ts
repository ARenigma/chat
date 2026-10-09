import { useCallback } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { SET_AVAILABILITY_KEY, useSetAvailability } from '../api/provider';
import { track } from './telemetry';

/**
 * The availability vocabulary, in one place, because availability is said in
 * TWO places: the switch in the Chats header (ProviderChatsScreen) and the card
 * on the You tab (ProviderYouScreen).
 *
 * A module of its own since the provider split (navigation step 6), for the
 * same reason it was one constant before the split: a future edit to the
 * card's wording cannot leave the header describing the same boolean in a
 * vocabulary that has moved on. The state itself already cannot diverge — both
 * controls read `profile.is_available` and call the same mutation — and this is
 * the same argument applied to the words.
 *
 * `head` is deliberately NOT presence vocabulary: no "Away", "Offline" or
 * "Hidden". That rule outlived the thing it was written against: the separate
 * presence chooser is GONE from SettingsSheet as of 2026-09-17, and this switch
 * is now the only availability control in the app. The vocabulary still holds,
 * because Open/Closed is the shop metaphor the card's own title uses and
 * "hidden" would now describe nothing at all.
 *
 * `on.sub` CHANGED on 2026-09-17, when the three channel switches moved under
 * this one (see `styles.availabilityCard` in ProviderYouScreen). It used to
 * promise "you can be messaged", which was a claim the card itself could
 * contradict two rows lower the moment a provider turned Chat off and kept
 * calls on. It now points at the switches that give the real answer, which is
 * the whole reason they are children rather than a fourth peer question.
 */
export const AVAILABILITY = {
  on: {
    head: 'Online',
    title: 'Online for New Conversations',
    sub: 'You are listed. Pick how members can reach you.',
  },
  off: {
    head: 'Offline',
    title: 'Not Taking New Conversations',
    // D4: the directory still lists closed providers as "Notify only", so
    // "not listed" was false. The honest claim is that new conversations are
    // blocked; existing chats are unaffected.
    sub: "Members can't start new conversations with you. Existing chats still work.",
  },
} as const;

/**
 * The one availability write, shared by both switches so they narrate the same
 * `availability_changed` event. Each screen calls this hook and gets its own
 * mutation observer, so `pending` is read through the mutation KEY rather than
 * the observer: either switch is held while either one's write is in flight,
 * which is what one shared `useSetAvailability()` gave before the split.
 */
export function useAvailabilityToggle() {
  const setAvailability = useSetAvailability();
  const toggle = useCallback(
    (next: boolean) => {
      track('availability_changed', { available: next });
      setAvailability.mutate(next);
    },
    [setAvailability],
  );
  const pending = useIsMutating({ mutationKey: SET_AVAILABILITY_KEY }) > 0;
  return { toggle, pending };
}
