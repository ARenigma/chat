import {
  FlashList,
  type FlashListRef,
  type ListRenderItemInfo,
  type ViewToken,
} from '@shopify/flash-list';
import React, { useCallback } from 'react';
import {
  Dimensions,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type ViewabilityConfig,
} from 'react-native';
import { KeyboardChatScrollView } from 'react-native-keyboard-controller';
import type { SharedValue } from 'react-native-reanimated';
import { DayDivider } from '../components/DayDivider';
import { PeerTyping } from '../components/PeerTyping';
import { SystemMessageRow } from '../components/SystemMessageRow';
import { timeOfDay } from '../lib/datetime';
import type { ReactionTally } from '../lib/reactions';
import type { VoicePlayer } from '../lib/voice';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { chatV2Receipt, type ChatV2CallPermissions } from './cells';
import { ChatCallRowV2 } from './ChatCallRowV2';
import { ChatMessageCellV2, type ChatV2Anchor } from './ChatMessageCellV2';
import {
  chatV2ItemType,
  chatV2MessageText,
  type ChatV2ImageBody,
  type ChatV2Row,
} from './rows';
import { useChatKeyboardFrozen } from './useChatKeyboardFrozen';
import { ChatScrollThumbV2, useScrollThumb } from './ChatScrollThumbV2';

interface Props {
  /** Newest first. The list is `inverted`, so index 0 paints at the bottom. */
  rows: readonly ChatV2Row[];
  /**
   * Held by the screen, which owns the scroll POLICY. The list never moves
   * itself: see the note on `ChatScreenV2`'s arrival effect for the rule.
   */
  listRef: React.RefObject<FlashListRef<ChatV2Row> | null>;
  extraContentPadding: SharedValue<number>;
  safeAreaOffset: number;
  readOnly?: boolean;
  /** Names the person in the typing bubble at the foot of the transcript. */
  peerName: string;
  /** Viewport-gated read receipts: the ids of peer messages now on screen. */
  onVisibleMessages: (messageIds: readonly string[]) => void;
  /** Inverted offset from the newest row, for the page-down state. */
  onScrollOffset: (offsetY: number) => void;

  /* ---- what the cells need -------------------------------------------- */
  voicePlayer: VoicePlayer;
  tallies: ReadonlyMap<string, ReactionTally[]>;
  callPermissions: ChatV2CallPermissions;
  /** All five are stable callbacks; the cell memo depends on that. */
  onMessageLongPress: (
    messageId: string,
    mine: boolean,
    anchor: ChatV2Anchor,
  ) => void;
  onSwipeReply: (messageId: string) => void;
  onRetry: (messageId: string) => void;
  onOpenImage: (image: ChatV2ImageBody) => void;
  onCallBack: (medium: 'voice' | 'video') => void;
}

/*
 * "On screen" for read-receipt purposes: 60% of the bubble's own area inside
 * the viewport, not merely brushing an edge. Module-level and never recreated
 * — FlashList's docs say changing `viewabilityConfig` on the fly is not
 * supported.
 */
const VIEWABILITY_CONFIG: ViewabilityConfig = {
  itemVisiblePercentThreshold: 60,
};

const getItemType = (item: ChatV2Row) => chatV2ItemType(item);
const keyExtractor = (item: ChatV2Row) => item.id;

/**
 * The transcript.
 *
 * It owns the list and nothing else: the keyboard geometry is the screen's, the
 * row rules are `rows.ts`'s, and what a bubble may offer is `cells.ts`'s. Every
 * cell it renders is a V2 component. That isolation is why this directory
 * exists, and it is still asserted as a standing ban even though the V1
 * transcript it was isolating from was deleted on 2026-09-19 — see
 * `__tests__/chatV2Cells.test.ts` › "never imports the V1 transcript,
 * composer or keyboard geometry".
 */
