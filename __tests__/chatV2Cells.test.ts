import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHAT_V2_BUBBLE_PADDING,
  CHAT_V2_META_FONT_SIZE,
  CHAT_V2_PAGE_DOWN_GAP,
  CHAT_V2_RECORD_PING_MS,
  chatV2CallModel,
  chatV2CellA11yActions,
  chatV2ConsentFailure,
  chatV2MediaState,
  chatV2MessageActions,
  chatV2MetaSlot,
  chatV2MetaText,
  chatV2OwnerMenuItems,
  chatV2PageDownBottom,
  chatV2Receipt,
  chatV2TrailingControl,
  sameMessageCell,
  type ChatV2MessageCellFacts,
} from '../src/chat-v2/cells';
import { TYPING_THROTTLE_MS, TYPING_TTL_MS } from '../src/lib/presence';
import { buildChatV2Rows, type ChatV2MessageRow } from '../src/chat-v2/rows';
import type { CallRecord } from '../src/api/chat';
import { timeOfDay } from '../src/lib/datetime';
import type { TranscriptMessage } from '../src/lib/transcript';

const ROOT = join(__dirname, '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const THEM = 'bbbbbbbb-0000-4000-8000-000000000002';
const CONVERSATION = 'cccccccc-0000-4000-8000-000000000003';
const BASE = Date.parse('2026-09-18T10:00:00.000Z');

let seq = 0;

function message(
  overrides: Partial<TranscriptMessage> = {},
): TranscriptMessage {
  seq += 1;
  return {
    id: `id-${seq}`,
    conversation_id: CONVERSATION,
    sender_id: THEM,
    body: `body ${seq}`,
    reply_to_id: null,
    voice_path: null,
    voice_duration_ms: null,
    voice_peaks: null,
    attachment_path: null,
    attachment_type: null,
    attachment_width: null,
    attachment_height: null,
    session_id: null,
    origin: 'live',
    created_at: new Date(BASE + seq * 1000).toISOString(),
    read_at: null,
    edited_at: null,
    deleted_at: null,
    ...overrides,
  } as TranscriptMessage;
}

function row(overrides: Partial<TranscriptMessage> = {}): ChatV2MessageRow {
  const [built] = buildChatV2Rows({
    messages: [message(overrides)],
    calls: undefined,
    sessionEvents: undefined,
    selfId: ME,
    unreadAnchorId: null,
    notice: null,
  });
  return built as ChatV2MessageRow;
}

function call(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    id: 'call-1',
    conversation_id: CONVERSATION,
    medium: 'voice',
    status: 'missed',
    started_at: null,
    ended_at: null,
    created_at: new Date(BASE).toISOString(),
    ...overrides,
  };
}

/** Every call can start, and nothing else is holding the line. */
const CAN_CALL = {
  canStartAudio: true,
  canStartVideo: true,
  sessionBusy: false,
  callsAvailable: true,
} as const;

const STAMP = timeOfDay(new Date(BASE).toISOString());

/** A settled message from each side, which every action rule starts from. */
const PEER_SETTLED = {
  mine: false,
  pending: false,
  failed: false,
  deleted: false,
  canEdit: false,
  canDelete: false,
} as const;
const MINE_SETTLED = {
  mine: true,
  pending: false,
  failed: false,
  deleted: false,
  canEdit: true,
  canDelete: true,
} as const;

