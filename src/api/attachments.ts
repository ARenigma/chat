import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { errorTick, tick } from '../lib/haptics';
import {
  PENDING_PREFIX,
  markFailed,
  settleOptimistic,
  type TranscriptMessage,
} from '../lib/transcript';
import { track } from '../lib/telemetry';
import type { Message, SendError } from '../lib/database.types';
import { isAttachmentPath } from '../lib/attachments';
import { useStore } from '../store/useStore';
import { keys } from './chat';
import { sendNotice, sendResultFrom } from '../lib/sendErrors';
import { CONTACT_GUARD_NOTICE } from '../lib/contactGuard';
import { openRefill } from '../lib/routes/actions';

/** The private bucket created by migration 014. */
const BUCKET = 'attachments';

/**
 * How long a display URL is good for. Ten minutes, minted on demand and cached
 * by react-query below, because unlike a voice note a photo shows the moment its
 * row is on screen rather than on a tap, and re-minting per render would issue a
 * fresh credential for every visible image on every scroll.
 */
const SIGNED_URL_TTL_SECONDS = 600;

const NOTICE: Record<SendError, string> = {
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
  ...CONTACT_GUARD_NOTICE,
};

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
 * Retry a photo whose upload SUCCEEDED but whose `send_message_idempotent`
 * call failed — the `keepFailed` branch, not `withdraw`. Before this
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
        keepFailed(
          code !== undefined
            ? (sendNotice(result, NOTICE) ?? NOTICE[code])
            : 'Could not send. Check your connection.',
        );
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
    [conversationId, selfId, queryClient, setSending, setBalance, setNotice],
  );
}
