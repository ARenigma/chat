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
 * Nothing here is computed. The number, the document type, the issue date and
 * the total are the columns `record_invoice` wrote; where a document does not
 * exist the screen says so instead of assembling one out of the ledger row. An
 * invented invoice number on a statutory document is not a display bug.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { useBackBarrier } from '../lib/backGuard';
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

/** What this screen shows, and the one thing it can only say in a sentence. */
export interface BillingList {
  /**
   * Recharges that took money, newest first. `invoice` is null on a row whose
   * document has not been raised yet — that is a state, not a row to hide.
   */
  documents: BillingRow[];
  /**
   * Recharges that never took money: `created` (the member left the Cashfree
   * sheet and no webhook ever came) or `failed`. They are not documents and
   * never will be, so they are counted rather than listed — 10 of the 23
   * recharge rows in the live table on 2026-09-13 are in this state, so a
   * member WILL come here looking for the bill for one of them.
   */
  unsettled: number;
}

/**
 * Split the ledger into the documents and the attempts, without dropping either.
 *
 * Pure and exported because it is the only part of this screen that can be
 * executed in this repo (no renderer in devDependencies), and because the rule
 * it encodes — settled status decides, not kind, not the presence of an invoice
 * row — is the one that would silently regress.
 */
export function billingList(rows: readonly BillingRow[] | undefined): BillingList {
  const all = rows ?? [];
  return {
    documents: all.filter(row => SETTLED_RECHARGE_STATUSES.has(row.status)),
    unsettled: all.filter(row => !SETTLED_RECHARGE_STATUSES.has(row.status)).length,
  };
}

/**
 * The sentence for the payments that were never billed, or null when there
 * were none.
 *
 * Said plainly rather than shown as a greyed row: a failed payment has no
 * number, no total and no document, so a row for it would be four empty fields
 * and an explanation. One sentence answers the question it is actually asked —
 * "I tried to pay, where is my bill" — and answers it with "that payment did
 * not go through", which is the fact.
 */
export function unsettledNote(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  return count === 1
    ? 'One payment did not go through, so nothing was billed for it.'
    : `${count} payments did not go through, so nothing was billed for them.`;
}

export function InvoicesScreen({ onBack }: Props) {
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
  const setNotice = useStore(s => s.setNotice);
  const { data, isLoading } = useBills();
  const fetchInvoiceUrl = useFetchInvoiceUrl();
  /*
   * The document whose URL is being minted, so a second tap cannot mint a
   * second signed URL and launch a second browser window for the same file.
   *
   * A re-entry guard rather than `Pressable`'s `busy`: `busy` is the state a
   * pending MUTATION holds a control in, and it comes with the requirement that
   * the control say which mutation it is running (contract.test.ts, "narrates
   * every mutation a button starts"). This row starts no mutation and has no
   * label to change — it fetches a URL and hands it to Android — so the honest
   * version is to swallow the second tap and leave the row alone.
   */
  const [opening, setOpening] = useState<string | null>(null);

  const { documents, unsettled } = useMemo(() => billingList(data), [data]);
  const note = unsettledNote(unsettled);

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
        // Backstop: nothing above is expected to throw (fetchInvoiceUrl returns
        // null on failure), and a rejection escaping an onPress handler is an
        // unhandled rejection rather than anything the member can see.
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
      ) : documents.length === 0 ? (
        /*
         * Empty, and the note below it is why this is not one message. A member
         * with nothing but abandoned checkouts has no documents AND a reason,
         * and the reason is the half they came for.
         */
        <View style={styles.state}>
          <Icon name="wallet" size={TOKENS.icon['2xl']} color={theme.color.text.tertiary} />
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
          {note === null ? null : (
            <Text allowFontScaling style={styles.emptyBody} testID="invoices-unsettled">
              {note}
            </Text>
          )}
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          {...SCROLL_PHYSICS}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + TOKENS.space.xl },
          ]}>
          <View style={styles.group}>
            {documents.map((entry, index) => (
              <React.Fragment key={entry.transactionId}>
                {index === 0 ? null : <View style={styles.separator} />}
                <BillRow entry={entry} onOpen={openDocument} />
              </React.Fragment>
            ))}
          </View>
          {note === null ? null : (
            <Text allowFontScaling style={styles.note} testID="invoices-unsettled">
              {note}
            </Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

interface RowProps {
  entry: BillingRow;
  onOpen: (invoice: InvoiceRecord) => void;
}

/**
 * One line of the list, in one of the three states this data actually has.
 *
 *   1. A document with a stored PDF — the whole row opens it.
 *   2. A document whose PDF has not landed yet. `pdf_path` is set by
 *      `set_invoice_pdf` AFTER the upload, and the Edge Function logs the
 *      failure and returns non-fatally if that RPC fails, so this state is both
 *      transient (seconds) and occasionally permanent. Either way the row keeps
 *      its real number and total and says the PDF is not there — it does not
 *      offer an action that cannot work.
 *   3. A settled recharge with no invoice row at all. Migration 046 raises the
 *      invoice through pg_net and returns quietly when the Vault secrets are
 *      empty, so "paid, never invoiced" is a real state with no user-visible
 *      cause. The row shows what the LEDGER knows (what was paid, and when) and
 *      does not put a number on it.
 */
function BillRow({ entry, onOpen }: RowProps) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const invoice = entry.invoice;

  if (invoice === null) {
    return (
      <View style={styles.line} testID={`bill-${entry.transactionId}`}>
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

  const label = DOCUMENT_LABEL[invoice.documentType];
  // A reversed recharge keeps its document — the number was issued and the
  // series is gapless — so the row says what happened to the money instead of
  // disappearing. See SETTLED_RECHARGE_STATUSES.
  const meta = `${label} · ${longDate(invoice.issuedAt)}${
    entry.status === 'refunded' ? ' · Refunded' : ''
  }`;

  if (invoice.pdfPath === null) {
    return (
      <View style={styles.line} testID={`bill-${entry.transactionId}`}>
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
          Low-emphasis secondary ink, at the trailing edge, per the list-action
          references the recharge history already follows. */}
      <View style={styles.glyph}>
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
    // Inset-grouped section, matching the recharge history: one hairline above
    // the first line, a separator between lines, nothing below the last.
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
    line: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
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
    glyph: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    note: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
      paddingTop: TOKENS.space.md,
    },
  });