describe('V2 call rows', () => {
  it('is one line in every state, and never a second helper line', () => {
    for (const status of ['ended', 'missed', 'declined', 'failed'] as const) {
      for (const medium of ['voice', 'video'] as const) {
        const model = chatV2CallModel(
          call({
            status,
            medium,
            started_at: new Date(BASE).toISOString(),
            ended_at: new Date(BASE + 90_000).toISOString(),
          }),
          CAN_CALL,
        );

        expect(model.label).not.toContain('\n');
        expect(model.label).toContain(STAMP);
        expect(model.label.toLowerCase()).not.toContain('tap to call back');
        expect(model.icon).toBe(medium === 'video' ? 'video' : 'call');
      }
    }
  });

  it('makes an unanswered call the loud, tappable entry and an ended one muted', () => {
    const ended = chatV2CallModel(
      call({
        status: 'ended',
        started_at: new Date(BASE).toISOString(),
        ended_at: new Date(BASE + 272_000).toISOString(),
      }),
      CAN_CALL,
    );

    expect(ended.tone).toBe('muted');
    expect(ended.tappable).toBe(false);
    // Talk time is the shared transcript wording, not a second mm:ss format.
    expect(ended.label).toContain('4 min');

    for (const status of ['missed', 'declined', 'failed'] as const) {
      const model = chatV2CallModel(call({ status }), CAN_CALL);
      expect(model.tone).toBe('danger');
      expect(model.tappable).toBe(true);
      expect(model.accessibilityLabel).toContain('Tap to call back');
    }
  });

  it('refuses the call back rather than dead-ending when a call cannot start', () => {
    const noVideo = chatV2CallModel(call({ medium: 'video' }), {
      ...CAN_CALL,
      canStartVideo: false,
    });
    const noAudio = chatV2CallModel(call({ medium: 'voice' }), {
      ...CAN_CALL,
      canStartAudio: false,
    });
    const busy = chatV2CallModel(call(), { ...CAN_CALL, sessionBusy: true });
    const noScreenHandler = chatV2CallModel(call(), {
      ...CAN_CALL,
      callsAvailable: false,
    });

    for (const model of [noVideo, noAudio, busy, noScreenHandler]) {
      expect(model.tappable).toBe(false);
      // Still says what happened, and still in the danger voice.
      expect(model.tone).toBe('danger');
      expect(model.accessibilityLabel).not.toContain('Tap to call back');
    }
    // A video row is gated on the video switch alone.
    expect(
      chatV2CallModel(call({ medium: 'video' }), {
        ...CAN_CALL,
        canStartAudio: false,
      }).tappable,
    ).toBe(true);
  });
});

describe('V2 message action policy', () => {
  const settledPeer = PEER_SETTLED;
  const settledMine = MINE_SETTLED;

  it('offers reactions, reply and report on a settled peer message', () => {
    const actions = chatV2MessageActions(settledPeer);

    expect(actions.surface).toBe('reactions');
    expect(actions.react).toBe(true);
    expect(actions.reply).toBe(true);
    expect(actions.report).toBe(true);
    expect(actions.edit).toBe(false);
    expect(actions.remove).toBe(false);
  });

  it('never offers a reaction picker on my own message', () => {
    const actions = chatV2MessageActions(settledMine);

    expect(actions.surface).toBe('menu');
    expect(actions.react).toBe(false);
    expect(actions.report).toBe(false);
    expect(actions.edit).toBe(true);
    expect(actions.remove).toBe(true);
  });

  it('drops Edit alone when the fifteen-minute window has closed', () => {
    const actions = chatV2MessageActions({ ...settledMine, canEdit: false });

    expect(actions.surface).toBe('menu');
    expect(actions.edit).toBe(false);
    expect(actions.remove).toBe(true);
  });

  it('exposes no actions at all on a pending, failed or deleted row', () => {
    for (const state of [
      { ...settledMine, pending: true },
      { ...settledMine, pending: true, failed: true },
      { ...settledMine, deleted: true, canEdit: false, canDelete: false },
      { ...settledPeer, deleted: true },
    ]) {
      const actions = chatV2MessageActions(state);
      expect(actions.surface).toBe('none');
      expect(actions.react).toBe(false);
      expect(actions.reply).toBe(false);
      expect(actions.report).toBe(false);
      expect(actions.edit).toBe(false);
      expect(actions.remove).toBe(false);
    }
  });

  it('leaves nothing on the menu when the server would refuse both actions', () => {
    expect(
      chatV2MessageActions({ ...settledMine, canEdit: false, canDelete: false })
        .surface,
    ).toBe('none');
  });
});

