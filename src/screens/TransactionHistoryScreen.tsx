import React, { useCallback } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { BackButton } from '../components/BackButton';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { formatPaise, useFetchInvoiceUrl, useTransactions, type TokenTransaction } from '../api/transactions';

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
 * Shows every token_transaction the member has, newest first. When a row has
 * an associated invoice PDF the member gets a 'Download invoice' action that
 * mints a short-lived signed URL and opens it in the system browser.
 *
 * Expected state today: empty list, because PAYMENTS_ENABLED=false means no
 * recharge has ever completed. The empty state is the common path.
 */
export function TransactionHistoryScreen({ onBack }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useTransactions();
  const fetchInvoiceUrl = useFetchInvoiceUrl();

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
        <Text allowFontScaling style={styles.barTitle}>
          Recharge history
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <Text allowFontScaling style={styles.hintText}>
            Loading…
          </Text>
        </View>
      ) : !data || data.length === 0 ? (
        /* Empty state — expected today with PAYMENTS_ENABLED=false */
        <View style={styles.center}>
          <Icon name="wallet" size={40} color={theme.color.text.tertiary} />
          <Text allowFontScaling style={styles.emptyTitle}>
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
            {data.map((tx, index) => (
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
        <Text allowFontScaling style={styles.rowTokens}>
          {tx.tokensDelta > 0 ? '+' : ''}
          {tx.tokensDelta.toLocaleString('en-IN')} tokens
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
            highlight="ios"
            style={styles.downloadBtn}>
            <Icon name="download" size={18} color={theme.color.text.secondary} />
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
      ...TOKENS.typography.headline,
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
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
      textAlign: 'center',
      marginTop: TOKENS.space.sm,
    },
    emptyBody: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
    hintText: {
      ...TOKENS.typography.bodyMedium,
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
      width: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: TOKENS.space.xs,
    },
    // Low-emphasis icon-only button: no fill, 44dp tap target.
    downloadBtn: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowKind: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    rowDate: {
      ...TOKENS.typography.captionRegular,
      color: t.color.text.secondary,
    },
    rowAmount: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    rowTokens: {
      ...TOKENS.typography.captionRegular,
      color: t.color.text.secondary,
    },
  });
