import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildChatV2Rows,
  chatV2ItemType,
  chatV2MessageText,
  chatV2RetryKind,
  resolveChatV2Conversation,
  unreadAnchorOf,
  type ChatV2MessageRow,
  type ChatV2Row,
} from '../src/chat-v2/rows';
import {
  CHAT_V2_PAGE_DOWN_THRESHOLD,
  chatV2Arrival,
  chatV2ComposerState,
  chatV2LoadState,
  chatV2MutationInputs,
  chatV2RowIds,
  chatV2ScrolledAway,
} from '../src/chat-v2/chatState';
import type { CallRecord } from '../src/api/chat';
import type { SessionEvent } from '../src/api/sessions';
import type { ConversationSummary } from '../src/lib/database.types';
import type { TranscriptMessage } from '../src/lib/transcript';

const ROOT = join(__dirname, '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const THEM = 'bbbbbbbb-0000-4000-8000-000000000002';
const CONVERSATION = 'cccccccc-0000-4000-8000-000000000003';

/** A fixed base so ordering is deterministic and unrelated to test runtime. */
const BASE = Date.parse('2026-09-18T10:00:00.000Z');

describe('chatV2MutationInputs', () => {
  it('removes every mount-time mutation input in benchmark read-only mode', () => {
    expect(
      chatV2MutationInputs({
        benchmarkReadOnly: true,
        conversationId: CONVERSATION,
        selfId: ME,
        providerId: THEM,
        needsOpen: true,
      }),
    ).toEqual({
      openProviderId: null,
      liveConversationId: undefined,
      liveSelfId: undefined,
      markReadConversationId: undefined,
      markReadSelfId: undefined,
      outboxConversationId: undefined,
      announceConversationId: undefined,
      announceEnabled: false,
    });
  });

  it('preserves normal debug V2 mutation inputs', () => {
    expect(
      chatV2MutationInputs({
        benchmarkReadOnly: false,
        conversationId: CONVERSATION,
        selfId: ME,
        providerId: THEM,
        needsOpen: true,
      }),
    ).toEqual({
      openProviderId: THEM,
      liveConversationId: CONVERSATION,
      liveSelfId: ME,
      markReadConversationId: CONVERSATION,
      markReadSelfId: ME,
      outboxConversationId: CONVERSATION,
      announceConversationId: CONVERSATION,
      announceEnabled: true,
    });
  });
});

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

/** Newest-first, the order `useMessages` returns and `buildChatV2Rows` expects. */
function newestFirst(list: readonly TranscriptMessage[]): TranscriptMessage[] {
  return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function call(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    id: 'call-1',
    conversation_id: CONVERSATION,
    medium: 'voice',
    status: 'missed',
    started_at: null,
    ended_at: null,
    created_at: new Date(BASE + 500).toISOString(),
    ...overrides,
  };
}

function sessionEvent(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    id: 'session-1',
    started_at: new Date(BASE - 60_000).toISOString(),
    ended_at: new Date(BASE + 1_500).toISOString(),
    minutes_billed: 3,
    ...overrides,
  };
}

function thread(
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    conversation_id: CONVERSATION,
    peer_id: THEM,
    peer_display_name: 'Asha',
    peer_avatar_url: null,
    peer_available: true,
    peer_is_provider: true,
    peer_presence: null,
    peer_last_active_at: null,
    peer_online: true,
    peer_last_seen_at: null,
    last_session_at: null,
    last_session_channel: null,
    last_session_duration_seconds: null,
    last_preview_kind: null,
    last_session_status: null,
    unread_count_member: 0,
    unread_count_provider: 0,
    i_am_member: true,
    ...overrides,
  } as ConversationSummary;
}

const EMPTY = {
  messages: undefined,
  calls: undefined,
  sessionEvents: undefined,
  selfId: ME,
  unreadAnchorId: null,
  notice: null,
} as const;