describe('V2 bubble metadata geometry', () => {
  it('reserves a real slot on the first frame, never a zero-width one', () => {
    const peer = chatV2MetaSlot({ stamp: STAMP, receipt: undefined });
    const mine = chatV2MetaSlot({ stamp: STAMP, receipt: 'read' });

    expect(peer).toBeGreaterThan(0);
    expect(mine).toBeGreaterThan(peer);
    // Deterministic: the same facts give the same slot, so there is no second
    // frame in which the reserve changes and the bubble reflows.
    expect(chatV2MetaSlot({ stamp: STAMP, receipt: 'read' })).toBe(mine);
  });

  it('grows with what the meta actually says', () => {
    const plain = chatV2MetaSlot({ stamp: STAMP, receipt: undefined });
    const edited = chatV2MetaSlot({
      stamp: STAMP,
      receipt: undefined,
      edited: true,
    });
    const longer = chatV2MetaSlot({ stamp: '10:45 pm', receipt: undefined });
    const shorter = chatV2MetaSlot({ stamp: '9:05', receipt: undefined });

    expect(edited).toBeGreaterThan(plain);
    expect(longer).toBeGreaterThan(shorter);
  });

  it('reserves a full-width slot for a non-Latin clock', () => {
    /*
     * `timeOfDay` is `Intl.DateTimeFormat` on the DEVICE locale, so a Japanese
     * or Korean phone gets "午後3:55" / "오후 3:55" — full-width glyphs, each
     * about a whole em. Estimating those at a Latin lowercase advance
     * under-reserves by nearly half and drops the clock on top of a character,
     * which is the one failure mode a reserve is not allowed to have.
     */
    const latin = chatV2MetaSlot({ stamp: '3:55 pm' });

    expect(chatV2MetaSlot({ stamp: '午後3:55' })).toBeGreaterThan(latin);
    expect(chatV2MetaSlot({ stamp: '오후 3:55' })).toBeGreaterThan(latin);
    // Two full-width marks are worth at least two ems between them.
    const bare = chatV2MetaSlot({ stamp: '' });
    expect(chatV2MetaSlot({ stamp: '午後' }) - bare).toBeGreaterThanOrEqual(
      2 * CHAT_V2_META_FONT_SIZE,
    );
    expect(chatV2MetaSlot({ stamp: '下午' }) - bare).toBeGreaterThanOrEqual(
      2 * CHAT_V2_META_FONT_SIZE,
    );
  });

  it('prefixes Edited into the one measured string rather than a second Text', () => {
    expect(chatV2MetaText({ stamp: STAMP, edited: false })).toBe(STAMP);
    expect(chatV2MetaText({ stamp: STAMP, edited: true })).toBe(
      `Edited · ${STAMP}`,
    );
    expect(CHAT_V2_META_FONT_SIZE).toBeGreaterThan(0);
  });

  it('reads the receipt off the row rather than off arrival order', () => {
    expect(chatV2Receipt(row({ sender_id: ME }))).toBe('sent');
    expect(
      chatV2Receipt(
        row({ sender_id: ME, read_at: new Date(BASE).toISOString() }),
      ),
    ).toBe('read');
    // Theirs carries none, and neither does a row still in flight.
    expect(chatV2Receipt(row({ sender_id: THEM }))).toBeUndefined();
    expect(
      chatV2Receipt(row({ sender_id: ME, id: 'pending-1' })),
    ).toBeUndefined();
    expect(
      chatV2Receipt(
        row({ sender_id: ME, deleted_at: new Date(BASE).toISOString() }),
      ),
    ).toBeUndefined();
  });
});

