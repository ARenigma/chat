import React, { useMemo } from 'react';
import {
  Dimensions,
  Modal,
  Pressable as RNPressable,
  StyleSheet,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperMenu, type PaperMenuItem } from '../components/PaperMenu';
import { ReactionStrip } from '../components/ReactionStrip';
import type { ReactionEmoji } from '../lib/database.types';
import { chatV2OwnerMenuItems, type ChatV2MessageActions } from './cells';
import type { ChatV2Anchor } from './ChatMessageCellV2';

/** Between the anchored surface and the bubble it belongs to. */
const GAP = 8;
/** Keep the surface this far from the window edges. */
const EDGE = 12;
/**
 * Strip-height estimate, used only to choose above-vs-below. It is an estimate
 * because the decision is made before the Modal has laid anything out, and the
 * alternative is showing the strip in the wrong place for a frame.
 */
const STRIP_H_EST = 56;

export interface ChatV2ActionRequest {
  messageId: string;
  mine: boolean;
  anchor: ChatV2Anchor;
  actions: ChatV2MessageActions;
  chosenReaction: ReactionEmoji | null;
}

interface Props {
  request: ChatV2ActionRequest | null;
  onClose: () => void;
  onReact: (messageId: string, emoji: ReactionEmoji) => void;
  onReply: (messageId: string) => void;
  onReport: (messageId: string) => void;
  onEdit: (messageId: string) => void;
  onDelete: (messageId: string) => void;
}

/**
 * What a long press opens, anchored to the bubble that was pressed.
 *
 * TWO SURFACES, NOT ONE, and the split is the policy rather than a layout
 * choice. A peer message gets the thin reaction bar — six emoji, reply, report.
 * My own message gets a vertical menu with Edit and Delete and NO reaction
 * picker at all: a self-reaction in a two-person thread is a person agreeing
 * with themselves, and the two things an author can do to their own words are
 * not "quick" actions that belong in a bar.
 *
 * Hosted by the SCREEN rather than by the cell. A Modal declared inside a
 * FlashList cell unmounts with the cell when the list recycles it, and the
 * transcript recycles while a session is delivering messages.
 */
export function ChatActionsV2({
  request,
  onClose,
  onReact,
  onReply,
  onReport,
  onEdit,
  onDelete,
}: Props) {
  /*
   * The owner menu, derived from the CURRENT request and from nothing else.
   *
   * An earlier pass kept `PaperMenu` resident and held the last request so
   * `menuOut`/`scrimOut` would have something to exit from. It was a bad
   * trade twice over. React Native's Modal is a native Dialog: setting
   * `visible={false}` tears the window down with its children still inside
   * it, so a Reanimated `exiting` gets no frames on Android whether the
   * component above it is resident or not — the close snaps either way, and
   * that is accepted here. What residency DID buy was a retained ANCHOR: a
   * rect belonging to a bubble that had already been dismissed, ready to
   * place the card against the wrong message for a frame if the next long
   * press arrived before the state settled. Correctness governs. A close that
   * snaps is a worse animation; a menu that flashes at the wrong bubble is a
   * wrong menu.
   * https://reactnative.dev/docs/modal
   */
  const menu = request?.actions.surface === 'menu' ? request : null;

  /*
   * Edit first, Delete last and destructive, with a rule between them. The
   * order, the danger flag and the rule's condition are `chatV2OwnerMenuItems`'
   * — values a test can read — and this only binds each one to its handler.
   */
  const items = useMemo<PaperMenuItem[]>(() => {
    if (menu === null) {
      return [];
    }
    const messageId = menu.messageId;
    return chatV2OwnerMenuItems(menu.actions).map(item => ({
      ...item,
      onPress: () =>
        item.key === 'edit' ? onEdit(messageId) : onDelete(messageId),
    }));
  }, [menu, onEdit, onDelete]);

  /*
   * Above the bubble when there is room, below it otherwise; aligned to the
   * speaker's side and clamped to the window edges.
   *
   * The window is READ here rather than subscribed to with
   * `useWindowDimensions`. The screen renders this component whether or not
   * anything is open, and the manifest resizes the window every time the IME
   * does — so a subscription would re-render a component that draws nothing on
   * every keyboard event. A window that resizes WHILE a surface is open is not
   * a case that exists: both are modal and take the keyboard down with them.
   * https://reactnative.dev/docs/dimensions
   */
  const placement = useMemo(() => {
    if (request === null) {
      return null;
    }
    const { width: winW, height: winH } = Dimensions.get('window');
    const { anchor } = request;
    const above = anchor.y - GAP - STRIP_H_EST >= EDGE;
    const box: {
      left?: number;
      right?: number;
      top?: number;
      bottom?: number;
    } = above
      ? { bottom: winH - anchor.y + GAP }
      : { top: anchor.y + anchor.height + GAP };
    if (request.mine) {
      box.right = Math.max(EDGE, winW - (anchor.x + anchor.width));
    } else {
      box.left = Math.max(EDGE, anchor.x);
    }
    return box;
  }, [request]);

  const strip =
    request !== null &&
    request.actions.surface === 'reactions' &&
    placement !== null
      ? request
      : null;

  return (
    <>
      {/*
       * Mounted only while there is a menu to show. `surface` is one value, so
       * the two surfaces cannot be open at once and neither can stack on the
       * other.
       */}
      {menu === null ? null : (
        <PaperMenu
          visible
          items={items}
          anchor={menu.anchor}
          onClose={onClose}
          testID="chat-v2-own-menu"
        />
      )}
      {strip === null ? null : (
        <Modal
          visible
          transparent
          // The strip owns its own entrance (an overshoot out of the bubble's
          // corner). A Modal fade here would compound with it into a curve
          // nobody specified.
          animationType="none"
          hardwareAccelerated
          statusBarTranslucent
          onRequestClose={onClose}
        >
          {/*
           * A Modal is a separate native window, outside the root view the app
           * wraps in `GestureHandlerRootView` — so RNGH's touch interception
           * does not reach inside it. The strip's controls are `Pressable`,
           * which is gesture-driven, and without a root of its own here they
           * receive nothing at all.
           * https://docs.swmansion.com/react-native-gesture-handler/docs/installation
           */}
          <GestureHandlerRootView style={styles.fill}>
            {/* A transparent full-screen backdrop, so a tap in free space
                dismisses — an inline strip has nothing behind it to catch one. */}
            <RNPressable
              testID="chat-v2-actions-scrim"
              style={StyleSheet.absoluteFill}
              accessibilityLabel="Dismiss message actions"
              onPress={onClose}
            />
            <View
              testID="chat-v2-actions-anchor"
              style={[styles.anchor, placement]}
              pointerEvents="box-none"
            >
              <ReactionStrip
                chosen={strip.chosenReaction}
                mine={strip.mine}
                onReact={emoji => {
                  onClose();
                  onReact(strip.messageId, emoji);
                }}
                onReply={() => {
                  onClose();
                  onReply(strip.messageId);
                }}
                onReport={
                  strip.actions.report
                    ? () => {
                        onClose();
                        onReport(strip.messageId);
                      }
                    : undefined
                }
              />
            </View>
          </GestureHandlerRootView>
        </Modal>
      )}
    </>
  );
}

/**
 * Not themed, so it is built once at module scope rather than per render: the
 * only two rules here are a flex fill and an absolute anchor, and neither has a
 * colour to take from the theme.
 */
const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  anchor: {
    position: 'absolute',
  },
});