describe('V2 row model', () => {
  it('merges messages, calls and ended sessions newest-first on one timeline', () => {
    const mine = message({
      sender_id: ME,
      created_at: new Date(BASE + 3_000).toISOString(),
    });
    const theirs = message({
      created_at: new Date(BASE + 1_000).toISOString(),
    });
    const rows = buildChatV2Rows({
      ...EMPTY,
      messages: newestFirst([mine, theirs]),
      calls: [call()],
      sessionEvents: [sessionEvent()],
    });

    expect(rows.map(r => r.kind)).toEqual([
      'message',
      'system',
      'message',
      'call',
    ]);
    expect(rows.map(r => r.sortAt)).toEqual(
      [...rows].map(r => r.sortAt).sort((a, b) => b.localeCompare(a)),
    );
    const first = rows[0] as ChatV2MessageRow;
    expect(first.mine).toBe(true);
    expect(first.id).toBe(mine.id);
    expect(rows[1]?.id).toBe('session-session-1');
    expect(rows[3]?.id).toBe('call-call-1');
  });

  it('keys a settled row on its localKey so the cell is never remounted', () => {
    const settled = message({
      id: 'server-id',
      localKey: 'pending-42',
      sender_id: ME,
    });
    const [row] = buildChatV2Rows({ ...EMPTY, messages: [settled] });

    expect(row?.id).toBe('pending-42');
    expect((row as ChatV2MessageRow).message.id).toBe('server-id');
  });

  it('opens a day against the true older neighbour whatever its kind', () => {
    const today = message({ created_at: new Date(BASE).toISOString() });
    const yesterday = message({
      created_at: new Date(BASE - 86_400_000).toISOString(),
    });
    const between = call({
      created_at: new Date(BASE - 3_600_000).toISOString(),
    });
    const rows = buildChatV2Rows({
      ...EMPTY,
      messages: newestFirst([today, yesterday]),
      calls: [between],
    });

    // Newest message and the call share a day, so the boundary belongs to the
    // call — the row whose older neighbour is on the previous day. Computed
    // against messages alone (the V1 defect) it would have landed nowhere.
    expect(rows.map(r => r.kind)).toEqual(['message', 'call', 'message']);
    expect(rows.map(r => r.opensDay)).toEqual([false, true, true]);
  });

  it('breaks a run on a day boundary as well as on a change of speaker', () => {
    const older = message({
      sender_id: ME,
      created_at: new Date(BASE - 86_400_000).toISOString(),
    });
    const newer = message({
      sender_id: ME,
      created_at: new Date(BASE).toISOString(),
    });
    const rows = buildChatV2Rows({
      ...EMPTY,
      messages: newestFirst([older, newer]),
    }) as ChatV2MessageRow[];

    expect(rows[0]?.first).toBe(true);
    expect(rows[0]?.last).toBe(true);
    expect(rows[1]?.first).toBe(true);
    expect(rows[1]?.last).toBe(true);
  });

  it('splices the unread divider immediately after its anchor row', () => {
    const oldest = message({
      id: 'unread-oldest',
      created_at: new Date(BASE + 1_000).toISOString(),
    });
    const newer = message({
      id: 'unread-newer',
      created_at: new Date(BASE + 2_000).toISOString(),
    });
    const rows = buildChatV2Rows({
      ...EMPTY,
      messages: newestFirst([oldest, newer]),
      unreadAnchorId: 'unread-oldest',
    });

    expect(rows.map(r => r.id)).toEqual([
      'unread-newer',
      'unread-oldest',
      'unread-divider',
    ]);
    expect(rows[2]?.kind).toBe('divider');
    expect(rows[2]?.opensDay).toBe(false);
  });

  it('drops the divider when its anchor is not in the loaded page', () => {
    const rows = buildChatV2Rows({
      ...EMPTY,
      messages: [message()],
      unreadAnchorId: 'not-loaded',
    });

    expect(rows.some(r => r.kind === 'divider')).toBe(false);
  });

  it('carries an ephemeral notice as a system row', () => {
    const at = new Date(BASE + 60_000).toISOString();
    const rows = buildChatV2Rows({
      ...EMPTY,
      messages: [message({ created_at: new Date(BASE).toISOString() })],
      notice: { at, text: 'Asha has been notified.', icon: 'bell' },
    });

    expect(rows[0]).toMatchObject({
      kind: 'system',
      id: 'chat-v2-notice',
      text: 'Asha has been notified.',
      icon: 'bell',
    });
  });

  it('labels an ended chat session with the shared transcript helper (elapsed time)', () => {
    const rows = buildChatV2Rows({ ...EMPTY, sessionEvents: [sessionEvent()] });

    expect(rows[0]?.kind).toBe('system');
    // sessionEvent() has started_at = BASE - 60_000ms and ended_at = BASE + 1_500ms,
    // so elapsed = 61.5 s → "1 min 1 sec". The new policy shows wall-clock elapsed
    // time rather than billed minutes (Amit, 2026-09-20).
    expect((rows[0] as { text: string }).text).toMatch(/^Chat · 1 min 1 sec · /);
  });

  it('attaches voice and image bodies from the existing payload readers', () => {
    const voice = message({
      body: null,
      voice_path: `${CONVERSATION}/abc.m4a`,
      voice_duration_ms: 4_000,
      voice_peaks: [1, 2, 3],
    });
    const photo = message({
      body: null,
      attachment_path: `${CONVERSATION}/pic.jpg`,
      attachment_width: 800,
      attachment_height: 600,
    });
    const rows = buildChatV2Rows({
      ...EMPTY,
      messages: newestFirst([voice, photo]),
    }) as ChatV2MessageRow[];

    const voiceRow = rows.find(r => r.message.id === voice.id);
    const photoRow = rows.find(r => r.message.id === photo.id);
    expect(voiceRow?.voice).toEqual({
      messageId: voice.id,
      path: `${CONVERSATION}/abc.m4a`,
      durationMs: 4_000,
      peaks: [1, 2, 3],
    });
    expect(photoRow?.image).toMatchObject({
      messageId: photo.id,
      path: `${CONVERSATION}/pic.jpg`,
      width: 800,
      height: 600,
    });
  });

  it('recycles each cell shape from its own pool', () => {
    const rows = buildChatV2Rows({
      ...EMPTY,
      messages: newestFirst([
        message({ created_at: new Date(BASE + 1_000).toISOString() }),
        message({
          body: null,
          voice_path: `${CONVERSATION}/abc.m4a`,
          voice_duration_ms: 4_000,
          created_at: new Date(BASE + 2_000).toISOString(),
        }),
        message({
          body: null,
          attachment_path: `${CONVERSATION}/pic.jpg`,
          attachment_width: 4,
          attachment_height: 4,
          created_at: new Date(BASE + 3_000).toISOString(),
        }),
      ]),
      calls: [call()],
      sessionEvents: [sessionEvent()],
      unreadAnchorId: null,
    });

    /*
     * Four message shapes and two centred rows, and the OLDEST of them carries
     * a `-day` suffix: it opens the transcript's first day, so its cell holds a
     * `DayDivider` the others do not, and recycling across that boundary would
     * leave the divider's height in place for a frame.
     */
    expect(new Set(rows.map(chatV2ItemType))).toEqual(
      new Set([
        'message-text',
        'message-voice',
        'message-media',
        'system',
        'call-day',
      ]),
    );
    // Same row, same day, same pool — the suffix tracks the divider, not the id.
    expect(rows.filter(r => r.opensDay).map(chatV2ItemType)).toEqual([
      'call-day',
    ]);
  });

  it('quotes the parent of a reply out of the page it is looking at', () => {
    const parent = message({
      id: 'parent-1',
      body: 'are you free?',
      created_at: new Date(BASE + 8_000).toISOString(),
    });
    const answer = message({
      sender_id: ME,
      reply_to_id: 'parent-1',
      body: 'yes',
      created_at: new Date(BASE + 9_000).toISOString(),
    });
    const rows = buildChatV2Rows({
      ...EMPTY,
      messages: newestFirst([parent, answer]),
      peerName: 'Asha',
    });

    expect((rows[0] as ChatV2MessageRow).quote).toEqual({
      author: 'Asha',
      body: 'are you free?',
    });
    // Mine is "You", which is who the reader is.
    const mineQuoted = buildChatV2Rows({
      ...EMPTY,
      messages: newestFirst([
        message({
          id: 'mine-1',
          sender_id: ME,
          body: 'here',
          created_at: new Date(BASE + 8_000).toISOString(),
        }),
        message({
          reply_to_id: 'mine-1',
          created_at: new Date(BASE + 9_000).toISOString(),
        }),
      ]),
      peerName: 'Asha',
    });
    expect((mineQuoted[0] as ChatV2MessageRow).quote?.author).toBe('You');
  });

  it('shows no quote at all for a parent outside the loaded page', () => {
    const [row] = buildChatV2Rows({
      ...EMPTY,
      messages: [message({ reply_to_id: 'long-gone' })],
      peerName: 'Asha',
    });

    expect((row as ChatV2MessageRow).quote).toBeUndefined();
  });

  it('keeps calls and session rows inside the page the messages cover', () => {
    /*
     * A FULL page means older messages exist that nobody has fetched. A call
     * from before the oldest loaded bubble would otherwise land beneath a
     * stretch of conversation that is simply not on the device.
     */
    const full = Array.from({ length: 100 }, (_, i) =>
      message({ created_at: new Date(BASE + (i + 100) * 1000).toISOString() }),
    );
    const floor = full[0]?.created_at ?? '';
    const older = {
      ...call({ id: 'old' }),
      created_at: new Date(BASE).toISOString(),
    };
    const inside = {
      ...call({ id: 'recent' }),
      created_at: new Date(Date.parse(floor) + 500).toISOString(),
    };

    const rows = buildChatV2Rows({
      ...EMPTY,
      messages: newestFirst(full),
      calls: [older, inside],
      sessionEvents: [sessionEvent({ id: 'old-session' })],
    });

    expect(rows.some(r => r.id === 'call-old')).toBe(false);
    expect(rows.some(r => r.id === 'session-old-session')).toBe(false);
    expect(rows.some(r => r.id === 'call-recent')).toBe(true);
  });

  it('keeps every call when the page is short, because nothing is missing', () => {
    const rows = buildChatV2Rows({
      ...EMPTY,
      messages: [
        message({ created_at: new Date(BASE + 50_000).toISOString() }),
      ],
      calls: [call({ id: 'ancient' })],
      sessionEvents: [sessionEvent({ id: 'ancient-session' })],
    });

    expect(rows.some(r => r.id === 'call-ancient')).toBe(true);
    expect(rows.some(r => r.id === 'session-ancient-session')).toBe(true);
  });

  it('falls back to a body label rather than an empty bubble', () => {
    const [text] = buildChatV2Rows({
      ...EMPTY,
      messages: [message({ body: 'hello' })],
    });
    const [photo] = buildChatV2Rows({
      ...EMPTY,
      messages: [
        message({
          body: null,
          attachment_path: `${CONVERSATION}/pic.jpg`,
          attachment_width: 4,
          attachment_height: 4,
        }),
      ],
    });
    const [voice] = buildChatV2Rows({
      ...EMPTY,
      messages: [
        message({
          body: null,
          voice_path: `${CONVERSATION}/a.m4a`,
          voice_duration_ms: 2_000,
        }),
      ],
    });
    const [gone] = buildChatV2Rows({
      ...EMPTY,
      messages: [
        message({
          sender_id: ME,
          body: null,
          deleted_at: new Date(BASE).toISOString(),
        }),
      ],
    });

    expect(chatV2MessageText(text as ChatV2MessageRow)).toBe('hello');
    expect(chatV2MessageText(photo as ChatV2MessageRow)).toBe('Photo');
    expect(chatV2MessageText(voice as ChatV2MessageRow)).toBe('Voice note');
    expect(chatV2MessageText(gone as ChatV2MessageRow)).toBe(
      'You deleted this message',
    );
  });
});

