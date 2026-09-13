import React, { useCallback, useMemo } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { useBackBarrier } from '../lib/backGuard';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { BackButton } from '../components/BackButton';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { formatPaise, useFetchInvoiceUrl, useTransactions, type TokenTransaction } from '../api/transactions';
import { formatRupees } from '../lib/rates';

interface Props {
  onBack: () => void;
}

/** Human-readable label per transaction kind. */
function kindLabel(kind: TokenTransaction['kind']): string {
  switch (kind) {
    case 'recharge':
      return 'Recharge';
    case 'refund':
      return 'Refund';
    case 'adjustment':
      return 'Adjustment';
  }
}

/**
 * The statuses under which a transaction is money that actually moved.
 *
 * `token_transactions.status` is the payment lifecycle (migration 019):
 * a row is inserted `created` when create-order mints the Cashfree order, and
 * only `credit_purchased_recharge` flips it to `succeeded` — see migration 033,
 * whose `and status = 'created'` guard is what makes the webhook idempotent. The
 * two dead ends are written by cashfree-webhook/index.ts, which sets `failed` on
 * PAYMENT_FAILED_WEBHOOK and PAYMENT_USER_DROPPED_WEBHOOK.
 *
 * So `created` is a payment still in flight or abandoned at the gateway, and
 * `failed` is one that was declined. Neither took the member's money and neither
 * credited a token, and a row on this screen reads as "you were charged this" —
 * it carries an amount in ₹ and a credited line. Listing them is the screen
 * telling a member they paid for something they did not.
 *
 * `refunded` stays IN. It is a recharge that succeeded and was later reversed —
 * real money that moved, and the only status besides `succeeded` that has a GST
 * tax invoice attached (migration 046 raises the invoice on
 * `new.status = 'succeeded' and new.kind = 'recharge'`, and 019's invoice
 * numbering is gapless because a gap invites a GST scrutiny notice). Hiding it
 * would hide a document the member is entitled to download, which is the
 * opposite of the fix.
 */
const SETTLED_STATUSES: ReadonlySet<TokenTransaction['status']> = new Set([
  'succeeded',
  'refunded',
]);

/**
 * The rows this screen is allowed to show: settled money only.
 *
 * Pure and exported so the rule is executed by a test rather than inferred from
 * the JSX — the screen itself cannot be rendered here (no renderer in
 * devDependencies), so this is the only part of it that can be proven.
 */
export function settledTransactions(
  data: readonly TokenTransaction[] | undefined,
): TokenTransaction[] {
  return (data ?? []).filter(tx => SETTLED_STATUSES.has(tx.status));
}

/** Short date: "27 Aug 2026" */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Recharge history and invoice downloads.
 *
 * Shows the member's SETTLED top-ups, newest first — see SETTLED_STATUSES for
 * why an in-flight or declined payment is not history. When a row has an
 * associated invoice PDF the member gets a 'Download invoice' action that
 * mints a short-lived signed URL and opens it in the system browser.
 *
 * Expected state today: empty list, because PAYMENTS_ENABLED=false means no
 * recharge has ever completed. The empty state is the common path.
 */
