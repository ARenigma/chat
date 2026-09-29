/**
 * The member's billing documents, and the way to get the PDF of one.
 *
 * Everything behind this screen already existed and none of it was reachable:
 * `public.invoices` (migration 019) with its gapless per-FY numbering, the
 * `Members read own invoices` RLS policy, the private `invoices` storage bucket
 * with its own `Members read own invoice PDFs` policy, the `generate-invoice`
 * Edge Function, and the trigger that calls it on every succeeded recharge
 * (migration 046). A member could see that they had paid and could not obtain
 * the document that says so.
 *
 * Why this is not the recharge-history screen with an extra column. That screen
 * answers "what happened to my money" — it lists top-ups, refunds and
 * adjustments, and its rows are amounts. This one answers "give me the
 * document", which is a different list: it is keyed by invoice number, it
 * includes a recharge whose document has not been raised yet (a row the money
 * ledger has no reason to distinguish), and it excludes the kinds that can
 * never have a document at all.
 *
 * Amit 2026-09-29: failed and pending payments are their own non-tappable rows
 * rather than a footnote count. A member whose payment failed should see that
 * explicitly and read why no bill was raised, not discover a footnote that says
 * "N payments did not go through". The old `unsettledNote` and `billingList`
 * count are removed.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Linking, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { longDate } from '../lib/datetime';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useStore } from '../store/useStore';
import {
  formatPaise,
  SETTLED_RECHARGE_STATUSES,
  useBills,
  useFetchInvoiceUrl,
  type BillingRow,
  type InvoiceRecord,
} from '../api/transactions';
import { BackButton } from '../components/BackButton';
import { Icon } from '../components/Icon';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { Pressable } from '../components/Pressable';
import { useBottomBarOffset } from '../shell/useBottomBarOffset';

interface Props {
  onBack: () => void;
}

/**
 * The document's own name for itself.
 *
 * `document_type` is chosen by `generate-invoice` at issue time: a tax invoice
 * when the seller had a GSTIN in its environment, a bill of supply when it did
 * not. Every row issued so far is a bill of supply — no tax was charged on it —
 * so a screen that called them all "invoices" would be describing an untaxed
 * document as a taxed one. The row picks its own word.
 */
const DOCUMENT_LABEL: Record<InvoiceRecord['documentType'], string> = {
  tax_invoice: 'Tax invoice',
  bill_of_supply: 'Bill of supply',
};

/** "SEPTEMBER 2026" from an ISO timestamp. */
function monthHeader(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleDateString('en-US', { month: 'long' }).toUpperCase();
  return `${month} ${d.getFullYear()}`;
}

/** Group billing rows by month; the date used is paidAt (created_at). */
function groupByMonth(
  rows: BillingRow[],
): Array<{ title: string; data: BillingRow[] }> {
  const sections: Array<{ title: string; data: BillingRow[] }> = [];
  let currentTitle = '';
  for (const row of rows) {
    const title = monthHeader(row.paidAt);
    if (title !== currentTitle) {
      sections.push({ title, data: [] });
      currentTitle = title;
    }
    sections[sections.length - 1]!.data.push(row);
  }
  return sections;
}

