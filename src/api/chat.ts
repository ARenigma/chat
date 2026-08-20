import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { ClaimResult, Message, Profile } from '../lib/database.types';
import { canSend } from '../lib/tokenLedger';
import { errorTick, tick } from '../lib/haptics';
import { useStore } from '../store/useStore';
import { streamChat, type StreamHandle } from './stream';
import type { StreamErrorCode } from '../../supabase/functions/_shared/protocol';

/** Newest-first: the transcript renders into an inverted list. */
const PAGE_SIZE = 100;

export const keys = {
  profile: ['profile'] as const,
  chat: (personaId: string) => ['chat', personaId] as const,
  messages: (chatId: string) => ['messages', chatId] as const,
};

const NOTICE: Record<StreamErrorCode, string> = {
  INSUFFICIENT_TOKENS: 'You are out of tokens.',
  UPSTREAM_FAILED: 'Could not reach your companion. Your token was refunded.',
  BAD_REQUEST: 'That message could not be sent.',
  UNAUTHORIZED: 'Session expired. Reopen the app to continue.',
  FORBIDDEN: 'That conversation is not available.',
  INTERNAL: 'Something went wrong. Your token was refunded.',
};

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    throw new Error('No session');
  }
  return data.user.id;
}

/** Profile + the authoritative token balance, mirrored into the store. */
export function useProfile() {
  const setBalance = useStore(s => s.setBalance);

  const query = useQuery<Profile>({
    queryKey: keys.profile,
    queryFn: async () => {
      const userId = await requireUserId();
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
    staleTime: 15_000,
  });

  useEffect(() => {
    if (query.data) {
      setBalance(query.data.token_balance);
    }
  }, [query.data, setBalance]);

  return query;
}

/** One RPC: resolves the persona's chat, creating it on first open. */
export function useChatId(personaId: string | null) {
  return useQuery<string>({
    queryKey: keys.chat(personaId ?? ''),
    enabled: personaId !== null,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_or_create_chat', {
        p_persona_id: personaId as string,
      });
      if (error || !data) {
        throw new Error(error?.message ?? 'Could not open chat');
      }
      return data;
    },
  });
}

export function useMessages(chatId: string | undefined) {
  return useQuery<Message[]>({
    queryKey: keys.messages(chatId ?? ''),
    enabled: chatId !== undefined,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', chatId as string)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
  });
}

/**
 * The send path. Optimistically inserts the user's turn so the bubble lands on
 * the same frame as the keypress, then streams the reply. On failure the
 * optimistic row is removed and the balance is re-fetched, because the server
 * has already refunded the token.
 */
export function useSendMessage(chatId: string | undefined, personaId: string | null) {
  const queryClient = useQueryClient();
  const handleRef = useRef<StreamHandle | null>(null);

  const beginStream = useStore(s => s.beginStream);
  const setStreamText = useStore(s => s.setStreamText);
  const endStream = useStore(s => s.endStream);
  const setBalance = useStore(s => s.setBalance);
  const setNotice = useStore(s => s.setNotice);
  const openRefill = useStore(s => s.openRefill);

  useEffect(
    () => () => {
      handleRef.current?.cancel();
    },
    [],
  );

  const send = useCallback(
    async (raw: string): Promise<void> => {
      const message = raw.trim();
      if (message === '' || chatId === undefined || personaId === null) {
        return;
      }
      if (useStore.getState().isStreaming) {
        return;
      }
      if (!canSend(useStore.getState().balance)) {
        errorTick();
        openRefill();
        return;
      }

      tick();
      const optimisticId = `pending-${Date.now()}`;
      const optimistic: Message = {
        id: optimisticId,
        chat_id: chatId,
        sender: 'user',
        content: message,
        created_at: new Date().toISOString(),
      };
      queryClient.setQueryData<Message[]>(keys.messages(chatId), prev => [
        optimistic,
        ...(prev ?? []),
      ]);
      beginStream();

      const settle = async (): Promise<void> => {
        endStream();
        await queryClient.invalidateQueries({ queryKey: keys.messages(chatId) });
        await queryClient.invalidateQueries({ queryKey: keys.profile });
      };

      handleRef.current = await streamChat(
        { chatId, personaId, message },
        {
          onBalance: setBalance,
          onText: setStreamText,
          onDone: () => {
            void settle();
          },
          onError: code => {
            queryClient.setQueryData<Message[]>(keys.messages(chatId), prev =>
              (prev ?? []).filter(m => m.id !== optimisticId),
            );
            setNotice(NOTICE[code]);
            errorTick();
            if (code === 'INSUFFICIENT_TOKENS') {
              openRefill();
            }
            void settle();
          },
        },
      );
    },
    [
      chatId,
      personaId,
      queryClient,
      beginStream,
      setStreamText,
      endStream,
      setBalance,
      setNotice,
      openRefill,
    ],
  );

  return send;
}

/** The refill trigger behind the low-balance sheet. */
export function useClaimTokens() {
  const queryClient = useQueryClient();
  const setBalance = useStore(s => s.setBalance);
  const setNotice = useStore(s => s.setNotice);
  const closeRefill = useStore(s => s.closeRefill);

  return useMutation<ClaimResult>({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('claim_daily_tokens');
      if (error || !data) {
        throw new Error(error?.message ?? 'Refill failed');
      }
      return data;
    },
    onSuccess: result => {
      if (result.success && typeof result.new_balance === 'number') {
        setBalance(result.new_balance);
        closeRefill();
        void queryClient.invalidateQueries({ queryKey: keys.profile });
        return;
      }
      setNotice(
        result.error === 'TOO_SOON'
          ? 'Your next free refill unlocks within 24 hours.'
          : 'Refill unavailable right now.',
      );
    },
    onError: () => setNotice('Refill unavailable right now.'),
  });
}
