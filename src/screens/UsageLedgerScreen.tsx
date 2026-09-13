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
 *
 * TWO totals at the top, not one (Amit, 2026-09-07: "usage ledger should have
 * two total level KPIs for sessions and spends at top and then ledger rows").
 * A single token total answers "how much" and leaves "how much of what"
 * unanswered — ₹1,200 across three long video calls and across forty short
 * chats are different facts about the same person, and the row list makes the
 * reader count to find out. The count is the second KPI so neither figure has
 * to be inferred from the other.
 *
 * Both KPIs are still only the caller's own side of the money. The count is
 * safe by construction (a row the caller can see is a row they were in), and
 * the token figure is the same sum this screen has always shown — server-chosen
 * per row, so a provider's 60% share is what is added up and the gross never
 * reaches this file to be leaked.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { useBackBarrier } from '../lib/backGuard';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { listStamp } from '../lib/datetime';
import { formatCount, formatRupees } from '../lib/rates';
import { useUsageLedger, type UsageRow } from '../api/usage';
import { useProfile } from '../api/chat';
import { BackButton } from '../components/BackButton';
import { Icon, type IconName } from '../components/Icon';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { RupeeAmount } from '../components/RupeeAmount';

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

/** The two top-level figures, with the words that make each one mean something. */
export interface UsageKpis {
  /** How many billed sessions are in this ledger. A COUNT of rows. */
  sessions: number;
  /** The visible word under the count: "Session" at one, "Sessions" otherwise. */
  sessionsLabel: string;
  /** The spoken form — what the number means, not the number. */
  sessionsSpoken: string;
  /** The caller's own figure in ₹: what they spent, or what they were paid. */
  tokens: number;
  /** "Spent" for a member, "Earned" for a provider; the ₹ sits beneath it. */
  tokensLabel: string;
  /** The spoken form of the same. */
  tokensSpoken: string;
  /** True when the caller is being paid for these sessions rather than paying. */
  earning: boolean;
}

/**
 * The two KPIs, or `null` when there is nothing to total.
 *
 * `null` and not `{ sessions: 0, tokens: 0 }` on purpose. Two cards reading
 * zero are two things a first-time member has to read, understand and dismiss
 * before reaching the sentence that actually helps them ("Every conversation
 * you have will be listed here, with what it cost"). An empty state is one
 * message, so the caller renders the empty state OR the KPIs and can never
 * render both — the impossibility is in this return type rather than in a
 * `rows.length > 0` that a later edit could drop.
 *
 * `sessions` is `rows.length`. It is stated here and gated in
 * __tests__/usageLedger.test.ts because a count and a sum look identical in a
 * card and diverge the moment a session costs anything other than one token —
 * which every session does.
 *
 * The role comes off the newest row's `i_am_member`, which is what the screen
 * title has always used. It is the caller's side of the ledger, not a claim
 * about the whole list: an account that is both a member and a provider gets
 * one label and one summed figure for a list that mixes both. That predates
 * these KPIs (the single total had it too) and belongs to the RPC, which would
 * have to return the two sides separately before this screen could show them.
 */
export function usageKpis(rows: readonly UsageRow[]): UsageKpis | null {
  if (rows.length === 0) {
    return null;
  }
  const earning = rows[0]?.i_am_member === false;
  const sessions = rows.length;
  // Both totals are the caller's own: a member's spend, a provider's share.
  const tokens = rows.reduce((sum, r) => sum + r.tokens, 0);
  const amount = formatRupees(tokens);
  const singular = sessions === 1;
  return {
    sessions,
    // "1 sessions" is the tell that nobody looked at a one-row ledger.
    sessionsLabel: singular ? 'Session' : 'Sessions',
    sessionsSpoken: `${formatCount(sessions)} ${
      singular ? 'session' : 'sessions'
    } in this ledger`,
    tokens,
    /*
     * A provider is not spending. The word has to move with the role or the
     * screen tells someone being paid that they spent the money — which is the
     * same reason the title above already says "Earnings by session". Neither
     * wording exposes the other side's figure: it renames the caller's own.
     */
    /*
     * "Earned" / "Spent", with no unit word: the figure beneath already carries
     * ₹ (2026-09-08). Saying "₹1,20,000 tokens spent" names two units for one
     * number, which is the exact redundancy removing tokens was meant to end.
     */
    tokensLabel: earning ? 'Earned' : 'Spent',
    tokensSpoken: earning
      ? `${amount} earned across these sessions`
      : `${amount} spent across these sessions`,
    earning,
  };
}

/**
 * One KPI card: the figure, then what the figure is.
 *
 * The two Texts are ONE accessibility node. "Describe each UI element" asks a
 * description to convey purpose rather than visual detail, and left unmerged
 * TalkBack reads "3" and then, separately, "Sessions" — two fragments a
 * listener has to reassemble, in an order the layout happens to impose. So the
 * container takes `accessible` (React Native's equivalent of Compose's
 * `mergeDescendants`, which the principles page names for exactly this) and one
 * `accessibilityLabel` that states the meaning: "3 sessions in this ledger".
 * https://developer.android.com/guide/topics/ui/accessibility/apps
 * https://developer.android.com/guide/topics/ui/accessibility/principles
 *
 * No `maxFontSizeMultiplier` on the value: design/tokens.json leaves numerals
 * uncapped deliberately, "so accessibility scaling still enlarges reading text
 * and the balance", and a KPI is a balance.
 */
function Kpi({
  value,
  label,
  spoken,
  testID,
}: {
  // A node, not just a string: the tokens KPI passes a `RupeeAmount` so its
  // rupee glyph renders in a lighter weight than the figure, and the sessions
  // KPI still passes a plain string (`formatCount` — no currency, nothing to
  // split).
  value: React.ReactNode;
  label: string;
  spoken: string;
  testID: string;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.kpi} accessible accessibilityLabel={spoken}>
      {typeof value === 'string' ? (
        <Text allowFontScaling style={styles.kpiValue} testID={testID}>
          {value}
        </Text>
      ) : (
        // Already a styled node (RupeeAmount carries `styles.kpiValue` itself);
        // wrapping it in another Text would nest two Text trees for one line.
        <View testID={testID}>{value}</View>
      )}
      <Text allowFontScaling style={styles.kpiLabel}>
        {label}
      </Text>
    </View>
  );
}

