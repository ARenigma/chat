import React, { memo, useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable as RNPressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { GESTURE, springTo } from '../theme/motion';

// Where the sheet starts its entry slide: safely below the tallest sheet, so it
// begins off-screen and springs up into view. Only the last stretch is visible.
const SHEET_ENTRY_OFFSET = 1000;

interface Props {
  visible: boolean;
  title: string;
  body?: string;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
  /**
   * Leading and trailing actions on the title row, so callers stop appending a
   * full-width dismiss Button to the bottom of their stack.
   *
   * Every sheet in the app used to end with one, 'Cancel', 'Close', 'Not now',
   * 'Back', which is the Material bottom-sheet idiom. iOS puts Cancel top-leading
   * and Done top-trailing in the sheet's own bar, which also means the one
   * full-width button left in the stack is unambiguously the sheet's action.
   *
   * Labels are overridable because 'Back' inside a multi-step sheet is a
   * different promise from 'Cancel'.
   */
  onCancel?: () => void;
  cancelLabel?: string;
  onDone?: () => void;
  doneLabel?: string;
}

/**
 * Bottom sheet, draggable.
 *
 * The drag is the reason this file is longer than a sheet needs to be, and it is
 * the single biggest difference between the app feeling animated and feeling
 * physical. Three properties:
 *
 *   1. **The sheet tracks the finger exactly** while it is down, no easing, no
 *      lag, position equals gesture translation. Anything else feels like rubber.
 *      Upward drag is resisted rather than blocked (a third of the distance), so
 *      pulling the wrong way still responds instead of going dead.
 *   2. **Release hands the velocity to the spring.** `springTo(target, 'smooth',
 *      velocityY)` means a flicked sheet keeps travelling at the speed the finger
 *      left it and a slow release settles gently, from the same code. This is
 *      what a duration curve fundamentally cannot do.
 *   3. **Dismissal is distance OR velocity.** Past 28% of its height, or faster
 *      than 800 px/s. Distance alone punishes a confident flick; velocity alone
 *      punishes a slow deliberate push. Both numbers are tokens.
 *
 * The scrim opacity is derived from the same shared value, so the background
 * lightens as you pull the sheet down. That coupling is what makes the gesture
 * feel like it is moving one scene rather than one card.
 *
 * `Modal` is still the host: it owns the hardware back button and the status-bar
 * overlay, both of which a hand-rolled overlay would have to reimplement.
 */
function SheetView({
  visible,
  title,
  body,
  onClose,
  children,
  testID,
  onCancel,
  cancelLabel = 'Cancel',
  onDone,
  doneLabel = 'Done',
}: Props) {
  const styles = useStyles(makeStyles);
  // Initialised OFF-SCREEN, not at rest. A shared value starting at 0 meant the
  // Modal's first painted frame showed the sheet at its resting position — for one
  // frame, mid-fade, so it read as a faint "ghost" of the sheet sitting in place
  // before it slid up (Amit, 2026-08-27, recharge pay tap). Starting off-screen
  // means the first frame is already off-screen and only the spring brings it in.
  const y = useSharedValue(SHEET_ENTRY_OFFSET);
  const [height, setHeight] = useState(0);

  // Entry is driven here, by Reanimated, not by the Modal's own animation. The
  // Modal used `animationType="slide"`, which slides the WHOLE window up — and the
  // full-screen scrim is inside that window, so the dim rose from the bottom as a
  // grey rectangle trailing the sheet ("a grey second layer following it", Amit
  // 2026-08-27). Now the Modal only fades (the scrim fades in place) and the sheet
  // alone slides: start it below the screen and spring to rest. The offset is a
  // constant safely past any sheet height; the exact resting position is 0.
  //
  // Parked back off-screen whenever hidden so the NEXT open's first painted frame
  // is off-screen too — without this, a second open would flash the ghost again
  // because the value had settled at 0 from the previous open.
  useEffect(() => {
    if (visible) {
      y.value = SHEET_ENTRY_OFFSET;
      y.value = springTo(0, 'smooth');
    } else {
      y.value = SHEET_ENTRY_OFFSET;
    }
  }, [visible, y]);

  const measure = useCallback((e: LayoutChangeEvent) => {
    setHeight(e.nativeEvent.layout.height);
  }, []);

  const pan = Gesture.Pan()
    .onChange(e => {
      // Downward is free, upward is resisted. A sheet that cannot move up at all
      // reads as broken; one that moves freely up reads as detached.
      y.value = e.translationY > 0 ? e.translationY : e.translationY / 3;
    })
    .onEnd(e => {
      const far = height > 0 && y.value > height * GESTURE.dismissDistance;
      const fast = e.velocityY > GESTURE.dismissVelocity;
      if (far || fast) {
        // Carry the throw through to the bottom, then close once it is gone.
        y.value = springTo(height > 0 ? height : 600, 'smooth', e.velocityY);
        runOnJS(onClose)();
        return;
      }
      y.value = springTo(0, 'smooth', e.velocityY);
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));

  /**
   * The scrim holds, rather than lightening as the sheet is pulled down.
   *
   * That is a reversal of the coupling this file used to argue for. Fading the dim
   * with the drag made the gesture feel like one scene moving, which was true and
   * was also the wrong model: iOS holds its dim until the dismissal actually
   * resolves, so a drag that snaps back never flashed the page behind it. The
   * interpolation stays in the file for the drag that *does* dismiss, where the
   * scrim following the sheet off-screen is correct, it is simply clamped to a
   * floor so a half-pull does not reveal the transcript.
   *
   * 0.4 rather than 0.55 is a judgement call and not a measured iOS constant.
   */
  const scrimStyle = useAnimatedStyle(() => ({
    opacity:
      height > 0
        ? interpolate(y.value, [0, height * 0.9, height], [0.4, 0.4, 0], 'clamp')
        : 0.4,
  }));

  return (
    <Modal
      visible={visible}
      transparent
      // Fade, not slide: the sheet itself slides via Reanimated (see the entry
      // effect), and a fading window means the scrim dims in place instead of a
      // grey panel rising with the sheet. hardwareAccelerated so the window
      // composites on the GPU and the fade does not lag the slide.
      animationType="fade"
      hardwareAccelerated
      statusBarTranslucent
      onRequestClose={onClose}>
      {/**
       * A second GestureHandlerRootView, inside the Modal.
       *
       * This is not belt-and-braces. On Android a React Native Modal is a
       * separate native window with its own root view, so the
       * GestureHandlerRootView at the top of App.tsx does not enclose anything
       * rendered here, the pan is constructed, attached, and then recognised by
       * nobody. Verified on a device by holding a finger on the sheet and
       * dragging: the gesture produced no movement at all, and no warning
       * anywhere. The fix is one wrapper per modal root.
       */}
      <GestureHandlerRootView style={styles.host}>
        <Animated.View pointerEvents="none" style={[styles.scrim, scrimStyle]} />
        <RNPressable style={styles.scrimFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <GestureDetector gesture={pan}>
          <Animated.View testID={testID} onLayout={measure} style={[styles.sheet, sheetStyle]}>
            {/* The grabber is not decoration once the sheet is draggable, it is
                the only thing telling anyone the drag exists. 36x5 at radius 2.5,
                which is UIKit's, sitting about 5pt from the top edge; it was 40x4
                at radius 2 inset 14, which is Material's. */}
            <View style={styles.grabberRow}>
              <View style={styles.grabber} />
            </View>
            {/*
              * The actions sit on their own row ABOVE the title, not beside it.
              *
              * They used to share a row with it, with the title at `flex: 1`, and
              * on a sheet that has a leading action and no trailing one that
              * rendered as "Not Now  50 Tokens Left" with the two texts touching.
              * Caught on the emulator, where it read as one broken line rather
              * than as a bar and a heading.
              *
              * This is also the iOS structure it was reaching for: a bar carries
              * the actions, and a large title sits underneath it. The row is
              * rendered only when there is an action to put in it, so a sheet with
              * neither does not pay for an empty strip.
              */}
            {onCancel !== undefined || onDone !== undefined ? (
              <View style={styles.barRow}>
                {onCancel !== undefined ? (
                  <RNPressable
                    onPress={onCancel}
                    testID="sheet-cancel"
                    accessibilityRole="button"
                    accessibilityLabel={cancelLabel}
                    hitSlop={12}>
                    <Text allowFontScaling style={styles.action}>
                      {cancelLabel}
                    </Text>
                  </RNPressable>
                ) : null}
                <View style={styles.barSpacer} />
                {onDone !== undefined ? (
                  <RNPressable
                    onPress={onDone}
                    testID="sheet-done"
                    accessibilityRole="button"
                    accessibilityLabel={doneLabel}
                    hitSlop={12}>
                    <Text allowFontScaling style={styles.action}>
                      {doneLabel}
                    </Text>
                  </RNPressable>
                ) : null}
              </View>
            ) : null}
            <Text
              testID="sheet-title"
              allowFontScaling
              numberOfLines={2}
              style={styles.title}>
              {title}
            </Text>
            {body ? (
              <Text allowFontScaling style={styles.body}>
                {body}
              </Text>
            ) : null}
            <View style={styles.actions}>{children}</View>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

export const Sheet = memo(SheetView);

const makeStyles = (t: Theme) => StyleSheet.create({
  host: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
  },
  scrimFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    paddingTop: 5,
    paddingHorizontal: TOKENS.space.xl,
    // Padded well past the home indicator: a sheet that can be dragged needs
    // slack at the bottom, or the last button sits under the gesture area.
    paddingBottom: TOKENS.space['3xl'],
    gap: TOKENS.space.sm,
    // `radius.sheet` is 10 now, which is UISheetPresentationController's default
    // corner. It was 28, Material 3's specified bottom-sheet corner, and at that
    // size the sheet read as a card floating rather than a surface rising, which
    // is the same complaint that took it down from the 44dp screen radius before.
    borderTopLeftRadius: TOKENS.radius.sheet,
    borderTopRightRadius: TOKENS.radius.sheet,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.raised,
    // No elevation. On Android the elevation shadow is a separate compositing pass
    // that lags a `translateY`, so it trailed the sheet as a grey ghost during the
    // slide. The dark scrim already separates the sheet from the page; a shadow on
    // top of a scrim is invisible anyway.
  },
  grabberRow: {
    alignItems: 'center',
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: t.color.border.strong,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: TOKENS.space.xs,
  },
  // Pushes a lone trailing action to the edge and a lone leading action away
  // from it, without either needing to know whether the other exists.
  barSpacer: {
    flex: 1,
  },
  title: {
    ...TOKENS.typography.titleMedium,
    color: t.color.text.primary,
    paddingTop: TOKENS.space['2xs'],
  },
  // Plain tinted text, not a button. An iOS sheet's bar actions have no fill and
  // no border; the tint is what says they are tappable.
  action: {
    ...TOKENS.typography.bodyLarge,
    color: t.color.text.accent,
  },
  body: {
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.secondary,
  },
  actions: {
    paddingTop: TOKENS.space.sm,
    gap: TOKENS.space.sm,
  },
});
