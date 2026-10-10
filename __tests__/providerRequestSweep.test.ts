/**
 * Provider request sweep fixes (B5, C11, C12, C14, B9, D7) — 2026-10-09.
 * Source-pin style: the wiring is pinned as source text, the way the
 * neighbouring suites do it (providerOnboardingSweep.test.ts).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8');

describe('B5: conversation list invalidated on accept AND on ring', () => {
  const sessions = read('src/api/sessions.ts');
  it('invalidates conversationList in useAcceptSessionRequest onSuccess', () => {
    const hook = sessions.slice(sessions.indexOf('export function useAcceptSessionRequest'));
    // onSuccess body sits after mutationFn; allow up to 1200 chars to reach it
    const onSuccess = hook.slice(hook.indexOf('onSuccess'), hook.indexOf('onSuccess') + 1200);
    expect(onSuccess).toContain('keys.conversationList');
  });
  it('invalidates conversationList when a chat request starts ringing', () => {
    const app = read('App.tsx');
    const cb = app.slice(app.indexOf('onIncomingChatRequest'));
    expect(cb.slice(0, 1200)).toContain('keys.conversationList');
  });
});

describe('C11: peer avatar and preview carried in IncomingRequest', () => {
  it('IncomingRequest type has peerAvatarUrl and peerPreview', () => {
    const store = read('src/store/useStore.ts');
    expect(store).toContain('peerAvatarUrl');
    expect(store).toContain('peerPreview');
  });
  it('ring builder sets peerAvatarUrl from cached conversation', () => {
    const app = read('App.tsx');
    const cb = app.slice(app.indexOf('onIncomingChatRequest'));
    // peerAvatarUrl appears inside setIncomingRequest call; 2000 chars is safe.
    expect(cb.slice(0, 2000)).toContain('peerAvatarUrl');
    expect(cb.slice(0, 2000)).toContain('peer_avatar_url');
  });
  it('ChatRequestScreen shows avatar uri from IncomingRequest', () => {
    const screen = read('src/components/ChatRequestScreen.tsx');
    expect(screen).toContain('peerAvatarUrl');
    // The server's answer first (C11 RPC, migration 187), the ring's own value after.
    expect(screen).toContain('const avatarUrl = info?.peer_avatar_url ?? incoming.peerAvatarUrl ?? null;');
    expect(screen).toContain('uri={avatarUrl ?? undefined}');
  });
  it('App.tsx applies getLabelByPeer to peerName before enqueuing the ring', () => {
    const app = read('App.tsx');
    const cb = app.slice(app.indexOf('onIncomingChatRequest'));
    expect(cb.slice(0, 1500)).toContain('getLabelByPeer');
    expect(cb.slice(0, 1500)).toContain('request.initiatorId');
  });
  it('ChatRequestScreen shows preview when available', () => {
    const screen = read('src/components/ChatRequestScreen.tsx');
    expect(screen).toContain('peerPreview');
    expect(screen).toContain('chat-ring-preview');
  });
  it('migration 187 defines get_request_peer_info', () => {
    const sql = read('supabase/migrations/187_request_peer_info_and_pending_flag.sql');
    expect(sql).toContain('get_request_peer_info');
    expect(sql).toContain('first_message_preview');
    expect(sql).toContain('security definer');
    expect(sql).toContain("grant execute on function public.get_request_peer_info(uuid) to authenticated");
  });
  it('get_request_peer_info is in the grants inventory', () => {
    const inv = read('supabase/tests/568_function_grants_inventory.sql');
    expect(inv).toContain("'get_request_peer_info'");
  });
});

describe('C12: engagement notice is tappable and channel name is provider-appropriate', () => {
  it('onEngagement enqueues an openChat intent when peerId is present', () => {
    const app = read('App.tsx');
    const engBlock = app.slice(app.indexOf('onEngagement'));
    expect(engBlock.slice(0, 600)).toContain("type: 'openChat'");
    expect(engBlock.slice(0, 600)).toContain('push.peerId');
  });
  it('push.ts applies getLabelByPeer to the engagement nudge title', () => {
    const push = read('src/lib/push.ts');
    // The background-handler block starts at the first `const nudge = readEngagementPush`.
    const block = push.slice(push.indexOf('const nudge = readEngagementPush'));
    expect(block.slice(0, 900)).toContain('getLabelByPeer');
    expect(block.slice(0, 900)).toContain('resolvedNudge');
    // Only the name inside the sentence is swapped, not the whole title.
    expect(block.slice(0, 900)).toContain('text.split(nudge.senderName).join(');
  });
  it('engagement channel name is no longer member-only language', () => {
    const strings = read('android/app/src/main/res/values/strings.xml');
    expect(strings).not.toContain('Nudges when someone new is around to talk');
    expect(strings).toContain('channel_engagement');
  });
});

describe('C14: recoverPending fetches all pending requests, not just one', () => {
  it('recoverPending has no .limit(1) or .maybeSingle()', () => {
    const sessions = read('src/api/sessions.ts');
    const fn = sessions.slice(sessions.indexOf('async function recoverPending'));
    const body = fn.slice(0, 1500);
    expect(body).not.toContain('.limit(1)');
    expect(body).not.toContain('.maybeSingle()');
  });
  it('recoverPending loops over all results', () => {
    const sessions = read('src/api/sessions.ts');
    const fn = sessions.slice(sessions.indexOf('async function recoverPending'));
    // Function body including the for-loop is ~1800 chars; 2500 is safe.
    const body = fn.slice(0, 2500);
    expect(body).toContain('for (const row');
  });
  it('threadLabel shows "Wants to chat" for pending requests', () => {
    const screen = read('src/screens/ProviderChatsScreen.tsx');
    expect(screen).toContain("'Wants to chat'");
    expect(screen).toContain('peer_request_pending');
  });
  it('migration 187 adds peer_request_pending to conversation_summaries', () => {
    const sql = read('supabase/migrations/187_request_peer_info_and_pending_flag.sql');
    expect(sql).toContain('peer_request_pending');
    expect(sql).toContain('session_requests sr');
    expect(sql).toContain("sr.recipient_id = auth.uid()");
  });
  it('ConversationSummary type has peer_request_pending', () => {
    const types = read('src/lib/database.types.ts');
    expect(types).toContain('peer_request_pending');
  });
});

describe('B9: RechargeScreen and SessionFeedbackSheet in ProviderShell', () => {
  it('ProviderShell renders RechargeScreen', () => {
    const shell = read('src/shell/index.tsx');
    const provider = shell.slice(shell.indexOf('export function ProviderShell'));
    expect(provider.slice(0, 1200)).toContain('<RechargeScreen');
  });
  it('ProviderShell renders SessionFeedbackSheet', () => {
    const shell = read('src/shell/index.tsx');
    const provider = shell.slice(shell.indexOf('export function ProviderShell'));
    expect(provider.slice(0, 1200)).toContain('<SessionFeedbackSheet');
  });
  it('Wallet is absent from the provider navigator so a note explains the sheet path', () => {
    const shell = read('src/shell/index.tsx');
    expect(shell).toContain('openRefill');
  });
});

describe('D7: ProviderChatsScreen layout and accessibility', () => {
  const screen = read('src/screens/ProviderChatsScreen.tsx');
  it('uses useBottomBarOffset for paddingBottom', () => {
    expect(screen).toContain('useBottomBarOffset');
    expect(screen).toContain('bottomOffset');
    expect(screen).not.toMatch(/paddingBottom.*TOKENS\.space\[.2xl.\]/);
  });
  it('shows an error state with Retry on load failure', () => {
    expect(screen).toContain('isError');
    expect(screen).toContain('Could not load chats');
    expect(screen).toContain('Retry');
  });
  it('never hides member-side threads behind an empty-work state', () => {
    // A provider with only their own member-side chats still sees them.
    expect(screen).not.toContain('No provider conversations yet');
    expect(screen).not.toMatch(/\) : work\.length === 0 \? \(/);
  });
  it('accessibilityLabel includes unread count and preview', () => {
    expect(screen).toContain('unread');
    expect(screen).toContain('a11yLabel');
  });
});