export function ChatListV2({
  rows,
  listRef,
  extraContentPadding,
  safeAreaOffset,
  readOnly = false,
  peerName,
  onVisibleMessages,
  onScrollOffset,
  voicePlayer,
  tallies,
  callPermissions,
  onMessageLongPress,
  onSwipeReply,
  onRetry,
  onOpenImage,
  onCallBack,
}: Props) {
  const styles = useStyles(makeStyles);

  // The right-edge scroll thumb; its timing lives with it (useScrollThumb).
  const thumb = useScrollThumb(extraContentPadding);
  const onThumbScroll = thumb.onScroll;
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      onScrollOffset(event.nativeEvent.contentOffset.y);
      onThumbScroll(event);
    },
    [onScrollOffset, onThumbScroll],
  );

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<ChatV2Row>[] }) => {
      const ids: string[] = [];
      for (const token of viewableItems) {
        if (
          token.isViewable &&
          token.item.kind === 'message' &&
          !token.item.mine
        ) {
          ids.push(token.item.message.id);
        }
      }
      if (ids.length > 0) {
        onVisibleMessages(ids);
      }
    },
    [onVisibleMessages],
  );

  const renderBody = useCallback(
    (item: ChatV2Row) => {
      if (item.kind === 'call') {
        return (
          <ChatCallRowV2
            call={item.call}
            permissions={callPermissions}
            onCallBack={onCallBack}
          />
        );
      }

      if (item.kind === 'divider') {
        /*
         * The unread marker, as a rule with a label rather than a pill: it
         * belongs to the SPACE between two messages, and a pill would read as
         * another centred system row of the kind this transcript already has
         * three of.
         */
        return (
          <View style={styles.unread}>
            <View style={styles.unreadRule} />
            <Text
              testID="chat-v2-divider"
              allowFontScaling
              style={styles.unreadLabel}
            >
              Unread messages
            </Text>
            <View style={styles.unreadRule} />
          </View>
        );
      }

      if (item.kind === 'system') {
        return (
          <View testID="chat-v2-system">
            <SystemMessageRow
              text={item.text}
              tone={item.tone}
              icon={item.icon}
              emoji={item.emoji}
            />
          </View>
        );
      }

      return (
        <ChatMessageCellV2
          id={item.id}
          messageId={item.message.id}
          text={chatV2MessageText(item)}
          mine={item.mine}
          first={item.first}
          pending={item.pending}
          failed={item.failed}
          deleted={item.deleted}
          edited={item.message.edited_at !== null}
          stamp={timeOfDay(item.sortAt)}
          receipt={chatV2Receipt(item)}
          voice={item.voice}
          image={item.image}
          // The payload FACTS, beside the payload objects: the objects are
          // rebuilt on every row build, so these are what the memo compares.
          voicePath={item.voice?.path}
          voiceDurationMs={item.voice?.durationMs}
          voicePeaks={item.voice?.peaks}
          imagePath={item.image?.path}
          imageLocalUri={item.image?.localUri}
          imageWidth={item.image?.width}
          imageHeight={item.image?.height}
          quoteAuthor={item.quote?.author}
          quoteBody={item.quote?.body ?? undefined}
          tallies={tallies.get(item.message.id)}
          voicePlayer={voicePlayer}
          // The SURFACE is the screen's decision — only it holds `selfId` and
          // the edit window. This is only whether to arm the recogniser.
          actionable={!readOnly && !item.pending && !item.deleted}
          mutationsDisabled={readOnly}
          onLongPress={onMessageLongPress}
          onSwipeReply={onSwipeReply}
          onRetry={onRetry}
          onOpenImage={onOpenImage}
        />
      );
    },
    [
      callPermissions,
      onCallBack,
      onMessageLongPress,
      onOpenImage,
      onRetry,
      onSwipeReply,
      readOnly,
      styles,
      tallies,
      voicePlayer,
    ],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ChatV2Row>) => (
      <View testID={`chat-v2-row-${item.id}`} style={styles.cell}>
        {/* Above the row's content in the cell, which on an inverted list is
            visually above it too — so the divider labels the day it OPENS
            rather than the day that just ended. Its presence is part of
            `chatV2ItemType`, because it is part of this subtree's height. */}
        {item.opensDay ? (
          <View testID="chat-v2-day">
            <DayDivider iso={item.sortAt} />
          </View>
        ) : null}
        {renderBody(item)}
      </View>
    ),
    [renderBody, styles],
  );

  /*
   * The typing bubble, and it is the list's HEADER because the list is
   * inverted: the header renders at the visual bottom, flush under the newest
   * message, which is where the other person is about to write.
   *
   * It is the ONLY subscriber to the live-activity state, so a peer starting
   * or stopping typing never changes `data` and the transcript performs no
   * layout work for it. `PeerTyping` is a module-level memo, so handing it
   * here does not invalidate the list either.
   */
  const header = useCallback(() => <PeerTyping name={peerName} />, [peerName]);

  const covered = useChatKeyboardFrozen();
  const renderScrollComponent = useCallback(
    (props: ScrollViewProps) => (
      <KeyboardChatScrollView
        {...props}
        inverted
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        keyboardDismissMode="interactive"
        keyboardLiftBehavior="always"
        // A sheet over the chat owns the keyboard it opens (useChatKeyboardFrozen).
        freeze={covered}
        offset={safeAreaOffset}
        extraContentPadding={extraContentPadding}
      />
    ),
    [covered, extraContentPadding, safeAreaOffset],
  );

  return (
    <View style={styles.list}>
      <FlashList
        ref={listRef}
        testID="chat-v2-list"
        style={styles.list}
        // The system bar would sit on the LEFT: Android FlashList inverts by
        // rotating 180°. ChatScrollThumbV2 draws it on the right instead.
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        data={rows}
        inverted
        drawDistance={Dimensions.get('screen').height}
        getItemType={getItemType}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={header}
        renderScrollComponent={renderScrollComponent}
        viewabilityConfig={VIEWABILITY_CONFIG}
        onViewableItemsChanged={onViewableItemsChanged}
        onScroll={onScroll}
        scrollEventThrottle={16}
      />
      <ChatScrollThumbV2 {...thumb.props} />
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    list: {
      flex: 1,
    },
    content: {
      paddingHorizontal: TOKENS.space.sm,
      paddingVertical: TOKENS.space.xs,
    },
    cell: {
      // The gap between turns. `2xs` rather than a full step because grouping
      // already separates runs, and a larger gap makes a run read as singles.
      marginVertical: TOKENS.space['2xs'],
    },
    unread: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingVertical: TOKENS.space.xs,
    },
    unreadRule: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: t.color.border.hairline,
    },
    unreadLabel: {
      ...TOKENS.typography.labelMedium,
      color: t.color.text.secondary,
    },
  });
