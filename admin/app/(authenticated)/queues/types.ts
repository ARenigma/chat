export interface ContactGuardRow {
  user_id: string;
  role: string | null;
  display_name: string | null;
  review_state: string | null;
  review_requested_at: string | null;
  active_strikes: number;
  paused_until: string | null;
  directory_hidden_until: string | null;
  suspended_until: string | null;
  last_event_at: string | null;
  categories: string[] | null;
}

export interface RefundRow {
  id: string;
  user_id: string;
  purchased_tokens: number;
  amount_paise: number;
  status: string;
  notes: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}
