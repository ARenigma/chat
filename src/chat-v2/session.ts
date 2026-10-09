/**
 * The paid session's chrome, decided before anything is drawn.
 *
 * Everything in this file is a rule V1 already applies inside its own render
 * body, where it reads as a chain of `&&`s that cannot be checked: which of the
 * extend card and the recharge bar owns the top band, whether the clock is
 * allowed to start yet, what the leave dialog says for each of its two
 * intents, and what a back press means with four surfaces open over a live
 * session.
 *
 * Pulled out here so each one is a value a test can read, for the same reason
 * `rows.ts` and `chatState.ts` are. Nothing here imports a component, a query
 * client or the Supabase client; `showsCountdown` is the shared threshold, so
 * the two screens cannot disagree about when the last five minutes begin.
 */
import { showsCountdown } from '../lib/sessionClock';
import type { TranscriptMessage } from '../lib/transcript';

/* -------------------------------------------------------------------------- */
/* The band above the transcript                                               */
/* -------------------------------------------------------------------------- */

export interface ChatV2SessionBandInput {
  /** Not `profiles.role`: a provider does not recharge, their wallet is earnings. */
  isMemberSide: boolean;
  /** `paid_sessions.status`, or null when no session is live. */
  status: string | null;
  /** Seconds the balance still buys, aged from the server's snapshot. */
  remaining: number | null;
  /** The member closed the card this visit. */
  extendDismissed: boolean;
  /** The transcript scrolled past the pinned card, so recharge takes the band. */
  extendScrolledAway: boolean;
}

export interface ChatV2SessionBand {
  /** Inside the last five minutes: the clock ticks per second. */
  countingDown: boolean;
  showExtend: boolean;
  showRecharge: boolean;
}

/**
 * Which of the two money controls owns the band, and whether either does.
 *
 * ONE BAND, so this returns at most one of them. The extend card is the
 * ACTIVE-session offer and holds the band while it is pinned; once it has been
 * dismissed or scrolled away, the recharge bar slides into the same slot. Both
 * are gated on the countdown rather than on having a session at all, because
 * the bar exists to say something is running out — a permanent balance strip
 * above a conversation is a second, coarser answer to a question nobody asked
 * (Amit, 2026-09-07: "only one countdown which activates when <=5 mins left").
 *
 * `warning` and `grace` are the server saying time is up. The card is not
 * offered there — extending a session the server has already stopped billing
 * is not what its copy promises — but recharge is exactly the control those
 * states want, so the bar stays.
 */
export function chatV2SessionBand(
  input: ChatV2SessionBandInput,
): ChatV2SessionBand {
  const countingDown = showsCountdown(input.remaining);
  const cardEligible =
    input.isMemberSide &&
    input.status === 'active' &&
    countingDown &&
    input.remaining !== null &&
    input.remaining > 0 &&
    !input.extendDismissed;
  return {
    countingDown,
    showExtend: cardEligible && !input.extendScrolledAway,
    showRecharge:
      input.isMemberSide &&
      countingDown &&
      (!cardEligible || input.extendScrolledAway),
  };
}

/** The statuses in which a session is metering and the clock should run. */
const RUNNING = new Set(['active', 'warning', 'grace']);

/**
 * When the visible clock is allowed to start, or null.
 *
 * The server's `started_at` is authoritative for BILLING; it is not sufficient
 * for the display, because a session can be started by the member before the
 * provider has said anything a human wrote. Automated openers carry
 * `origin = 'automated_opener'` and no `session_id`, so a countdown that began
 * on one would be counting down a conversation that has not started.
 */
export function chatV2SessionStartedAt(input: {
  status: string | null;
  startedAt: string | null;
  hasLiveProviderMessage: boolean;
}): string | null {
  if (input.status === null || !RUNNING.has(input.status)) {
    return null;
  }
  return input.hasLiveProviderMessage ? input.startedAt : null;
}

/**
 * Has the provider of THIS session written a live message in it.
 *
 * All three clauses matter: the sender, the origin, and the session id. A live
 * message from an earlier session is not this one starting.
 */
export function chatV2HasLiveProviderMessage(
  messages: readonly TranscriptMessage[] | undefined,
  session: { id: string; provider_id: string } | null,
): boolean {
  if (session === null) {
    return false;
  }
  return (messages ?? []).some(
    m =>
      m.sender_id === session.provider_id &&
      m.origin === 'live' &&
      m.session_id === session.id,
  );
}

/* -------------------------------------------------------------------------- */
/* Leaving                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `leave` is back — end the session and go. `end` is the header control — end
 * the session and stay in the thread. One dialog, because both are the same
 * irreversible act on the same money and a second dialog would be a second
 * place for the copy to drift.
 */
