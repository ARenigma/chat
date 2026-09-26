/**
 * The signed-in shells, one per role, around that role's tab navigator
 * (nav-migration §1). What lives here is what the old SignedIn body drew
 * beside its routes and that is not itself a route:
 *
 * - member: the refill sheet and the session feedback sheet (RN Modals, over
 *   every route). The feedback sheet is held while a call owns the screen
 *   (A5): a session that ends because a call connected never asks over it.
 * - provider: the push-gate state (one AppState listener for all three tabs)
 *   and the ring: a request the store starts ringing becomes a `chatRequest`
 *   intent once, so it is presented through the one queue that holds it
 *   during a call and drops it once it has expired (§3).
 *
 * adapted from bluesky-social/social-app src/view/shell/index.tsx (MIT),
 * see THIRD_PARTY_LICENSES.md
 */

import React, { useEffect, type ReactNode } from 'react';

import { ProviderPushGateProvider } from '../components/ProviderPushGate';
import { SessionFeedbackSheet } from '../components/SessionFeedbackSheet';
import { enqueueIntent } from '../lib/intents';
import { RechargeScreen } from '../screens/RechargeScreen';
import { useStore } from '../store/useStore';

export function MemberShell({ children }: { children: ReactNode }) {
  const callUp = useStore(s => s.activeCall !== null);
  return (
    <>
      {children}
      <RechargeScreen />
      {/* One feedback sheet for the whole app: a session can end in a chat or
          in a call started from a profile, and the sheet has to outlive
          whichever screen noticed (goal item 14). */}
      <SessionFeedbackSheet held={callUp} />
    </>
  );
}

export function ProviderShell({ children }: { children: ReactNode }) {
  const ringing = useStore(s => s.incomingRequest);
  const ringingId = ringing?.requestId ?? null;
  const ringingPeer = ringing?.peerId ?? null;
  useEffect(() => {
    if (ringingId !== null && ringingPeer !== null) {
      enqueueIntent({ type: 'chatRequest', requestId: ringingId, peerId: ringingPeer });
    }
  }, [ringingId, ringingPeer]);
  return <ProviderPushGateProvider>{children}</ProviderPushGateProvider>;
}
