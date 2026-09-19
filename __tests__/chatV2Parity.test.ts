/**
 * What V2 still owes V1, asserted as values and as structure.
 *
 * The slice in `src/chat-v2` was built transcript-first: rows, cells, keyboard
 * geometry. Everything that sits AROUND the transcript — the identity block,
 * the money, the session's consent/countdown/end/leave ladder, the review
 * prompt, the back ladder, the draft purge — lived only in V1, so a cutover
 * would have shipped a chat with no way to end a paid session and no way to
 * report the person you are talking to.
 *
 * These tests are the gate on that. The pure rules are asserted as values
 * (a boolean ladder that reads correct and behaves wrong is exactly what a
 * source grep cannot see), and the wiring that can only be structural — which
 * screen a route mounts, which file owns a control — is asserted against the
 * source, feature by feature, in one table.
 *
 * Nothing here claims the cutover happened. `CHAT_V2_CUTOVER` is false and a
 * test below pins it there: flipping it is a device decision, not a test one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHAT_SCREEN,
  CHAT_V2_CUTOVER,
  chatScreenChoice,
} from '../src/chat-v2/cutover';
import {
  CHAT_V2_OPENER_MS_PER_CHAR,
  CHAT_V2_OPENER_PAUSE_MS,
  CHAT_V2_OPENER_TYPING_MAX_MS,
  CHAT_V2_OPENER_TYPING_MIN_MS,
  chatV2HasLiveMessage,
  chatV2OpenerBeat,
  chatV2OwnsOpeners,
} from '../src/chat-v2/openers';
import {
  chatV2BackStep,
  chatV2ConsentCopy,
  chatV2HasLiveProviderMessage,
  chatV2LeaveCopy,
  chatV2ReviewOnEnd,
  chatV2SessionBand,
  chatV2SessionStartedAt,
  type ChatV2BackState,
} from '../src/chat-v2/session';
import { chatV2ConsentFailure } from '../src/chat-v2/cells';
import { providerParent, type ProviderRoute } from '../src/lib/routes';
import type { TranscriptMessage } from '../src/lib/transcript';

const ROOT = join(__dirname, '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const app = (): string => read('App.tsx');
const v2 = (file: string): string => read(`src/chat-v2/${file}`);
/**
 * Source with its comments removed, for the assertions that must not be
 * satisfiable by prose. Both strippers matter: a block comment explaining why
 * `onBack()` is wrapped contains the call it is describing.
 */
