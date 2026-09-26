/**
 * The `Call` route, both trees.
 *
 * Back always asks (nav-migration §4, 3b): `usePreventRemove(!ending)` turns
 * a removal into the screen's own leave dialog
 * (https://reactnavigation.org/docs/preventing-going-back). Confirming ends
 * the call, the screen sets `ending`, and `onEnded` goes to that peer's chat
 * through the planner: back to the chat the call was started from (the Chat
 * is still mounted under it), or in the call's place when there is none.
 *
 * `onEnded` fires in the same commit that sets `ending`, BEFORE the published
 * guard reaches this adapter, so `leaving` is what lets the call's own exit
 * through its own guard.
 *
 * The store's `activeCall` was set when this route was dispatched (`startCall`,
 * or the intent queue for a ring); this route records the call id when it is
 * known and releases the call when it unmounts, owner-checked by `seq`.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import * as Layout from '../../components/Layout';
import { CallScreen, type CallGuard } from '../CallScreen';
import { openChat } from '../../lib/routes/actions';
import type { AllNavigatorParams } from '../../lib/routes/types';
import { useStore } from '../../store/useStore';

type Props = NativeStackScreenProps<AllNavigatorParams, 'Call'>;

export function CallRoute({ navigation, route }: Props) {
  const { peerId, direction, callId, medium } = route.params;
  const [guard, setGuard] = useState<CallGuard | null>(null);
  const leaving = useRef(false);

  // The call this route owns: the one `activeCall` held when it mounted.
  const seq = useRef<number | null>(useStore.getState().activeCall?.seq ?? null);
  useEffect(
    () => () => {
      if (seq.current !== null) {
        useStore.getState().endActiveCall(seq.current);
      }
    },
    [],
  );
  const onCallId = useCallback((id: string) => {
    if (seq.current !== null) {
      useStore.getState().setActiveCallId(seq.current, id);
    }
  }, []);

  const onEnded = useCallback(() => {
    leaving.current = true;
    openChat(peerId, 'callEnd', route.key);
  }, [peerId, route.key]);

  usePreventRemove(guard?.ending !== true, ({ data }) => {
    if (leaving.current) {
      navigation.dispatch(data.action);
      return;
    }
    guard?.openLeave();
  });

  return (
    <Layout.Screen minimalShell>
      <CallScreen
        key={callId ?? 'starting'}
        providerId={peerId}
        direction={direction}
        callId={callId}
        medium={medium}
        onEnded={onEnded}
        onGuard={setGuard}
        onCallId={onCallId}
      />
    </Layout.Screen>
  );
}
