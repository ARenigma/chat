// Supabase and its transitive MMKV dependency are ESM-only and cannot be
// loaded by Jest's CommonJS transformer. Mock both before any import chain
// reaches them — the pure reducers under test never call either.
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    channel: jest.fn(() => ({ on: jest.fn(), subscribe: jest.fn() })),
    realtime: { setAuth: jest.fn() },
    auth: { getSession: jest.fn() },
    removeChannel: jest.fn(),
  },
}));
// chat.ts transitively imports outboxStore → storage → react-native-mmkv.
// The pure reducers only need the `keys` constant (which the hook uses) and
// the PeerPresenceRow type (erased at compile time), so a minimal stub works.
jest.mock('../src/api/chat', () => ({
  keys: {
    providers: ['providers'],
    conversationList: ['conversation-list'],
    conversation: (id: string) => ['conversation', id],
  },
}));

/**
 * Unit tests for the cache-patching reducers in src/api/presenceStream.ts
 * (migration 182 — pushed provider presence).
 *
 * These are pure functions: no Supabase client, no React, no async. The hook
 * that calls them is tested implicitly by the integration test suite; these
 * verify the reducer logic in isolation so a regression fails the build without
 * requiring a running device or emulator.
 */

import {
  applyPresenceToConversations,
  applyPresenceToPeer,
  applyPresenceToProviders,
} from '../src/api/presenceStream';
import type { ProviderPresenceChange } from '../src/lib/database.types';
import type {
  ConversationSummary,
  ProviderSummary,
} from '../src/lib/database.types';
import type { PeerPresenceRow } from '../src/api/chat';

const CHANGE_ONLINE: ProviderPresenceChange = {
  provider_id: 'aaaa',
  online: true,
  last_seen_at: '2026-09-29T08:00:00.000Z',
  updated_at: '2026-09-29T08:00:01.000Z',
};

const CHANGE_OFFLINE: ProviderPresenceChange = {
  provider_id: 'aaaa',
  online: false,
  last_seen_at: '2026-09-29T07:55:00.000Z',
  updated_at: '2026-09-29T08:00:02.000Z',
};

// ---------------------------------------------------------------------------
// applyPresenceToProviders
// ---------------------------------------------------------------------------

describe('applyPresenceToProviders', () => {
  const baseProvider = {
    id: 'aaaa',
    online: false,
    last_seen_at: null,
  } as unknown as ProviderSummary;

  const otherProvider = {
    id: 'bbbb',
    online: false,
    last_seen_at: null,
  } as unknown as ProviderSummary;

  it('passes undefined through unchanged', () => {
    expect(applyPresenceToProviders(undefined, CHANGE_ONLINE)).toBeUndefined();
  });

  it('returns empty list unchanged', () => {
    expect(applyPresenceToProviders([], CHANGE_ONLINE)).toEqual([]);
  });

  it('patches the matching provider to online=true', () => {
    const result = applyPresenceToProviders([baseProvider, otherProvider], CHANGE_ONLINE)!;
    expect(result[0]!.online).toBe(true);
    expect(result[0]!.last_seen_at).toBe(CHANGE_ONLINE.last_seen_at);
  });

  it('patches the matching provider to online=false on an offline event', () => {
    const online = { ...baseProvider, online: true } as ProviderSummary;
    const result = applyPresenceToProviders([online], CHANGE_OFFLINE)!;
    expect(result[0]!.online).toBe(false);
  });

  it('does not touch an unrelated provider', () => {
    const result = applyPresenceToProviders([otherProvider], CHANGE_ONLINE)!;
    expect(result[0]!.online).toBe(false);
    expect(result[0]!.id).toBe('bbbb');
  });

  it('preserves all other fields on the patched provider', () => {
    const rich = { ...baseProvider, display_name: 'Alice', rating_avg: 4.9 } as ProviderSummary;
    const result = applyPresenceToProviders([rich], CHANGE_ONLINE);
    expect((result?.[0] as unknown as { display_name: string }).display_name).toBe('Alice');
    expect((result?.[0] as unknown as { rating_avg: number }).rating_avg).toBe(4.9);
  });
});

// ---------------------------------------------------------------------------
// applyPresenceToConversations
// ---------------------------------------------------------------------------

describe('applyPresenceToConversations', () => {
  const baseConvo = {
    conversation_id: 'conv-1',
    peer_id: 'aaaa',
    peer_online: false,
    peer_last_seen_at: null,
  } as unknown as ConversationSummary;

  const otherConvo = {
    conversation_id: 'conv-2',
    peer_id: 'bbbb',
    peer_online: false,
    peer_last_seen_at: null,
  } as unknown as ConversationSummary;

  it('passes undefined through unchanged', () => {
    expect(applyPresenceToConversations(undefined, CHANGE_ONLINE)).toBeUndefined();
  });

  it('patches the matching conversation peer to online=true', () => {
    const result = applyPresenceToConversations([baseConvo, otherConvo], CHANGE_ONLINE)!;
    expect(result[0]!.peer_online).toBe(true);
    expect(result[0]!.peer_last_seen_at).toBe(CHANGE_ONLINE.last_seen_at);
  });

  it('patches the matching conversation peer to online=false', () => {
    const online = { ...baseConvo, peer_online: true } as ConversationSummary;
    const result = applyPresenceToConversations([online], CHANGE_OFFLINE)!;
    expect(result[0]!.peer_online).toBe(false);
  });

  it('does not touch a conversation with a different peer_id', () => {
    const result = applyPresenceToConversations([otherConvo], CHANGE_ONLINE)!;
    expect(result[0]!.peer_online).toBe(false);
  });

  it('patches all conversations with the same peer (multiple threads)', () => {
    const second = { ...baseConvo, conversation_id: 'conv-3' } as ConversationSummary;
    const result = applyPresenceToConversations([baseConvo, second], CHANGE_ONLINE)!;
    expect(result.every(c => c.peer_online === true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyPresenceToPeer
// ---------------------------------------------------------------------------

describe('applyPresenceToPeer', () => {
  const basePeer: PeerPresenceRow = {
    peer_online: false,
    peer_last_seen_at: null,
  };

  it('passes null through unchanged (thread removed)', () => {
    expect(applyPresenceToPeer(null, CHANGE_ONLINE)).toBeNull();
  });

  it('passes undefined through unchanged (not yet loaded)', () => {
    expect(applyPresenceToPeer(undefined, CHANGE_ONLINE)).toBeUndefined();
  });

  it('patches peer_online to true', () => {
    const result = applyPresenceToPeer(basePeer, CHANGE_ONLINE);
    expect(result?.peer_online).toBe(true);
    expect(result?.peer_last_seen_at).toBe(CHANGE_ONLINE.last_seen_at);
  });

  it('patches peer_online to false on an offline event', () => {
    const online: PeerPresenceRow = { peer_online: true, peer_last_seen_at: '2026-09-29T07:55:00.000Z' };
    const result = applyPresenceToPeer(online, CHANGE_OFFLINE);
    expect(result?.peer_online).toBe(false);
    expect(result?.peer_last_seen_at).toBe(CHANGE_OFFLINE.last_seen_at);
  });

  it('does not mutate the input object', () => {
    const input: PeerPresenceRow = { peer_online: false, peer_last_seen_at: null };
    applyPresenceToPeer(input, CHANGE_ONLINE);
    expect(input.peer_online).toBe(false);
  });
});
