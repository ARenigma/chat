/**
 * About, pushed from the You tab's last row. A port of Bluesky's
 * AboutSettings (social-app src/screens/Settings/AboutSettings.tsx, MIT; see
 * THIRD_PARTY_LICENSES.md): the policy links, a divider, then the version.
 * Their status page, system log, error report and cache rows do not apply.
 *
 * Rows are Bluesky's SettingsList.Item: 24dp icon, 20/8 padding, 8dp gap,
 * 48dp, text_md, a chevron on a link; the header is Layout.Header on native,
 * the title left-aligned under a hairline.
 */
import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../components/BackButton';
import { Divider } from '../components/Divider';
import { Icon, type IconName } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { SENTRY_VERSION_CODE, SENTRY_VERSION_NAME } from '../config';
import { legalUrl } from '../lib/legal';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useBottomBarOffset } from '../shell/useBottomBarOffset';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';

interface Props {
  onBack: () => void;
}

// The legal operator, shown here so a member can see who runs the service; it is the
// name the website footer and the Play developer profile use.
const OPERATOR_NAME = 'Axionix Technologies Private Limited';
const SUPPORT_EMAIL = 'hello@pappal.live';

const POLICIES: readonly {
  key: 'terms' | 'privacy' | 'guidelines' | 'refund';
  title: string;
  label: string;
}[] = [
  { key: 'terms', title: 'Terms of service', label: 'Terms of Service' },
  { key: 'privacy', title: 'Privacy policy', label: 'Privacy Policy' },
  { key: 'guidelines', title: 'Community guidelines', label: 'Community Guidelines' },
  { key: 'refund', title: 'Refund policy', label: 'Refund Policy' },
];

function AboutRow({
  icon,
  title,
  chevron,
}: {
  icon: IconName;
  title: string;
  chevron: boolean;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  return (
    <>
      <Icon name={icon} size={TOKENS.icon.lg} color={theme.color.text.primary} />
      <Text allowFontScaling numberOfLines={1} style={styles.rowTitle}>
        {title}
      </Text>
      {chevron ? (
        <Icon name="chevronRight" size={TOKENS.icon.sm} color={theme.color.text.tertiary} />
      ) : null}
    </>
  );
}

export function AboutScreen({ onBack }: Props) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const barOffset = useBottomBarOffset(TOKENS.space.xl);
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <BackButton onPress={onBack} testID="about-back" />
        <Text
          allowFontScaling
          maxFontSizeMultiplier={TOKENS.fontScaleCap.textLgSemiBoldTight}
          style={styles.barTitle}>
          About
        </Text>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        {...SCROLL_PHYSICS}
        contentContainerStyle={[styles.scroll, { paddingBottom: barOffset }]}>
        {/* Terms, Privacy, Guidelines and Refund open in the system browser, at the URLs
            the seeded policy_versions rows use (migration 027). Refund is here
            because the purchase surfaces state "no refunds". */}
        {POLICIES.map(p => (
          <Pressable
            key={p.key}
            onPress={() => {
              void Linking.openURL(legalUrl(p.key));
            }}
            testID={`settings-${p.key}`}
            accessibilityRole="link"
            accessibilityLabel={p.label}
            press="none"
            highlight="dim"
            style={styles.row}>
            <AboutRow icon="policy" title={p.title} chevron />
          </Pressable>
        ))}
        <View style={styles.rule}>
          <Divider />
        </View>
        <View
          style={styles.row}
          accessible
          accessibilityLabel={`Version ${SENTRY_VERSION_NAME}, build ${SENTRY_VERSION_CODE}`}
          testID="about-version">
          <AboutRow
            icon="version"
            title={`Version ${SENTRY_VERSION_NAME} (${SENTRY_VERSION_CODE})`}
            chevron={false}
          />
        </View>
        <View style={styles.operator} testID="about-operator">
          <Text allowFontScaling style={styles.operatorText}>
            {`Pappal is operated by ${OPERATOR_NAME}.`}
          </Text>
          <Text allowFontScaling style={styles.operatorText}>
            {`© 2026 ${OPERATOR_NAME}.`}
          </Text>
          <Pressable
            onPress={() => {
              Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => undefined);
            }}
            testID="about-support-email"
            accessibilityRole="link"
            accessibilityLabel={`Email ${SUPPORT_EMAIL}`}
            press="none"
            highlight="dim"
            style={styles.operatorLink}>
            <Text allowFontScaling style={styles.operatorLinkText}>
              {SUPPORT_EMAIL}
            </Text>
          </Pressable>
        </View>
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
    // Bluesky's Layout.Header.Outer on native (see AppearanceScreen).
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
    // Bluesky's SettingsList.Item: px_xl 20, py_sm 8, gap_sm 8, minHeight 48.
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
    // SettingsList.Divider: full width, my_sm.
    rule: {
      marginVertical: TOKENS.space.xs,
    },
    operator: {
      paddingHorizontal: TOKENS.space.lg,
      paddingTop: TOKENS.space.md,
      gap: TOKENS.space['2xs'],
    },
    operatorText: {
      ...TOKENS.typography.textSm,
      color: t.color.text.secondary,
    },
    operatorLink: {
      minHeight: TOKENS.interaction.minTarget,
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    operatorLinkText: {
      ...TOKENS.typography.textSm,
      color: t.color.text.primary,
      textDecorationLine: 'underline',
    },
  });