export function InvoicesScreen({ onBack }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const barOffset = useBottomBarOffset(TOKENS.space.xl);
  const setNotice = useStore(s => s.setNotice);
  const { data, isLoading } = useBills();
  const fetchInvoiceUrl = useFetchInvoiceUrl();
  /*
   * The document whose URL is being minted, so a second tap cannot mint a
   * second signed URL and launch a second browser window for the same file.
   */
  const [opening, setOpening] = useState<string | null>(null);

  // All billing rows — settled ones get real documents, unsettled ones get an
  // explanatory row. Amit 2026-09-29: no footnote count; every attempt visible.
  const allRows = useMemo(() => data ?? [], [data]);
  const sections = useMemo(() => groupByMonth(allRows), [allRows]);

  const openDocument = useCallback(
    async (invoice: InvoiceRecord) => {
      const path = invoice.pdfPath;
      if (path === null || opening !== null) {
        return;
      }
      setOpening(invoice.id);
      try {
        const signedUrl = await fetchInvoiceUrl(path);
        if (signedUrl === null) {
          setNotice('Could not fetch that document. Check your connection and try again.');
          return;
        }
        /*
         * Handed to the system rather than rendered in-app, which is the same
         * call the recharge history and the legal links already make. Android
         * requires the caller to be ready for nothing being able to handle an
         * implicit ACTION_VIEW ("be ready to catch an ActivityNotFoundException,
         * which occurs if there's no other activity that can handle your app's
         * intent" —
         * https://developer.android.com/training/basics/intents/sending), and
         * React Native surfaces that as a rejected promise. A bare `void
         * Linking.openURL(...)` turns it into an unhandled rejection and the
         * member sees the row do nothing at all.
         */
        await Linking.openURL(signedUrl).catch(() => {
          setNotice('No app on this phone can open a PDF.');
        });
      } catch {
        setNotice('Could not open that document just now.');
      } finally {
        setOpening(null);
      }
    },
    [fetchInvoiceUrl, opening, setNotice],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="invoices">
      <View style={styles.bar}>
        <BackButton onPress={onBack} testID="invoices-back" style={styles.barIcon} />
        <Text
          maxFontSizeMultiplier={TOKENS.fontScaleCap.textLgSemiBoldTight}
          allowFontScaling
          style={styles.barTitle}>
          Bills & invoices
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.state}>
          <LoadingIndicator />
        </View>
      ) : allRows.length === 0 ? (
        <View style={styles.state}>
          <Icon name="receipt" size={TOKENS.icon['2xl']} color={theme.color.text.tertiary} />
          <Text
            maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
            allowFontScaling
            style={styles.emptyTitle}>
            No bills yet
          </Text>
          <Text allowFontScaling style={styles.emptyBody}>
            Every top-up that goes through is billed, and the document is listed
            here for you to open or save.
          </Text>
        </View>
      ) : (
        <SectionList
          showsVerticalScrollIndicator={false}
          {...SCROLL_PHYSICS}
          sections={sections}
          keyExtractor={entry => entry.transactionId}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: barOffset },
          ]}
          renderSectionHeader={({ section }) => (
            <Text allowFontScaling style={styles.sectionHeader}>
              {section.title}
            </Text>
          )}
          renderItem={({ item: entry }) => (
            <BillRow
              entry={entry}
              onOpen={openDocument}
            />
          )}
        />
      )}
    </View>
  );
}

interface RowProps {
  entry: BillingRow;
  onOpen: (invoice: InvoiceRecord) => void;
}

/**
 * One line of the list.
 *
 * Amit 2026-09-29: failed and pending payments are their own non-tappable rows
 * ("Payment failed" / "Payment pending") instead of a footnote count. Real
 * bills keep their three states (PDF ready, PDF pending, no invoice yet).
 *
 * Every row carries a leading filled receipt glyph with no circle container —
 * `active` picks receipt-fill; the shape already communicates "document".
 *
 * States:
 *   1. Failed payment — non-tappable. "Payment failed" / "No bill: nothing was
 *      charged" / amount.
 *   2. Pending payment — non-tappable. "Payment pending" / "Bill follows once
 *      it clears" / amount.
 *   3. Settled with no invoice row yet — non-tappable. "Bill pending" /
 *      "Paid <date>" + generation message / amount.
 *   4. Settled with invoice, PDF not yet uploaded — non-tappable. Invoice
 *      number / meta + preparation message / amount.
 *   5. Settled with invoice and PDF — tappable row, whole row opens PDF.
 */
