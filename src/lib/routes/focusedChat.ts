/**
 * The focused Chat, as intents see it.
 *
 * A chat registers `{ peerId, requestAway }` while it is the focused route
 * (from its route's `useFocusEffect`), so a plan that would switch tabs away
 * from a paid chat can ask it first: `requestAway(proceed)` runs `proceed`
 * at once when nothing is billing, and otherwise opens the chat's own leave
 * dialog and runs `proceed` only after the member confirms (nav-migration §3,
 * resolveOpenChat rule 1, A7). A plan that REMOVES the chat does not come
 * through here: the chat's `usePreventRemove` sees that removal itself.
 */

export interface FocusedChat {
  peerId: string;
  requestAway: (proceed: () => void) => void;
}

let focused: FocusedChat | null = null;

/** Registers the focused chat. Returns the owner-checked release. */
export function setFocusedChat(chat: FocusedChat): () => void {
  focused = chat;
  return () => {
    if (focused === chat) {
      focused = null;
    }
  };
}

/** Runs `proceed` once the focused chat, if any, has agreed to be left. */
export function requestAwayFromFocusedChat(proceed: () => void): void {
  if (focused === null) {
    proceed();
    return;
  }
  focused.requestAway(proceed);
}
