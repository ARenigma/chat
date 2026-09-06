/**
 * Where the tokens went, session by session.
 *
 * Goal item 2 (Amit, 2026-09-05): "usage ledger by session in settings for
 * users and providers". A member could see a balance and a recharge history and
 * still not answer "where did my tokens go"; a provider could see one earnings
 * total and not answer "which conversation was that".
 *
 * One screen for both roles, because it is one question asked from two sides of
 * the same row. The SERVER decides which number the caller is entitled to
 * (migration 069) — a member reads what they spent, a provider their own share
 * — so this screen renders whatever it is given and cannot leak the other side
 * by getting a branch wrong.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { listStamp } from '../lib/datetime';
import { formatTokens } from '../lib/rates';
import { useUsageLedger, type UsageRow } from '../api/usage';
import { BackButton } from '../components/BackButton';
import { Icon, type IconName } from '../components/Icon';
import { LoadingIndicator } from '../components/LoadingIndicator';

interface Props {
  onBack: () => void;
}

const CHANNEL_GLYPH: Record<UsageRow['channel'], IconName> = {
  chat: 'chat',
  audio: 'call',
  video: 'video',
};

const CHANNEL_LABEL: Record<UsageRow['channel'], string> = {
  chat: 'Chat',
  audio: 'Voice call',
  video: 'Video call',
};

/** "12 min", and "under 1 min" rather than "0 min" for a part-minute session. */
function minutesLabel(minutes: number): string {
  return minutes < 1 ? 'under 1 min' : `${minutes} min`;
}

export function UsageLedgerScreen({ onBack }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useUsageLedger();
  const rows = data ?? [];
  // Both totals are the caller's own: a member's spend, a provider's share.
  const total = rows.reduce((sum, r) => sum + r.tokens, 0);
  const earning = rows.length > 0 && rows[0]?.i_am_member === false;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="usage-ledger">
      <View style={styles.bar}>
        <BackButton onPress={onBack} testID="usage-back" style={styles.barIcon} />
        <Text
          maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
          allowFontScaling
          style={styles.barTitle}>
          {earning ? 'Earnings by session' : 'Usage by session'}
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.state}>
          <LoadingIndicator />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.state}>
          <Text
            maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
            allowFontScaling
            style={styles.emptyTitle}>
            Nothing yet
          </Text>
          <Text allowFontScaling style={styles.emptyBody}>
            Every conversation you have will be listed here, with what it cost.
          </Text>
        </View>
      ) : (
        <ScrollView
          {...SCROLL_PHYSICS}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + TOKENS.space.xl },
          ]}>
          <View style={styles.totalCard}>
            <Text allowFontScaling style={styles.totalLabel}>
              {earning ? 'Earned across these sessions' : 'Spent across these sessions'}
            </Text>
            <Text
              maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineMediumEmphasized}
              allowFontScaling
              style={styles.totalValue}
              testID="usage-total">
              {`${formatTokens(total)} tokens`}
            </Text>
          </View>

          {rows.map(row => (
            <View key={row.session_id} style={styles.row} testID={`usage-${row.session_id}`}>
              <View style={styles.glyph}>
                <Icon
                  name={CHANNEL_GLYPH[row.channel]}
                  size={18}
                  color={theme.color.text.secondary}
                />
              </View>
              <View style={styles.rowBody}>
                <Text allowFontScaling numberOfLines={1} style={styles.rowName}>
                  {row.peer_name}
                </Text>
                <Text allowFontScaling style={styles.rowMeta}>
                  {`${CHANNEL_LABEL[row.channel]} · ${minutesLabel(row.minutes)}${
                    row.started_at !== null ? ` · ${listStamp(row.started_at)}` : ''
                  }`}
                </Text>
              </View>
              <View style={styles.amount}>
                <Text allowFontScaling style={styles.amountValue}>
                  {`${row.i_am_member ? '-' : '+'}${formatTokens(row.tokens)}`}
                </Text>
                {/* Provider only: their share is accrued before it is paid, and
                    saying so here is cheaper than a support conversation. */}
                {row.earnings_status !== null && row.earnings_status !== undefined ? (
                  <Text allowFontScaling style={styles.amountNote}>
                    {row.earnings_status}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.color.bg.base },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    barIcon: { width: 28, height: 40, alignItems: 'center', justifyContent: 'center' },
    barTitle: { ...TOKENS.typography.titleMediumEmphasized, color: t.color.text.primary },
    state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: TOKENS.space.xs, paddingHorizontal: TOKENS.space.xl },
    emptyTitle: { ...TOKENS.typography.titleMediumEmphasized, color: t.color.text.primary },
    emptyBody: { ...TOKENS.typography.bodyMedium, color: t.color.text.secondary, textAlign: 'center' },
    scroll: { paddingHorizontal: TOKENS.space.md, gap: TOKENS.space.xs },
    totalCard: {
      backgroundColor: t.color.bg.raised,
      borderRadius: TOKENS.radius.lg,
      borderCurve: 'continuous',
      padding: TOKENS.space.lg,
      gap: TOKENS.space.hair,
      marginBottom: TOKENS.space.xs,
    },
    totalLabel: { ...TOKENS.typography.bodySmall, color: t.color.text.secondary },
    totalValue: { ...TOKENS.typography.headlineMediumEmphasized, color: t.color.text.primary },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      minHeight: TOKENS.layout.rowTwoLine,
    },
    glyph: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.sunken,
    },
    rowBody: { flex: 1, gap: TOKENS.space.hair },
    rowName: { ...TOKENS.typography.bodyLarge, color: t.color.text.primary },
    rowMeta: { ...TOKENS.typography.bodySmall, color: t.color.text.secondary },
    amount: { alignItems: 'flex-end', gap: TOKENS.space.hair },
    amountValue: { ...TOKENS.typography.numeralMedium, color: t.color.text.primary },
    amountNote: { ...TOKENS.typography.bodySmall, color: t.color.text.tertiary },
  });
