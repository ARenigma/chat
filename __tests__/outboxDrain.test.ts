/**
 * The global outbox drain, run for real over a stand-in client: a drain
 * already on the wire when the account changes must not carry the queue it
 * read into the next session (src/api/chat.ts `drainAllOutbox`).
 */
import { QueryClient } from '@tanstack/react-query';

const mockStore = new Map<string, string>();
jest.mock('../src/lib/storage', () => ({
  storage: {
    get: (key: string) => mockStore.get(key) ?? null,
    set: (key: string, value: string) => {
      mockStore.set(key, value);
    },
    remove: (key: string) => {
      mockStore.delete(key);
    },
  },
  supabaseStorage: {},
}));

const mockSession: { userId: string | null } = { userId: 'user-a' };
/** Every RPC as it left: which entry, under which session. */
const mockSent: Array<{ nonce: string; as: string | null }> = [];
let mockHold: Promise<void> = Promise.resolve();
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: mockSession.userId === null ? null : { user: { id: mockSession.userId } } },
        error: null,
      })),
    },
    rpc: jest.fn(async (_name: string, args: { p_client_nonce: string }) => {
      mockSent.push({ nonce: args.p_client_nonce, as: mockSession.userId });
      await mockHold;
      return { data: null, error: { message: 'offline', code: '' } };
    }),
  },
}));
jest.mock('../src/lib/haptics', () => ({ tick: jest.fn(), errorTick: jest.fn() }));
jest.mock('../src/lib/telemetry', () => ({ track: jest.fn() }));

import { drainAllOutbox } from '../src/api/chat';
import { clearOutbox, enqueue, readOutbox } from '../src/lib/outboxStore';

const queued = (nonce: string) => ({
  nonce,
  conversationId: 'conv-1',
  body: `body ${nonce}`,
  replyToId: null,
  createdAt: new Date().toISOString(),
  attempts: 1,
});

/** A provider's thread, so the member wallet gate never stops the send. */
function client(): QueryClient {
  // No garbage-collection timer left behind to hold the test process open.
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  queryClient.setQueryData(['conversation-list'], [{ conversation_id: 'conv-1', i_am_member: false }]);
  return queryClient;
}

describe('a drain on the wire when the account changes', () => {
  beforeEach(() => {
    mockStore.clear();
    mockSent.length = 0;
    mockSession.userId = 'user-a';
  });

  it('sends nothing more of the old account\'s queue once it signed out and another signed in', async () => {
    enqueue(queued('n1'));
    enqueue(queued('n2'));
    enqueue(queued('n3'));
    let release: () => void = () => undefined;
    mockHold = new Promise<void>(resolve => {
      release = resolve;
    });
    const drain = drainAllOutbox(client());
    await new Promise(resolve => setImmediate(resolve));
    // The first send hangs. A signs out (the device half clears the queue)
    // and B signs in before it comes back.
    expect(mockSent.map(s => s.nonce)).toHaveLength(1);
    clearOutbox();
    mockSession.userId = 'user-b';
    release();
    await drain;
    expect(mockSent).toEqual([{ nonce: 'n1', as: 'user-a' }]);
    // And the failed first send did not put A's entry back for B.
    expect(readOutbox().filter(e => e.nonce !== 'n1')).toEqual([]);
  });

  it('stops at a changed session even when the queue still holds the entries', async () => {
    enqueue(queued('n1'));
    enqueue(queued('n2'));
    let release: () => void = () => undefined;
    mockHold = new Promise<void>(resolve => {
      release = resolve;
    });
    const drain = drainAllOutbox(client());
    await new Promise(resolve => setImmediate(resolve));
    mockSession.userId = 'user-b';
    release();
    await drain;
    expect(mockSent.map(s => s.as)).toEqual(['user-a']);
  });
});
