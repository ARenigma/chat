import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/** Signed URL TTL for invoice PDFs — ten minutes, matching attachments. */
const INVOICE_URL_TTL_SECONDS = 600;

const txKeys = {
  list: ['transactions'] as const,
  bills: ['bills'] as const,
  invoiceUrl: (p: string | null | undefined) => ['invoice-url', p] as const,
};

/** The Cashfree payment lifecycle a ledger row moves through (migration 019). */
export type TokenTransactionStatus = 'created' | 'succeeded' | 'failed' | 'refunded';

/**
 * The recharge statuses under which money actually moved, and therefore the
 * only ones a billing document can exist for.
 *
 * `token_transactions.status` is the Cashfree lifecycle (migration 019): a row
 * is inserted `created` when create-order mints the order, `failed` is written
 * by cashfree-webhook on PAYMENT_FAILED_WEBHOOK / PAYMENT_USER_DROPPED_WEBHOOK,
 * and only `credit_purchased_recharge` (migration 033) moves it to `succeeded`.
 * `refunded` is IN: that is a recharge that succeeded and was later reversed, so
 * its invoice was issued and the member is still entitled to the document —
 * migration 019's numbering is gapless precisely because a missing number
 * invites a GST scrutiny notice.
 *
 * The rule is executed against those states in __tests__/rechargeHistory.test.ts
 * (TransactionHistoryScreen holds a second copy of the same set for its own
 * filter; this export is the one a new caller should use, and that copy should
 * move here the next time that screen is open for edit).
 */
export const SETTLED_RECHARGE_STATUSES: ReadonlySet<TokenTransactionStatus> = new Set([
  'succeeded',
  'refunded',
]);

/** The shape returned from the joined select. */
export interface TokenTransaction {
  id: string;
  kind: 'recharge' | 'refund' | 'adjustment';
  status: 'created' | 'succeeded' | 'failed' | 'refunded';
  amountPaise: number;
  tokensDelta: number;
  gateway: string | null;
  createdAt: string;
  invoice?: {
    id: string;
    invoiceNumber: string;
    documentType: 'tax_invoice' | 'bill_of_supply';
    pdfPath: string | null;
  } | null;
}

/** Raw database row shape from the joined query. */
interface RawTransaction {
  id: string;
  kind: string;
  status: string;
  amount_paise: number;
  tokens_delta: number;
  gateway: string | null;
  created_at: string;
  // 1:1 unique FK: Supabase returns the child as a single object, not an array.
  invoices: {
    id: string;
    invoice_number: string;
    document_type: string;
    pdf_path: string | null;
  } | null;
}

function mapTransaction(row: RawTransaction): TokenTransaction {
  const inv = row.invoices ?? null;
  return {
    id: row.id,
    kind: row.kind as TokenTransaction['kind'],
    status: row.status as TokenTransaction['status'],
    amountPaise: row.amount_paise,
    tokensDelta: row.tokens_delta,
    gateway: row.gateway,
    createdAt: row.created_at,
    invoice: inv
      ? {
          id: inv.id,
          invoiceNumber: inv.invoice_number,
          documentType: inv.document_type as 'tax_invoice' | 'bill_of_supply',
          pdfPath: inv.pdf_path,
        }
      : null,
  };
}

/**
 * The member's recharge history, newest first, with the associated invoice
 * row embedded. Supabase embeds `invoices` via the unique FK on
 * `invoices.transaction_id`.
 */
export function useTransactions() {
  return useQuery<TokenTransaction[]>({
    queryKey: txKeys.list,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('token_transactions')
        .select(
          'id, kind, status, amount_paise, tokens_delta, gateway, created_at, invoices(id, invoice_number, document_type, pdf_path)',
        )
        // This is the recharge/receipts history: show top-ups and their
        // corrections only. `usage_debit` (spending) and `provider_accrual`
        // (earnings) are a different ledger and have no invoice — including them
        // produced rows with no label (their kind is outside kindLabel's set).
        .in('kind', ['recharge', 'refund', 'adjustment'])
        .order('created_at', { ascending: false });
      if (error) {
        throw new Error(error.message);
      }
      return (data as RawTransaction[]).map(mapTransaction);
    },
    staleTime: 30_000,
  });
}

/** One issued billing document, exactly as `public.invoices` holds it. */
export interface InvoiceRecord {
  id: string;
  /** Gapless per-FY number minted by `record_invoice`, e.g. AXN/2026-27/00012. */
  invoiceNumber: string;
  /**
   * `tax_invoice` when the seller had a GSTIN at issue time, `bill_of_supply`
   * otherwise. Every document issued so far is a bill of supply (checked
   * against the live table 2026-09-13: 13 rows, all `bill_of_supply`), because
   * SELLER_GSTIN is still empty in generate-invoice's environment. A screen
   * that calls them all "tax invoices" would be labelling an untaxed document
   * as a taxed one, so the label comes off this field per row.
   */
  documentType: 'tax_invoice' | 'bill_of_supply';
  issuedAt: string;
  totalPaise: number;
  /** Null until generate-invoice has uploaded the PDF and called set_invoice_pdf. */
  pdfPath: string | null;
}