export function UsageLedgerScreen({ onBack }: Props) {
  /*
   * This screen covers Home, and Home stays mounted underneath it (App.tsx
   * renders pushed screens as overlays so returning never remounts Home's
   * lists). Without this barrier Home's search guard — live whenever its search
   * field is open — still hears the hardware back press from up here, closes a
   * field nobody can see, and reports the press handled, so this screen never
   * pops. See src/lib/backGuard.ts.
   */
  useBackBarrier();

  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useUsageLedger();
  const { data: profile } = useProfile();
  const rows = data ?? [];
  const kpis = usageKpis(rows);
  // When there are no rows yet, fall back to the profile role so a provider
  // always sees "Earnings" language, not "Usage" language, even before their
  // first session.
  const earning = kpis?.earning ?? (profile?.role === 'provider');

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
      ) : /* `kpis === null` IS `rows.length === 0` — see usageKpis. Branching on
             the KPIs rather than on the row count is what makes "empty state or
             KPIs, never both" a fact about the types instead of a convention. */
      kpis === null ? (
        <View style={styles.state}>
          <Text
            maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
            allowFontScaling
            style={styles.emptyTitle}>
            Nothing yet
          </Text>
          <Text allowFontScaling style={styles.emptyBody}>
            {earning
              ? 'Every conversation you have will appear here, showing what you earned.'
              : 'Every conversation you have will be listed here, with what it cost.'}
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
          {/* Two up, above the rows. Equal `flex: 1` halves rather than a fixed
              width, so the pair survives every screen width without a
              breakpoint, and separated by the same space.xs the row list is
              already gapped by — one rhythm down the screen, not two. */}
          <View style={styles.kpiRow}>
            <Kpi
              value={formatCount(kpis.sessions)}
              label={kpis.sessionsLabel}
              spoken={kpis.sessionsSpoken}
              testID="usage-sessions"
            />
            <Kpi
              value={
                <RupeeAmount value={kpis.tokens} allowFontScaling style={styles.kpiValue} />
              }
              label={kpis.tokensLabel}
              spoken={kpis.tokensSpoken}
              testID="usage-total"
            />
          </View>

          {rows.map(row => (
            <View key={row.session_id} style={styles.row} testID={`usage-${row.session_id}`}>
              <View style={styles.glyph}>
                <Icon
                  name={CHANNEL_GLYPH[row.channel]}
                  size={TOKENS.icon.md}
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
                  {`${row.i_am_member ? '-' : '+'}${formatRupees(row.tokens)}`}
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
    kpiRow: { flexDirection: 'row', gap: TOKENS.space.xs, marginBottom: TOKENS.space.xs },
    /*
     * The card interior stays space.lg, which is where design/tokens.json keeps
     * card interiors ("Recharge balance, Provider detail sections, Payment
     * success") and what the single total card used before it became two. Half
     * the width, so it was worth checking the number still fits rather than
     * assuming: at 360dp the content box is (360 − 2×16 − 8)/2 − 2×20 = 120dp,
     * and the widest figure this ledger can produce — 50 sessions is the RPC's
     * cap (migration 069) at the 35/min video rate — is six digits, ~101dp of
     * numeralLarge. Two-line wrap above that, never a clip.
     */
    kpi: {
      flex: 1,
      backgroundColor: t.color.bg.raised,
      borderRadius: TOKENS.radius.lg,
      borderCurve: 'continuous',
      padding: TOKENS.space.lg,
      gap: TOKENS.space.hair,
    },
    /*
     * numeralLarge, not the headlineMediumEmphasized the single total wore.
     *
     * DEPARTURE, stated: the brief named numeralMedium/numeralSmall for the
     * values. Both are tabular, which was the point of naming them — a figure
     * that changes must not twitch — but numeralMedium is 14pt, the size this
     * screen already uses for a single ROW's amount, and a top-level total set
     * smaller than or equal to the lines it totals is not a KPI. numeralLarge
     * is the same tabular Bold face on the M3 headlineSmall grid (24/32), so it
     * keeps the tabular guarantee, reads as the summary, and is 4pt narrower
     * than the 28pt it replaces — which is what buys the fit computed above.
     */
    kpiValue: { ...TOKENS.typography.numeralLarge, color: t.color.text.primary },
    kpiLabel: { ...TOKENS.typography.bodySmall, color: t.color.text.secondary },
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