function BillRow({ entry, onOpen }: RowProps) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const invoice = entry.invoice;
  const isSettled = SETTLED_RECHARGE_STATUSES.has(entry.status);

  // State 1: failed payment
  if (entry.status === 'failed') {
    return (
      <View style={styles.line} testID={`bill-${entry.transactionId}`}>
        <Icon name="receipt" active size={TOKENS.icon.md} color={theme.color.text.secondary} />
        <View style={styles.lineBody}>
          <Text allowFontScaling style={styles.title}>
            Payment failed
          </Text>
          <Text allowFontScaling style={styles.meta}>
            No bill: nothing was charged
          </Text>
        </View>
        <Text allowFontScaling style={styles.amount}>
          {formatPaise(entry.amountPaise)}
        </Text>
      </View>
    );
  }

  // State 2: pending payment (created — in flight or abandoned at gateway)
  if (entry.status === 'created') {
    return (
      <View style={styles.line} testID={`bill-${entry.transactionId}`}>
        <Icon name="receipt" active size={TOKENS.icon.md} color={theme.color.text.secondary} />
        <View style={styles.lineBody}>
          <Text allowFontScaling style={styles.title}>
            Payment pending
          </Text>
          <Text allowFontScaling style={styles.meta}>
            Bill follows once it clears
          </Text>
        </View>
        <Text allowFontScaling style={styles.amount}>
          {formatPaise(entry.amountPaise)}
        </Text>
      </View>
    );
  }

  // State 3: settled with no invoice row
  if (isSettled && invoice === null) {
    return (
      <View style={styles.line} testID={`bill-${entry.transactionId}`}>
        <Icon name="receipt" active size={TOKENS.icon.md} color={theme.color.text.secondary} />
        <View style={styles.lineBody}>
          <Text allowFontScaling style={styles.title}>
            Bill pending
          </Text>
          <Text allowFontScaling style={styles.meta}>
            {`Paid ${longDate(entry.paidAt)}`}
          </Text>
          <Text allowFontScaling style={styles.meta}>
            The document for this top-up has not been raised yet.
          </Text>
        </View>
        <Text allowFontScaling style={styles.amount}>
          {formatPaise(entry.amountPaise)}
        </Text>
      </View>
    );
  }

  // States 4 & 5: settled with invoice (invoice is non-null here)
  if (invoice === null) {
    // Unreachable: covered by state 3. Guard satisfies TS.
    return null;
  }

  const label = DOCUMENT_LABEL[invoice.documentType];
  // A reversed recharge keeps its document — the number was issued and the
  // series is gapless — so the row says what happened to the money instead of
  // disappearing. See SETTLED_RECHARGE_STATUSES.
  const meta = `${label} · ${longDate(invoice.issuedAt)}${
    entry.status === 'refunded' ? ' · Refunded' : ''
  }`;

  // State 4: PDF still being prepared
  if (invoice.pdfPath === null) {
    return (
      <View style={styles.line} testID={`bill-${entry.transactionId}`}>
        <Icon name="receipt" active size={TOKENS.icon.md} color={theme.color.text.secondary} />
        <View style={styles.lineBody}>
          <Text allowFontScaling style={styles.title}>
            {invoice.invoiceNumber}
          </Text>
          <Text allowFontScaling style={styles.meta}>
            {meta}
          </Text>
          <Text allowFontScaling style={styles.meta}>
            The PDF is still being prepared. It will appear here shortly.
          </Text>
        </View>
        <Text allowFontScaling style={styles.amount}>
          {formatPaise(invoice.totalPaise)}
        </Text>
      </View>
    );
  }

  // State 5: PDF ready — whole row is tappable
  return (
    <Pressable
      onPress={() => onOpen(invoice)}
      testID={`bill-${entry.transactionId}`}
      accessibilityLabel={`Open ${label} ${invoice.invoiceNumber}, ${formatPaise(
        invoice.totalPaise,
      )}, ${longDate(invoice.issuedAt)}`}
      accessibilityHint="Opens the PDF in another app"
      press="none"
      highlight="dim"
      style={styles.line}>
      <Icon name="receipt" active size={TOKENS.icon.md} color={theme.color.text.secondary} />
      <View style={styles.lineBody}>
        <Text allowFontScaling style={styles.title}>
          {invoice.invoiceNumber}
        </Text>
        <Text allowFontScaling style={styles.meta}>
          {meta}
        </Text>
      </View>
      <Text allowFontScaling style={styles.amount}>
        {formatPaise(invoice.totalPaise)}
      </Text>
      {/* The glyph is the affordance, not a second button: the whole row is the
          target, so a nested pressable here would be a 48dp hole inside a hole.
          Low-emphasis secondary ink, at the trailing edge. */}
      <View style={styles.glyphSlot}>
        <Icon name="download" size={TOKENS.icon.md} color={theme.color.text.secondary} />
      </View>
    </Pressable>
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
    state: {
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
    },
    emptyBody: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
    list: {
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.xs,
    },
    sectionHeader: {
      ...TOKENS.typography.textSmSemiBold,
      color: t.color.text.section,
      paddingTop: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    line: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingVertical: TOKENS.space.sm,
      minHeight: TOKENS.layout.rowTwoLine,
    },
    lineBody: {
      flex: 1,
      gap: TOKENS.space['2xs'],
    },
    title: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    meta: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
    amount: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    glyphSlot: {
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
