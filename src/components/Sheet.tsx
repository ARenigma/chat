import React, { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable as RNPressable,
  StyleSheet,
  Text,
  useWindowDimensions,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { GESTURE, INTERACTION, sheetIn, sheetOut } from '../theme/motion';
import { setSheetBackdropBlur } from '../lib/windowChrome';
import { trackSheetClosed } from '../lib/perfTelemetry';
import { Pressable } from './Pressable';

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
  /** Sticky footer outside scrollable children — primary CTAs live here. */
  footer?: ReactNode;
  /** `large` caps sheet height at ~90% of the window. */
  detents?: 'auto' | 'large';
  /** When false, scrim tap does not dismiss (blocking gates). Default true. */
  dismissOnScrim?: boolean;
}

/**
 * Material 3 Paper bottom sheet — drag handle, 28dp top corners, dim scrim,
 * optional sticky footer for CTAs.
 * https://m3.material.io/components/bottom-sheets/overview
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
 * lightens as you pull the sheet down on dismiss. That coupling is what makes
 * the gesture feel like it is moving one scene rather than one card.
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
  footer,
  detents = 'auto',
  dismissOnScrim = true,
}: Props) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // Always cap so a tall form cannot become a full-page sheet. `large` is the
  // 90% Material expanded detent; `auto` wraps content and only uses the cap
  // when the stack would otherwise overflow.
  const sheetMaxHeight = windowHeight * (detents === 'large' ? 0.9 : 0.72);
  // Gesture nav / 3-button bar: keep sticky CTAs above the system inset.
  // Fixed `3xl` alone clipped the Leave button on ConfirmDialog (S22 Ultra).
  const sheetBottomPad = Math.max(insets.bottom, TOKENS.space.md) + TOKENS.space.md;
  // Initialised OFF-SCREEN, not at rest. A shared value starting at 0 meant the
  // Modal's first painted frame showed the sheet at its resting position — for one
  // frame, mid-fade, so it read as a faint "ghost" of the sheet sitting in place
  // before it slid up (Amit, 2026-08-27, recharge pay tap). Starting off-screen
  // means the first frame is already off-screen and only the spring brings it in.
  const y = useSharedValue(SHEET_ENTRY_OFFSET);
  /*
   * The measured height lives on the UI thread, not in React state.
   *
   * The pan's `onEnd` needs the sheet height to decide a distance dismissal, and
   * reading it from a `useState` value captured when the gesture worklet was
   * built is a latent Android bug: the first drag after a resize (rotation, IME,
   * a sheet whose content grew) tests against a stale height. A shared value is
   * always the current one on the thread the gesture runs on. `measured` (state)
   * only gates the scrim's first paint, which is a render concern, not a
   * gesture one.
   */
  const sheetHeight = useSharedValue(0);
  const [measured, setMeasured] = useState(false);
  const openedAt = useRef(0);

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
    if (!visible) return;
    setSheetBackdropBlur(true);
    return () => setSheetBackdropBlur(false);
  }, [visible]);

  useEffect(() => {
    if (visible) {
      openedAt.current = Date.now();
      y.value = SHEET_ENTRY_OFFSET;
      // M3 sheet spring (spatialDefault). Position only — the sheet body never
      // fades; the scrim carries the dim.
      y.value = sheetIn();
    } else {
      if (openedAt.current > 0) {
        trackSheetClosed(testID ?? 'sheet', openedAt.current);
        openedAt.current = 0;
      }
      y.value = SHEET_ENTRY_OFFSET;
    }
  }, [visible, y, testID]);

  const measure = useCallback(
    (e: LayoutChangeEvent) => {
      sheetHeight.value = e.nativeEvent.layout.height;
      setMeasured(true);
    },
    [sheetHeight],
  );

  const pan = Gesture.Pan()
    .onChange(e => {
      // Downward is free, upward is resisted. A sheet that cannot move up at all
      // reads as broken; one that moves freely up reads as detached.
      y.value = e.translationY > 0 ? e.translationY : e.translationY / 3;
    })
    .onEnd(e => {
      const measuredHeight = sheetHeight.value;
      const far = measuredHeight > 0 && y.value > measuredHeight * GESTURE.dismissDistance;
      const fast = e.velocityY > GESTURE.dismissVelocity;
      if (far || fast) {
        // Carry the throw through to the bottom, then close once it is gone.
        y.value = sheetOut(measuredHeight > 0 ? measuredHeight : 600, e.velocityY);
        runOnJS(onClose)();
        return;
      }
      y.value = sheetIn(e.velocityY);
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
  const scrimStyle = useAnimatedStyle(() => {
    const h = sheetHeight.value;
    const base = INTERACTION.scrim;
    // Unmeasured: 0, so the Modal's own fade brings the dim in rather than a pop.
    // Measured: hold at the token opacity, falling to 0 only as a dismiss drag
    // carries the sheet off the bottom.
    return {
      opacity: !measured ? 0 : h > 0 ? interpolate(y.value, [0, h * 0.9, h], [base, base, 0], 'clamp') : base,
    };
  });

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
        <RNPressable
          style={styles.scrimFill}
          onPress={dismissOnScrim ? onClose : undefined}
          accessibilityLabel="Dismiss"
          accessibilityState={{ disabled: !dismissOnScrim }}
        />
        <GestureDetector gesture={pan}>
          {/*
           * W5#5 — `renderToHardwareTextureAndroid` NOT added to this container,
           * and that is a recorded decision.
           *
           * The sheet slides in/out with a Reanimated translateY. During that
           * animation the subtree is visually static, so a hardware texture would
           * let the compositor handle the slide as a matrix multiply rather than
           * re-drawing children — the right use case on paper.
           *
           * Two problems prevent doing it correctly:
           *
           *   1. "Never left on." A texture that persists while the sheet is open
           *      and settled pays real GPU memory for no benefit. Toggling requires
           *      knowing when `y.value` has settled at 0 — i.e. an `onSettled`
           *      callback from the spring/timing animation — which would add
           *      complexity to every animation path in this file.
           *
           *   2. No real-hardware measurement yet. `scripts/framestats.mjs` exists
           *      but has not been run against sheet open/close on the S22. Without
           *      a number that shows frames over budget during the 400 ms slide,
           *      adding a GPU memory allocation is speculative.
           *
           * Revisit after a `framestats.mjs` run on the S22 confirms sheet open/
           * close frames exceed the 8.33 ms budget.
           * https://reactnative.dev/docs/view-style-props#rendertohardwaretextureandroid
           */}
          <Animated.View
            testID={testID}
            onLayout={measure}
            style={[
              styles.sheet,
              sheetStyle,
              { paddingBottom: sheetBottomPad },
              { maxHeight: sheetMaxHeight },
            ]}>
            {/* M3 drag handle — 32–40×4dp pill, 48dp min touch via grabberRow padding.
                https://m3.material.io/components/bottom-sheets/overview */}
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
                  <Pressable
                    onPress={onCancel}
                    testID="sheet-cancel"
                    accessibilityLabel={cancelLabel}
                    press="button">
                    <Text allowFontScaling style={styles.action}>
                      {cancelLabel}
                    </Text>
                  </Pressable>
                ) : null}
                <View style={styles.barSpacer} />
                {onDone !== undefined ? (
                  <Pressable
                    onPress={onDone}
                    testID="sheet-done"
                    accessibilityLabel={doneLabel}
                    press="button">
                    <Text allowFontScaling style={styles.action}>
                      {doneLabel}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLargeEmphasized}
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
            <View style={[styles.actions, styles.actionsScroll]}>{children}</View>
            {footer !== undefined ? (
              <View style={styles.footer}>{footer}</View>
            ) : null}
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
    // M3 scrim is a stable dark role, not inverseSurface (which turns light in
    // dark mode). https://m3.material.io/styles/elevation/applying-elevation
    backgroundColor: t.color.bg.scrim,
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
    // Bottom pad applied at runtime from safe-area insets (see sheetBottomPad).
    // 8dp between title block and the first control — Material layout spacing
    // (dense related content), not a second `sm` padded onto actions.
    // https://m3.material.io/foundations/layout/understanding-layout/spacing
    gap: TOKENS.space.xs,
    // M3 Paper: 28dp top corners per bottom-sheets spec.
    // https://m3.material.io/components/bottom-sheets/overview
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
    // 48dp min touch target for the drag affordance.
    paddingVertical: (TOKENS.interaction.minTarget - 4) / 2,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
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
    ...TOKENS.typography.titleLargeEmphasized,
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
    ...TOKENS.typography.bodyLarge,
    color: t.color.text.secondary,
  },
  actions: {
    // No extra top pad: sheet `gap` already separates title/body from children.
    // The old `sm` here stacked with sheet gap and read as a void under "Payment".
    paddingTop: 0,
    gap: TOKENS.space.sm,
  },
  actionsScroll: {
    flexShrink: 1,
    minHeight: 0,
  },
  footer: {
    gap: TOKENS.space.sm,
    paddingTop: TOKENS.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.color.border.hairline,
  },
});
