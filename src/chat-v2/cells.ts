/**
 * What the V2 cells paint, decided before anything is laid out.
 *
 * Pure and separate from the components for the reason `rows.ts` and
 * `chatState.ts` are: these are the rules that read correct and behave wrong —
 * which actions a bubble may offer, whether a missed call can actually be
 * called back, how much room the clock needs — and a grep over a `.tsx` file
 * cannot tell a right rule from a wrong one. Every rule here is asserted as a
 * value in `__tests__/chatV2Cells.test.ts`.
 *
 * It imports nothing that would pull the native runtime into a unit test:
 * `timeOfDay` and `durationWords` are the app's shared formatters, so a call
 * row and a session row cannot word one history two ways.
 */
import type { CallRecord } from '../api/chat';
import { timeOfDay } from '../lib/datetime';
import { TYPING_THROTTLE_MS } from '../lib/presence';
import type { ReactionTally } from '../lib/reactions';
import { durationWords } from '../lib/transcript';
import { TOKENS } from '../theme/tokens';
import type { ChatV2MessageRow } from './rows';

/* -------------------------------------------------------------------------- */
/* The bubble's metadata slot                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The clock's own type size. 11, not `bodySmall`'s 12: the meta is a
 * disclosure inside somebody else's sentence, and it takes the smallest step
 * the type scale's own ramp still reads at.
 */
export const CHAT_V2_META_FONT_SIZE = 11;
/** Fixed, and the reason my bubble and theirs are the same height. */
export const CHAT_V2_META_LINE_HEIGHT = 16;
/** `bodySmall`'s tracking, which the meta inherits. */
const META_LETTER_SPACING = 0.4;
/** Between the last glyph of the message and the reserved slot. */
export const CHAT_V2_META_GAP = TOKENS.space.xs;
/** Between the clock and the receipt tick inside the meta row. */
const META_TICK_GAP = TOKENS.space.hair;

/**
 * Whether a character occupies a full em rather than a Latin advance.
 *
 * Unicode's East Asian Width "W" and "F" classes, as the ranges that actually
 * reach a timestamp: Hangul, the CJK ideographs and their compatibility and
 * extension blocks, the kana, the CJK symbols and punctuation, and the
 * fullwidth forms. https://www.unicode.org/reports/tr11/
 */
function isFullWidth(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK radicals, symbols, punctuation
    (code >= 0x3041 && code <= 0x33ff) || // Kana, Bopomofo, compatibility
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0xa960 && code <= 0xa97f) || // Hangul Jamo Extended-A
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
    (code >= 0xfe10 && code <= 0xfe6f) || // Vertical forms, small forms
    (code >= 0xff00 && code <= 0xff60) || // Fullwidth forms
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

/**
 * Per-glyph advance, in ems, rounded UP.
 *
 * WHY AN ESTIMATE AT ALL. React Native cannot measure text before it lays it
 * out — `onLayout` is the only answer, and it arrives a frame late
 * (https://reactnative.dev/docs/text). V1 took that frame: its `metaWidth`
 * starts at 0, so a one-word bubble reserved nothing, wrapped the clock onto a
 * second line, and then snapped back a frame later. On a `Hi` that is the
 * bubble visibly doubling its height on arrival.
 *
 * So the slot is COMPUTED instead, and the arithmetic is deliberately
 * pessimistic: every advance here is at or above the real one for Geist, and a
 * cushion is added on top. Over-reserving widens a bubble by a point or two,
 * which nobody can see; under-reserving would let the clock sit on a glyph,
 * which everybody can. That asymmetry is why the numbers round up.
 *
 * THE FULL-WIDTH BRANCH IS NOT DEFENSIVE PROGRAMMING, it is the common case on
 * a large share of devices. `timeOfDay` is `Intl.DateTimeFormat` on the DEVICE
 * locale, so a Japanese phone renders "午後3:55" and a Korean one "오후 3:55".
 * Every one of those marks is a whole em; charging them a Latin lowercase
 * advance under-reserves the slot by nearly half and parks the clock on top of
 * a character — the single failure this estimator exists to prevent.
 */