describe('V2 conversation resolution', () => {
  it('uses a known thread without the open_conversation round trip', () => {
    const resolved = resolveChatV2Conversation([thread()], THEM, undefined);

    expect(resolved.needsOpen).toBe(false);
    expect(resolved.conversationId).toBe(CONVERSATION);
    expect(resolved.isMemberSide).toBe(true);
    expect(resolved.knownThread?.peer_id).toBe(THEM);
  });

  it('reads the side from i_am_member, so a provider peer resolves too', () => {
    const resolved = resolveChatV2Conversation(
      [thread({ i_am_member: false, peer_is_provider: false })],
      THEM,
      undefined,
    );

    expect(resolved.needsOpen).toBe(false);
    expect(resolved.isMemberSide).toBe(false);
    expect(resolved.conversationId).toBe(CONVERSATION);
  });

  it('waits for the conversation list before asking to open anything', () => {
    /*
     * The cold frame. `open_conversation` takes a PROVIDER id and raises for a
     * member one, so firing it before the list has arrived means every
     * provider opening a thread cold burns a guaranteed-to-fail RPC — and on
     * the member side it races the list that was about to answer for free.
     */
    const cold = resolveChatV2Conversation(undefined, THEM, undefined);
    expect(cold.needsOpen).toBe(false);
    expect(cold.conversationId).toBeUndefined();
    expect(cold.isMemberSide).toBe(true);
  });

  it('opens a brand-new thread once the list is known not to hold one', () => {
    const empty = resolveChatV2Conversation([], THEM, undefined);
    expect(empty.needsOpen).toBe(true);
    expect(empty.conversationId).toBeUndefined();

    const opened = resolveChatV2Conversation([], THEM, 'opened-id');
    expect(opened.needsOpen).toBe(true);
    expect(opened.conversationId).toBe('opened-id');
  });

  it('never asks for a thread the loaded list already holds', () => {
    const other = resolveChatV2Conversation(
      [thread()],
      'someone-else',
      undefined,
    );
    expect(other.needsOpen).toBe(true);
    expect(
      resolveChatV2Conversation([thread()], THEM, undefined).needsOpen,
    ).toBe(false);
  });
});

