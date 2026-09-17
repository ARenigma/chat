import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { ENV } from '../lib/env';
import { newUuid } from '../lib/ids';
import { canSend } from '../lib/tokenLedger';
import { errorTick, tick } from '../lib/haptics';
import {
  PENDING_PREFIX,
  insertOptimistic,
  markFailed,
  settleOptimistic,
  type TranscriptMessage,
} from '../lib/transcript';
import { track } from '../lib/telemetry';
import type { Message, SendError } from '../lib/database.types';
import {
  isSendable,
  isVoicePath,
  nextSpeed,
  voiceObjectPath,
  type PlaybackSpeed,
  type VoiceDraft,
  type VoicePlayer,
} from '../lib/voice';
import {
  applySpeed,
  rememberSpeed,
  startPlayback,
  stopPlayback,
  storedSpeed,
} from '../lib/recorder';
import { useStore } from '../store/useStore';
import { keys, memberPaysInThread } from './chat';
import { sendResultFrom } from '../lib/sendErrors';

/** The private bucket created by migration 011. */
const BUCKET = 'voice-notes';

/**
 * How long a playback URL is good for.
 *
 * Sixty seconds, minted on the tap rather than on render. Minting per row at
 * render time would issue a signed URL for every note on screen whether or not
 * anybody listens, and each one is a credential with a lifetime.
 */
const SIGNED_URL_TTL_SECONDS = 60;

const NOTICE: Record<SendError | 'UPLOAD', string> = {
  INSUFFICIENT_BALANCE: 'Your balance is empty.',
  POLICY_REQUIRED: 'Accept the latest Terms and Privacy Policy to continue.',
  BAD_REQUEST: 'That voice note could not be sent.',
  UNAUTHORIZED: 'Session expired. Reopen the app to continue.',
  FORBIDDEN: 'That conversation is not available.',
  NOT_FOUND: 'That conversation no longer exists.',
  BLOCKED: 'You can no longer message each other.',
  SUSPENDED: 'Your account is under review and cannot send messages.',
  RATE_LIMITED: 'Slow down a moment, then try again.',
  CHANNEL_DISABLED_BY_PROVIDER: 'They are not taking chats right now.',
  // Not a `SendError`: the upload is a separate hop and it is the one that fails
  // on a bad connection, so it says so rather than borrowing BAD_REQUEST.
  UPLOAD: 'The recording could not be uploaded. Check your connection.',
};

/**
 * The upload, hand-rolled, and the comment is the reason rather than a preference.
 *
 * `supabase.storage.from(b).upload(path, body)` cannot be used from React Native.
 * storage-js's FormData branch calls `body.has('cacheControl')`, and React
 * Native's FormData polyfill implements only `append`, `getAll` and `getParts`,
 * so it throws a TypeError before a byte leaves the device. The Blob branch is no
 * help either: RN's Blob cannot be constructed from a file path.
 *
 * What does work needs no filesystem module and puts no bytes through JS: RN's
 * networking layer streams a file part natively when given `{ uri, name, type }`,
 * so this is the same multipart shape storage-js sends for a browser Blob, posted
 * to the same endpoint. The alternative, reading the file into an ArrayBuffer,
 * would base64 the whole recording across the bridge *and* need a filesystem
 * dependency to read it.
 *
 * Uses XMLHttpRequest instead of fetch so `xhr.upload.onprogress` can report
 * byte-level progress to the caller — fetch provides no upload progress API.
 * M3 spec: determinate progress when the fraction is known.
 * Ref: https://m3.material.io/components/progress-indicators/guidelines
 */
async function uploadRecording(
  path: string,
  file: string,
  accessToken: string,
  onProgress?: (fraction: number) => void,
): Promise<boolean> {
  const form = new FormData();
  form.append('cacheControl', '3600');
  // The empty field name is what storage-js uses, and the server reads the first
  // file part regardless of its name.
  form.append('', {
    uri: file.startsWith('file://') ? file : `file://${file}`,
    name: 'note.m4a',
    type: 'audio/mp4',
  } as unknown as Blob);

  return new Promise<boolean>(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${ENV.supabaseUrl}/storage/v1/object/${BUCKET}/${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('apikey', ENV.supabaseAnonKey);
    // No `x-upsert`. The bucket has no UPDATE policy on purpose: a recording
    // the sender can replace after it has been read or reported is worthless
    // as evidence. A retry mints a new key instead.
    if (onProgress !== undefined) {
      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable && e.total > 0) {
          onProgress(e.loaded / e.total);
        }
      };
    }
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.onabort = () => resolve(false);
    // A stalled upload otherwise never settles this promise, hanging the send
    // spinner forever (2026-09-09 audit). Settle to the same failure path as
    // onerror so the composer can offer a retry.
    xhr.timeout = 30000;
    xhr.ontimeout = () => resolve(false);
    xhr.send(form);
  });
}