function advanceEm(ch: string): number {
  if (ch >= '0' && ch <= '9') {
    return 0.58;
  }
  const code = ch.codePointAt(0) ?? 0;
  if (isFullWidth(code)) {
    return 1;
  }
  // Anything outside the BMP is an emoji or a rare script; both are at least a
  // full em, and a timestamp containing one is already unusual enough to
  // deserve the wider reserve rather than the narrower.
  if (code > 0xffff) {
    return 1.2;
  }
  switch (ch) {
    case ':':
    case '.':
    case ',':
      return 0.32;
    case ' ':
    case '\u202f': // Intl's narrow no-break space, in front of AM/PM.
    case '\u00a0':
      return 0.3;
    case '·':
      return 0.36;
    case 'i':
    case 'l':
    case 'j':
    case 'I':
    case 't':
    case 'f':
    case 'r':
      return 0.36;
    case 'm':
    case 'w':
    case 'M':
    case 'W':
      return 0.92;
    default:
      return ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? 0.74 : 0.62;
  }
}

function textWidth(
  text: string,
  fontSize: number,
  letterSpacing: number,
): number {
  let total = 0;
  for (const ch of text) {
    total += advanceEm(ch) * fontSize + letterSpacing;
  }
  return Math.ceil(total);
}

/** The delivery state a bubble paints, or nothing at all. */
export type ChatV2Receipt = 'sent' | 'read';

export interface ChatV2MetaFacts {
  stamp: string;
  receipt?: ChatV2Receipt;
  /** Migration 103's `edited_at`, which rides in the clock's own string. */
  edited?: boolean;
  /** A failed send shows a mark instead of a tick — same box, same width. */
  failed?: boolean;
}

/**
 * The one string the meta row paints.
 *
 * "Edited" rides IN the timestamp rather than as a sibling `Text`, which is
 * WhatsApp's placement and also the only shape that measures once: two adjacent
 * Texts in this row is the layout that clipped and wrapped in V1.
 */
export function chatV2MetaText(facts: {
  stamp: string;
  edited?: boolean;
}): string {
  return facts.edited === true ? `Edited · ${facts.stamp}` : facts.stamp;
}

/**
 * How much room to reserve at the end of the last line, in dp.
 *
 * The reserve is a zero-content spacer inside the message `Text`, and the real
 * meta is overlaid absolutely on top of it — so the text's intrinsic width
 * becomes `max(widest line, last line + slot)` and the bubble hugs exactly the
 * WhatsApp width. Because this number is known before layout, the first frame
 * is the final frame.
 */
export function chatV2MetaSlot(facts: ChatV2MetaFacts): number {
  const label = chatV2MetaText(facts);
  const glyphs = textWidth(label, CHAT_V2_META_FONT_SIZE, META_LETTER_SPACING);
  const mark =
    facts.failed === true || facts.receipt !== undefined
      ? META_TICK_GAP + TOKENS.icon.xs
      : 0;
  // The cushion absorbs the difference between this estimate and the font's
  // real advances. Two points, which is under one character.
  return glyphs + mark + 2;
}

/**
 * Both sides, identically. WhatsApp's measured insets (8/2/10/5), and the fact
 * that they are the SAME on my bubble and theirs is the whole point: V1 gave
 * mine `space.md`/`space.xs` and theirs the measured pair, so a one-word
 * exchange came out two different heights.
 *
 * There is deliberately no `chatV2BubbleHeight()` beside this. One existed and
 * was deleted on review: it re-derived a height from these constants and was
 * then asserted against itself, which proves the arithmetic and nothing about
 * the bubble. The parity that ships is that BOTH sides spread one `bubble`
 * style rule, and the test asserts that against the stylesheet.
 */
export const CHAT_V2_BUBBLE_PADDING = {
  left: 8,
  top: 2,
  right: 10,
  bottom: 5,
} as const;

/**
 * The tick a bubble carries, or none.
 *
 * Mine only, settled only, and never on a tombstone: a read tick on a message
 * that no longer exists is a claim about nothing.
 */