/** A recharge and the document raised for it, if one has been raised yet. */
export interface BillingRow {
  transactionId: string;
  status: TokenTransactionStatus;
  /** What the member was charged, from the ledger row. */
  amountPaise: number;
  paidAt: string;
  invoice: InvoiceRecord | null;
}

interface RawBillingRow {
  id: string;
  status: string;
  amount_paise: number;
  created_at: string;
  /*
   * One object or null, never an array — the same shape RawTransaction relies
   * on. PostgREST returns a to-ONE embed as an object when the foreign key
   * column carries a unique constraint, and `invoices_transaction_id_key
   * UNIQUE (transaction_id)` is on the live table (checked 2026-09-13). The
   * select itself was run against the live REST endpoint and parsed (200), so
   * the embed name resolves too.
   */
  invoices: {
    id: string;
    invoice_number: string;
    document_type: string;
    issued_at: string;
    total_paise: number;
    pdf_path: string | null;
  } | null;
}

/**
 * How often to re-ask while a document is still missing its PDF.
 *
 * An invoice is minted by a pg_net call the recharge trigger fires (migration
 * 046) and the PDF lands a second or two later, so "pending" is a state that
 * resolves on its own while the member is looking at it. Polling only while
 * something is actually pending is what keeps this from being a background
 * timer: `refetchInterval` returns false the moment every row has its PDF.
 */
const PENDING_POLL_MS = 15_000;

/**
 * The member's billing documents: every recharge with its invoice attached.
 *
 * Queried through `token_transactions` rather than straight off `invoices`
 * because the interesting states are the ones with NO document — a top-up whose
 * invoice has not been raised yet, and an attempt that never took any money.
 * Starting from the ledger makes those rows visible; starting from `invoices`
 * would silently drop them and leave a member who paid staring at a list that
 * does not mention their payment. RLS does the rest: `Members read own
 * transactions` bounds this list, and `Members read own invoices` (migration
 * 019, verified live) bounds the embed.
 *
 * `kind = 'recharge'` because that is the only kind that is ever invoiced —
 * migration 046's triggers fire on `new.kind = 'recharge'`, and there is no
 * credit-note table, so a refund or a manual adjustment has no document to
 * show and would render as a permanently pending row.
 */
export function useBills() {
  return useQuery<BillingRow[]>({
    queryKey: txKeys.bills,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('token_transactions')
        .select(
          'id, status, amount_paise, created_at, invoices(id, invoice_number, document_type, issued_at, total_paise, pdf_path)',
        )
        .eq('kind', 'recharge')
        .order('created_at', { ascending: false });
      if (error) {
        throw new Error(error.message);
      }
      return (data as RawBillingRow[]).map(row => ({
        transactionId: row.id,
        status: row.status as TokenTransactionStatus,
        amountPaise: row.amount_paise,
        paidAt: row.created_at,
        invoice:
          row.invoices === null
            ? null
            : {
                id: row.invoices.id,
                invoiceNumber: row.invoices.invoice_number,
                documentType: row.invoices.document_type as InvoiceRecord['documentType'],
                issuedAt: row.invoices.issued_at,
                totalPaise: row.invoices.total_paise,
                pdfPath: row.invoices.pdf_path,
              },
      }));
    },
    staleTime: 30_000,
    refetchInterval: query =>
      (query.state.data ?? []).some(
        row => SETTLED_RECHARGE_STATUSES.has(row.status) && row.invoice?.pdfPath == null,
      )
        ? PENDING_POLL_MS
        : false,
  });
}

/**
 * A signed URL for one stored invoice PDF, cached.
 *
 * Mirrors useAttachmentUrl exactly: keyed on the path, staleTime just under
 * the TTL so react-query re-mints before the URL expires, enabled only when
 * pdfPath is a non-empty string.
 */
export function useInvoiceUrl(pdfPath: string | null | undefined) {
  return useQuery({
    queryKey: txKeys.invoiceUrl(pdfPath),
    enabled: typeof pdfPath === 'string' && pdfPath.length > 0,
    staleTime: (INVOICE_URL_TTL_SECONDS - 30) * 1000,
    gcTime: INVOICE_URL_TTL_SECONDS * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from('invoices')
        .createSignedUrl(pdfPath as string, INVOICE_URL_TTL_SECONDS);
      if (error || !data) {
        throw error ?? new Error('no signed url');
      }
      return data.signedUrl;
    },
  });
}

/**
 * Format paise as a rupee string with 2 decimal places.
 * ₹30000 paise → '₹300.00'
 */
export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

/**
 * Fetch an invoice URL on demand (used by the Download press handler when the
 * URL has not been pre-fetched by the visible list).
 */
export function useFetchInvoiceUrl() {
  const queryClient = useQueryClient();
  return async (pdfPath: string): Promise<string | null> => {
    try {
      return await queryClient.fetchQuery({
        queryKey: txKeys.invoiceUrl(pdfPath),
        staleTime: (INVOICE_URL_TTL_SECONDS - 30) * 1000,
        queryFn: async () => {
          const { data, error } = await supabase.storage
            .from('invoices')
            .createSignedUrl(pdfPath, INVOICE_URL_TTL_SECONDS);
          if (error || !data) {
            throw error ?? new Error('no signed url');
          }
          return data.signedUrl;
        },
      });
    } catch {
      return null;
    }
  };
}
