/**
 * B-BS-5 (2026-10-02): provider tapped the voice-call button; screen showed
 * "Calling" for >90 s while no row landed in public.calls.
 *
 * Root cause: `useConversationId` calls `open_conversation(p_provider_id:
 * memberId)` — a member-only RPC — so it always fails on the provider's side,
 * leaving `openedId = undefined`. The startCall effect gated on `openedId`
 * therefore never fired. The computed `_conversationId` fallback was
 * immediately voided and never reached the effect.
 *
 * These tests assert the two structural invariants the fix installs so a
 * future refactor cannot reopen the bug silently.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const call = withoutComments(read('src/screens/CallScreen.tsx'));

describe('provider outgoing call — conversation ID resolution', () => {
  it('only calls open_conversation on the member side', () => {
    // The guard `isMemberSide` must appear in the useConversationId call so
    // the provider-outgoing path never passes the member id as p_provider_id.
    expect(call).toMatch(/useConversationId\([^)]*isMemberSide[^)]*\)/);
  });

  it('uses resolvedConversationId (not openedId) as the startCall argument', () => {
    // The startCall effect must receive the peerThread fallback, not the bare
    // open_conversation result that is always undefined for providers.
    expect(call).toMatch(/startCall\(resolvedConversationId,/);
  });

  it('gates the startCall effect on resolvedConversationId, not openedId', () => {
    // The early-return guard must check the resolved id so the provider path
    // (where openedId is undefined but peerThread.conversation_id is known)
    // actually fires.
    expect(call).toMatch(/resolvedConversationId === undefined/);
  });
});

describe('outgoing call hard timeout (B-BS-5)', () => {
  it('arms a setTimeout when direction is out and callId is null', () => {
    // The timeout effect must branch on direction and callId so it only runs
    // for unresolved outgoing calls and cancels once the server responds.
    expect(call).toMatch(/direction !== 'out' \|\| callId !== null/);
    expect(call).toMatch(/setTimeout/);
    expect(call).toMatch(/clearTimeout/);
  });

  it('calls onEnd() inside the timeout handler', () => {
    // Without calling onEnd the screen would still sit on "Calling" after the
    // timer fires — the same symptom the bug produced.
    expect(call).toMatch(/15[_,]?000/);
    expect(call).toMatch(/onEnd\(\)/);
  });
});