describe('V2 cell identity', () => {
  const facts = (
    over: Partial<ChatV2MessageCellFacts> = {},
  ): ChatV2MessageCellFacts => ({
    id: 'row-1',
    messageId: 'id-1',
    text: 'hello',
    mine: true,
    first: true,
    pending: false,
    failed: false,
    deleted: false,
    edited: false,
    stamp: STAMP,
    receipt: 'sent',
    voicePath: undefined,
    voiceDurationMs: undefined,
    voicePeaks: undefined,
    imagePath: undefined,
    imageLocalUri: undefined,
    imageWidth: undefined,
    imageHeight: undefined,
    quoteAuthor: undefined,
    quoteBody: undefined,
    tallies: undefined,
    ...over,
  });

  it('re-renders one cell when one receipt lands, not the whole transcript', () => {
    const before = facts();

    expect(sameMessageCell(before, facts())).toBe(true);
    expect(sameMessageCell(before, facts({ receipt: 'read' }))).toBe(false);
  });

  it('compares reaction tallies by content, since the map is rebuilt each fetch', () => {
    const before = facts({ tallies: [{ emoji: '❤️', count: 1, mine: false }] });

    expect(
      sameMessageCell(
        before,
        facts({ tallies: [{ emoji: '❤️', count: 1, mine: false }] }),
      ),
    ).toBe(true);
    expect(
      sameMessageCell(
        before,
        facts({ tallies: [{ emoji: '❤️', count: 2, mine: false }] }),
      ),
    ).toBe(false);
    expect(sameMessageCell(before, facts({ tallies: undefined }))).toBe(false);
  });

  it('notices every fact the bubble paints', () => {
    const before = facts();

    for (const changed of [
      facts({ text: 'hello there' }),
      facts({ edited: true }),
      facts({ deleted: true }),
      facts({ failed: true }),
      facts({ pending: true }),
      facts({ first: false }),
      facts({ stamp: '11:11' }),
      facts({ imageLocalUri: 'file:///tmp/a.jpg' }),
      facts({ quoteBody: 'parent' }),
    ]) {
      expect(sameMessageCell(before, changed)).toBe(false);
    }
  });

  it('notices the payload a voice row draws, not only its path', () => {
    const before = facts({
      voicePath: 'conv/a.m4a',
      voiceDurationMs: 4_000,
      voicePeaks: [0.2, 0.4],
    });

    // Same path, same waveform: the cell has nothing new to paint.
    expect(
      sameMessageCell(
        before,
        facts({
          voicePath: 'conv/a.m4a',
          voiceDurationMs: 4_000,
          voicePeaks: [0.2, 0.4],
        }),
      ),
    ).toBe(true);
    // The player prints the duration and the waveform draws the peaks, so a
    // change in either is a change on screen.
    expect(
      sameMessageCell(
        before,
        facts({
          voicePath: 'conv/a.m4a',
          voiceDurationMs: 9_000,
          voicePeaks: [0.2, 0.4],
        }),
      ),
    ).toBe(false);
    expect(
      sameMessageCell(
        before,
        facts({
          voicePath: 'conv/a.m4a',
          voiceDurationMs: 4_000,
          voicePeaks: [0.2, 0.9],
        }),
      ),
    ).toBe(false);
    expect(
      sameMessageCell(
        before,
        facts({
          voicePath: 'conv/a.m4a',
          voiceDurationMs: 4_000,
          voicePeaks: undefined,
        }),
      ),
    ).toBe(false);
  });

  it('notices the intrinsic size a photo reserves its box from', () => {
    const before = facts({
      imagePath: 'conv/p.jpg',
      imageWidth: 800,
      imageHeight: 600,
    });

    // The box height is derived from the aspect, so a changed dimension is a
    // changed cell height — exactly what the transcript must not miss.
    expect(
      sameMessageCell(
        before,
        facts({ imagePath: 'conv/p.jpg', imageWidth: 800, imageHeight: 900 }),
      ),
    ).toBe(false);
    expect(
      sameMessageCell(
        before,
        facts({ imagePath: 'conv/p.jpg', imageWidth: 400, imageHeight: 600 }),
      ),
    ).toBe(false);
  });
});

describe('V2 media state', () => {
  it('names a failed photo a failure, not a permanent upload', () => {
    /*
     * A failed send keeps its optimistic id, so `pending` stays TRUE forever.
     * Branching on `pending` alone left an indeterminate progress bar spinning
     * over a photo that had already given up — the app claiming to be working
     * on something it had stopped doing.
     */
    expect(
      chatV2MediaState({ pending: true, failed: true, hasSource: true }),
    ).toBe('failed');
    expect(
      chatV2MediaState({ pending: true, failed: true, hasSource: false }),
    ).toBe('failed');
  });

  it('separates an upload in flight from a credential still resolving', () => {
    expect(
      chatV2MediaState({ pending: true, failed: false, hasSource: true }),
    ).toBe('uploading');
    expect(
      chatV2MediaState({ pending: false, failed: false, hasSource: false }),
    ).toBe('resolving');
    expect(
      chatV2MediaState({ pending: false, failed: false, hasSource: true }),
    ).toBe('ready');
  });
});

