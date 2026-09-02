import React, { memo, useCallback, useEffect, useRef } from 'react';
import {
  Image,
  Modal,
  PixelRatio,
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
import { LIGHT, TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { GESTURE, springTo } from '../theme/motion';
import { sizedStorageImageUri } from '../lib/storageImage';
import { initialOf } from '../lib/display';
import { TactileCTA } from './TactileCTA';
import { Pressable } from './Pressable';

interface Props {
  visible: boolean;
  /** The spotlighted provider's display name. */
  name: string;
  /** Their photo. When absent, a coral field with the initial stands in. */
  avatarUri?: string | null;
  /** Whether the spotlighted person is available now — shows the "Online" badge. */
  online?: boolean;
  /** Scrim tap / "Not now": dismiss without opening a chat. */
  onClose: () => void;
  /** The primary invitation: open this provider's chat. */
  onChat: () => void;
  testID?: string;
}

/**
 * Where the sheet starts its entry, safely below the tallest sheet so the
 * first painted frame is already off-screen and only the spring brings it in.
 */
const SHEET_ENTRY_OFFSET = 1000;

/**
 * The home "spotlight" — a full-image-bleed M3 bottom sheet that greets a
 * first-time member with one person, on first visit, after the tutorial.
 *
 * Converted from a centred floating card to a true bottom-anchored M3 modal
 * sheet, so the hardware back button, the scrim tap and the drag gesture are all
 * the platform's, not hand-rolled. Entry is a Reanimated spring on the card
 * alone with the scrim fading in place — the split Sheet.tsx settled on, for
 * the same reason: a sliding window drags the scrim up as a grey rectangle.
 *
 * The image bleeds edge-to-edge inside the sheet. A gradient bottom-scrim
 * carries the copy over any photo. The drag handle sits above the image so the
 * sheet reads as a physical surface rather than a floating card.
 *
 * GestureHandlerRootView is required inside the Modal: on Android a React Native
 * Modal is a separate native window whose root view is not the one at App.tsx,
 * so the pan gesture is constructed and then recognised by nobody without it.
 * https://m3.material.io/components/bottom-sheets/overview
 */
function SpotlightCardView({ visible, name, avatarUri, online = false, onClose, onChat, testID }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  // Sheet height: 68% of window, enough for the photo to breathe.
  const sheetH = windowHeight * 0.68;
  // Gesture nav / 3-button bar: keep copy above the system inset.
  const sheetBottomPad = Math.max(insets.bottom, TOKENS.space.md) + TOKENS.space.md;

  const y = useSharedValue(SHEET_ENTRY_OFFSET);
  // Gesture worklets must read layout through a shared value. React state is
  // captured when Gesture.Pan is built and can stay null on Android even after
  // onLayout, which would make slow distance-based dismissal impossible.
  const sheetHeight = useSharedValue(0);
  const openedAt = useRef(0);

  useEffect(() => {
    if (visible) {
      openedAt.current = Date.now();
      y.value = SHEET_ENTRY_OFFSET;
      y.value = springTo(0, 'smooth');
    } else {
      y.value = SHEET_ENTRY_OFFSET;
    }
  }, [visible, y]);

  const measure = useCallback((e: LayoutChangeEvent) => {
    sheetHeight.value = e.nativeEvent.layout.height;
  }, [sheetHeight]);

  const pan = Gesture.Pan()
    .onChange(e => {
      // Downward is free, upward is resisted.
      y.value = e.translationY > 0 ? e.translationY : e.translationY / 3;
    })
    .onEnd(e => {
      const measuredHeight = sheetHeight.value;
      const far = measuredHeight > 0 && y.value > measuredHeight * GESTURE.dismissDistance;
      const fast = e.velocityY > GESTURE.dismissVelocity;
      if (far || fast) {
        y.value = springTo(measuredHeight > 0 ? measuredHeight : 600, 'smooth', e.velocityY);
        runOnJS(onClose)();
        return;
      }
      y.value = springTo(0, 'smooth', e.velocityY);
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));

  /**
   * Scrim holds steady while a snap-back drag is in progress, same as Sheet.tsx:
   * fading with a dismissal that returns snaps the scrim open again, which reads
   * as the world flickering rather than as a gesture recovering.
   */
  const scrimStyle = useAnimatedStyle(() => ({
    opacity:
      sheetHeight.value <= 0
        ? 0
        : interpolate(
            y.value,
            [0, sheetHeight.value * 0.9, sheetHeight.value],
            [0.4, 0.4, 0],
            'clamp',
          ),
  }));

  // A warm coral field is the fallback when there is no photo.
  const gradient = `linear-gradient(150deg, ${theme.color.bg.accent} 0%, ${theme.color.bg.accentStrong} 100%)`;
  // Bottom scrim so white copy holds over any photo.
  const copyScrim =
    'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.76) 100%)';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      hardwareAccelerated
      statusBarTranslucent
      onRequestClose={onClose}>
      {/**
       * A second GestureHandlerRootView inside the Modal — required on Android
       * where each Modal is a separate native window and the pan attached to the
       * top-level root view does not recognise any gesture here.
       */}
      <GestureHandlerRootView style={styles.host}>
        <Animated.View pointerEvents="none" style={[styles.scrim, scrimStyle]} />
        <RNPressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <GestureDetector gesture={pan}>
          <Animated.View
            testID={testID}
            onLayout={measure}
            style={[styles.card, { height: sheetH }, sheetStyle]}>
            {/* Full-bleed image or warm-field fallback */}
            {avatarUri ? (
              <Image
                source={{
                  uri: sizedStorageImageUri(avatarUri, windowWidth, sheetH, PixelRatio.get()),
                }}
                resizeMode="cover"
                style={StyleSheet.absoluteFill}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, { experimental_backgroundImage: gradient }]}>
                <View style={styles.initialWrap}>
                  <Text allowFontScaling={false} style={styles.initial}>
                    {initialOf(name)}
                  </Text>
                </View>
              </View>
            )}

            {/* Copy gradient over any photo — transparent at top, dark at bottom. */}
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { experimental_backgroundImage: copyScrim }]}
            />

            {/* M3 drag handle: 32–36×4dp pill, 48dp touch row. */}
            <View style={styles.grabberRow}>
              <View style={styles.grabber} />
            </View>

            {/* Greeting, name and primary CTA, plus the "Not now" escape link. */}
            <View style={[styles.copy, { paddingBottom: sheetBottomPad }]}>
              {online ? (
                <View style={styles.onlineRow}>
                  <View style={styles.onlineBadge} testID="spotlight-online">
                    <View style={styles.onlineDot} />
                    <Text allowFontScaling style={styles.onlineLabel}>
                      Online now
                    </Text>
                  </View>
                </View>
              ) : null}
              <Text allowFontScaling style={styles.greeting}>
                hey i am here, lets talk!
              </Text>
              <Text allowFontScaling numberOfLines={1} style={styles.name}>
                {name}
              </Text>
              {/* Two actions side by side, equal width: M3 puts a dialog's
                  actions on one row and only stacks them when the labels no
                  longer fit. https://m3.material.io/components/dialogs/specs */}
              <View style={styles.actions}>
                <TactileCTA
                  onPress={onChat}
                  accessibilityLabel={`Chat with ${name}`}
                  rippleColor={LIGHT.color.text.onAccent}
                  emoji="👋"
                  emojiStyle={styles.ctaEmoji}
                  containerStyle={styles.slot}
                  style={styles.cta}
                  testID="spotlight-chat">
                  <Text allowFontScaling numberOfLines={1} style={styles.ctaLabel}>
                    Say hi
                  </Text>
                </TactileCTA>
                <Pressable
                  onPress={onClose}
                  accessibilityLabel="Not now"
                  testID="spotlight-dismiss"
                  style={styles.notNowHit}
                  press="button"
                  onColor={LIGHT.color.text.onAccent}>
                  <Text allowFontScaling numberOfLines={1} style={styles.notNow}>
                    Not now
                  </Text>
                </Pressable>
              </View>
            </View>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

