import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { armStallDetector } from '../lib/uploadStall';
import type { Message, SendError } from '../lib/database.types';
import {
  attachmentExt,
  attachmentMime,
  attachmentObjectPath,
  isAttachmentPath,
  type ImageDraft,
} from '../lib/attachments';
import { useStore } from '../store/useStore';
import { keys, memberPaysInThread } from './chat';
import { sendResultFrom } from '../lib/sendErrors';

/** The private bucket created by migration 014. */
const BUCKET = 'attachments';

/**
 * How long a display URL is good for. Ten minutes, minted on demand and cached
 * by react-query below, because unlike a voice note a photo shows the moment its
 * row is on screen rather than on a tap, and re-minting per render would issue a
 * fresh credential for every visible image on every scroll.
 */
const SIGNED_URL_TTL_SECONDS = 600;

const NOTICE: Record<SendError | 'UPLOAD', string> = {
  INSUFFICIENT_BALANCE: 'Your balance is empty.',
  POLICY_REQUIRED: 'Accept the latest Terms and Privacy Policy to continue.',
  BAD_REQUEST: 'That photo could not be sent.',
  UNAUTHORIZED: 'Session expired. Reopen the app to continue.',
  FORBIDDEN: 'That conversation is not available.',
  NOT_FOUND: 'That conversation no longer exists.',
  BLOCKED: 'You can no longer message each other.',
  SUSPENDED: 'Your account is under review and cannot send messages.',
  RATE_LIMITED: 'Slow down a moment, then try again.',
  CHANNEL_DISABLED_BY_PROVIDER: 'They are not taking chats right now.',
  UPLOAD: 'The photo could not be uploaded. Check your connection.',
};

/**
 * The upload, the exact shape `uploadRecording` uses in api/voice.ts and for the
 * same reason: storage-js's FormData branch calls `body.has(...)`, which React
 * Native's FormData polyfill does not implement, so a file part streamed
 * natively through `{ uri, name, type }` is the only path that gets bytes off the
 * device without a filesystem dependency or a base64 hop across the bridge.
 *
 * Uses XMLHttpRequest instead of fetch so `xhr.upload.onprogress` can report
 * byte-level progress to the caller — fetch provides no upload progress API.
 * M3 spec: determinate progress when the fraction is known.
 * Ref: https://m3.material.io/components/progress-indicators/guidelines
 */
async function uploadImage(
  path: string,
  uri: string,
  accessToken: string,
  onProgress?: (fraction: number) => void,
): Promise<boolean> {
  const type = attachmentMime(path);
  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', {
    uri: uri.startsWith('file://') || uri.startsWith('content://') ? uri : `file://${uri}`,
    name: `photo.${path.slice(path.lastIndexOf('.') + 1)}`,
    type,
  } as unknown as Blob);

  return new Promise<boolean>(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${ENV.supabaseUrl}/storage/v1/object/${BUCKET}/${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.setRequestHeader('apikey', ENV.supabaseAnonKey);
    // No `x-upsert`, same evidence argument as voice notes: a photo the
    // sender can replace after it is seen or reported is worthless as
    // evidence. A retry mints a new key.
    if (onProgress !== undefined) {
      xhr.upload.onprogress = (e: ProgressEvent) => {
        if (e.lengthComputable && e.total > 0) {
          onProgress(e.loaded / e.total);
        }
      };
    }
    /*
     * A STALL detector, not a wall-clock timeout (2026-09-17 audit). The
     * 2026-09-09 fix below was a real bug fixed the wrong way: `xhr.timeout`
     * bounds TOTAL transfer time, so a multi-megabyte photo on a slow but
     * genuinely moving connection was killed at 30 s exactly as dead as a
     * truly stuck one. `armStallDetector` watches for the ABSENCE of upload
     * progress instead — see lib/uploadStall.ts — so a slow-but-moving
     * upload is never killed and a genuinely stuck one still is, in the same
     * 30 s.
     */
    const disarmStallDetector = armStallDetector(xhr, 30_000);
    xhr.onload = () => {
      disarmStallDetector();
      resolve(xhr.status >= 200 && xhr.status < 300);
    };
    xhr.onerror = () => {
      disarmStallDetector();
      resolve(false);
    };
    xhr.onabort = () => {
      disarmStallDetector();
      resolve(false);
    };
    xhr.send(form);
  });
}

