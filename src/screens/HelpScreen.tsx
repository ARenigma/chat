/**
 * Help & feedback, pushed from the settings list. A short FAQ, then a row that
 * opens the user's mail app addressed to hello@pappal.live, the one contact
 * address on the website. No form and no backend.
 *
 * Built like AboutScreen (the same header, hairline and 48dp rows). The answers
 * are plain text blocks, not an accordion: animating height re-runs layout for
 * the node and its siblings every frame (CLAUDE.md RULE 6), and five short
 * answers do not need hiding.
 *
 * Every answer restates a fact the product already publishes: web/pricing.html,
 * web/refund.html, web/terms.html, web/privacy.html, web/delete.html and
 * SafetySheet. Change one of those and change the answer with it.
 */
import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../components/BackButton';
import { Divider } from '../components/Divider';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useBottomBarOffset } from '../shell/useBottomBarOffset';
import { useStore } from '../store/useStore';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';

interface Props {
  onBack: () => void;
}

export interface FaqEntry {
  question: string;
  answer: string;
}

export const HELP_EMAIL = 'hello@pappal.live';
export const HELP_SUBJECT = 'Pappal help and feedback';
export const HELP_MAILTO = `mailto:${HELP_EMAIL}?subject=${encodeURIComponent(HELP_SUBJECT)}`;

export const FAQ: readonly FaqEntry[] = [
  {
    question: 'How does charging work?',
    answer:
      'Text, voice and video are charged per minute from your balance, and the app shows you the rate before a conversation starts. There are no subscriptions or automatic renewals, so nothing is ever charged behind your back.',
  },
  {
    question: 'How do I add balance?',
    answer:
      'Open Recharge and pick a pack. You will see the final amount before you pay. The balance you add does not expire while your account is active.',
  },
  {
    question: 'What if I change my mind about a purchase?',
    answer:
      'Purchases are final, so please add what you are comfortable with. If something went wrong, like a duplicate payment or a payment that did not give you balance, we are happy to help. Write to us with the transaction ID and the date.',
  },
  {
    question: 'How can I block or report someone?',
    answer:
      'Open the menu in the chat. Blocking happens straight away and they are not told. If you report, a real person on our team will take a look, and a copy of the message goes along with it. You can see everyone you have blocked in Settings.',
  },
  {
    question: 'What if someone asks for my number?',
    answer:
      'Moving a chat off Pappal is not allowed, so you can politely say no. If it keeps happening, you can block them and let us know.',
  },
  {
    question: 'Who can read my messages?',
    answer:
      'Only the two people in the chat. When a session ends, the messages disappear from the app for both of you. We keep a copy that nobody can open for 30 days, in case we need to help with a dispute or a safety concern, and then we delete it. Our team only reads a message if you report it.',
  },
  {
    question: 'How do I delete my account?',
    answer:
      'Open Settings, tap Delete account and confirm. Your profile, chats and balance are deleted right away. Any unused balance cannot be brought back, so do write to us first if you have some left. Reports about abuse are kept for 90 days without your name.',
  },
];

export function HelpScreen({ onBack }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const barOffset = useBottomBarOffset(TOKENS.space.xl);
  const setNotice = useStore(s => s.setNotice);

  const writeToUs = (): void => {
    // No mail app installed makes openURL reject; say where to write instead.
    Linking.openURL(HELP_MAILTO).catch(() => {
      setNotice(`We could not open a mail app. You can write to us at ${HELP_EMAIL}`);
    });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <BackButton onPress={onBack} testID="help-back" />
        <Text
          allowFontScaling
          maxFontSizeMultiplier={TOKENS.fontScaleCap.textLgSemiBoldTight}
          style={styles.barTitle}>
          Help & feedback
        </Text>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        {...SCROLL_PHYSICS}
        contentContainerStyle={[styles.scroll, { paddingBottom: barOffset }]}>
        {FAQ.map(item => (
          <View key={item.question} style={styles.entry} testID="help-faq-entry">
            <Text allowFontScaling style={styles.question}>
              {item.question}
            </Text>
            <Text allowFontScaling style={styles.answer}>
              {item.answer}
            </Text>
          </View>
        ))}
        <View style={styles.rule}>
          <Divider />
        </View>
        <Pressable
          onPress={writeToUs}
          testID="help-write-to-us"
          accessibilityRole="link"
          accessibilityLabel={`Write to us at ${HELP_EMAIL}`}
          press="none"
          highlight="dim"
          style={styles.row}>
          <Icon name="send" size={TOKENS.icon.lg} color={theme.color.text.primary} />
          <Text allowFontScaling numberOfLines={1} style={styles.rowTitle}>
            Write to us
          </Text>
          <Icon name="chevronRight" size={TOKENS.icon.sm} color={theme.color.text.tertiary} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
    },
    // Same header as AboutScreen (Bluesky's Layout.Header.Outer on native).
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space['2xs'],
      minHeight: TOKENS.interaction.minTarget,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.color.border.hairline,
    },
    barTitle: {
      flex: 1,
      ...TOKENS.typography.textLgSemiBoldTight,
      color: t.color.text.primary,
    },
    scroll: {
      paddingTop: TOKENS.space.xs,
    },
    entry: {
      gap: TOKENS.space['2xs'],
      paddingHorizontal: TOKENS.space.lg,
      paddingVertical: TOKENS.space.xs,
    },
    question: {
      ...TOKENS.typography.textMdSemiBold,
      color: t.color.text.primary,
    },
    answer: {
      ...TOKENS.typography.textMd,
      color: t.color.text.secondary,
    },
    rule: {
      marginVertical: TOKENS.space.xs,
    },
    // AboutScreen's row: 20/8 padding, 8dp gap, 48dp minimum.
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      minHeight: TOKENS.interaction.minTarget,
      paddingHorizontal: TOKENS.space.lg,
      paddingVertical: TOKENS.space.xs,
      borderRadius: 0,
    },
    rowTitle: {
      ...TOKENS.typography.textMd,
      color: t.color.text.primary,
      flex: 1,
    },
  });
