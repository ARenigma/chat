import { moneyDate } from '../lib/datetime';
import { PAYMENT_STATE_LABEL, paymentState, type PaymentState } from '../lib/paymentStatus';
import React, { useCallback, useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { BackButton } from '../components/BackButton';
import { FilterChip } from '../components/Chip';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { formatPaise, useFetchInvoiceUrl, useTransactions, type TokenTransaction } from '../api/transactions';
import { useBottomBarOffset } from '../shell/useBottomBarOffset';

interface Props {
  onBack: () => void;
}

// Amit 2026-09-29: failed or incomplete payments are their own line items.
// Show every attempt regardless of status — the query already returns all of
// them and RLS scopes rows to the signed-in user. Do not filter here.
// (Previously this screen filtered to SETTLED_STATUSES only, which hid failed
// and pending rows from members who needed to know their payment didn't clear.)

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

/** The coloured status word trailing the amount (shared rule: lib/paymentStatus). */
function stateOf(tx: TokenTransaction): PaymentState {
  return paymentState(tx.status, tx.createdAt);
}

/**
 * The rows this screen is allowed to show.
 *
 * Amit 2026-09-29: every attempt is its own line item — succeeded, created
 * (pending), failed and refunded. This replaces the old settled-only filter.
 * RLS (token_transactions: Members read own transactions) already scopes rows
 * to the signed-in user, so every row returned is one the member initiated.
 */
export function allTransactions(
  data: readonly TokenTransaction[] | undefined,
): TokenTransaction[] {
  return (data ?? []).slice();
}

/** Short date + time: "27 Aug 2026, 10:30 AM" */
function shortDateTime(iso: string): string {
  const time = new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${moneyDate(iso)}, ${time}`;
}

/** "SEPTEMBER 2026" from an ISO timestamp. */
function monthHeader(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleDateString('en-US', { month: 'long' }).toUpperCase();
  return `${month} ${d.getFullYear()}`;
}

/**
 * Flat array with month-header strings interleaved before the first row of
 * each new month. FlashList has no sections prop — sections are expressed as
 * a flat list with header rows in it, plus getItemType for recycling pools.
 */
type FlatTx = string | TokenTransaction;

function groupByMonth(rows: TokenTransaction[]): FlatTx[] {
  const flat: FlatTx[] = [];
  let currentHeader = '';
  for (const row of rows) {
    const header = monthHeader(row.createdAt);
    if (header !== currentHeader) {
      flat.push(header);
      currentHeader = header;
    }
    flat.push(row);
  }
  return flat;
}

/** Filter labels in display order. */
const FILTER_OPTIONS = ['All', 'Paid', 'Pending', 'Not completed', 'Failed', 'Refunded'] as const;
type FilterOption = (typeof FILTER_OPTIONS)[number];

/** The status values that correspond to each filter label. */
const FILTER_STATUS: Record<FilterOption, PaymentState | null> = {
  All: null,
  Paid: 'paid',
  Pending: 'pending',
  'Not completed': 'incomplete',
  Failed: 'failed',
  Refunded: 'refunded',
};

/**
 * Recharge history and invoice downloads.
 *
 * Shows ALL top-ups, newest first — including pending, failed and refunded
 * attempts. See allTransactions for why every status is shown.
 *
 * A filter chip row at the top lets the member narrow to a single status; only
 * the chips for statuses that actually appear in the list are rendered.
 */
export function TransactionHistoryScreen({ onBack }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const barOffset = useBottomBarOffset(TOKENS.space.xl);
  const { data, isLoading } = useTransactions();
  const fetchInvoiceUrl = useFetchInvoiceUrl();
  const [activeFilter, setActiveFilter] = useState<FilterOption>('All');

  const rows = useMemo(() => allTransactions(data), [data]);

  // Which statuses are present in the full list — only those get a chip.
  const presentStatuses = useMemo(
    () => new Set(rows.map(stateOf)),
    [rows],
  );

  // Chips to show: "All" always plus whichever status labels have rows.
  const visibleFilters = useMemo(
    () =>
      FILTER_OPTIONS.filter(f => {
        if (f === 'All') return true;
        const s = FILTER_STATUS[f];
        return s !== null && presentStatuses.has(s);
      }),
    [presentStatuses],
  );

  // When a filter is toggled: select it, or return to All if already selected.
  const handleFilter = useCallback((label: string) => {
    setActiveFilter(prev =>
      prev === label ? 'All' : (label as FilterOption),
    );
  }, []);

  const filteredRows = useMemo(() => {
    const status = FILTER_STATUS[activeFilter];
    if (status === null) return rows;
    return rows.filter(tx => stateOf(tx) === status);
  }, [rows, activeFilter]);

  const flatRows = useMemo(() => groupByMonth(filteredRows), [filteredRows]);

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
      <View style={styles.bar}>
        <BackButton onPress={onBack} testID="transactions-back" style={styles.barIcon} />
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.textLgSemiBoldTight} allowFontScaling style={styles.barTitle}>
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
          <Icon name="wallet" active size={TOKENS.icon['2xl']} color={theme.color.text.tertiary} />
          <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.emptyTitle}>
            No recharges yet
          </Text>
          <Text allowFontScaling style={styles.emptyBody}>
            Your top-ups will appear here.
          </Text>
        </View>
      ) : (
        <FlashList
          showsVerticalScrollIndicator={false}
          {...SCROLL_PHYSICS}
          data={flatRows}
          keyExtractor={item => (typeof item === 'string' ? item : item.id)}
          getItemType={item => (typeof item === 'string' ? 'header' : 'row')}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: barOffset },
          ]}
          ListHeaderComponent={
            /* Filter chips: shown only when more than one status is present. */
            visibleFilters.length > 1 ? (
              <View style={styles.filters}>
                {visibleFilters.map(f => (
                  <FilterChip
                    key={f}
                    label={f}
                    selected={activeFilter === f}
                    onToggle={handleFilter}
                    testID={`filter-${f.toLowerCase()}`}
                    accessibilityLabel={`Show ${f} payments`}
                  />
                ))}
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            if (typeof item === 'string') {
              return (
                <Text allowFontScaling style={styles.sectionHeader}>
                  {item}
                </Text>
              );
            }
            return <TransactionRow tx={item} onDownload={handleDownload} />;
          }}
          ListEmptyComponent={
            /* Shown when a filter leaves no rows (the full list is non-empty). */
            <View style={styles.center}>
              <Text allowFontScaling style={styles.emptyBody}>
                {`No ${activeFilter.toLowerCase()} payments`}
              </Text>
            </View>
          }
        />
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
      {/*
       * Amit 2026-09-29: filled wallet glyph with NO circle container.
       * `active` selects wallet-fill.
       */}
      <Icon name="wallet" active size={TOKENS.icon.md} color={theme.color.text.secondary} />

      {/* Left col: kind + date/time */}
      <View style={styles.rowLeft}>
        <Text allowFontScaling style={styles.rowKind}>
          {kindLabel(tx.kind)}
        </Text>
        <Text allowFontScaling style={styles.rowDate}>
          {shortDateTime(tx.createdAt)}
        </Text>
      </View>

      {/* Right col: amount + status word */}
      <View style={styles.rowRight}>
        <Text allowFontScaling style={styles.rowAmount}>
          {formatPaise(tx.amountPaise)}
        </Text>
        <Text
          allowFontScaling
          style={[
            styles.rowStatus,
            stateOf(tx) === 'paid' && styles.statusPaid,
            stateOf(tx) === 'pending' && styles.statusPending,
            (stateOf(tx) === 'failed' || stateOf(tx) === 'incomplete') && styles.statusFailed,
            stateOf(tx) === 'refunded' && styles.statusRefunded,
          ]}>
          {PAYMENT_STATE_LABEL[stateOf(tx)]}
        </Text>
      </View>

      {/* Trailing download slot — reserved on every row so amounts stay
          aligned. Filled only when an invoice PDF exists. */}
      <View style={styles.downloadSlot}>
        {hasPdf ? (
          <Pressable
            onPress={() => {
              if (tx.invoice?.pdfPath) {
                onDownload(tx.invoice.pdfPath);
              }
            }}
            testID={`download-invoice-${tx.id}`}
            accessibilityLabel={`Download invoice for ${formatPaise(tx.amountPaise)} recharge on ${shortDateTime(tx.createdAt)}`}
            accessibilityRole="button"
            press="none"
            highlight="dim"
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
      ...TOKENS.typography.textLgSemiBoldTight,
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
    filters: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space.xs,
      paddingVertical: TOKENS.space.sm,
    },
    sectionHeader: {
      ...TOKENS.typography.textSmSemiBold,
      color: t.color.text.section,
      paddingTop: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
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
    downloadSlot: {
      width: TOKENS.interaction.minTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: TOKENS.space.xs,
    },
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
    /*
     * Base style for the status word; each status overrides the color.
     */
    rowStatus: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
    // Paid — succeeded: existing success / available green
    statusPaid: {
      color: t.color.text.available,
    },
    // Pending — created: amber warning token (text/warning, Amit 2026-09-29)
    statusPending: {
      color: t.color.text.warning,
    },
    // Failed — danger ink
    statusFailed: {
      color: t.color.state.danger,
    },
    // Refunded — secondary ink (money left, then came back)
    statusRefunded: {
      color: t.color.text.secondary,
    },
  });