/**
 * A signed URL for one stored photo, cached.
 *
 * Keyed on the path so every bubble showing the same image shares one credential,
 * and `staleTime` sits just under the TTL so react-query re-mints before a URL
 * expires rather than after a broken image appears.
 */
export function useAttachmentUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['attachment-url', path],
    enabled: typeof path === 'string' && isAttachmentPath(path),
    staleTime: (SIGNED_URL_TTL_SECONDS - 30) * 1000,
    gcTime: SIGNED_URL_TTL_SECONDS * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path as string, SIGNED_URL_TTL_SECONDS);
      if (error || !data) {
        throw error ?? new Error('no signed url');
      }
      return data.signedUrl;
    },
  });
}

/**
 * Send a photo as a message.
 *
 * The exact mirror of `useSendVoiceNote`: upload first, insert second (the row
 * cannot be written twice and must point at an object that already exists),
 * optimistic row, the same notice map so both media paths fail the same way. The
 * optimistic row carries the local `uri` so the picked photo shows immediately;
 * the confirmed row drops it and the bubble re-resolves through a signed URL.
 */
export function useSendImage(
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
    async (draft: ImageDraft, replyToId: string | null = null): Promise<boolean> => {
      if (conversationId === undefined || selfId === undefined) {
        return false;
      }
      if (draft.width <= 0 || draft.height <= 0) {
        setNotice(NOTICE.BAD_REQUEST);
        return false;
      }
      // Same member-only wallet gate as useSendMessage — providers reply at 0.
      if (memberPaysInThread(queryClient, conversationId) && !canSend(useStore.getState().balance)) {
        errorTick();
        openRefill();
        return false;
      }

      const ext = attachmentExt(draft.mime);
      const path = attachmentObjectPath(conversationId, newUuid(), ext);
      if (!isAttachmentPath(path)) {
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
        voice_path: null,
        voice_duration_ms: null,
        voice_peaks: null,
        attachment_path: path,
        attachment_type: 'image',
        attachment_width: draft.width,
        attachment_height: draft.height,
        session_id: null,
        origin: 'live',
        created_at: new Date().toISOString(),
        read_at: null,
        edited_at: null,
        deleted_at: null,
      };

      // The local uri, kept off the row type so the transcript can show the pick
      // before it is in the bucket. Read back by the bubble via `localImageUri`.
      queryClient.setQueryData<TranscriptMessage[]>(key, prev =>
        insertOptimistic(prev ?? [], { ...optimistic, localImageUri: draft.uri } as TranscriptMessage),
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
       * stays and says so — and, since 2026-09-17, can actually be retried:
       * `useRetryImageSend` below re-sends the RPC alone against this same
       * object, no re-upload. Not queued in the OUTBOX, still — see
       * `lib/outbox.ts` for why media is not replayed ACROSS a launch — but a
       * tap-to-retry within this session needs none of that; the object is
       * right here.
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

      const uploaded = await uploadImage(path, draft.uri, accessToken, fraction => {
        setUploadProgress(pendingId, fraction);
      }).catch(() => false);
      clearUploadProgress(pendingId);
      if (!uploaded) {
        setSending(false);
        track('send_rejected', { reason: 'upload' });
        withdraw(NOTICE.UPLOAD);
        return false;
      }

      const { data, error } = await supabase.rpc('send_message_idempotent', {
        p_client_nonce: nonce,
        p_conversation_id: conversationId,
        p_body: null,
        p_reply_to_id: replyToId,
        p_attachment_path: path,
        p_attachment_width: draft.width,
        p_attachment_height: draft.height,
      });
      setSending(false);

      const result = sendResultFrom(data, error);

      if (result === null || !result.success) {
        const code = result?.error;
        track('send_rejected', { reason: code ?? 'network' });
        keepFailed(code !== undefined ? NOTICE[code] : 'Could not send. Check your connection.');
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
      // No success event: `guard_event_shape`'s allowlist has no `image_sent`, and
      // adding one is deferred to the moderation follow-up rather than expanding
      // the telemetry surface here. Failures already report through `send_rejected`.
      void queryClient.invalidateQueries({ queryKey: keys.conversationList });
      return true;
    },
    [conversationId, selfId, queryClient, setSending, setBalance, setNotice, openRefill, setUploadProgress, clearUploadProgress],
  );
}

/**
 * Retry a photo whose upload SUCCEEDED but whose `send_message_idempotent`
 * call failed — the `keepFailed` branch above, not `withdraw`. Before this
 * (2026-09-17 audit), that branch's own docblock argued a retry could not
 * work and cited the outbox's media limitation to justify offering none —
 * but that limitation is about replaying media ACROSS a launch, when the
 * local file may be gone. Within the same session the object already exists
 * in the bucket at `attachment_path`; nothing needs re-uploading, so the
 * retry is the RPC alone, reusing the original nonce so the server's own
 * idempotency (migration 081) is what makes a duplicate impossible if the
 * first attempt in fact landed.
 *
 * `message` is read for its own fields, not passed as a fresh draft: this is
 * why the retry needs no `ImageDraft` and no picker round-trip.
 */
export function useRetryImageSend(
  conversationId: string | undefined,
  selfId: string | undefined,
) {
  const queryClient = useQueryClient();
  const setSending = useStore(s => s.setSending);
  const setBalance = useStore(s => s.setBalance);
  const setNotice = useStore(s => s.setNotice);
  const openRefill = useStore(s => s.openRefill);

  return useCallback(
    async (message: Message): Promise<boolean> => {
      if (
        conversationId === undefined ||
        selfId === undefined ||
        message.attachment_path === null
      ) {
        return false;
      }

      const pendingId = message.id;
      const nonce = pendingId.slice(PENDING_PREFIX.length);
      const key = keys.messages(conversationId);

      const keepFailed = (notice: string) => {
        queryClient.setQueryData<TranscriptMessage[]>(key, prev =>
          markFailed(prev ?? [], pendingId),
        );
        setNotice(notice);
        errorTick();
      };

      tick();
      setSending(true);
      const { data, error } = await supabase.rpc('send_message_idempotent', {
        p_client_nonce: nonce,
        p_conversation_id: conversationId,
        p_body: null,
        p_reply_to_id: message.reply_to_id,
        p_attachment_path: message.attachment_path,
        p_attachment_width: message.attachment_width,
        p_attachment_height: message.attachment_height,
      });
      setSending(false);

      const result = sendResultFrom(data, error);
      if (result === null || !result.success) {
        const code = result?.error;
        track('send_rejected', { reason: code ?? 'network' });
        keepFailed(code !== undefined ? NOTICE[code] : 'Could not send. Check your connection.');
        if (code === 'INSUFFICIENT_BALANCE') {
          openRefill();
        }
        void queryClient.invalidateQueries({ queryKey: keys.profile });
        return false;
      }

      const confirmed: Message | null =
        result.message_id !== undefined && result.created_at !== undefined
          ? {
              id: result.message_id,
              conversation_id: conversationId,
              sender_id: selfId,
              body: null,
              reply_to_id: message.reply_to_id,
              voice_path: null,
              voice_duration_ms: null,
              voice_peaks: null,
              attachment_path: message.attachment_path,
              attachment_type: 'image',
              attachment_width: message.attachment_width,
              attachment_height: message.attachment_height,
              session_id: null,
              origin: 'live',
              created_at: result.created_at,
              read_at: null,
              edited_at: null,
              deleted_at: null,
            }
          : null;

      queryClient.setQueryData<TranscriptMessage[]>(key, prev =>
        settleOptimistic(prev ?? [], pendingId, confirmed),
      );

      if (typeof result.new_balance === 'number') {
        setBalance(result.new_balance);
      }
      void queryClient.invalidateQueries({ queryKey: keys.conversationList });
      return true;
    },
    [conversationId, selfId, queryClient, setSending, setBalance, setNotice, openRefill],
  );
}