export function TransactionHistoryScreen({ onBack }: Props) {
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
  const { data, isLoading } = useTransactions();
  const fetchInvoiceUrl = useFetchInvoiceUrl();

  // Filtered BEFORE the empty-state branch, not inside the list. A member whose
  // only recharge was declined has `data.length === 1` and zero rows to draw —
  // branching on `data` would give them a hairline and a blank gap instead of
  // "No recharges yet".
  const rows = useMemo(() => settledTransactions(data), [data]);

  const handleDownload = useCallback(
    async (pdfPath: string) => {
      const signedUrl = await fetchInvoiceUrl(pdfPath);
      if (signedUrl) {
        void Linking.openURL(signedUrl);
      }
    },
    [fetchInvoiceUrl],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header: bare-chevron back + title, same anatomy as BlockedUsersScreen */}
      <View style={styles.bar}>
        <BackButton onPress={onBack} testID="transactions-back" style={styles.barIcon} />
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.barTitle}>
          Recharge history
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <Text allowFontScaling style={styles.hintText}>
            Loading…
          </Text>
        </View>
      ) : rows.length === 0 ? (
        /* Empty state — expected today with PAYMENTS_ENABLED=false */
        <View style={styles.center}>
          <Icon name="wallet" size={TOKENS.icon['2xl']} color={theme.color.text.tertiary} />
          <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.emptyTitle}>
            No recharges yet
          </Text>
          <Text allowFontScaling style={styles.emptyBody}>
            Your top-ups and invoices will appear here.
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          {...SCROLL_PHYSICS}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + TOKENS.space.xl },
          ]}>
          {/* Inset-grouped style: one hairline at top of section, separator between rows */}
          <View style={styles.group}>
            {rows.map((tx, index) => (
              <React.Fragment key={tx.id}>
                {index === 0 ? null : <View style={styles.separator} />}
                <TransactionRow tx={tx} onDownload={handleDownload} />
              </React.Fragment>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

interface RowProps {
  tx: TokenTransaction;
  onDownload: (pdfPath: string) => void;
}

function TransactionRow({ tx, onDownload }: RowProps) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const hasPdf = Boolean(tx.invoice?.pdfPath);

  return (
    <View style={styles.row}>
      {/* Left col: kind + date */}
      <View style={styles.rowLeft}>
        <Text allowFontScaling style={styles.rowKind}>
          {kindLabel(tx.kind)}
        </Text>
        <Text allowFontScaling style={styles.rowDate}>
          {shortDate(tx.createdAt)}
        </Text>
      </View>

      {/* Right col: amount + token delta */}
      <View style={styles.rowRight}>
        <Text allowFontScaling style={styles.rowAmount}>
          {formatPaise(tx.amountPaise)}
        </Text>
        {/* Rupee-first, one unit: the credited amount reads in ₹ like the amount
            paid above it (1 token = ₹1), not as a bare "tokens" count. The paid
            line and this credited line differ by GST. (2026-09-09 audit) */}
        <Text allowFontScaling style={styles.rowTokens}>
          {tx.tokensDelta >= 0 ? '+' : '−'}
          {formatRupees(Math.abs(tx.tokensDelta))}
        </Text>
      </View>

      {/* Trailing download slot. Reserved on every row so the amounts stay
          aligned, and filled only when an invoice PDF exists. Icon-only and
          low-emphasis (secondary ink, no fill) — downloading is a secondary
          action — at the row's trailing edge, vertically centred, with a 44dp
          tap target. Placement/emphasis per the list-action UX references. */}
      <View style={styles.downloadSlot}>
        {hasPdf ? (
          <Pressable
            onPress={() => {
              if (tx.invoice?.pdfPath) {
                onDownload(tx.invoice.pdfPath);
              }
            }}
            testID={`download-invoice-${tx.id}`}
            accessibilityLabel={`Download invoice for ${formatPaise(tx.amountPaise)} recharge on ${shortDate(tx.createdAt)}`}
            accessibilityRole="button"
            press="none"
            highlight="dim"
            // `downloadBtn` sets no radius, so the `dim` fill painted a solid
            // 48dp square behind an 18pt glyph — at the row's trailing edge, where
            // it read as a mystery box rather than as this button. Icon-only
            // controls take borderless (circular) ink.
            // https://developer.android.com/training/material/animations
            shape="circle"
            style={styles.downloadBtn}>
            <Icon name="download" size={TOKENS.icon.md} color={theme.color.text.secondary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
    },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.xs,
    },
    barIcon: {
      width: 28,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    barTitle: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space['2xl'],
      gap: TOKENS.space.sm,
    },
    emptyTitle: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
      textAlign: 'center',
      marginTop: TOKENS.space.sm,
    },
    emptyBody: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
    hintText: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
    },
    list: {
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.xs,
    },
    // Inset-grouped section: one hairline at top, no bottom, separators between rows.
    group: {
      backgroundColor: t.color.bg.base,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      marginLeft: TOKENS.space.md,
      backgroundColor: t.color.border.hairline,
    },
    row: {
      flexDirection: 'row',
      // Centre so the trailing download icon aligns to the middle of the
      // two-line amount block rather than its top.
      alignItems: 'center',
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.sm,
      minHeight: 52,
    },
    rowLeft: {
      flex: 1,
      gap: TOKENS.space['2xs'],
    },
    rowRight: {
      alignItems: 'flex-end',
      gap: TOKENS.space['2xs'],
    },
    // Reserved trailing slot keeps amounts aligned whether or not a row has an
    // invoice. Sits to the right of the amount column.
    downloadSlot: {
      width: TOKENS.interaction.minTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: TOKENS.space.xs,
    },
    // Low-emphasis icon-only button: no fill, 44dp tap target.
    downloadBtn: {
      width: TOKENS.interaction.minTarget,
      height: TOKENS.interaction.minTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowKind: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    rowDate: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
    rowAmount: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    rowTokens: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
  });
