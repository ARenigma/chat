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
 * 2026-09-27 (migration 155): LAST SEEN IS REAL NOW. The provider app
 * heartbeats, and the server derives `online` (open, a heartbeat within 75 s,
 * no explicit offline since) and `last_seen_at` (that event, to the minute) in
 * the directory and the inbox views, withheld for member peers and across a
 * block. `readPresence({ online, lastSeenAt, now })` renders them, and it is
 * the only form: every dot and line reads the server's two fields, and the
 * pre-155 boolean form (the master switch as the dot, "Here now" / "Away")
 * was deleted once the last call site moved. The switch still decides what a
 * member can DO (the Notify route); it no longer decides the dot.
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
 * The server's presence reading for one person (migration 155), as the
 * directory (`online`, `last_seen_at`) and the inbox and peers views
 * (`peer_online`, `peer_last_seen_at`) publish it.
 */
export interface PresenceInput {
  /**
   * Derived by the server: open, a heartbeat within 75 s, and no explicit
   * offline since. False for a member peer and across a block. Undefined while
   * the row has not loaded or the server predates 155.
   */
  online: boolean | null | undefined;
  /**
   * The last presence event, rounded down to the minute by the server. Null for
   * a member, across a block, or when never seen.
   */
  lastSeenAt: string | null | undefined;
  /** The render's clock, passed in so the function stays pure. */
  now: Date;
  /**
   * Minutes east of UTC to read the calendar in. Defaults to the device's own
   * offset at each instant, which is what "today" means to the person reading.
   * Tests pin it (330, IST, which has no DST) so a boundary does not depend on
   * the machine running them.
   */
  utcOffsetMinutes?: number;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Fixed English names, because Hermes ships one Intl locale (datetime.ts). */
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** The wall-clock fields of an instant at an offset, read through UTC getters. */
function wallClock(ms: number, offsetMinutes: number | undefined) {
  const offset = offsetMinutes ?? -new Date(ms).getTimezoneOffset();
  const shifted = new Date(ms + offset * MINUTE_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    /** The calendar day as a whole number, so two days subtract to whole days. */
    day: Math.floor(
      Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate(),
      ) / DAY_MS,
    ),
  };
}

/** "10:15 am": en-IN's 12-hour clock, lowercase, no leading zero on the hour. */
function clockLine(hours: number, minutes: number): string {
  const suffix = hours < 12 ? 'am' : 'pm';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/**
 * The last-seen escalation WhatsApp uses, in en-IN: a time for today and
 * yesterday, a weekday inside the week, and a date after it. A weekday is only
 * unambiguous for six days, so it stops there, as `listStamp` does. The year is
 * added only when it is not this year's, so an old stamp cannot read as recent.
 *
 * Deliberately a 12-hour clock rather than `timeOfDay`'s device preference:
 * this is a sentence of copy ("last seen today at 10:15 am"), specified in
 * en-IN, and not a stamp in a column.
 */
function lastSeenLine(
  lastSeenAt: string,
  now: Date,
  utcOffsetMinutes: number | undefined,
): string | null {
  const parsed = Date.parse(lastSeenAt);
  const nowMs = now.getTime();
  if (Number.isNaN(parsed) || Number.isNaN(nowMs)) {
    return null;
  }
  // A stamp ahead of this device's clock is skew, not a future visit: read it
  // as now, rather than as "tomorrow" on a device whose clock is behind.
  const thenMs = Math.min(parsed, nowMs);
  const then = wallClock(thenMs, utcOffsetMinutes);
  const today = wallClock(nowMs, utcOffsetMinutes);
  const days = today.day - then.day;
  const at = clockLine(then.hours, then.minutes);
  if (days <= 0) {
    return `last seen today at ${at}`;
  }
  if (days === 1) {
    return `last seen yesterday at ${at}`;
  }
  if (days < 7) {
    return `last seen ${WEEKDAYS[then.weekday]} at ${at}`;
  }
  const date = `${then.date} ${MONTHS[then.month]}`;
  return then.year === today.year
    ? `last seen ${date}`
    : `last seen ${date} ${then.year}`;
}

/**
 * The one reading of whether somebody is here.
 *
 * The server's reading (migration 155), `{ online, lastSeenAt, now }`:
 *   - `online` true lights the dot and says "Online";
 *   - otherwise a known last seen says "last seen today at 10:15 am",
 *     "last seen yesterday at ...", "last seen Monday at ..." inside a week and
 *     "last seen 12 Sep" after it, with the dot off;
 *   - with neither, nothing: no dot and no line. That is a member peer, a
 *     blocked pair, a provider never seen, or a row not loaded yet, and saying
 *     anything about them would be a claim nobody made. Availability off with a
 *     recent heartbeat reads as a last-seen line and never as "Online", because
 *     the server's `online` already requires the switch.
 *
 * `here` is the dot and nothing else. A surface deciding whether a provider
 * can be REACHED (Call versus Notify) reads `is_available`, not this: open but
 * idle for more than 75 s is not online, and is still callable.
 */
export function readPresence(input: PresenceInput): PresenceRead {
  if (input.online === true) {
    return { here: true, line: 'Online' };
  }
  if (typeof input.lastSeenAt === 'string') {
    const line = lastSeenLine(input.lastSeenAt, input.now, input.utcOffsetMinutes);
    return line === null ? NOTHING : { here: false, line };
  }
  return NOTHING;
}

/**
 * The same reading, lowercased, for an accessibility label that is read as part
 * of a sentence rather than on its own line. Separate from `line` so the visible
 * label can stay capitalised ("Online") without a screen reader announcing it
 * capitalised mid sentence ("Priya, online, speaks Hindi").
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