export function chatV2Receipt(
  row: ChatV2MessageRow,
): ChatV2Receipt | undefined {
  if (!row.mine || row.pending || row.deleted) {
    return undefined;
  }
  return row.message.read_at === null ? 'sent' : 'read';
}

/* -------------------------------------------------------------------------- */
/* What a long press may offer                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Which surface a long press opens.
 *
 * Two different menus, deliberately, because they are two different sets:
 * theirs is a bar of quick reactions with reply and report, mine is a vertical
 * list of the two things an author can do to their own words. Folding them into
 * one would mean either a reaction picker on my own message — a self-reaction,
 * which a 1:1 thread has no use for — or Edit and Delete sitting on a peer
 * message where the server would refuse both.
 */
type ChatV2ActionSurface = 'none' | 'reactions' | 'menu';

export interface ChatV2MessageActions {
  surface: ChatV2ActionSurface;
  react: boolean;
  reply: boolean;
  report: boolean;
  edit: boolean;
  /** `delete` is a keyword in enough places to be worth avoiding as a name. */
  remove: boolean;
}

const NO_ACTIONS: ChatV2MessageActions = {
  surface: 'none',
  react: false,
  reply: false,
  report: false,
  edit: false,
  remove: false,
};

export interface ChatV2ActionInput {
  mine: boolean;
  /** Optimistic, which a failed send also is — its id keeps the nonce. */
  pending: boolean;
  failed: boolean;
  deleted: boolean;
  /**
   * `canEditMessage` / `canDeleteMessage` from `src/api/chat`, decided by the
   * caller. Taken as booleans rather than computed here so this module stays
   * out of the Supabase client's import graph, and so the fifteen-minute window
   * has exactly one definition — the one the server also enforces.
   */
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * What this row offers, and what it must not.
 *
 * A tombstone offers nothing on either side: quoting, reacting to or reporting
 * a message whose text is gone all produce a reference to nothing, and
 * `reports.evidence_body` would have nothing to snapshot.
 *
 * A pending or failed row of mine offers nothing either. It is not on the
 * server yet, so every action would name an id that does not exist; the tap it
 * does have is the retry.
 */
export function chatV2MessageActions(
  input: ChatV2ActionInput,
): ChatV2MessageActions {
  if (input.deleted || input.pending || input.failed) {
    return NO_ACTIONS;
  }
  if (!input.mine) {
    return {
      surface: 'reactions',
      react: true,
      reply: true,
      report: true,
      edit: false,
      remove: false,
    };
  }
  if (!input.canEdit && !input.canDelete) {
    // Nothing the server would accept, so nothing is drawn — rather than a
    // menu that exists only to refuse.
    return NO_ACTIONS;
  }
  return {
    surface: 'menu',
    react: false,
    reply: false,
    report: false,
    edit: input.canEdit,
    remove: input.canDelete,
  };
}

/**
 * The owner menu's rows, in order.
 *
 * Built here rather than inline in the component so the ORDER, the danger flag
 * and the rule between the two are values a test can read. The order is M3's:
 * the common action where the thumb lands, the irreversible one at the bottom
 * behind a divider so it is a deliberate reach rather than the next row down.
 * https://m3.material.io/components/menus/guidelines
 */
export interface ChatV2MenuItem {
  key: 'edit' | 'delete';
  label: string;
  danger: boolean;
  /** A hairline above this row, grouping it away from what is above. */
  divider: boolean;
}

export function chatV2OwnerMenuItems(
  actions: ChatV2MessageActions,
): ChatV2MenuItem[] {
  if (actions.surface !== 'menu') {
    return [];
  }
  const items: ChatV2MenuItem[] = [];
  if (actions.edit) {
    items.push({ key: 'edit', label: 'Edit', danger: false, divider: false });
  }
  if (actions.remove) {
    items.push({
      key: 'delete',
      label: 'Delete',
      danger: true,
      // Only when something is above it. A rule at the top of a card is a line
      // separating the menu from nothing.
      divider: items.length > 0,
    });
  }
  return items;
}

/**
 * The actions a screen reader can fire on a bubble.
 *
 * `longpress` and `activate` are both standard React Native actions, which is
 * what makes them reachable: TalkBack raises them from its own menu, so the
 * long press that opens the reaction strip and the tap that retries a failed
 * send stop being gesture-only. https://reactnative.dev/docs/accessibility
 *
 * This replaces an `accessibilityHint` that was INERT. RN installs its
 * accessibility delegate only for a view carrying a role, state, actions or a
 * test id — a hint alone installs nothing, so "Long press for message actions"
 * was never announced on any API level. An `accessibilityActions` entry both
 * installs the delegate and gives the action somewhere to go.
 */
export interface ChatV2A11yAction {
  name: 'longpress' | 'activate';
  label: string;
}

export function chatV2CellA11yActions(input: {
  actionable: boolean;
  failed: boolean;
  /**
   * The label for a row that has a TAP of its own — a photo opens full screen.
   * Omitted on a text or voice row, where the tap does nothing and offering
   * `activate` would announce an action that goes nowhere.
   */
  activateLabel?: string;
}): ChatV2A11yAction[] {
  if (input.failed) {
    // A failed row has no menu and its photo has nothing to open — the one
    // action is the retry, which is what the tap does for everyone else.
    return [{ name: 'activate', label: 'Retry sending' }];
  }
  const actions: ChatV2A11yAction[] = [];
  if (input.activateLabel !== undefined) {
    actions.push({ name: 'activate', label: input.activateLabel });
  }
  if (input.actionable) {
    actions.push({ name: 'longpress', label: 'Message actions' });
  }
  return actions;
}

/* -------------------------------------------------------------------------- */
/* The photo                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What a media bubble is doing, decided from all three facts at once.
 *
 * `failed` is checked FIRST and that ordering is the fix rather than a
 * preference. A failed send keeps its optimistic `pending-…` id, so `pending`
 * stays true forever — and a bubble that branched on `pending` alone left an
 * indeterminate progress bar turning over a photo that had already given up.
 * The app claiming to still be working on something it had stopped doing is
 * worse than no indicator at all, because it is the one state from which the
 * member would never think to retry.
 */
export type ChatV2MediaState = 'ready' | 'uploading' | 'resolving' | 'failed';

export function chatV2MediaState(input: {
  pending: boolean;
  failed: boolean;
  /** A local pick or a signed URL — something to actually draw. */
  hasSource: boolean;
}): ChatV2MediaState {
  if (input.failed) {
    return 'failed';
  }
  if (input.pending) {
    return 'uploading';
  }
  return input.hasSource ? 'ready' : 'resolving';
}

/* -------------------------------------------------------------------------- */
/* The call log row                                                            */
/* -------------------------------------------------------------------------- */

export interface ChatV2CallModel {
  icon: 'call' | 'video';
  medium: 'voice' | 'video';
  /** One line. Never two — see the note on `tappable`. */
  label: string;
  tone: 'danger' | 'muted';
  tappable: boolean;
  accessibilityLabel: string;
}

export interface ChatV2CallPermissions {
  canStartAudio: boolean;
  canStartVideo: boolean;
  /** A non-chat session is already live, so a second call cannot start. */
  sessionBusy: boolean;
  /** The screen was given a way to start a call at all. */
  callsAvailable: boolean;
}

/**
 * A call, as one line.
 *
 * A call that CONNECTED and then ended is a muted, non-tappable log line. One
 * the other side never accepted is the loud entry WhatsApp makes it: danger
 * tint, and the whole row is the call-back target.
 *
 * NO SECOND LINE. V1 printed "Tap to call back" under the label, which is a
 * caption explaining an affordance the row already has — and it made the row
 * two heights depending on whether calling happened to be switched on. The
 * affordance is carried by the accessibility label instead, where it is read to
 * the people who cannot see that the row is pressable.
 */
export function chatV2CallModel(
  call: CallRecord,
  permissions: ChatV2CallPermissions,
): ChatV2CallModel {
  const video = call.medium === 'video';
  const noun = video ? 'Video' : 'Voice';
  const stamp = timeOfDay(call.created_at);
  const connected = call.status === 'ended';

  let label: string;
  switch (call.status) {
    case 'ended': {
      const talk =
        call.started_at === null || call.ended_at === null
          ? ''
          : durationWords(
              Math.round(
                (Date.parse(call.ended_at) - Date.parse(call.started_at)) /
                  1000,
              ),
            );
      label = `${noun} call${talk === '' ? '' : ` · ${talk}`} · ${stamp}`;
      break;
    }
    case 'missed':
      label = `Missed ${noun.toLowerCase()} call · ${stamp}`;
      break;
    case 'declined':
      label = `Declined ${noun.toLowerCase()} call · ${stamp}`;
      break;
    default:
      label = `${noun} call failed · ${stamp}`;
      break;
  }

  const allowed = video ? permissions.canStartVideo : permissions.canStartAudio;
  const tappable =
    !connected &&
    permissions.callsAvailable &&
    allowed &&
    !permissions.sessionBusy;

  return {
    icon: video ? 'video' : 'call',
    medium: call.medium,
    label,
    tone: connected ? 'muted' : 'danger',
    tappable,
    accessibilityLabel: tappable ? `${label}. Tap to call back.` : label,
  };
}

/* -------------------------------------------------------------------------- */
/* Cell identity                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Everything a message cell paints, as primitives.
 *
 * The row OBJECTS cannot carry the memo: `buildChatV2Rows` runs on every change
 * to `messages`, and react-query hands back a fresh array whenever a single
 * `read_at` lands — so every row object is new and a reference compare re-renders
 * the whole transcript for one tick. Comparing the facts instead means a receipt
 * re-renders the one bubble it is about.
 */
export interface ChatV2MessageCellFacts {
  id: string;
  messageId: string;
  text: string;
  mine: boolean;
  /** Oldest bubble of a run: the one that carries the tail. */
  first: boolean;
  pending: boolean;
  failed: boolean;
  deleted: boolean;
  edited: boolean;
  stamp: string;
  receipt: ChatV2Receipt | undefined;
  voicePath: string | undefined;
  /** Printed by the player, so a correction to it is a change on screen. */
  voiceDurationMs: number | undefined;
  /** Drawn by the waveform, one bar per entry. */
  voicePeaks: readonly number[] | undefined;
  imagePath: string | undefined;
  imageLocalUri: string | undefined;
  /**
   * The intrinsic size the bubble reserves its box from. Not decoration: the
   * height comes from this aspect, so a changed dimension is a changed cell
   * height, and a comparator that missed it would leave the transcript holding
   * a box the photo no longer fits.
   */
  imageWidth: number | undefined;
  imageHeight: number | undefined;
  quoteAuthor: string | undefined;
  quoteBody: string | undefined;
  tallies: readonly ReactionTally[] | undefined;
}

function sameTallies(
  a: readonly ReactionTally[] | undefined,
  b: readonly ReactionTally[] | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined || a.length !== b.length) {
    return false;
  }
  return a.every((tally, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      tally.emoji === other.emoji &&
      tally.count === other.count &&
      tally.mine === other.mine
    );
  });
}

