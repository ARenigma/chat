import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS } from '../theme/tokens';
import { getPersona, type PersonaId } from '../lib/personas';
import { useChatId, useMessages, useProfile, useSendMessage } from '../api/chat';
import { selectIsStreaming, useStore } from '../store/useStore';
import { Avatar } from '../components/Avatar';
import { Chip } from '../components/Chip';
import { Composer } from '../components/Composer';
import { DayDivider } from '../components/DayDivider';
import { Icon } from '../components/Icon';
import { NoticeBar } from '../components/NoticeBar';
import { Pressable } from '../components/Pressable';
import { StreamingTurn } from '../components/StreamingTurn';
import { TokenCounter } from '../components/TokenCounter';
import { AssistantTurn, UserTurn } from '../components/Turn';

interface Props {
  personaId: PersonaId;
  onBack: () => void;
}

const STARTERS: ReadonlyArray<{ label: string; tone: 'neutral' | 'warm' }> = [
  { label: 'Tell me about your day', tone: 'neutral' },
  { label: 'I missed you', tone: 'warm' },
  { label: 'I just need to vent', tone: 'neutral' },
];

function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * `inverted` is load-bearing: it anchors the transcript to the bottom, so a
 * keyboard opening or a bubble growing changes nobody's scroll offset. Combined
 * with a stable `data` reference during streaming (the live reply lives in
 * ListHeaderComponent), the list does no layout work while tokens arrive.
 */
export function ChatScreen({ personaId, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const persona = getPersona(personaId);
  const balance = useStore(s => s.balance);
  const openRefill = useStore(s => s.openRefill);
  const isStreaming = useStore(selectIsStreaming);
  const [bloomKey, setBloomKey] = useState(0);

  useProfile();
  const { data: chatId, isPending: chatPending } = useChatId(personaId);
  const { data: messages, isPending: messagesPending } = useMessages(chatId);
  const send = useSendMessage(chatId, personaId);

  const onSend = useCallback(
    (text: string) => {
      setBloomKey(n => n + 1);
      void send(text);
    },
    [send],
  );

  const initial = persona?.initial ?? '?';

  /**
   * Grouping is computed once per data change, not per row: a row needs to know
   * whether it opens a group and whether it closes one, which depends on its
   * neighbours. The list is newest-first because it renders inverted.
   */
  const rows = useMemo(() => {
    const list = messages ?? [];
    return list.map((m, i) => {
      const newer = list[i - 1];
      const older = list[i + 1];
      return {
        message: m,
        first: !older || older.sender !== m.sender,
        last: !newer || newer.sender !== m.sender,
      };
    });
  }, [messages]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<(typeof rows)[number]>) => {
      const { message, first, last } = item;
      const stamp = last ? timeOf(message.created_at) : undefined;
      return message.sender === 'assistant' ? (
        <View style={styles.turn}>
          <AssistantTurn
            message={message.content}
            initial={initial}
            first={first}
            timestamp={stamp}
          />
        </View>
      ) : (
        <View style={styles.turn}>
          <UserTurn message={message.content} timestamp={stamp} />
        </View>
      );
    },
    [initial],
  );

  const header = useCallback(() => <StreamingTurn initial={initial} />, [initial]);
  const loading = chatPending || (chatId !== undefined && messagesPending);
  const empty = !loading && rows.length === 0 && !isStreaming;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          testID="chat-back"
          accessibilityLabel="Back to companions"
          style={styles.back}>
          <Icon glyph="chevron-left" size={16} />
        </Pressable>
        <Avatar initial={initial} size={32} online={persona?.online ?? false} />
        <Text testID="chat-title" allowFontScaling numberOfLines={1} style={styles.title}>
          {persona?.name ?? 'Companion'}
        </Text>
        <TokenCounter balance={balance} onPress={openRefill} />
      </View>

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={TOKENS.color.text.secondary} />
          </View>
        ) : empty ? (
          <View style={styles.empty}>
            <Avatar initial={initial} size={56} tone="warm" breathing />
            <Text allowFontScaling style={styles.emptyName}>
              {persona?.name}
            </Text>
            <Text allowFontScaling style={styles.emptyLine}>
              She’s been waiting.
            </Text>
            <View style={styles.starters}>
              {STARTERS.map(s => (
                <Chip key={s.label} label={s.label} tone={s.tone} onPress={onSend} />
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            data={rows}
            inverted
            keyExtractor={r => r.message.id}
            renderItem={renderItem}
            ListHeaderComponent={header}
            ListFooterComponent={<DayDivider label="Today" />}
            contentContainerStyle={styles.list}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            windowSize={9}
            removeClippedSubviews
            showsVerticalScrollIndicator={false}
          />
        )}

        <NoticeBar />

        <View style={{ paddingBottom: insets.bottom + TOKENS.space.sm }}>
          <Composer
            onSend={onSend}
            disabled={isStreaming || chatId === undefined}
            placeholder={isStreaming ? 'Replying…' : 'Say anything'}
            bloomKey={bloomKey}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: TOKENS.color.bg.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.sm,
    paddingHorizontal: TOKENS.space.md,
    paddingTop: TOKENS.space.xs,
    paddingBottom: TOKENS.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TOKENS.color.border.hairline,
  },
  back: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TOKENS.color.bg.sunken,
  },
  title: {
    ...TOKENS.typography.bodyMedium,
    fontWeight: '600',
    color: TOKENS.color.text.primary,
    flex: 1,
  },
  body: {
    flex: 1,
  },
  list: {
    paddingHorizontal: TOKENS.space.md,
    paddingTop: TOKENS.space.md,
  },
  turn: {
    paddingVertical: TOKENS.space.xs,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: TOKENS.space.xs,
    paddingHorizontal: TOKENS.space['2xl'],
  },
  emptyName: {
    ...TOKENS.typography.titleMedium,
    color: TOKENS.color.text.primary,
  },
  emptyLine: {
    ...TOKENS.typography.bodyMedium,
    color: TOKENS.color.text.secondary,
  },
  starters: {
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
    paddingTop: TOKENS.space.xl,
  },
});
