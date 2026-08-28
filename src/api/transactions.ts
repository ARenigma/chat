import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/** Signed URL TTL for invoice PDFs — ten minutes, matching attachments. */
const INVOICE_URL_TTL_SECONDS = 600;

export const txKeys = {
  list: ['transactions'] as const,
  invoiceUrl: (p: string | null | undefined) => ['invoice-url', p] as const,
};

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
        .order('created_at', { ascending: false });
      if (error) {
        throw new Error(error.message);
      }
      return (data as RawTransaction[]).map(mapTransaction);
    },
    staleTime: 30_000,
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
