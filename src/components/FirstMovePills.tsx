import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { TactileCTA } from './TactileCTA';

interface Props {
  onSayHi: () => void;
  onSendSticker: () => void;
}

/**
 * Soft first-move pills above the composer — equal white capsules on a blush
 * strip, matching the dating-app first-message pattern (wave + Send Sticker /
 * Say Hi!).
 *
 * The strip uses `bg.accentTint`, not full accent: coral stays for actions and
 * states; this is a wash behind the invitation, not a page painted coral.
 */
function FirstMovePillsView({ onSayHi, onSendSticker }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();

  return (
    <View style={styles.strip} accessibilityRole="toolbar">
      <TactileCTA
        onPress={onSendSticker}
        accessibilityLabel="Send Sticker"
        rippleColor={theme.color.bg.accent}
        emoji="👋"
        emojiStyle={styles.emoji}
        containerStyle={styles.pillContainer}
        style={styles.pill}>
        <Text allowFontScaling style={styles.label}>
          Send Sticker
        </Text>
      </TactileCTA>
      <TactileCTA
        onPress={onSayHi}
        accessibilityLabel="Say Hi"
        rippleColor={theme.color.bg.accent}
        containerStyle={styles.pillContainer}
        style={styles.pill}>
        <Text allowFontScaling style={styles.label}>
          Say Hi!
        </Text>
      </TactileCTA>
    </View>
  );
}

export const FirstMovePills = memo(FirstMovePillsView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.md,
      paddingBottom: TOKENS.space.sm,
      backgroundColor: t.color.bg.accentTint,
    },
    // The flex child. Equal-width pills come from the pressable stretching, so
    // flex lives here, on the outer pressable, not on the visual capsule.
    pillContainer: {
      flex: 1,
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TOKENS.space.xs,
      minHeight: 44,
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.sm,
      backgroundColor: t.color.bg.raised,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      // Soft lift so the capsule reads on the blush, not as flat chrome.
      elevation: 2,
    },
    emoji: {
      fontSize: 17,
      lineHeight: 20,
    },
    label: {
      ...TOKENS.typography.labelMedium,
      color: t.color.text.primary,
      fontFamily: 'Geist-Regular',
    },
  });
