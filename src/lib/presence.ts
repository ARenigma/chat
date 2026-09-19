/**
 * One reading of whether somebody is reachable, so four screens cannot
 * disagree about it.
 *
 * They did disagree. Before migration 012 the directory row, the inbox row, the
 * chat header and the provider's own inbox each derived a dot and a line
 * separately, from `is_available`, which was then the provider's *listing*
 * switch: "listed for discovery and open to new conversations". Rendering that
 * as a presence dot said someone was there when it only meant they wanted work,
 * and the provider's inbox had given up entirely and hardcoded `online={false}`,
 * because `peer_available` is false for a member peer by construction. So 012
 * added `profiles.presence` as a separate declaration, and this module became
 * the single interpretation of it.
 *
 * 2026-09-17: 012 IS REVERSED, DELIBERATELY, and not by merging two ideas back
 * together. The second idea is GONE. Amit made `is_available` a master switch
 * over the three channel toggles and removed the presence picker from Settings,
 * so there is no longer a second declaration that could contradict the switch.
 * `is_available` is now the only statement anyone makes about being reachable,
 * which is what makes reading it as the dot honest rather than the overload it
 * was: there is exactly one concept and nothing left to be ambiguous between.
 * The consequence was put to him and accepted — a provider who opens up and
 * never comes back reads as here indefinitely, because nothing else is checked.
 *
 * `profiles.presence`, `profiles.presence_visible` and `touch_presence()` are
 * still in the schema and are now read by nothing. `last_active_at` was never
 * written at all — `touch_presence` has never been called from a client — which
 * is why the closed state says a plain word rather than a last-seen stamp it
 * could not honestly produce.
 *
 * The exported names are unchanged. `readPresence` is what the call sites and
 * `HeaderSubtitle` already speak, including one screen outside this change, and
 * a rename riding along would make a mechanical edit look like a second idea.
 *
 * Kept pure and here rather than in a hook for the reason `datetime.ts` and
 * `transcript.ts` are: it is the part with rules in it, and it is testable
 * without booting the native runtime.
 */

/**
 * How long a typing or recording broadcast keeps the peer's indicator up
 * without a refresh, and the minimum gap between the broadcasts that refresh
 * it.
 *
 * Here rather than inside `src/api/realtime.ts`, which is where both used to
 * live, because a THIRD party has to agree with them: the composer re-pings
 * while a voice note records, and a correct interval has to clear the throttle
 * (anything faster is dropped by the sender) and stay UNDER the TTL (anything
 * slower lets the indicator lapse mid-note). That window cannot be honoured by
 * a constant copied into a component. The copy was 4s — clear of the throttle,
 * but sitting exactly ON the TTL, so every refresh raced the expiry it existed
 * to beat and the indicator blinked off whenever the timer won. A component
 * cannot import the realtime module without dragging the Supabase client into
 * a unit test, so the pair moved to the pure module both sides can read.
 */
export const TYPING_TTL_MS = 4_000;
export const TYPING_THROTTLE_MS = 1_500;

export interface PresenceRead {
  /** Whether the avatar's dot lights. */
  here: boolean;
  /**
   * The line under the name, or null when there is nothing to say. Null is a
   * real case and not an empty string: the chat header renders the name alone
   * rather than reserving a blank row, and a row that appears and disappears is
   * what made the header change height.
   */
  line: string | null;
}

const NOTHING: PresenceRead = { here: false, line: null };

/**
 * Three outcomes from a boolean, because null is not false here. The column is
 * `not null`, so a nullish argument means the row has not loaded, or the peer
 * is a member and has no listing switch to publish. Saying "Away" about either
 * would be asserting something nobody stated; the one direction that must never
 * happen is showing somebody as present who did not open up.
 */
export function readPresence(isAvailable: boolean | null | undefined): PresenceRead {
  if (isAvailable === true) {
    return { here: true, line: 'Here now' };
  }
  if (isAvailable === false) {
    return { here: false, line: 'Away' };
  }
  return NOTHING;
}

/**
 * The same reading, lowercased, for an accessibility label that is read as part
 * of a sentence rather than on its own line. Separate from `line` so the visible
 * label can stay title-case without a screen reader announcing 'Here Now' mid
 * sentence.
 */
export function presenceForSpeech(read: PresenceRead): string | null {
  return read.line === null ? null : read.line.toLowerCase();
}

/** The three channel switches as a provider sets them (migration 064). */
export interface OfferedChannels {
  chat_enabled: boolean;
  audio_enabled: boolean;
  video_enabled: boolean;
}

/**
 * What to say under the name when a provider does not offer everything.
 *
 * Amit, 2026-09-17: "gate the mode of interaction if sp has disabled some mode
 * for member to let them know for example that this sp is only available for
 * voice chat". The surfaces already withhold the actions; this is the sentence
 * that stops the absence reading as a bug.
 *
 * Null for the full set, because the default needs no caption and a line on
 * every card would be noise that teaches a member to stop reading it.
 *
 * Migration 064's `profiles_at_least_one_channel` CHECK makes the empty set
 * unrepresentable, so the final return is unreachable rather than a state with
 * copy of its own.
 */
export function offeredChannelsLine(offered: OfferedChannels): string | null {
  const chat = offered.chat_enabled;
  const voice = offered.audio_enabled;
  const video = offered.video_enabled;
  if (chat && voice && video) {
    return null;
  }
  if (chat && voice) {
    return 'Chat and voice calls only';
  }
  if (chat && video) {
    return 'Chat and video calls only';
  }
  if (voice && video) {
    return 'Voice and video calls only';
  }
  if (chat) {
    return 'Chat only';
  }
  if (voice) {
    return 'Voice calls only';
  }
  if (video) {
    return 'Video calls only';
  }
  return null;
}