/**
 * Send a recording as a message.
 *
 * Upload first, insert second, and that order is the whole design. `voice_path`
 * is not client-writable after the fact (migration 011 guards it in
 * `guard_message_reply_and_voice`), so the row can only ever be written once and
 * has to point at audio that already exists. The failure this leaves behind is an
 * orphaned object when the RPC rejects after a successful upload, and
 * `purge_orphaned_voice_notes` sweeps those after 24 hours.
 *
 * Mirrors `useSendMessage` deliberately, including the optimistic row and the
 * notice map, so the two send paths behave the same when they fail. The one thing
 * it does not mirror: the optimistic row cannot be played, because its audio is
 * on disk and not yet in the bucket, and a local-file playback path would be a
 * second player route to keep in step with the first for one second of benefit.
 */
export function useSendVoiceNote(
  conversationId: string | undefined,
  selfId: string | undefined,
) {
  const queryClient = useQueryClient();
  const setSending = useStore(s => s.setSending);
  const setBalance = useStore(s => s.setBalance);
  const setNotice = useStore(s => s.setNotice);
  const openRefill = useStore(s => s.openRefill);
  const setUploadProgress = useStore(s => s.setUploadProgress);
  const clearUploadProgress = useStore(s => s.clearUploadProgress);

  return useCallback(
    async (draft: VoiceDraft, replyToId: string | null = null): Promise<boolean> => {
      if (conversationId === undefined || selfId === undefined) {
        return false;
      }
      // The recorder already refuses to run past the ceiling, so this is the
      // floor: a tap too short to be a recording is discarded without a telling
      // off, because being scolded for brushing a button is worse than nothing.
      if (!isSendable(draft.durationMs)) {
        return false;
      }
      // Same member-only wallet gate as useSendMessage — providers reply at 0.
      if (memberPaysInThread(queryClient, conversationId) && !canSend(useStore.getState().balance)) {
        errorTick();
        openRefill();
        return false;
      }

      const path = voiceObjectPath(conversationId, newUuid());
      if (!isVoicePath(path)) {
        // Unreachable unless the conversation id is not a uuid, which would mean
        // the RPC would refuse the path too. Checked here so the recording is not
        // uploaded first to find that out.
        setNotice(NOTICE.BAD_REQUEST);
        return false;
      }

      tick();
      const key = keys.messages(conversationId);
      // One value for the local row id and the server dedup key. See chat.ts.
      const nonce = newUuid();
      const pendingId = `${PENDING_PREFIX}${nonce}`;
      const optimistic: Message = {
        id: pendingId,
        conversation_id: conversationId,
        sender_id: selfId,
        body: null,
        reply_to_id: replyToId,
        voice_path: path,
        voice_duration_ms: draft.durationMs,
        voice_peaks: null,
        attachment_path: null,
        attachment_type: null,
        attachment_width: null,
        attachment_height: null,
        session_id: null,
        origin: 'live',
        created_at: new Date().toISOString(),
        read_at: null,
        edited_at: null,
        deleted_at: null,
      };

      queryClient.setQueryData<TranscriptMessage[]>(key, prev =>
        insertOptimistic(prev ?? [], optimistic),
      );
      setSending(true);

      /*
       * WITHDRAW: take the bubble away. Correct only before the object exists —
       * a recording that never uploaded has nothing to retry and nothing to
       * show, so leaving a failed bubble would offer a retry that cannot work.
       */
      const withdraw = (notice: string) => {
        queryClient.setQueryData<TranscriptMessage[]>(key, prev =>
          settleOptimistic(prev ?? [], pendingId, null),
        );
        setNotice(notice);
        errorTick();
      };

      /*
       * KEEP: the object uploaded and only the send RPC failed, so the bubble
       * stays and says so. Not queued in the outbox — see `lib/outbox.ts` for
       * why media is deliberately not replayed across a launch — but within
       * this session the member can see what happened instead of watching their
       * voice note evaporate.
       */
      const keepFailed = (notice: string) => {
        queryClient.setQueryData<TranscriptMessage[]>(key, prev =>
          markFailed(prev ?? [], pendingId),
        );
        setNotice(notice);
        errorTick();
      };

      const { data: session } = await supabase.auth.getSession();
      const accessToken = session.session?.access_token;
      if (accessToken === undefined) {
        setSending(false);
        withdraw(NOTICE.UNAUTHORIZED);
        return false;
      }

      const uploaded = await uploadRecording(path, draft.file, accessToken, fraction => {
        setUploadProgress(pendingId, fraction);
      }).catch(
        () => false,
      );
      clearUploadProgress(pendingId);
      if (!uploaded) {
        setSending(false);
        // Counted as a rejection with its own reason, because an upload that
        // fails at scale is a different problem from a send the server refused.
        track('send_rejected', { reason: 'upload' });
        withdraw(NOTICE.UPLOAD);
        return false;
      }

      const { data, error } = await supabase.rpc('send_message_idempotent', {
        p_client_nonce: nonce,
        p_conversation_id: conversationId,
        p_body: null,
        p_reply_to_id: replyToId,
        p_voice_path: path,
        p_voice_duration_ms: draft.durationMs,
        p_voice_peaks: [...draft.peaks],
      });
      setSending(false);

      const result = sendResultFrom(data, error);

      if (result === null || !result.success) {
        const code = result?.error;
        track('send_rejected', { reason: code ?? 'network' });
        keepFailed(
          code !== undefined ? NOTICE[code] : 'Could not send. Check your connection.',
        );
        if (code === 'INSUFFICIENT_BALANCE') {
          openRefill();
        }
        void queryClient.invalidateQueries({ queryKey: keys.profile });
        return false;
      }

      const confirmed: Message | null =
        result.message_id !== undefined && result.created_at !== undefined
          ? { ...optimistic, id: result.message_id, created_at: result.created_at }
          : null;

      queryClient.setQueryData<TranscriptMessage[]>(key, prev =>
        settleOptimistic(prev ?? [], pendingId, confirmed),
      );

      if (typeof result.new_balance === 'number') {
        setBalance(result.new_balance);
      }
      // Seconds, not the message id: `guard_event_shape` rejects any prop key
      // matching `message`, and the length is the only interesting thing anyway.
      track('voice_note_sent', { secs: Math.round(draft.durationMs / 1000) });
      void queryClient.invalidateQueries({ queryKey: keys.conversationList });
      return true;
    },
    [conversationId, selfId, queryClient, setSending, setBalance, setNotice, openRefill, setUploadProgress, clearUploadProgress],
  );
}