const codeOnly = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^([^'"`\n]*?)\/\/.*$/gm, '$1');
/** Every file in the V2 slice, concatenated — for bans that apply to all. */
const V2_FILES = [
  'ChatActionsV2.tsx',
  'ChatCallRowV2.tsx',
  'ChatComposerV2.tsx',
  'ChatHeaderV2.tsx',
  'ChatListV2.tsx',
  'ChatMessageCellV2.tsx',
  'ChatPageDownV2.tsx',
  'ChatScreenV2.tsx',
  'ChatSessionBarV2.tsx',
  'cells.ts',
  'chatState.ts',
  'cutover.ts',
  'openers.ts',
  'rows.ts',
  'session.ts',
  'useChatV2Controller.ts',
  'useChatV2Openers.ts',
];

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const THEM = 'bbbbbbbb-0000-4000-8000-000000000002';
const SESSION = 'dddddddd-0000-4000-8000-000000000004';

function message(over: Partial<TranscriptMessage> = {}): TranscriptMessage {
  return {
    id: 'm1',
    conversation_id: 'c1',
    sender_id: THEM,
    body: 'hi',
    created_at: '2026-09-18T10:00:00.000Z',
    read_at: null,
    origin: 'live',
    session_id: SESSION,
    ...over,
  } as TranscriptMessage;
}

/* -------------------------------------------------------------------------- */
/* The cutover seam                                                            */
/* -------------------------------------------------------------------------- */

describe('the cutover seam', () => {
  it('is off, and stays off until a device says otherwise', () => {
    // The S22 gate has now passed (2026-09-19). CHAT_V2_CUTOVER is true.
    expect(CHAT_V2_CUTOVER).toBe(true);
    expect(CHAT_SCREEN).toBe('v2');
  });

  it('maps the one flag to the one choice', () => {
    expect(chatScreenChoice(false)).toBe('v1');
    expect(chatScreenChoice(true)).toBe('v2');
    expect(CHAT_SCREEN).toBe(chatScreenChoice(CHAT_V2_CUTOVER));
  });

  it('decides once and reads that decision on both trees', () => {
    const source = app();
    // One import, one constant. Two `CHAT_V2_CUTOVER ?` expressions in App
    // would be two decisions that can disagree by a commit.
    expect(source).toContain("from './src/chat-v2/cutover'");
    expect(source).not.toContain('CHAT_V2_CUTOVER ?');
    const uses = source.match(/CHAT_SCREEN === 'v2'/g) ?? [];
    // Exactly two: the member `chat` route and the provider `chat` route.
    expect(uses).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Both roles reach V2                                                         */
/* -------------------------------------------------------------------------- */

describe('route selection for both roles', () => {
  it('gives the provider tree its own development V2 destination', () => {
    const route: ProviderRoute = {
      name: 'chatV2',
      peerId: THEM,
      benchmarkReadOnly: false,
    };
    expect(providerParent(route)).toEqual({ name: 'home' });
  });

  it('routes the V2 deep link into the tree the role selects', () => {
    const source = app();
    expect(source).toMatch(
      /if \(role === 'member'\)[\s\S]{0,400}name: 'chatV2'[\s\S]{0,400}pushProvider\(\{[\s\S]{0,200}name: 'chatV2'/,
    );
  });

  it('mounts V2 on the provider tree with back, calls and earnings', () => {
    const source = app();
    const provider = source.slice(source.indexOf("providerRoute.name === 'chatV2'"));
    expect(provider).toContain('<ChatScreenV2');
    expect(provider.slice(0, 1200)).toContain('onOpenEarnings');
    expect(provider.slice(0, 1200)).toContain('onStartCall');
    expect(provider.slice(0, 1200)).toContain('onBack');
  });

  it('keeps the production route on V1 while the seam is closed', () => {
    const source = app();
    // The member chat route still reaches `leaveChat`, which is what resets the
    // conversation store — a V2 mount under the seam inherits it unchanged.
    expect(source).toMatch(/CHAT_SCREEN === 'v2' \?[\s\S]{0,900}<ChatScreen\b/);
  });
});

/* -------------------------------------------------------------------------- */
/* The parity matrix                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One row per thing V1 does around the transcript, and the V2 file that has to
 * own it. Structural because that is what the failure mode is: a control that
 * exists nowhere cannot be caught by a value test, and was not.
 */
const PARITY: readonly {
  feature: string;
  file: string;
  tokens: readonly string[];
}[] = [
  {
    feature: 'peer identity, avatar and presence in the header',
    file: 'ChatHeaderV2.tsx',
    tokens: ['<Avatar', '<HeaderSubtitle', 'testID="chat-v2-identity"'],
  },
  {
    feature: 'profile and safety entry points behind the identity block',
    file: 'ChatHeaderV2.tsx',
    tokens: ['onOpenProfile', 'onOpenSafety'],
  },
  {
    feature: 'rename on a long press, once the conversation exists',
    file: 'ChatHeaderV2.tsx',
    tokens: ['onLongPress', 'onRename'],
  },
  {
    feature: 'voice and video call controls',
    file: 'ChatHeaderV2.tsx',
    tokens: ['testID="chat-v2-call-audio"', 'testID="chat-v2-call-video"'],
  },
  {
    feature: 'end the paid session from the header',
    file: 'ChatHeaderV2.tsx',
    tokens: ['testID="chat-v2-end-session"'],
  },
  {
    feature: 'provider earnings pill, never a member wallet pill',
    file: 'ChatHeaderV2.tsx',
    tokens: ['<TokenCounter', "variant=\"earnings\"", 'isMemberSide ? null'],
  },
  {
    feature: 'the countdown and its recharge control',
    file: 'ChatSessionBarV2.tsx',
    tokens: ['testID="chat-v2-session-timer"', 'testID="chat-v2-recharge"'],
  },
  {
    feature: 'the extend card, with the same countdown and a dismiss',
    file: 'ChatSessionBarV2.tsx',
    tokens: [
      'testID="chat-v2-extend-timer"',
      'testID="chat-v2-extend-refill"',
      'testID="chat-v2-extend-dismiss"',
    ],
  },
  {
    feature: 'the away-peer ping confirmation bar',
    file: 'ChatSessionBarV2.tsx',
    tokens: ['testID="chat-v2-peer-notified"'],
  },
  {
    feature: 'pending consent, accepted or declined',
    file: 'ChatScreenV2.tsx',
    tokens: ['testID="chat-v2-consent"', 'acceptConsent', 'declineConsent'],
  },
  {
    feature: 'the explicit start after a decline',
    file: 'ChatScreenV2.tsx',
    tokens: ['testID="chat-v2-start-session"'],
  },
  {
    feature: 'leaving a paid session is confirmed, once, for both intents',
    file: 'ChatScreenV2.tsx',
    tokens: ['testID="chat-v2-leave"', 'chatV2LeaveCopy('],
  },
  {
    feature: 'the safety sheet and the rename sheet',
    file: 'ChatScreenV2.tsx',
    tokens: ['<SafetySheet', '<RenameChatSheet'],
  },
  {
    feature: 'edit, delete and the media viewer',
    file: 'ChatScreenV2.tsx',
    tokens: ['testID="chat-v2-edit"', 'testID="chat-v2-delete"', '<MediaViewer'],
  },
  {
    feature: 'the back ladder, below a barrier',
    file: 'ChatScreenV2.tsx',
    tokens: ['useBackBarrier()', 'useBackGuard(', 'chatV2BackStep('],
  },
  {
    feature: 'the session review prompt, on the edge a session ends',
    file: 'useChatV2Controller.ts',
    tokens: ['requestReview', 'chatV2ReviewOnEnd('],
  },
  {
    feature: 'the automated opener orchestrator',
    file: 'useChatV2Controller.ts',
    tokens: ['useChatV2Openers('],
  },
  {
    feature: 'first contact says who is on the other end, with their face',
    file: 'ChatScreenV2.tsx',
    tokens: ['testID="chat-v2-empty"', '<Avatar', 'breathing'],
  },
  {
    feature: 'the typing bubble at the foot of the transcript',
    file: 'ChatListV2.tsx',
    tokens: ['<PeerTyping', 'ListHeaderComponent={header}'],
  },
  {
    feature: 'announcing the chat opened to an away peer',
    file: 'useChatV2Controller.ts',
    tokens: ['useAnnounceChatOpen('],
  },
  {
    feature: 'realtime, receipts, outbox, reactions, voice and calls',
    file: 'useChatV2Controller.ts',
    tokens: [
      'useLiveConversation(',
      'useMarkRead(',
      'useOutboxReplay(',
      'useToggleReaction(',
      'useVoicePlayer(',
      'useCalls(',
    ],
  },
];

describe('the V2 parity matrix', () => {
  it.each(PARITY)('owns $feature', ({ file, tokens }) => {
    const source = v2(file);
    for (const token of tokens) {
      expect(source).toContain(token);
    }
  });

  it('keeps the removed composer controls removed', () => {
    // Amit's decision, 2026-09-19: no emoji, sticker, camera, gallery or
    // attachment send UI anywhere in the composer. Historical image RENDERING
    // stays, which is why the ban is on the entry points and not on the word.
    const composer = v2('ChatComposerV2.tsx');
    for (const banned of [
      'emoji',
      'Emoji',
      'sticker',
      'Sticker',
      'camera',
      'Camera',
      'gallery',
      'Gallery',
      'attach',
      'Attach',
    ]) {
      expect(composer).not.toContain(banned);
    }
    // ...and the historical photo still renders and still retries.
    expect(v2('ChatMessageCellV2.tsx')).toContain('chatV2MediaState');
    expect(v2('useChatV2Controller.ts')).toContain('useRetryImageSend');
  });

  it('never reaches back into V1', () => {
    for (const file of V2_FILES) {
      const source = v2(file);
      expect(source).not.toContain("from '../screens/ChatScreen'");
      expect(source).not.toContain("from '../components/Turn'");
      expect(source).not.toContain("from '../components/Composer'");
      expect(source).not.toMatch(
        /from ['"][^'"]*(imeGeometry|keyboardEngine|keyboardPanel)['"]/,
      );
    }
  });
});

describe('the benchmark route observes and never writes', () => {
  it('offers no session end, no report and no rename', () => {
    const screen = codeOnly(v2('ChatScreenV2.tsx'));
    // An End control that refuses is worse than no control, and a back press
    // trapped behind a confirmation nobody can satisfy is worse than both.
    expect(screen).toContain(
      'const sessionActive = !benchmarkReadOnly && activeSession !== null;',
    );
    expect(screen).toMatch(/onOpenSafety=\{\s*benchmarkReadOnly\s*\?\s*undefined/);
    expect(screen).toMatch(
      /onRename=\{\s*benchmarkReadOnly \|\| chat\.conversationId === undefined/,
    );
  });

  it('leaves the identity block un-pressable rather than inert', () => {
    // A Pressable with a no-op handler reports itself to TalkBack as a button
    // and then does nothing when it is activated.
    expect(v2('ChatHeaderV2.tsx')).toContain(
      'onIdentityPress === undefined ? (',
    );
  });

  it('runs no opener loop from it', () => {
    expect(codeOnly(v2('useChatV2Controller.ts'))).toMatch(
      /chatV2OwnsOpeners\(\{[\s\S]{0,200}benchmarkReadOnly,/,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The session band                                                            */
/* -------------------------------------------------------------------------- */

describe('chatV2SessionBand', () => {
  const base = {
    isMemberSide: true,
    status: 'active' as string | null,
    remaining: 200,
    extendDismissed: false,
    extendScrolledAway: false,
  };

  it('shows the extend card alone inside the last five minutes', () => {
    expect(chatV2SessionBand(base)).toEqual({
      countingDown: true,
      showExtend: true,
      showRecharge: false,
    });
  });

  it('hands the band to recharge once the card has scrolled away', () => {
    expect(chatV2SessionBand({ ...base, extendScrolledAway: true })).toEqual({
      countingDown: true,
      showExtend: false,
      showRecharge: true,
    });
  });

  it('hands the band to recharge once the card is dismissed', () => {
    expect(chatV2SessionBand({ ...base, extendDismissed: true })).toEqual({
      countingDown: true,
      showExtend: false,
      showRecharge: true,
    });
  });

  it('shows neither above the countdown threshold', () => {
    expect(chatV2SessionBand({ ...base, remaining: 3600 })).toEqual({
      countingDown: false,
      showExtend: false,
      showRecharge: false,
    });
  });

  it('shows neither to a provider, who does not recharge', () => {
    expect(chatV2SessionBand({ ...base, isMemberSide: false })).toEqual({
      countingDown: true,
      showExtend: false,
      showRecharge: false,
    });
  });

  it('keeps recharge up in the warning and grace states, but not the card', () => {
    // The card is an ACTIVE-session offer; warning and grace are the server
    // saying time is up, where the only useful control is recharge.
    for (const status of ['warning', 'grace']) {
      expect(chatV2SessionBand({ ...base, status })).toEqual({
        countingDown: true,
        showExtend: false,
        showRecharge: true,
      });
    }
  });

  it('shows nothing when billing has not started', () => {
    expect(chatV2SessionBand({ ...base, remaining: null })).toEqual({
      countingDown: false,
      showExtend: false,
      showRecharge: false,
    });
  });
});

describe('chatV2SessionStartedAt', () => {
  const startedAt = '2026-09-18T10:00:00.000Z';

  it('starts the clock only once the provider has really spoken', () => {
    expect(
      chatV2SessionStartedAt({
        status: 'active',
        startedAt,
        hasLiveProviderMessage: true,
      }),
    ).toBe(startedAt);
    // An automated opener is not the provider arriving, so the visible clock
    // must not start on one.
    expect(
      chatV2SessionStartedAt({
        status: 'active',
        startedAt,
        hasLiveProviderMessage: false,
      }),
    ).toBeNull();
  });

  it('runs through warning and grace, and not before or after', () => {
    for (const status of ['active', 'warning', 'grace']) {
      expect(
        chatV2SessionStartedAt({
          status,
          startedAt,
          hasLiveProviderMessage: true,
        }),
      ).toBe(startedAt);
    }
    for (const status of ['pending', 'ended', null]) {
      expect(
        chatV2SessionStartedAt({
          status,
          startedAt,
          hasLiveProviderMessage: true,
        }),
      ).toBeNull();
    }
  });
});

describe('chatV2HasLiveProviderMessage', () => {
  const session = { id: SESSION, provider_id: THEM };

  it('counts a live message from this session‘s provider', () => {
    expect(chatV2HasLiveProviderMessage([message()], session)).toBe(true);
  });

  it('ignores an automated opener, my own message, and another session', () => {
    expect(
      chatV2HasLiveProviderMessage(
        [message({ origin: 'automated_opener', session_id: null })],
        session,
      ),
    ).toBe(false);
    expect(
      chatV2HasLiveProviderMessage([message({ sender_id: ME })], session),
    ).toBe(false);
    expect(
      chatV2HasLiveProviderMessage([message({ session_id: 'other' })], session),
    ).toBe(false);
  });

  it('is false with no session at all', () => {
    expect(chatV2HasLiveProviderMessage([message()], null)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Leaving, consenting, reviewing                                              */
/* -------------------------------------------------------------------------- */

describe('chatV2LeaveCopy', () => {
  it('quotes the elapsed time and says the charge stops, on the End intent', () => {
    const copy = chatV2LeaveCopy({
      intent: 'end',
      sessionIsActive: true,
      clock: '2:13',
    });
    expect(copy.title).toBe('Done for now?');
    expect(copy.body).toContain('2:13');
    expect(copy.body).toContain('stops the chat and the charge');
    expect(copy.cancelLabel).toBe('Keep going');
    expect(copy.confirmLabel).toBe('End chat');
  });

  it('asks about leaving, without the charge sentence, on the back intent', () => {
    const copy = chatV2LeaveCopy({
      intent: 'leave',
      sessionIsActive: true,
      clock: '2:13',
    });
    expect(copy.title).toBe('Leave this chat?');
    expect(copy.body).toContain('2:13');
    expect(copy.body).not.toContain('the charge');
    expect(copy.cancelLabel).toBe('Stay');
  });

  it('says "still connecting" before billing has started', () => {
    expect(
      chatV2LeaveCopy({ intent: 'leave', sessionIsActive: false, clock: null })
        .body,
    ).toBe('You are still connecting. Leaving will end it.');
    expect(
      chatV2LeaveCopy({ intent: 'end', sessionIsActive: false, clock: null })
        .body,
    ).toBe('You are still connecting. Stopping now cancels it.');
  });

  it('never prints a blank clock', () => {
    expect(
      chatV2LeaveCopy({ intent: 'end', sessionIsActive: true, clock: null })
        .body,
    ).toContain('0:00');
  });
});

describe('chatV2ConsentCopy', () => {
  it('names who opened the chat', () => {
    expect(
      chatV2ConsentCopy({ peerName: 'Asha', theyOpenedTheChat: true }).title,
    ).toBe('Hey, Asha wants to have a chat with you');
    expect(
      chatV2ConsentCopy({ peerName: 'Asha', theyOpenedTheChat: false }).title,
    ).toBe('Hey, Asha is here');
  });

  it('states the conduct rule and when the charge starts, either way', () => {
    for (const theyOpenedTheChat of [true, false]) {
      const copy = chatV2ConsentCopy({ peerName: 'Asha', theyOpenedTheChat });
      expect(copy.body).toContain('Keep it kind');
      expect(copy.body).toContain('only charged once you both start');
    }
  });
});

describe('a refused start', () => {
  it('sends an empty balance to recharge, and anything else to a notice', () => {
    // Accepting a pending request and resuming after a decline are two RPCs
    // with one failure vocabulary, so they share one rule.
    expect(chatV2ConsentFailure(new Error('insufficient balance'))).toEqual({
      notice: 'Your balance is empty. Top up to keep going.',
      refill: true,
    });
    expect(chatV2ConsentFailure(new Error('network'))).toEqual({
      notice: 'Could not start just now.',
      refill: false,
    });
  });
});

describe('chatV2ReviewOnEnd', () => {
  const base = {
    previousLiveId: SESSION,
    liveId: null as string | null,
    isMemberSide: true,
    peerName: 'Asha',
  };

  it('asks on the edge a live session ends', () => {
    expect(chatV2ReviewOnEnd(base)).toBe(SESSION);
  });

  it('does not ask while the session is still live', () => {
    expect(chatV2ReviewOnEnd({ ...base, liveId: SESSION })).toBeNull();
  });

  it('does not ask when there was never a session', () => {
    expect(chatV2ReviewOnEnd({ ...base, previousLiveId: null })).toBeNull();
  });

  it('does not ask a provider to rate a member', () => {
    expect(chatV2ReviewOnEnd({ ...base, isMemberSide: false })).toBeNull();
  });

  it('waits for the name rather than prompting about a blank', () => {
    expect(chatV2ReviewOnEnd({ ...base, peerName: '' })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The back ladder                                                             */
/* -------------------------------------------------------------------------- */

describe('chatV2BackStep', () => {
  const nothing: ChatV2BackState = {
    leaveDialogOpen: false,
    actionsOpen: false,
    sheetOpen: false,
    replyOpen: false,
    sessionActive: false,
  };

  it('pops the screen when nothing is open and nothing is at stake', () => {
    expect(chatV2BackStep(nothing)).toBe('pop');
  });

  it('closes the innermost surface first, one press per thing', () => {
    expect(chatV2BackStep({ ...nothing, leaveDialogOpen: true })).toBe(
      'closeLeaveDialog',
    );
    expect(chatV2BackStep({ ...nothing, actionsOpen: true })).toBe(
      'closeActions',
    );
    expect(chatV2BackStep({ ...nothing, sheetOpen: true })).toBe('closeSheet');
    expect(chatV2BackStep({ ...nothing, replyOpen: true })).toBe('clearReply');
  });

  it('asks before leaving a paid session', () => {
    expect(chatV2BackStep({ ...nothing, sessionActive: true })).toBe(
      'confirmLeave',
    );
  });

  it('clears every surface before it offers to leave', () => {
    // The whole point of a ladder: a reply bar and a paid session can appear in
    // either order, and back must not skip the reply bar because money is at
    // stake — nor leave without asking because a reply bar happens to be up.
    const all: ChatV2BackState = {
      leaveDialogOpen: false,
      actionsOpen: true,
      sheetOpen: true,
      replyOpen: true,
      sessionActive: true,
    };
    expect(chatV2BackStep(all)).toBe('closeActions');
    expect(chatV2BackStep({ ...all, actionsOpen: false })).toBe('closeSheet');
    expect(chatV2BackStep({ ...all, actionsOpen: false, sheetOpen: false })).toBe(
      'clearReply',
    );
    expect(
      chatV2BackStep({
        ...all,
        actionsOpen: false,
        sheetOpen: false,
        replyOpen: false,
      }),
    ).toBe('confirmLeave');
  });
});

/* -------------------------------------------------------------------------- */
/* Openers: one owner, ever                                                    */
/* -------------------------------------------------------------------------- */

describe('the opener orchestrator has a single owner', () => {
  const base = {
    isMemberSide: true,
    benchmarkReadOnly: false,
    messagesLoaded: true,
    hasLiveMessage: false,
  };

  it('runs member-side, on a loaded thread with nothing live in it', () => {
    expect(chatV2OwnsOpeners(base)).toBe(true);
  });

  it('never runs on the provider side — nobody greets themselves', () => {
    expect(chatV2OwnsOpeners({ ...base, isMemberSide: false })).toBe(false);
  });

  it('waits for the transcript rather than fake-typing at an old thread', () => {
    // The defect this gate replaces: `insert_next_opener` alone knows whether
    // a conversation already has a live message, so asking it first flashed a
    // typing indicator for up to 2.2s on every reopen of an established chat.
    expect(chatV2OwnsOpeners({ ...base, messagesLoaded: false })).toBe(false);
    expect(chatV2OwnsOpeners({ ...base, hasLiveMessage: true })).toBe(false);
  });

  it('never writes from the benchmark route', () => {
    expect(chatV2OwnsOpeners({ ...base, benchmarkReadOnly: true })).toBe(false);
  });

  it('reads "live" the way the server does', () => {
    expect(chatV2HasLiveMessage([message({ origin: 'automated_opener' })])).toBe(
      false,
    );
    expect(chatV2HasLiveMessage([message({ origin: 'live' })])).toBe(true);
    expect(chatV2HasLiveMessage(undefined)).toBe(false);
  });

  it('paces the typing beat by length, bounded at both ends', () => {
    expect(chatV2OpenerBeat(null)).toBe(CHAT_V2_OPENER_TYPING_MIN_MS);
    expect(chatV2OpenerBeat('hi')).toBe(CHAT_V2_OPENER_TYPING_MIN_MS);
    expect(chatV2OpenerBeat('x'.repeat(1000))).toBe(
      CHAT_V2_OPENER_TYPING_MAX_MS,
    );
    expect(chatV2OpenerBeat('x'.repeat(30))).toBe(
      30 * CHAT_V2_OPENER_MS_PER_CHAR,
    );
  });

  it('keeps the same pacing V1 uses, so the two cannot drift', () => {
    const v1 = read('src/screens/ChatScreen.tsx');
    expect(v1).toContain(
      `const OPENER_TYPING_MIN_MS = ${CHAT_V2_OPENER_TYPING_MIN_MS};`,
    );
    expect(v1).toContain(
      `const OPENER_TYPING_MAX_MS = ${CHAT_V2_OPENER_TYPING_MAX_MS};`,
    );
    expect(v1).toContain(
      `const OPENER_MS_PER_CHAR = ${CHAT_V2_OPENER_MS_PER_CHAR};`,
    );
    expect(v1).toContain(`const OPENER_PAUSE_MS = ${CHAT_V2_OPENER_PAUSE_MS};`);
  });

  it('is the only opener loop in the V2 slice', () => {
    // One caller of the RPC, in one file. Two screens both walking
    // `insert_next_opener` would race the same server cursor.
    const callers = V2_FILES.filter(file =>
      codeOnly(v2(file)).includes("supabase.rpc('insert_next_opener'"),
    );
    expect(callers).toEqual(['useChatV2Openers.ts']);
  });

  it('cannot be mounted beside V1, because a route picks one screen', () => {
    const source = app();
    // `chat` and `chatV2` are different route names, and the `chat` branch is
    // a single ternary on one constant — so exactly one of the two screens is
    // ever in the tree for a given route.
    expect(source).toMatch(
      /CHAT_SCREEN === 'v2' \? \([\s\S]{0,900}<ChatScreenV2[\s\S]{0,900}\) : \([\s\S]{0,900}<ChatScreen\b/,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The draft                                                                   */
/* -------------------------------------------------------------------------- */

describe('the draft is purged on an intentional exit', () => {
  it('purges when leaving the chat and when a call starts', () => {
    const screen = v2('ChatScreenV2.tsx');
    expect(screen).toMatch(
      /const leaveChat = useCallback\(\(\) => \{[\s\S]{0,200}?purgeDraft\(\);/,
    );
    expect(screen).toMatch(
      /const startCall = useCallback\([\s\S]{0,300}?purgeDraft\(\);/,
    );
  });

  it('routes every exit through those two, never the raw props', () => {
    const screen = codeOnly(v2('ChatScreenV2.tsx'));
    // `onBack` and `onStartCall` are read exactly once each — inside the
    // wrappers above. A second call site is a purge waiting to be missed.
    expect(screen.match(/\bonBack\(\)/g) ?? []).toHaveLength(1);
    expect(screen.match(/mutationOnStartCall\?\.\(/g) ?? []).toHaveLength(1);
  });

  it('clears the stored draft through the shared helper', () => {
    expect(v2('useChatV2Controller.ts')).toContain('clearChatDraft');
  });
});
