/**
 * Provider-side chat and call fixes from the 2026-10-09 provider sweep (B4, B8,
 * C7, C8, C9, C10, C13, D6). Pinned as source text, the way the chat contract
 * suites do it; the server half of B4 is pgTAP 186.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8');

describe('B4: a provider with their own chat channel off is not told "They are not taking chats"', () => {
  it('drops that notice when the sender is the provider', () => {
    const chat = read('src/api/chat.ts');
    expect(chat).toContain('const senderIsMember = memberPaysInThread(queryClient, conversationId);');
  });
  it('skips the provider-initiated request on the server when the channel is off', () => {
    expect(read('supabase/migrations/186_provider_send_fix.sql')).toMatch(/chat_enabled/);
  });
});

describe('C7: the provider sees the paid session start, with an elapsed clock', () => {
  it('draws the provider bar only from an elapsed clock', () => {
    const bar = read('src/chat-v2/ChatSessionBarV2.tsx');
    expect(bar).toContain('providerElapsedClock?: string | null;');
    expect(bar).toMatch(/\{providerElapsedClock != null \? \(/);
  });
});

describe('B8: a provider can save a member from the chat menu', () => {
  it('offers Save member / Remove from saved', () => {
    expect(read('src/chat-v2/ChatHeaderV2.tsx')).toContain(
      "label: isMemberSaved ? 'Remove from saved' : 'Save member',",
    );
  });
});

describe('C8: opening a chat makes no promise on the provider side', () => {
  it('says only that the member was notified', () => {
    const controller = read('src/chat-v2/useChatV2Controller.ts');
    expect(controller).toContain('`${displayName} has been notified.`');
  });
});

describe('C9: calls started by a provider', () => {
  it('confirms before ringing the member', () => {
    expect(read('src/chat-v2/ChatScreenV2.tsx')).toContain(
      'body="They\'re charged per minute once they pick up."',
    );
  });
  it('tells the member how it is billed on the incoming screen, with no unquoted figure', () => {
    const call = read('src/screens/CallScreen.tsx');
    expect(call).toContain('testID="call-incoming-rate"');
    expect(call).toContain('Charged per minute from when you start');
  });
});

describe('C10: call buttons follow the provider\'s own channel switches', () => {
  it('gates on the provider\'s own audio and video flags', () => {
    const controller = read('src/chat-v2/useChatV2Controller.ts');
    expect(controller).toContain('(ownProfile?.audio_enabled ?? true)');
    expect(controller).toContain('(ownProfile?.video_enabled ?? true)');
  });
  it('says which channel is off', () => {
    const call = read('src/screens/CallScreen.tsx');
    expect(call).toContain("'You have video calls turned off.'");
    expect(call).toContain("'You have voice calls turned off.'");
  });
});

describe('C13: a refusal never reveals the member\'s balance to a provider', () => {
  it('uses a neutral line', () => {
    expect(read('src/screens/CallScreen.tsx')).toContain("`${name} can't take a call right now.`");
  });
});

describe('D6: the end dialog speaks to the provider as a provider', () => {
  it('has provider copy and a not-started state', () => {
    const session = read('src/chat-v2/session.ts');
    expect(session).toContain("'End this chat? This ends the paid chat.'");
    expect(session).toContain("'Not started yet'");
  });
});