/**
 * The single playhead.
 *
 * There is one native player, so this owns one store value and every row reads it
 * rather than holding a position of its own. Stopping on unmount is not tidiness:
 * without it, audio from a thread you have left keeps playing over the next
 * screen, and the row that started it is gone so nothing can stop it.
 */
export function useVoicePlayer(): VoicePlayer {
  const setPlaying = useStore(s => s.setPlaying);
  const setNotice = useStore(s => s.setNotice);
  // Seeded from storage so a speed chosen last week is the speed this screen
  // opens with, then held in React state because the pill has to re-render when
  // it changes and MMKV cannot tell anyone it was written to.
  const [speed, setSpeed] = useState<PlaybackSpeed>(storedSpeed);

  useEffect(
    () => () => {
      void stopPlayback();
      setPlaying(null);
    },
    [setPlaying],
  );

  const toggle = useCallback(
    (messageId: string, path: string, durationMs: number) => {
      const current = useStore.getState().playing;
      if (current !== null && current.messageId === messageId) {
        void stopPlayback();
        setPlaying(null);
        return;
      }

      // Marked pending before the round trip. Signing a URL and opening a stream
      // takes long enough on a slow connection that a play button with no state
      // change reads as dead, and the second tap then stops what the first
      // started.
      setPlaying({ messageId, positionMs: 0, durationMs, pending: true });

      void (async () => {
        const { data, error } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        if (error !== null || data === null) {
          setPlaying(null);
          setNotice('That voice note could not be played.');
          return;
        }
        // Somebody may have tapped another note while the URL was being signed.
        if (useStore.getState().playing?.messageId !== messageId) {
          return;
        }
        try {
          await startPlayback(data.signedUrl, storedSpeed(), {
            onPosition: (positionMs, reportedDuration) => {
              if (useStore.getState().playing?.messageId !== messageId) {
                return;
              }
              setPlaying({
                messageId,
                positionMs,
                // The player's own duration once it has one: the column is what
                // the recorder reported, and the two can differ by a frame.
                durationMs: reportedDuration > 0 ? reportedDuration : durationMs,
                pending: false,
              });
            },
            onEnd: () => {
              void stopPlayback();
              setPlaying(null);
            },
          });
          track('voice_note_played', { secs: Math.round(durationMs / 1000) });
        } catch {
          setPlaying(null);
          setNotice('That voice note could not be played.');
        }
      })();
    },
    [setNotice, setPlaying],
  );

  const cycleSpeed = useCallback(() => {
    setSpeed(current => {
      const next = nextSpeed(current);
      // Applied to whatever is playing right now and remembered for the next one.
      // A rate that is remembered but not applied, or applied but not
      // remembered, is the same bug from two ends.
      void applySpeed(next);
      rememberSpeed(next);
      return next;
    });
  }, []);

  // Memoised because every bubble takes this object as a prop and every bubble is
  // memoised: a fresh object per render would re-render the whole transcript on
  // each playhead tick, which is the opposite of the point.
  return useMemo(() => ({ toggle, cycleSpeed, speed }), [toggle, cycleSpeed, speed]);
}
