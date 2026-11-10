export interface PayableRow {
  provider_id: string;
  display_name: string | null;
  claimable_tokens: number;
  account_status: string | null;
  pan_status: string | null;
  payable: boolean;
}

export interface HistoryRow {
  id: string;
  provider_id: string;
  provider_name: string | null;
  /** provider_payout_batches.status: pending | processing | completed | failed. */
  status: string;
  total_tokens: number;
  total_paise: number;
  /** The Cashfree batch reference, once the transfer has been submitted. */
  cashfree_batch_id?: string | null;
  initiated_by: string | null;
  initiated_at: string | null;
  completed_at: string | null;
  created_at: string;
}