export type ChatV2LeaveIntent = 'leave' | 'end';

export interface ChatV2LeaveCopy {
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
}

/**
 * What the leave dialog says.
 *
 * The body quotes the elapsed time because that is the fact a member is
 * deciding against — "this has been going for 2:13" is the price so far. The
 * charge sentence belongs to the `end` intent only: leaving is already
 * understood to stop things, whereas the End control sits in a header full of
 * controls that do not.
 *
 * `clock` is null only in the window before billing starts, where the body says
 * so instead; the `0:00` fallback exists so a race between the two can never
 * print a blank into the sentence.
 *
 * D6 (186): Provider copy omits the charge language (they earn, not pay) and
 * uses "Not started yet" when the clock is null (the session has not billed
 * because the provider has not replied yet, per migration 181).
 */
export function chatV2LeaveCopy(input: {
  intent: ChatV2LeaveIntent;
  sessionIsActive: boolean;
  clock: string | null;
  isMemberSide: boolean;
}): ChatV2LeaveCopy {
  const ending = input.intent === 'end';
  if (!input.isMemberSide) {
    // Provider copy: no charge language, "Not started yet" when clock is null
    // (migration 181: billing deferred to first provider reply).
    return {
      title: ending ? 'Done for now?' : 'Leave this chat?',
      body: input.sessionIsActive
        ? input.clock !== null
          ? 'End this chat? This ends the paid chat.'
          : 'Not started yet'
        : ending
        ? 'You are still connecting. Stopping now cancels it.'
        : 'You are still connecting. Leaving will end it.',
      cancelLabel: ending ? 'Keep going' : 'Stay',
      confirmLabel: 'End chat',
    };
  }
  return {
    title: ending ? 'Done for now?' : 'Leave this chat?',
    body: input.sessionIsActive
      ? `This chat has been going for ${input.clock ?? '0:00'}.${
          ending ? ' This stops the chat and the charge.' : ''
        }`
      : ending
      ? 'You are still connecting. Stopping now cancels it.'
      : 'You are still connecting. Leaving will end it.',
    cancelLabel: ending ? 'Keep going' : 'Stay',
    confirmLabel: 'End chat',
  };
}

/* -------------------------------------------------------------------------- */
/* Consent                                                                     */
/* -------------------------------------------------------------------------- */

export interface ChatV2ConsentCopy {
  title: string;
  body: string;
}

/**
 * The one prompt that asks a member to start paying.
 *
 * Two titles, because who reached out first changes what is being agreed to.
 * Both bodies carry the conduct rule and the fact that nothing is charged
 * until both sides start — which is the sentence that makes the prompt
 * answerable rather than alarming.
 */
export function chatV2ConsentCopy(input: {
  peerName: string;
  theyOpenedTheChat: boolean;
}): ChatV2ConsentCopy {
  return input.theyOpenedTheChat
    ? {
        title: `Hey, ${input.peerName} wants to have a chat with you`,
        body: 'Keep it kind. No sexual or abusive talk. You are only charged once you both start.',
      }
    : {
        title: `Hey, ${input.peerName} is here`,
        body: 'They are ready when you are. Keep it kind. No sexual or abusive talk. You are only charged once you both start.',
      };
}

/* -------------------------------------------------------------------------- */
/* The review prompt                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The session id to ask about, or null.
 *
 * Watches for the EDGE rather than for the absence: `activeSession` is null
 * before a session exists too, and asking then would prompt about a
 * conversation that never happened. Member side only — a provider rating a
 * member is a different feature with different consequences (ADR-0006).
 *
 * A blank `peerName` defers rather than prompting: the sheet names the person,
 * and the cold-open window where identity has not resolved is the one moment
 * that name is empty.
 */
export function chatV2ReviewOnEnd(input: {
  previousLiveId: string | null;
  liveId: string | null;
  isMemberSide: boolean;
  peerName: string;
}): string | null {
  if (input.liveId !== null || input.previousLiveId === null) {
    return null;
  }
  if (!input.isMemberSide || input.peerName === '') {
    return null;
  }
  return input.previousLiveId;
}

/*
 * chatV2BackStep and ChatV2BackState were removed in 186.
 *
 * ChatScreenV2 migrated to react-navigation's usePreventRemove (nav §4 3a) in
 * nav-migration, so the back ladder is now owned by ChatRoute and BackHandler
 * directly — each Modal consumes its own back press via onRequestClose. The
 * ladder here was dead code: ChatScreenV2 only referenced it in a comment.
 */