describe('V2 owner menu', () => {
  const menu = (edit: boolean, remove: boolean) =>
    chatV2OwnerMenuItems({
      surface: 'menu',
      react: false,
      reply: false,
      report: false,
      edit,
      remove,
    });

  it('puts Edit first and Delete last, behind a rule and in danger', () => {
    const items = menu(true, true);

    expect(items.map(i => i.key)).toEqual(['edit', 'delete']);
    expect(items[0]?.danger).toBe(false);
    expect(items[0]?.divider).toBe(false);
    expect(items[1]?.danger).toBe(true);
    // The rule is what makes the irreversible action a deliberate reach rather
    // than the next row down.
    expect(items[1]?.divider).toBe(true);
  });

  it('draws no rule when Delete is the only row', () => {
    const items = menu(false, true);

    expect(items.map(i => i.key)).toEqual(['delete']);
    expect(items[0]?.divider).toBe(false);
    expect(items[0]?.danger).toBe(true);
  });

  it('drops Edit alone once the window has closed', () => {
    expect(menu(true, false).map(i => i.key)).toEqual(['edit']);
    expect(menu(true, false)[0]?.divider).toBe(false);
  });

  it('builds nothing for a surface that is not the owner menu', () => {
    expect(chatV2OwnerMenuItems(chatV2MessageActions(PEER_SETTLED))).toEqual(
      [],
    );
    expect(
      chatV2OwnerMenuItems(
        chatV2MessageActions({ ...MINE_SETTLED, pending: true }),
      ),
    ).toEqual([]);
  });
});

describe('V2 cell accessibility actions', () => {
  it('gives TalkBack a way to reach the long-press menu', () => {
    const actions = chatV2CellA11yActions({ actionable: true, failed: false });

    // `longpress` is a standard RN action that maps to TalkBack's long click,
    // so the actions a sighted user reaches by holding are reachable without a
    // gesture. https://reactnative.dev/docs/accessibility
    expect(actions.map(a => a.name)).toContain('longpress');
    expect(actions.every(a => a.label.length > 0)).toBe(true);
  });

  it('gives a failed row an activate that retries', () => {
    const actions = chatV2CellA11yActions({ actionable: false, failed: true });

    expect(actions.map(a => a.name)).toEqual(['activate']);
    expect(actions[0]?.label.toLowerCase()).toContain('retry');
    // Even a failed PHOTO: there is nothing to open, so the one action is the
    // retry rather than a viewer over a file that never landed.
    expect(
      chatV2CellA11yActions({
        actionable: false,
        failed: true,
        activateLabel: 'View photo',
      }).map(a => a.name),
    ).toEqual(['activate']);
  });

  it('keeps the photo openable as well as long-pressable', () => {
    /*
     * A photo's tap opens the viewer, and that tap is an RNGH recogniser a
     * screen reader cannot see — so `activate` has to stay on offer alongside
     * the long press. A text row gets no `activate`, because its tap does
     * nothing and announcing one would send TalkBack nowhere.
     */
    const photo = chatV2CellA11yActions({
      actionable: true,
      failed: false,
      activateLabel: 'View photo',
    });

    expect(photo.map(a => a.name)).toEqual(['activate', 'longpress']);
    expect(
      chatV2CellA11yActions({ actionable: true, failed: false }).map(
        a => a.name,
      ),
    ).toEqual(['longpress']);
  });

  it('offers nothing on a row that offers nothing', () => {
    expect(chatV2CellA11yActions({ actionable: false, failed: false })).toEqual(
      [],
    );
  });
});

describe('V2 recording ping', () => {
  it('re-pings on the sender throttle and inside the receiver TTL', () => {
    /*
     * Pinging faster than the throttle is discarded by the sender; pinging
     * slower than the TTL lets the peer's indicator lapse mid-note. There is
     * exactly one interval that is both, and it is the throttle itself.
     */
    expect(CHAT_V2_RECORD_PING_MS).toBe(TYPING_THROTTLE_MS);
    expect(CHAT_V2_RECORD_PING_MS).toBeLessThan(TYPING_TTL_MS);
  });
});

describe('V2 page-down placement', () => {
  it('clears the whole measured dock, never just the composer', () => {
    for (const dock of [0, 64, 148, 320]) {
      expect(chatV2PageDownBottom(dock)).toBe(dock + CHAT_V2_PAGE_DOWN_GAP);
      expect(chatV2PageDownBottom(dock)).toBeGreaterThanOrEqual(dock + 8);
    }
  });

  it('never sits under a dock that grew', () => {
    const composerOnly = chatV2PageDownBottom(64);
    const withReplyAndConsent = chatV2PageDownBottom(64 + 48 + 56);

    expect(withReplyAndConsent).toBeGreaterThan(composerOnly);
  });
});

