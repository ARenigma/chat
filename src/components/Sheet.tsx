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

interface Props {
  visible: boolean;
  title: string;
  body?: string;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
}

/**
 * Bottom sheet, draggable.
 *
 * The drag is the reason this file is longer than a sheet needs to be, and it is
 * the single biggest difference between the app feeling animated and feeling
 * physical. Three properties:
 *
 *   1. **The sheet tracks the finger exactly** while it is down — no easing, no
 *      lag, position equals gesture translation. Anything else feels like rubber.
 *      Upward drag is resisted rather than blocked (a third of the distance), so
 *      pulling the wrong way still responds instead of going dead.
 *   2. **Release hands the velocity to the spring.** `springTo(target, 'smooth',
 *      velocityY)` means a flicked sheet keeps travelling at the speed the finger
 *      left it and a slow release settles gently — from the same code. This is
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
function SheetView({ visible, title, body, onClose, children, testID }: Props) {
  const styles = useStyles(makeStyles);
  const y = useSharedValue(0);
  const [height, setHeight] = useState(0);

  // Re-entry has to reset the offset. Without this, a sheet dismissed by a drag
  // reopens already pushed halfway down, because the shared value survives the
  // Modal unmounting its children.
  useEffect(() => {
    if (visible) {
      y.value = 0;
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

  const scrimStyle = useAnimatedStyle(() => ({
    opacity:
      height > 0
        ? interpolate(y.value, [0, height], [0.55, 0], 'clamp')
        : 0.55,
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}>
      {/**
       * A second GestureHandlerRootView, inside the Modal.
       *
       * This is not belt-and-braces. On Android a React Native Modal is a
       * separate native window with its own root view, so the
       * GestureHandlerRootView at the top of App.tsx does not enclose anything
       * rendered here — the pan is constructed, attached, and then recognised by
       * nobody. Verified on a device by holding a finger on the sheet and
       * dragging: the gesture produced no movement at all, and no warning
       * anywhere. The fix is one wrapper per modal root.
       */}
      <GestureHandlerRootView style={styles.host}>
        <Animated.View pointerEvents="none" style={[styles.scrim, scrimStyle]} />
        <RNPressable style={styles.scrimFill} onPress={onClose} accessibilityLabel="Dismiss" />
        <GestureDetector gesture={pan}>
          <Animated.View testID={testID} onLayout={measure} style={[styles.sheet, sheetStyle]}>
            {/* The grabber is not decoration once the sheet is draggable — it is
                the only thing telling anyone the drag exists. */}
            <View style={styles.grabberRow}>
              <View style={styles.grabber} />
            </View>
            <Text testID="sheet-title" allowFontScaling style={styles.title}>
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
    paddingTop: 14,
    paddingHorizontal: TOKENS.space.xl,
    // Padded well past the home indicator: a sheet that can be dragged needs
    // slack at the bottom, or the last button sits under the gesture area.
    paddingBottom: TOKENS.space['3xl'],
    gap: TOKENS.space.sm,
    // Material 3 specifies 28dp for a bottom sheet's top corners. The 44dp
    // screen radius that was here is for full-screen surfaces, and at that size
    // the sheet read as a card floating rather than a surface rising.
    borderTopLeftRadius: TOKENS.radius.sheet,
    borderTopRightRadius: TOKENS.radius.sheet,
    backgroundColor: t.color.bg.raised,
    ...TOKENS.elevation.sheet,
  },
  grabberRow: {
    alignItems: 'center',
    paddingBottom: TOKENS.space.xs,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.color.border.strong,
  },
  title: {
    ...TOKENS.typography.titleMedium,
    color: t.color.text.primary,
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