export const SpotlightCard = memo(SpotlightCardView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    host: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    scrim: {
      ...StyleSheet.absoluteFill,
      // M3 scrim is a stable dark role, not inverseSurface.
      // https://m3.material.io/styles/elevation/applying-elevation
      backgroundColor: t.color.bg.scrim,
    },
    card: {
      width: '100%',
      // M3 Paper: 28dp top corners per bottom-sheets spec.
      // https://m3.material.io/components/bottom-sheets/overview
      borderTopLeftRadius: TOKENS.radius.sheet,
      borderTopRightRadius: TOKENS.radius.sheet,
      borderCurve: 'continuous',
      overflow: 'hidden',
      backgroundColor: t.color.bg.accentStrong,
      // No elevation shadow: same reasoning as Sheet.tsx — the shadow lags
      // a translateY on Android as a trailing grey ghost; the scrim already
      // separates the sheet from the page behind it.
    },
    grabberRow: {
      alignItems: 'center',
      // 48dp minimum touch area for the drag affordance.
      paddingVertical: (TOKENS.interaction.minTarget - 4) / 2,
      // Sits above the image; no background so the photo shows through.
      zIndex: 2,
    },
    grabber: {
      width: 36,
      height: 4,
      borderRadius: 2,
      // White on a dark photo; semi-transparent so a light region still shows it.
      backgroundColor: 'rgba(255,255,255,0.55)',
    },
    initialWrap: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    initial: {
      fontFamily: TOKENS.typography.displayLarge.fontFamily,
      fontSize: 88,
      lineHeight: 96,
      color: LIGHT.color.text.onAccent,
    },
    copy: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      padding: TOKENS.space.xl,
      gap: TOKENS.space.xs,
    },
    // Row wrapper so the badge sizes to its content (a row child does not
    // stretch horizontally) instead of needing alignSelf on the badge itself.
    onlineRow: {
      flexDirection: 'row',
    },
    // Green-dot "Online now" badge, sitting on the dark copy scrim above the
    // greeting. Same presence colour as the avatar dots elsewhere.
    onlineBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
      paddingHorizontal: TOKENS.space.sm,
      paddingVertical: 5,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: 'rgba(0,0,0,0.38)',
      marginBottom: TOKENS.space['2xs'],
    },
    onlineDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: t.color.state.available,
    },
    onlineLabel: {
      ...TOKENS.typography.labelSmall,
      color: '#FFFFFF',
    },
    greeting: {
      ...TOKENS.typography.displaySmall,
      color: LIGHT.color.text.onAccent,
    },
    name: {
      ...TOKENS.typography.subhead,
      color: 'rgba(255,255,255,0.88)',
    },
    actions: {
      marginTop: TOKENS.space.sm,
      flexDirection: 'row',
      gap: TOKENS.space.sm,
    },
    // Layout lives on the pressable root; the fill lives on the inner surface.
    slot: {
      flex: 1,
    },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TOKENS.space.xs,
      minHeight: 48,
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.sm,
      backgroundColor: t.color.bg.accent,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
    },
    ctaEmoji: {
      fontSize: 18,
    },
    ctaLabel: {
      ...TOKENS.typography.labelMedium,
      color: LIGHT.color.text.onAccent,
    },
    notNowHit: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space.md,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      // The secondary of the pair sits on a photo, so it is a glass outline
      // rather than a second fill: M3's outlined button, tinted for the surface
      // it floats on. https://m3.material.io/components/buttons/specs
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.55)',
      backgroundColor: 'rgba(255,255,255,0.14)',
    },
    notNow: {
      ...TOKENS.typography.labelMedium,
      color: 'rgba(255,255,255,0.9)',
    },
  });