/**
 * Element-wise, like the tallies above, and for the same reason: `voiceOf`
 * rebuilds the array on every row build, so a reference compare would report a
 * change on every receipt and a skipped compare would miss a real one.
 * `VOICE_BARS` caps this at 32 numbers, and it only runs on a cell that matched
 * on everything else.
 */
function samePeaks(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined || a.length !== b.length) {
    return false;
  }
  return a.every((peak, i) => peak === b[i]);
}

/** `memo`'s comparator: true means "nothing this cell paints has changed". */
export function sameMessageCell(
  a: ChatV2MessageCellFacts,
  b: ChatV2MessageCellFacts,
): boolean {
  return (
    a.id === b.id &&
    a.messageId === b.messageId &&
    a.text === b.text &&
    a.mine === b.mine &&
    a.first === b.first &&
    a.pending === b.pending &&
    a.failed === b.failed &&
    a.deleted === b.deleted &&
    a.edited === b.edited &&
    a.stamp === b.stamp &&
    a.receipt === b.receipt &&
    a.voicePath === b.voicePath &&
    a.voiceDurationMs === b.voiceDurationMs &&
    a.imagePath === b.imagePath &&
    a.imageLocalUri === b.imageLocalUri &&
    a.imageWidth === b.imageWidth &&
    a.imageHeight === b.imageHeight &&
    a.quoteAuthor === b.quoteAuthor &&
    a.quoteBody === b.quoteBody &&
    samePeaks(a.voicePeaks, b.voicePeaks) &&
    sameTallies(a.tallies, b.tallies)
  );
}

