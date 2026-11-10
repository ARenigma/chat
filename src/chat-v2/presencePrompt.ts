import type { ChatOpenAlert } from '../api/sessions';
import type { IconName } from '../components/Icon';
import type { PresenceRead } from '../lib/presence';

/** What the prompt's one button does. The screen owns the handlers. */
export interface PresencePromptAction {
  kind: 'call' | 'recharge';
  label: string;
}

export interface PresencePromptContent {
  text: string;
  sub?: string;
  icon: IconName;
  action?: PresencePromptAction;
}

interface PresencePromptInput {
  /** What `announce_chat_open` answered on this visit; null until it does. */
  alert: ChatOpenAlert | null;
  isMemberSide: boolean;
  /** The header's name for the peer; blank while identity loads. */
  name: string;
  /** The controller's live reading of the peer (`readPresence`). */
  presence: PresenceRead;
  /** Any session is live: the other person has joined, so no prompt. */
  sessionActive: boolean;
  /** Epoch ms. */
  now: number;
  /** A call can be started from this chat (kill switch, channel flags). */
  canCall: boolean;
}

/*
 * `announce_chat_open` reasons that say something this prompt can use
 * (migration 111). Every other reason (in_session, unauthorized, forbidden,
 * not_found, not_configured) is silence on purpose.
 */
const SPEAKS = new Set(['peer_present', 'cooldown', 'no_balance']);

function waitLabel(minutes: number): string {
  if (minutes <= 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/**
 * The friendly line under a chat that follows the other person's presence.
 *
 * Live presence wins over the one-time RPC answer: a peer who comes online
 * after "away" flips the line, and a session removes it. A member's presence
 * is never published (see `readPresence`), so on the provider side the live
 * reading is unknown and the RPC's own `peer_present` / `alerted` stand in.
 *
 * The prompt promises no follow-up push ("we'll tell you when they're back"):
 * that does not exist yet.
 */
export function presencePrompt(input: PresencePromptInput): PresencePromptContent | null {
  const { alert, isMemberSide, name, presence, sessionActive, now, canCall } = input;
  if (alert === null || name === '' || sessionActive) {
    return null;
  }
  if (!alert.alerted && !SPEAKS.has(alert.reason ?? '')) {
    return null;
  }

  const liveKnown = presence.here || presence.line !== null;
  const online = liveKnown
    ? presence.here
    : alert.peer_present === true || alert.reason === 'peer_present';
  if (online) {
    return isMemberSide
      ? {
          text: `${name} is online now. You can chat or call.`,
          icon: 'check',
          ...(canCall ? { action: { kind: 'call', label: `Call ${name}` } } : {}),
        }
      : { text: `${name} is online now. Say hello when you're ready.`, icon: 'check' };
  }

  if (alert.alerted) {
    return {
      text: isMemberSide
        ? `${name} is away. We've let them know, and they'll join you here soon.`
        : `${name} is away. We've let them know.`,
      icon: 'bell',
    };
  }

  if (alert.reason === 'cooldown') {
    const until = Date.parse(alert.cooldown_until ?? '');
    if (Number.isNaN(until) || until <= now) {
      return null;
    }
    const minutes = Math.max(1, Math.ceil((until - now) / 60_000));
    return {
      text: `You nudged ${name} a few minutes ago.`,
      sub: `You can nudge again in ${waitLabel(minutes)}.`,
      icon: 'bell',
    };
  }

  // no_balance is always the MEMBER's balance; the provider never hears of it.
  if (alert.reason === 'no_balance' && isMemberSide) {
    return {
      text: `Add a little balance to nudge ${name}.`,
      sub: 'A nudge needs at least one minute of balance.',
      icon: 'bell',
      action: { kind: 'recharge', label: 'Add balance' },
    };
  }
  return null;
}