describe('V2 composer controls', () => {
  it('shows send for text, mic for silence, and stop while recording', () => {
    expect(
      chatV2TrailingControl({ mode: 'idle', text: 'hi', disabled: false }),
    ).toBe('send');
    expect(
      chatV2TrailingControl({ mode: 'idle', text: '   ', disabled: false }),
    ).toBe('mic');
    expect(
      chatV2TrailingControl({ mode: 'recording', text: '', disabled: false }),
    ).toBe('stop');
    expect(
      chatV2TrailingControl({ mode: 'review', text: '', disabled: false }),
    ).toBe('send');
  });

  it('keeps the mic in its slot while the thread cannot take a message', () => {
    // Not removed: the placeholder already says why, and a slot that empties
    // and refills is the capsule changing width for a state change.
    expect(
      chatV2TrailingControl({ mode: 'idle', text: '', disabled: true }),
    ).toBe('mic');
    expect(
      chatV2TrailingControl({ mode: 'idle', text: 'hi', disabled: true }),
    ).toBe('mic');
  });
});

describe('V2 start-session failure', () => {
  it('opens the refill when the balance is what stopped it', () => {
    const failure = chatV2ConsentFailure(new Error('insufficient_balance'));

    expect(failure.refill).toBe(true);
    expect(failure.notice.toLowerCase()).toContain('top up');
  });

  it('says something rather than nothing on any other failure', () => {
    for (const error of [new Error('network down'), 'nope', null, undefined]) {
      const failure = chatV2ConsentFailure(error);
      expect(failure.refill).toBe(false);
      expect(failure.notice.length).toBeGreaterThan(0);
    }
  });
});