/* -------------------------------------------------------------------------- */
/* Page down                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The air between the page-down control and the top of the dock.
 *
 * 8dp, the smallest Material spacing step that still reads as a gap rather than
 * a join. https://m3.material.io/foundations/layout/understanding-layout/spacing
 */
export const CHAT_V2_PAGE_DOWN_GAP = TOKENS.space.xs;

/**
 * Where the page-down control sits above the dock.
 *
 * `dockHeight` is the MEASURED height of every sticky child together — the
 * consent row, the start-session row, the reply strip and the composer — not
 * the composer alone. Measuring the composer alone is how the control ended up
 * under a reply strip that had just appeared.
 */
export function chatV2PageDownBottom(dockHeight: number): number {
  return dockHeight + CHAT_V2_PAGE_DOWN_GAP;
}

/* -------------------------------------------------------------------------- */
/* The composer                                                                */
/* -------------------------------------------------------------------------- */

/**
 * How often the composer re-announces that a voice note is being recorded.
 *
 * The sender throttles outbound presence broadcasts at `TYPING_THROTTLE_MS`
 * and the receiver drops the indicator `TYPING_TTL_MS` after the last one, so
 * a correct interval is at least the first and strictly under the second — and
 * the throttle itself is the cheapest value that is both. The local 4s copy
 * this replaces cleared the throttle but landed exactly on the TTL, which
 * makes every refresh a race against the expiry it is meant to beat: whenever
 * the expiry won, the peer watched the indicator blink off mid-recording.
 */
