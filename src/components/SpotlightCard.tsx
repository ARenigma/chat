import React, { memo, useEffect } from 'react';
import {
  Image,
  Modal,
  PixelRatio,
  Pressable as RNPressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { LIGHT, TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { fadeTo, springTo } from '../theme/motion';
import { sizedStorageImageUri } from '../lib/storageImage';
import { initialOf } from '../lib/display';
import { TactileCTA } from './TactileCTA';

interface Props {
  visible: boolean;
  /** The spotlighted provider's display name. */
  name: string;
  /** Their photo. When absent, a coral field with the initial stands in. */
  avatarUri?: string | null;
  /** Scrim tap / "Not now": dismiss without opening a chat. */
  onClose: () => void;
  /** The primary invitation: open this provider's chat. */
  onChat: () => void;
  testID?: string;
}

/** Where the card starts its entry, safely below the tallest card. */
const ENTRY_OFFSET = 900;

/**
 * The home "spotlight" — a full-image-bleed card that greets a first-time member
 * with one person, on first visit, after the tutorial (the race is gated in
 * HomeScreen so the tour always finishes first).
 *
 * This is deliberately NOT the bottom Sheet the POTD used to borrow. A sheet is
 * chrome-first: a grey panel with a title and an avatar chip. The product ask
 * (user 2026-08-31) is the opposite — the *person* is the card. So the photo
 * bleeds edge to edge, a bottom gradient carries the copy, and the CTA is the
 * springy TactileCTA (Option B), because this is the single most invitational
 * moment in the app and the one place a playful pop earns its keep.
 *
 * `Modal` hosts it so the hardware back button and status-bar overlay are the
 * platform's, not hand-rolled. Entry is a Reanimated spring on the card alone
 * with the scrim fading in place (the same split the Sheet uses, for the same
 * reason: a sliding window drags the scrim up as a grey rectangle).
 */
function SpotlightCardView({ visible, name, avatarUri, onClose, onChat, testID }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const y = useSharedValue(ENTRY_OFFSET);
  const scrim = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      y.value = ENTRY_OFFSET;
      y.value = springTo(0, 'smooth');
      scrim.value = fadeTo(1);
    } else {
      y.value = ENTRY_OFFSET;
      scrim.value = 0;
    }
  }, [visible, y, scrim]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value * 0.5 }));

  // Portrait card, capped so it never eats the whole window. Width leaves a
  // generous gutter so the card reads as an object floating over the dim, not a
  // second screen.
  const cardW = Math.min(windowWidth - TOKENS.space['2xl'] * 2, 360);
  const cardH = Math.min(cardW * 1.32, windowHeight * 0.66);

  // A warm coral field is the fallback when there is no photo, matching the
  // featured hero rather than a grey avatar chip.
  const gradient = `linear-gradient(150deg, ${theme.color.bg.accent} 0%, ${theme.color.bg.accentStrong} 100%)`;
  // Bottom scrim so white copy holds over any photo. Transparent at the top third.
  const copyScrim =
    'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.72) 100%)';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      hardwareAccelerated
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.host}>
        <Animated.View pointerEvents="none" style={[styles.scrim, scrimStyle]} />
        <RNPressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <Animated.View
          testID={testID}
          style={[styles.card, { width: cardW, height: cardH }, cardStyle]}>
          {avatarUri ? (
            <Image
              source={{
                uri: sizedStorageImageUri(avatarUri, cardW, cardH, PixelRatio.get()),
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

          {/* Copy gradient, then the greeting + name over it. */}
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { experimental_backgroundImage: copyScrim }]}
          />
          <View style={styles.copy}>
            <Text allowFontScaling style={styles.greeting}>
              hey i am here, lets talk!
            </Text>
            <Text allowFontScaling numberOfLines={1} style={styles.name}>
              {name}
            </Text>
            <TactileCTA
              onPress={onChat}
              accessibilityLabel={`Chat with ${name}`}
              rippleColor={LIGHT.color.text.onAccent}
              emoji="👋"
              emojiStyle={styles.ctaEmoji}
              style={styles.cta}
              testID="spotlight-chat">
              <Text allowFontScaling style={styles.ctaLabel}>
                Say hi
              </Text>
            </TactileCTA>
          </View>
        </Animated.View>

        <RNPressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Not now"
          testID="spotlight-dismiss"
          style={styles.notNowHit}>
          <Text allowFontScaling style={styles.notNow}>
            Not now
          </Text>
        </RNPressable>
      </View>
    </Modal>
  );
}

export const SpotlightCard = memo(SpotlightCardView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    host: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: t.color.bg.inverse,
    },
    card: {
      borderRadius: TOKENS.radius.xl,
      borderCurve: 'continuous',
      overflow: 'hidden',
      backgroundColor: t.color.bg.accentStrong,
      // A soft lift so the card sits above the dim as an object.
      elevation: 8,
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
    greeting: {
      ...TOKENS.typography.displaySmall,
      color: LIGHT.color.text.onAccent,
    },
    name: {
      ...TOKENS.typography.subhead,
      color: 'rgba(255,255,255,0.88)',
    },
    cta: {
      marginTop: TOKENS.space.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TOKENS.space.xs,
      alignSelf: 'flex-start',
      minHeight: 48,
      paddingHorizontal: TOKENS.space.xl,
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
      position: 'absolute',
      bottom: TOKENS.space.xl,
      minHeight: 48,
      paddingHorizontal: TOKENS.space.xl,
      alignItems: 'center',
      justifyContent: 'center',
    },
    notNow: {
      ...TOKENS.typography.labelMedium,
      color: 'rgba(255,255,255,0.9)',
    },
  });