describe('the V2 cells stay isolated from the V1 chat', () => {
  const sources = [
    'src/chat-v2/cells.ts',
    'src/chat-v2/ChatMessageCellV2.tsx',
    'src/chat-v2/ChatCallRowV2.tsx',
    'src/chat-v2/ChatActionsV2.tsx',
    'src/chat-v2/ChatPageDownV2.tsx',
    'src/chat-v2/ChatListV2.tsx',
    'src/chat-v2/ChatComposerV2.tsx',
    'src/chat-v2/ChatScreenV2.tsx',
  ];

  it('never imports the V1 transcript, composer or keyboard geometry', () => {
    const all = sources.map(read).join('\n');

    expect(all).not.toMatch(/from ['"][^'"]*screens\/ChatScreen/);
    expect(all).not.toMatch(/from ['"][^'"]*components\/Turn/);
    expect(all).not.toMatch(/from ['"][^'"]*components\/CallLogRow/);
    expect(all).not.toMatch(/from ['"][^'"]*components\/Composer/);
    expect(all).not.toMatch(
      /from ['"][^'"]*(imeGeometry|keyboardEngine|keyboardPanel)/,
    );
  });

  it('paints the bubble meta from the precomputed slot, not from a measurement', () => {
    const cell = read('src/chat-v2/ChatMessageCellV2.tsx');

    expect(cell).toContain('chatV2MetaSlot');
    // The V1 defect this replaces: `metaWidth` starts at 0, so the first frame
    // reserves nothing and the bubble doubles its height on the second.
    expect(cell).not.toContain('setMetaWidth');
    expect(cell).not.toMatch(/onLayout=\{[^}]*meta/i);
  });

  it('shows peer reaction tallies on my own bubble as well as theirs', () => {
    const cell = read('src/chat-v2/ChatMessageCellV2.tsx');

    // The tally row is rendered off the tallies alone. A `mine &&` guard here
    // would hide the only reaction a 1:1 thread can produce on my message.
    expect(cell).toMatch(/tallies[\s\S]{0,400}ChatV2ReactionTally/);
    expect(cell).not.toMatch(/!mine\s*&&\s*tallies/);
  });

  it('routes the tap on a failed row to the retry the controller owns', () => {
    const cell = read('src/chat-v2/ChatMessageCellV2.tsx');

    expect(cell).toContain('onRetry');
    // A failed send's tap RETRIES; it does not open the photo it was carrying,
    // which has not landed anywhere to be opened.
    expect(cell).toMatch(
      /onTap = failed && !mutationsDisabled\s*\?\s*retryThis/,
    );
  });

  it('keeps the swipe on the UI thread, with no JS hop per frame', () => {
    const cell = read('src/chat-v2/ChatMessageCellV2.tsx');
    const perFrame = cell.slice(
      cell.indexOf('onUpdate:'),
      cell.indexOf('onDeactivate:'),
    );

    expect(perFrame.length).toBeGreaterThan(0);
    // A scheduling call in `onUpdate` runs 60-120 times a second. The commit
    // haptic belongs on a threshold reaction and the reply on the release.
    expect(perFrame).not.toContain('runOnJS');
    expect(perFrame).not.toContain('setState');
    expect(cell).toContain('useAnimatedReaction');
  });

  it('offers each call control only while that medium can start', () => {
    const screen = read('src/chat-v2/ChatScreenV2.tsx');
    const header = read('src/chat-v2/ChatHeaderV2.tsx');

    /*
     * Drawn and DISABLED rather than hidden, which is the V1 behaviour this
     * matched to: flipping a kill switch or a provider channel must not change
     * the header's geometry under the member. The earlier V2 header removed
     * the controls instead, so the title re-centred whenever an operator
     * toggled a medium.
     */
    expect(header).toContain(
      'disabled={!callsAvailable || !canStartVideo || sessionBusy}',
    );
    expect(header).toContain(
      'disabled={!callsAvailable || !canStartAudio || sessionBusy}',
    );
    expect(header).toContain("onStartCall?.('video')");
    expect(header).toContain("onStartCall?.('audio')");
    // The screen decides; the header only draws what it is told.
    expect(screen).toContain('canStartVideo={chat.canStartVideo}');
    expect(screen).toContain('canStartAudio={chat.canStartAudio}');
    expect(screen).toContain(
      'onStartCall={mutationOnStartCall === undefined ? undefined : startCall}',
    );
    // The row's call-back and the header run through the same one prop, so a
    // screen given no way to call has no call affordance anywhere.
    expect(screen).toContain(
      'callsAvailable: mutationOnStartCall !== undefined',
    );
  });

  it('measures every sticky dock child together, and lifts page-down with it', () => {
    const screen = read('src/chat-v2/ChatScreenV2.tsx');

    expect(screen).toContain('onDockLayout');
    expect(screen).toContain('extraContentPadding.set(height)');
    expect(screen).toContain('offset={dockHeight}');
    expect(screen).toContain('chatV2PageDownBottom(dockHeight)');
    // Two sticky views, one offset: page-down and dock move as one under the IME.
    expect(screen.match(/<KeyboardStickyView/g)?.length).toBe(2);
    expect(screen).toContain('<ChatPageDownV2');
  });

  it('gives my bubble and theirs one shared padding block in the shipped styles', () => {
    const cell = read('src/chat-v2/ChatMessageCellV2.tsx');
    const block = (name: string): string => {
      const start = cell.indexOf(`    ${name}: {`);
      expect(start).toBeGreaterThan(-1);
      return cell.slice(start, cell.indexOf('\n    },', start));
    };

    /*
     * The parity that matters is in the STYLESHEET, not in a helper that
     * models it: every inset and the minimum height live on one `bubble` rule
     * both sides spread, and the per-side rules carry a fill and nothing else.
     * A padding that appeared in `bubbleMine` is exactly how V1's two sides
     * drifted to different heights.
     */
    const shared = block('bubble');
    expect(shared).toContain('paddingLeft: CHAT_V2_BUBBLE_PADDING.left');
    expect(shared).toContain('paddingTop: CHAT_V2_BUBBLE_PADDING.top');
    expect(shared).toContain('paddingRight: CHAT_V2_BUBBLE_PADDING.right');
    expect(shared).toContain('paddingBottom: CHAT_V2_BUBBLE_PADDING.bottom');
    expect(shared).toContain('minHeight: TOKENS.layout.bubbleMinHeight');

    for (const side of ['bubbleMine', 'bubblePeer']) {
      const rule = block(side);
      expect(rule).toContain('backgroundColor');
      expect(rule).not.toMatch(/padding|minHeight|lineHeight|margin/);
    }
    // And the meta row's box is a fixed line, so a receipt tick cannot make one
    // side taller than the other.
    expect(block('metaRow')).toContain('height: CHAT_V2_META_LINE_HEIGHT');
    expect(CHAT_V2_BUBBLE_PADDING.top).toBeGreaterThanOrEqual(0);
  });

  it('shows a failed photo as failed, with a retry rather than a progress bar', () => {
    const cell = read('src/chat-v2/ChatMessageCellV2.tsx');

    expect(cell).toContain('chatV2MediaState');
    expect(cell).toContain("mediaState === 'failed'");
    expect(cell).toContain('testID="chat-v2-image-failed"');
    // The progress bar belongs to a state that is still working.
    expect(cell).toMatch(
      /mediaState === 'uploading' \|\| mediaState === 'resolving'/,
    );
  });

  it('lets TalkBack reach the actions and the retry without a gesture', () => {
    const cell = read('src/chat-v2/ChatMessageCellV2.tsx');

    expect(cell).toContain('chatV2CellA11yActions');
    expect(cell).toContain('onAccessibilityAction');
    /*
     * V1 left an `accessibilityHint` on a node with no delegate installed, so
     * "Long press for message actions" was never announced on any API level.
     * A hint is only kept where an `accessibilityActions` entry makes the view
     * a real node. https://reactnative.dev/docs/accessibility
     */
    const hints = cell.match(/accessibilityHint/g) ?? [];
    for (const _ of hints) {
      expect(cell).toContain('accessibilityActions');
    }
  });

  it('anchors the owner menu to the request it is open for, and nothing else', () => {
    const actions = read('src/chat-v2/ChatActionsV2.tsx');

    /*
     * The menu is derived from the CURRENT request and mounted only while
     * there is one.
     *
     * A previous pass kept it resident and retained the last request so
     * `menuOut`/`scrimOut` would have something to exit from. That bought
     * nothing and risked the one thing a menu must never do: React Native's
     * Modal is a native Dialog, and setting `visible={false}` tears the window
     * down with its children still inside it, so a Reanimated `exiting` never
     * gets a frame on Android either way. What the retention DID buy was a
     * held anchor — a rect belonging to a bubble that had been dismissed,
     * ready to place the card against the wrong message for a frame if the
     * next long press raced it. A close that snaps is a worse animation; a
     * menu that flashes at the wrong bubble is a wrong menu.
     */
    expect(actions).not.toContain('lastMenu');
    expect(actions).not.toContain('useState');
    expect(actions).not.toContain('useEffect');
    // Conditionally mounted, and every prop read off `menu`, which is the
    // current request narrowed to the owner surface.
    expect(actions).toMatch(/menu === null \? null : \(/);
    expect(actions).toContain('anchor={menu.anchor}');
    expect(actions).toContain('chatV2OwnerMenuItems(menu.actions)');
    // And no claim about an exit this platform cannot deliver.
    expect(actions).not.toMatch(/exit(s|ing)? (it )?needs|animate out/i);
  });

  it('renders the rule PaperMenu items ask for', () => {
    const menu = read('src/components/PaperMenu.tsx');

    expect(menu).toContain('divider?: boolean');
    expect(menu).toContain(
      'item.divider === true ? <View style={styles.divider}',
    );
    expect(menu).toMatch(/divider: \{[\s\S]{0,140}hairlineWidth/);
  });

  it('drops the composer layout prop the dock wrapper made dead', () => {
    const composer = read('src/chat-v2/ChatComposerV2.tsx');
    const screen = read('src/chat-v2/ChatScreenV2.tsx');

    // One measurement authority. A second `onLayout` on the composer is a
    // second answer to a question the dock wrapper already answers, and the
    // prop survived the wrapper landing with nothing left to pass into it.
    expect(composer).not.toContain('onLayout');
    const mount = screen.slice(
      screen.indexOf('<ChatComposerV2'),
      screen.indexOf('/>', screen.indexOf('<ChatComposerV2')),
    );
    expect(mount.length).toBeGreaterThan(0);
    expect(mount).not.toContain('onLayout');
    expect(screen).toContain('onLayout={onDockLayout}');
  });

  it('re-pings the recording signal from one shared interval', () => {
    const composer = read('src/chat-v2/ChatComposerV2.tsx');

    expect(composer).toContain('CHAT_V2_RECORD_PING_MS');
    // Not a second copy of 4s: the number comes from the presence module both
    // the sender's throttle and the receiver's TTL are defined in.
    expect(composer).not.toMatch(/RECORD_PING_MS\s*=\s*4_?000/);
  });
});