export const CHAT_V2_RECORD_PING_MS = TYPING_THROTTLE_MS;

export type ChatV2ComposerMode = 'idle' | 'recording' | 'review';

/** Which control sits in the composer's trailing slot. */
export type ChatV2TrailingControl = 'send' | 'mic' | 'stop';

/**
 * One slot, three states, and it never empties.
 *
 * A disabled thread keeps the mic in place rather than removing it: the slot
 * is 40dp of the capsule's width, and a control that disappears while the
 * placeholder explains why would resize the field for a state change. The
 * control is `disabled` instead, which is what makes the tap honest.
 */
export function chatV2TrailingControl(input: {
  mode: ChatV2ComposerMode;
  text: string;
  disabled: boolean;
}): ChatV2TrailingControl {
  if (input.mode === 'recording') {
    return 'stop';
  }
  if (input.mode === 'review') {
    return 'send';
  }
  if (input.disabled) {
    return 'mic';
  }
  return input.text.trim() === '' ? 'mic' : 'send';
}

/* -------------------------------------------------------------------------- */
/* Starting a session                                                          */
/* -------------------------------------------------------------------------- */

export interface ChatV2ConsentFailure {
  notice: string;
  /** Open the recharge sheet: the balance is what stopped it. */
  refill: boolean;
}

/**
 * What a failed `resume_chat_consent` says, and what it opens.
 *
 * The empty-balance case is the one the member can act on, so it names the
 * action and opens the sheet that performs it — the same pair V1 uses on the
 * consent dialog. Anything else says so plainly rather than leaving the button
 * looking like it did nothing, which is what a silent failure is.
 */
export function chatV2ConsentFailure(error: unknown): ChatV2ConsentFailure {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.toLowerCase().includes('insufficient')) {
    return {
      notice: 'Your balance is empty. Top up to keep going.',
      refill: true,
    };
  }
  return { notice: 'Could not start just now.', refill: false };
}
