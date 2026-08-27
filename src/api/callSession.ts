/**
 * A live audio call over WebRTC, with signalling on a Realtime channel.
 *
 * The `calls` row (server) is the authoritative record of who called whom and
 * what it cost; this is the media that row bills for. SDP offers/answers and ICE
 * candidates ride a Supabase Realtime broadcast channel keyed on the call id and
 * are never written down — they are worthless a second after the call connects,
 * exactly as the migration 011 note intended.
 *
 * The handshake, deliberately simple for a 1:1 call:
 *   1. Both peers join `call:<id>`.
 *   2. The callee announces `ready` when its channel subscribes (it only joins
 *      after answering, so `ready` doubles as "I picked up").
 *   3. The caller, on `ready`, creates the offer and sends it.
 *   4. The callee answers; ICE flows both ways as candidates are gathered.
 * The caller joins first (it is on the outgoing screen before the callee
 * accepts), so it is always listening when `ready` arrives.
 *
 * Audio only. react-native-webrtc plays a remote audio track through the device
 * automatically once it is added to the connection, so there is nothing to
 * render — the hook returns connection state and a mute toggle, not a stream.
 * Video is a follow-up (it needs RTCView surfaces and a camera permission).
 */
import { useEffect, useRef, useState } from 'react';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  type MediaStream,
} from 'react-native-webrtc';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { ICE_SERVERS } from './calls';

export type CallConnState = 'connecting' | 'connected' | 'failed' | 'closed';

interface Session {
  connState: CallConnState;
  muted: boolean;
  toggleMute: () => void;
}

/**
 * Runs the media for one call. `enabled` gates when it starts — the caller turns
 * it on as the outgoing screen appears; the callee the moment it accepts — so
 * CallScreen can call the hook unconditionally (hook rules) while media only
 * runs when there is a call to run. Disabling it (or unmounting) tears
 * everything down: tracks stopped, peer closed, channel removed. So ending a
 * call is just leaving the screen.
 */
export function useCallSession(
  callId: string | null,
  isCaller: boolean,
  enabled: boolean,
): Session {
  const [connState, setConnState] = useState<CallConnState>('connecting');
  const [muted, setMuted] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!enabled || callId === null) {
      return;
    }
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    const send = (event: string, payload: Record<string, unknown>) => {
      void channel?.send({ type: 'broadcast', event, payload });
    };

    (async () => {
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      if (cancelled) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      localRef.current = stream;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      // @ts-expect-error react-native-webrtc's event target types lag its runtime
      pc.addEventListener('icecandidate', (e: { candidate: RTCIceCandidate | null }) => {
        if (e.candidate) {
          send('ice', { candidate: e.candidate.toJSON() });
        }
      });
      // @ts-expect-error see above
      pc.addEventListener('connectionstatechange', () => {
        const s = pc.connectionState;
        if (s === 'connected') {
          setConnState('connected');
        } else if (s === 'failed') {
          setConnState('failed');
        } else if (s === 'closed' || s === 'disconnected') {
          setConnState('closed');
        }
      });

      channel = supabase.channel(`call:${callId}`, {
        config: { broadcast: { self: false } },
      });

      channel.on('broadcast', { event: 'offer' }, async ({ payload }) => {
        if (isCaller || pc.signalingState === 'closed') {
          return;
        }
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send('answer', { sdp: answer });
      });

      channel.on('broadcast', { event: 'answer' }, async ({ payload }) => {
        if (!isCaller || pc.signalingState === 'closed') {
          return;
        }
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      });

      channel.on('broadcast', { event: 'ice' }, async ({ payload }) => {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch {
          // A candidate arriving before the remote description is set is normal
          // early in the handshake; the ret/renegotiation covers it.
        }
      });

      // The caller, once the callee signals it has picked up, makes the offer.
      channel.on('broadcast', { event: 'ready' }, async () => {
        if (!isCaller || pc.signalingState === 'closed') {
          return;
        }
        const offer = await pc.createOffer({});
        await pc.setLocalDescription(offer);
        send('offer', { sdp: offer });
      });

      channel.subscribe(status => {
        if (status === 'SUBSCRIBED' && !isCaller) {
          // Callee has joined (i.e. answered): tell the caller to send the offer.
          send('ready', {});
        }
      });
    })();

    return () => {
      cancelled = true;
      localRef.current?.getTracks().forEach(t => t.stop());
      localRef.current = null;
      pcRef.current?.close();
      pcRef.current = null;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [callId, isCaller, enabled]);

  const toggleMute = () => {
    const tracks = localRef.current?.getAudioTracks() ?? [];
    const next = !muted;
    tracks.forEach(t => {
      t.enabled = !next;
    });
    setMuted(next);
  };

  return { connState, muted, toggleMute };
}