describe('V2 unread anchor', () => {
  it('anchors on the oldest unread message from the peer', () => {
    const list = newestFirst([
      message({ id: 'read', read_at: new Date(BASE).toISOString() }),
      message({ id: 'old-unread' }),
      message({ id: 'new-unread' }),
      message({ id: 'mine', sender_id: ME }),
    ]);

    expect(unreadAnchorOf(list, ME)).toBe('old-unread');
  });

  it('is null while the data is incomplete or nothing is unread', () => {
    expect(unreadAnchorOf(undefined, ME)).toBeNull();
    expect(unreadAnchorOf([message()], undefined)).toBeNull();
    expect(
      unreadAnchorOf([message({ read_at: new Date(BASE).toISOString() })], ME),
    ).toBeNull();
  });
});

describe('the V2 controller is the only domain seam', () => {
  const controller = read('src/chat-v2/useChatV2Controller.ts');
  const rows = read('src/chat-v2/rows.ts');
  const screen = read('src/chat-v2/ChatScreenV2.tsx');
  const list = read('src/chat-v2/ChatListV2.tsx');
  const composer = read('src/chat-v2/ChatComposerV2.tsx');
  const v2 = [controller, rows, screen, list, composer].join('\n');

  it('reads the app domain directly rather than through the old chat screen', () => {
    for (const hook of [
      'useSelfId',
      'useConversations',
      'useConversationId',
      'useMessages',
      'useCalls',
      'useOutboxReplay',
      'useSendMessage',
      'useSendVoiceNote',
      'useVoicePlayer',
      'useLiveConversation',
      'useLiveMessageEdits',
      'useMarkRead',
      'useReactions',
      'useToggleReaction',
      'useActiveSession',
      'useSessionEvents',
      'useSessionRealtime',
      'useSessionLease',
      'usePendingSessionRequest',
      'useChatConsent',
      'useRetryImageSend',
      'useRetryVoiceSend',
    ]) {
      expect(controller).toContain(hook);
    }
  });

  it('never reaches into the V1 chat modules', () => {
    expect(v2).not.toMatch(/from ['"][^'"]*screens\/ChatScreen/);
    expect(v2).not.toMatch(/from ['"][^'"]*components\/Turn/);
    expect(v2).not.toMatch(/from ['"][^'"]*components\/Composer/);
    expect(v2).not.toMatch(
      /from ['"][^'"]*(imeGeometry|keyboardEngine|keyboardPanel)/,
    );
  });

  it('exposes the surface the V2 shell needs and owns no layout', () => {
    for (const member of [
      'peerName',
      'peerAvatarUrl',
      'presence',
      'peerActivity',
      'rows',
      'loading',
      'loadError',
      'empty',
      'refetch',
      'sendText',
      'sendVoice',
      'notifyTyping',
      'notifyRecording',
      'notifyRecordingEnded',
      'toggleReaction',
      'chosenReactionOf',
      'tallies',
      'voicePlayer',
      'retryRow',
      'markVisible',
      'composerDisabled',
      'composerPlaceholder',
      'awaitingMemberConsent',
      'offerExplicitStart',
      'chatClosed',
      'canStartAudio',
      'canStartVideo',
    ]) {
      expect(controller).toContain(member);
    }
    // Keyboard and layout stay with the shell (task v2-shell).
    expect(controller).not.toContain('KeyboardStickyView');
    expect(controller).not.toContain('useSafeAreaInsets');
  });

  it('keeps no fixture transcript anywhere in the tree', () => {
    expect(v2).not.toContain('fixtureMessages');
    // Deleted with this slice: real data is wired, so a second source of rows
    // is a second thing that can disagree with the server.
    expect(existsSync(join(ROOT, 'src/chat-v2/fixtureMessages.ts'))).toBe(
      false,
    );
  });

  it('folds the open_conversation failure into the load state', () => {
    expect(controller).toMatch(/isError:\s*openError/);
    expect(controller).toMatch(/refetch:\s*refetchOpen/);
    expect(controller).toContain('openError');
    expect(controller).toContain('void refetchOpen()');
    // The derivations themselves are asserted as values above, not grepped.
    expect(controller).toContain('chatV2LoadState');
    expect(controller).toContain('chatV2ComposerState');
  });

  it('retries a failed row by its payload, not by guessing from the body', () => {
    expect(controller).toContain('chatV2RetryKind');
    expect(controller).not.toMatch(/if \(message\.body !== null\) \{/);
  });
});

describe('the V2 shell renders real rows', () => {
  const screen = read('src/chat-v2/ChatScreenV2.tsx');
  const list = read('src/chat-v2/ChatListV2.tsx');

  it('drives the screen from the controller', () => {
    // Plus the step-6 gates (nav-migration §5), which default to true.
    expect(screen).toContain(
      'useChatV2Controller(providerId, benchmarkReadOnly, { live, focused })',
    );
    expect(screen).toContain('rows={chat.rows}');
    expect(screen).toContain('onSend={onSend}');
    expect(screen).toContain('onVisibleMessages={chat.markVisible}');
  });

  it('depends on the send callback rather than the whole controller', () => {
    // A new `onSend` identity on every render re-props the composer for free;
    // the callback's own dependency is the thing that actually changes.
    expect(screen).toMatch(/const \{[^}]*\bsendText\b[^}]*\} = chat;/);
    // The quoted parent rides with the send, and the reply bar clears first so
    // a failed send does not leave the strip pointing at a message that went.
    expect(screen).toMatch(
      /setReplyTo\(null\);[\s\S]{0,120}void sendText\(text, parent\?\.messageId \?\? null\);[\s\S]{0,80}\[guardMode, replyTo, sendText, setNotice\]/,
    );
    expect(screen).not.toMatch(/\[chat\],\s*\);/);
  });

  it('renders the consent and start-session controls the composer copy names', () => {
    // The placeholder says "Say yes above when you are ready" and "Start a
    // session to keep talking". Shipping that copy with nothing above the
    // field to say yes to is the app pointing at a control that is not there.
    expect(screen).toContain('chat.awaitingMemberConsent');
    expect(screen).toContain('chat.offerExplicitStart');
    expect(screen).toContain('chat.startSession');
    expect(screen).toContain('chat.startingSession');
    expect(screen).toContain('testID="chat-v2-consent"');
    expect(screen).toContain('testID="chat-v2-start-session"');
  });

  it('gates read receipts on the viewport rather than on arrival', () => {
    expect(list).toContain('onViewableItemsChanged');
    expect(list).toContain('viewabilityConfig');
    expect(list).toContain('itemVisiblePercentThreshold');
  });

  it('gives every row kind its own testID and keeps direction visible', () => {
    const cell = read('src/chat-v2/ChatMessageCellV2.tsx');
    const callRow = read('src/chat-v2/ChatCallRowV2.tsx');

    expect(list).toContain('testID={`chat-v2-row-${item.id}`}');
    expect(list).toContain('chat-v2-system');
    expect(list).toContain('chat-v2-divider');
    expect(list).toContain('chatV2MessageText');
    expect(list).toContain('getItemType={getItemType}');
    expect(list).toContain('chatV2ItemType');
    // The row testIDs moved into the cells with the cells. The direction is
    // still in the id, which is what a device run reads them for.
    expect(list).toContain('<ChatMessageCellV2');
    expect(list).toContain('<ChatCallRowV2');
    expect(cell).toContain("'chat-v2-message-mine'");
    expect(cell).toContain("'chat-v2-message-peer'");
    expect(callRow).toContain('testID="chat-v2-call"');
  });

  it('shows the day boundary the row model computes', () => {
    expect(list).toContain('item.opensDay');
    expect(list).toContain('testID="chat-v2-day"');
    // The real treatment, from the primitive the V1 transcript uses too —
    // `DayDivider` takes an instant and words it, so the two cannot disagree
    // about what "Yesterday" means.
    expect(list).toContain('<DayDivider');
  });

  it('never scrolls the transcript on its own', () => {
    /*
     * The unconditional `scrollToOffset(0)` on every `rows.length` change was
     * the defect: it yanked a member reading history back to the bottom on
     * any arrival. Scrolling is now a decision, and it is the screen's.
     */
    expect(list).not.toContain('scrollToOffset');
    expect(list).not.toContain('requestAnimationFrame');
    // The keyboard lift is native; nothing about it may enter the JS scroll
    // path. https://developer.android.com/develop/ui/views/layout/sw-keyboard
    expect(list).not.toMatch(/useKeyboardHandler|onKeyboard[A-Za-z]*\s*=/);
  });

  it('drives the page-down badge off the arrival the row model counted', () => {
    expect(screen).toContain('chatV2Arrival');
    expect(screen).toContain('chatV2RowIds');
    expect(screen).toContain('chatV2ScrolledAway');
    expect(screen).toContain('scrollToLatest');
    expect(screen).toContain('unreadBelow');
    expect(screen).toContain('testID="chat-v2-page-down"');
    // The badge adds what actually arrived, not one per commit.
    expect(screen).toContain('peerArrivals');
    expect(screen).not.toMatch(/setUnreadBelow\(n => n \+ 1\)/);
    expect(list).toContain('onScrollOffset');
    expect(list).toContain('scrollEventThrottle');
  });
});

/*
 * A row shape is only useful if the list can key and recycle it, so the union
 * is asserted at the type level too: this fails to compile if a member of
 * `ChatV2Row` ever loses `id`, `sortAt` or `kind`.
 */
describe('the row union stays keyable', () => {
  it('carries a stable key and a sort stamp on every member', () => {
    const rows: ChatV2Row[] = buildChatV2Rows({
      ...EMPTY,
      messages: [message()],
      calls: [call()],
      sessionEvents: [sessionEvent()],
    });

    for (const row of rows) {
      expect(typeof row.id).toBe('string');
      expect(typeof row.sortAt).toBe('string');
      expect(['message', 'call', 'system', 'divider']).toContain(row.kind);
    }
  });
});

/*
 * The four derivations that decide what a member actually sees. Asserted as
 * VALUES rather than grepped out of the screen: "is this a spinner, an error
 * or a first-contact state" is exactly the kind of boolean ladder that reads
 * correct and behaves wrong, and a source-grep cannot tell the difference.
 */
const LOADED = {
  threadsLoaded: true,
  threadsError: false,
  knownThread: true,
  conversationResolved: true,
  messagesLoaded: true,
  messagesPending: false,
  messagesError: false,
  openError: false,
  rowCount: 3,
} as const;

describe('V2 load state', () => {
  it('spins only for a known thread whose messages have never arrived', () => {
    expect(
      chatV2LoadState({
        ...LOADED,
        messagesLoaded: false,
        messagesPending: true,
      }),
    ).toEqual({ loading: true, loadError: false, empty: false });
    // A background refetch over cached rows is not a spinner.
    expect(chatV2LoadState({ ...LOADED, messagesPending: true }).loading).toBe(
      false,
    );
  });

  it('spins while the conversation list itself is still on the wire', () => {
    expect(
      chatV2LoadState({
        ...LOADED,
        threadsLoaded: false,
        knownThread: false,
        conversationResolved: false,
        messagesLoaded: false,
        rowCount: 0,
      }).loading,
    ).toBe(true);
  });

  it('shows a brand-new chat its first-contact state, not a spinner', () => {
    // No thread yet: `open_conversation` is creating the row in the
    // background and there is nothing coming that a spinner would wait for.
    expect(
      chatV2LoadState({
        ...LOADED,
        knownThread: false,
        conversationResolved: false,
        messagesLoaded: false,
        messagesPending: true,
        rowCount: 0,
      }),
    ).toEqual({ loading: false, loadError: false, empty: true });
  });

  it('never leaves a failed conversation list spinning forever', () => {
    expect(
      chatV2LoadState({
        ...LOADED,
        threadsLoaded: false,
        threadsError: true,
        knownThread: false,
        conversationResolved: false,
        messagesLoaded: false,
        rowCount: 0,
      }),
    ).toEqual({ loading: false, loadError: true, empty: false });
  });

  it('keeps cached rows on screen when only the thread list failed', () => {
    /*
     * The transcript is already rendered from cache. Covering it with "could
     * not load this chat" because a SUMMARY query failed hides the very thing
     * the member came to read.
     */
    expect(chatV2LoadState({ ...LOADED, threadsError: true })).toEqual({
      loading: false,
      loadError: false,
      empty: false,
    });
  });

  it('surfaces a message or open failure even over cached rows', () => {
    expect(chatV2LoadState({ ...LOADED, messagesError: true }).loadError).toBe(
      true,
    );
    expect(chatV2LoadState({ ...LOADED, openError: true }).loadError).toBe(
      true,
    );
  });

  it('calls an empty, healthy thread empty', () => {
    expect(chatV2LoadState({ ...LOADED, rowCount: 0 })).toEqual({
      loading: false,
      loadError: false,
      empty: true,
    });
  });
});

describe('V2 composer state', () => {
  const OPEN = {
    conversationResolved: true,
    openError: false,
    chatClosed: false,
    awaitingMemberConsent: false,
    offerExplicitStart: false,
    peerName: 'Asha',
  } as const;

  it('takes a message, and says so, when the thread is live', () => {
    expect(chatV2ComposerState(OPEN)).toEqual({
      disabled: false,
      placeholder: 'Message',
    });
  });

  it('says why it will not take one, rather than greying out silently', () => {
    expect(chatV2ComposerState({ ...OPEN, chatClosed: true })).toEqual({
      disabled: true,
      placeholder: 'Asha is not taking chats right now',
    });
    expect(
      chatV2ComposerState({ ...OPEN, offerExplicitStart: true }).placeholder,
    ).toBe('Start a session to keep talking');
    expect(
      chatV2ComposerState({ ...OPEN, awaitingMemberConsent: true }).placeholder,
    ).toBe('Say yes above when you are ready');
  });

  it('names the failure when the conversation could not be created', () => {
    // Previously this read "Message" over a field that could never send:
    // `open_conversation` had failed and nothing said so.
    expect(
      chatV2ComposerState({
        ...OPEN,
        conversationResolved: false,
        openError: true,
      }),
    ).toEqual({
      disabled: true,
      placeholder: 'Couldn’t start this chat. Pull to try again.',
    });
  });

  it('waits quietly while the conversation is still resolving', () => {
    expect(
      chatV2ComposerState({ ...OPEN, conversationResolved: false }),
    ).toEqual({ disabled: true, placeholder: 'Message' });
  });
});

describe('V2 scroll policy', () => {
  const mine = (at: number) =>
    message({ sender_id: ME, created_at: new Date(at).toISOString() });
  const theirs = (at: number) =>
    message({ created_at: new Date(at).toISOString() });
  const rowsOf = (...list: readonly ReturnType<typeof message>[]) =>
    buildChatV2Rows({ ...EMPTY, messages: newestFirst(list) });

  const arrival = (
    before: readonly ChatV2Row[],
    after: readonly ChatV2Row[],
    scrolledAway: boolean,
  ) => chatV2Arrival(chatV2RowIds(before), after, scrolledAway);

  it('does nothing when the transcript did not grow', () => {
    const rows = rowsOf(theirs(BASE));

    expect(arrival(rows, rows, false)).toEqual({
      action: 'idle',
      peerArrivals: 0,
    });
    expect(arrival(rows, rows, true)).toEqual({
      action: 'idle',
      peerArrivals: 0,
    });
  });

  it('stays idle when an edit or a receipt rewrites a row in place', () => {
    /*
     * A row count is the wrong thing to watch. An edit, a delete tombstone and
     * a read receipt all rebuild every row object without adding one, and none
     * of them should move anybody or touch the badge.
     */
    const original = theirs(BASE);
    const before = rowsOf(original);
    const after = rowsOf({ ...original, body: 'edited body' });

    expect(after[0]?.id).toBe(before[0]?.id);
    expect(arrival(before, after, true)).toEqual({
      action: 'idle',
      peerArrivals: 0,
    });
  });

  it('pins to my own send however far up the member has scrolled', () => {
    const before = rowsOf(theirs(BASE));
    const after = rowsOf(theirs(BASE), mine(BASE + 1_000));

    expect(arrival(before, after, true).action).toBe('pin');
    expect(arrival(before, after, false).action).toBe('pin');
  });

  it('counts a peer arrival instead of yanking a member out of history', () => {
    const before = rowsOf(mine(BASE));
    const after = rowsOf(mine(BASE), theirs(BASE + 1_000));

    expect(arrival(before, after, true)).toEqual({
      action: 'count',
      peerArrivals: 1,
    });
    expect(arrival(before, after, false).action).toBe('pin');
  });

  it('counts every peer message in a batch, not the batch itself', () => {
    /*
     * The badge said "1" whether one message or nine arrived, because the
     * effect incremented once per commit. A reconnect delivers a whole missed
     * stretch in one commit, which is exactly when the number is the reason to
     * tap the control at all.
     */
    const before = rowsOf(mine(BASE));
    const after = rowsOf(
      mine(BASE),
      theirs(BASE + 1_000),
      theirs(BASE + 2_000),
      theirs(BASE + 3_000),
    );

    expect(arrival(before, after, true)).toEqual({
      action: 'count',
      peerArrivals: 3,
    });
  });

  it('counts messages only — a call or a session boundary is not unread mail', () => {
    const before = buildChatV2Rows({ ...EMPTY, messages: [mine(BASE)] });
    const after = buildChatV2Rows({
      ...EMPTY,
      messages: newestFirst([mine(BASE), theirs(BASE + 4_000)]),
      calls: [call({ created_at: new Date(BASE + 1_000).toISOString() })],
      sessionEvents: [
        sessionEvent({ ended_at: new Date(BASE + 2_000).toISOString() }),
      ],
      notice: { at: new Date(BASE + 3_000).toISOString(), text: 'Pinged' },
    });

    // Four rows arrived; one of them is a message from the other person.
    expect(after.length - before.length).toBe(4);
    expect(arrival(before, after, true)).toEqual({
      action: 'count',
      peerArrivals: 1,
    });
  });

  it('never counts my own send, however it arrived', () => {
    const opener = theirs(BASE);
    const before = rowsOf(opener);
    const after = rowsOf(opener, mine(BASE + 1_000), mine(BASE + 2_000));

    expect(arrival(before, after, true)).toEqual({
      action: 'pin',
      peerArrivals: 0,
    });
  });

  it('treats the newest row, not the newest message, as the arrival', () => {
    // A notice spliced above my own send must not read as "I just sent
    // something" on the next growth tick — and a notice is not mail, so it
    // moves the list without touching the badge.
    const history = newestFirst([theirs(BASE), mine(BASE + 1_000)]);
    const before = buildChatV2Rows({ ...EMPTY, messages: history });
    const after = buildChatV2Rows({
      ...EMPTY,
      messages: history,
      notice: { at: new Date(BASE + 2_000).toISOString(), text: 'Pinged' },
    });

    expect(after[0]?.kind).toBe('system');
    expect(arrival(before, after, true)).toEqual({
      action: 'count',
      peerArrivals: 0,
    });
  });

  it('keys arrivals on the row id, so a cold open is one batch', () => {
    const rows = rowsOf(theirs(BASE), theirs(BASE + 1_000));

    expect(chatV2RowIds([]).size).toBe(0);
    expect(chatV2RowIds(rows).size).toBe(rows.length);
    // Nothing was on screen before, and the member is at the bottom: pin and
    // leave the badge alone rather than announcing history as unread.
    expect(arrival([], rows, false).action).toBe('pin');
  });

  it('reads scrolled-away off the inverted offset with a forgiving margin', () => {
    expect(chatV2ScrolledAway(0)).toBe(false);
    expect(chatV2ScrolledAway(CHAT_V2_PAGE_DOWN_THRESHOLD)).toBe(false);
    expect(chatV2ScrolledAway(CHAT_V2_PAGE_DOWN_THRESHOLD + 1)).toBe(true);
  });
});

describe('V2 retry routing', () => {
  const failed = (overrides: Partial<TranscriptMessage>) =>
    buildChatV2Rows({
      ...EMPTY,
      messages: [message({ sender_id: ME, failed: true, ...overrides })],
    })[0] as ChatV2MessageRow;

  it('routes by the payload the row actually carries', () => {
    expect(chatV2RetryKind(failed({ body: 'hi' }))).toBe('text');
    expect(
      chatV2RetryKind(
        failed({
          body: null,
          voice_path: `${CONVERSATION}/a.m4a`,
          voice_duration_ms: 2_000,
        }),
      ),
    ).toBe('voice');
    expect(
      chatV2RetryKind(
        failed({
          body: null,
          attachment_path: `${CONVERSATION}/p.jpg`,
          attachment_width: 4,
          attachment_height: 4,
        }),
      ),
    ).toBe('image');
  });

  it('prefers the media payload over a caption-shaped body', () => {
    /*
     * The body-first ladder replayed a voice note as a TEXT send whenever the
     * row also had a body — the RPC would then have written a text message
     * with the same nonce and the recording would have been lost.
     */
    expect(
      chatV2RetryKind(
        failed({
          body: 'listen to this',
          voice_path: `${CONVERSATION}/a.m4a`,
          voice_duration_ms: 2_000,
        }),
      ),
    ).toBe('voice');
    expect(
      chatV2RetryKind(
        failed({
          body: 'look',
          attachment_path: `${CONVERSATION}/p.jpg`,
          attachment_width: 4,
          attachment_height: 4,
        }),
      ),
    ).toBe('image');
  });

  it('has nothing to retry on a healthy row or an empty one', () => {
    const healthy = buildChatV2Rows({
      ...EMPTY,
      messages: [message({ sender_id: ME, body: 'hi' })],
    })[0] as ChatV2MessageRow;

    expect(chatV2RetryKind(healthy)).toBe('none');
    expect(chatV2RetryKind(failed({ body: null }))).toBe('none');
  });
});
