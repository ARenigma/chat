/**
 * Hand-maintained mirror of `supabase/migrations/*.sql`.
 *
 * Kept by hand rather than generated so typechecking never needs a live project
 * or the Supabase CLI. It is small and changes only when a migration does.
 *
 * These are `type` aliases, not `interface`s, on purpose: postgrest-js requires
 * every Row/Insert/Update to satisfy `Record<string, unknown>`, and TypeScript
 * only grants an implicit index signature to object *type aliases*. Switching
 * any of them to `interface` silently degrades the whole client to `any`-ish
 * inference (`.rpc()` args collapse to `never`).
 */

export type UserRole = 'member' | 'provider';

/**
 * The telemetry allowlist, mirrored from the `guard_event_shape` trigger. An
 * unknown name is rejected at insert, so keeping this union in step with the
 * migration is what turns that runtime rejection into a compile error.
 */
export type TelemetryEvent =
  | 'app_open'
  | 'directory_viewed'
  | 'conversation_opened'
  | 'message_sent'
  | 'send_rejected'
  | 'refill_opened'
  | 'refill_claimed'
  | 'report_submitted'
  | 'user_blocked'
  | 'user_unblocked'
  | 'account_deleted'
  | 'identity_linked'
  | 'signed_in'
  | 'application_submitted'
  | 'availability_changed'
  | 'review_submitted';

export type Gender = 'female' | 'male' | 'other';

export type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  role: UserRole;
  token_balance: number;
  identity_verified_at: string | null;
  is_available: boolean;
  /** Non-null and future-dated means suspended. A ban is a far-future value. */
  suspended_until: string | null;
  /** Never sent to another user; the directory publishes a computed age. */
  date_of_birth: string | null;
  gender: Gender | null;
  headline: string | null;
  languages: string[];
  /** Derived from `reviews` by trigger. Not writable by its subject. */
  rating_avg: number | null;
  rating_count: number;
  median_reply_seconds: number | null;
  created_at: string;
  last_refill_at: string | null;
};

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'needs_info'
  | 'approved'
  | 'rejected';

/**
 * What an applicant may see about their own application.
 *
 * `missing_fields` is the whole point: Clarity leaves listeners on "Something
 * Missing" with no idea which field, and they churn in public in the store
 * reviews. This is structured so the UI can point at the input.
 */
export type MyApplication = {
  status: ApplicationStatus;
  missing_fields: string[];
  reviewer_note: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type Review = {
  id: string;
  conversation_id: string;
  member_id: string;
  provider_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
};

/** Counted in tokens. Converting to currency is Stripe Connect's job, unbuilt. */
export type ProviderEarnings = {
  billable_messages: number;
  refunded_messages: number;
  members_served: number;
  conversations: number;
  first_message_at: string | null;
};

export type ReportReason =
  | 'harassment'
  | 'sexual_content'
  | 'minor_safety'
  | 'solicitation'
  | 'self_harm'
  | 'spam'
  | 'impersonation'
  | 'other';

export type ReportStatus = 'open' | 'actioned' | 'dismissed';

/** What the reporter is allowed to see back — deliberately not the resolver note. */
export type MyReport = {
  id: string;
  reason: ReportReason;
  status: ReportStatus;
  created_at: string;
  resolved_at: string | null;
};

export type Block = {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
};

/**
 * One row per thread for the inbox. A view rather than a client-side join
 * because the preview and the unread count would otherwise be two extra round
 * trips per row.
 */
export type ConversationSummary = {
  id: string;
  last_message_at: string;
  peer_id: string;
  peer_display_name: string | null;
  peer_available: boolean;
  last_body: string | null;
  last_sender_id: string | null;
  unread_count: number;
  reviewed: boolean;
  /**
   * Whether the caller is the paying side of *this* thread. Not the same as
   * `profiles.role === 'member'`: a member admitted as a provider keeps the
   * threads they paid for, and is still entitled to rate them. See migration
   * 007.
   */
  i_am_member: boolean;
};

/**
 * The member-facing projection of a provider. Deliberately a view with an
 * explicit column list, so a column added to `profiles` later cannot leak into
 * the directory by default.
 */
export type ProviderSummary = {
  id: string;
  display_name: string;
  gender: Gender | null;
  /** Integer years. The birth date itself is never exposed. */
  age: number | null;
  headline: string | null;
  languages: string[];
  is_available: boolean;
  rating_avg: number | null;
  rating_count: number;
  /** Published so "does she actually reply" is answerable before spending. */
  median_reply_seconds: number | null;
  created_at: string;
};

export type Conversation = {
  id: string;
  member_id: string;
  provider_id: string;
  created_at: string;
  last_message_at: string;
};

/**
 * `sender_id` rather than a `'user' | 'assistant'` discriminator: authorship is
 * now a real profile, which is what makes it provable and moderation possible.
 * Which side of the transcript a row renders on is a comparison against the
 * session's own id, not a property of the row.
 */
export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

export type SendError =
  | 'UNAUTHORIZED'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INSUFFICIENT_BALANCE'
  // Added by migration 005. None of these debit a token.
  | 'BLOCKED'
  | 'SUSPENDED'
  | 'RATE_LIMITED';

export type SendResult = {
  success: boolean;
  message_id?: string;
  created_at?: string;
  /** Null when the sender is the provider — a reply costs nothing. */
  new_balance?: number | null;
  error?: SendError;
};

export type ClaimResult = {
  success: boolean;
  new_balance?: number;
  error?: 'UNAUTHORIZED' | 'NO_PROFILE' | 'TOO_SOON';
  retry_after?: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
      conversations: {
        Row: Conversation;
        Insert: Partial<Conversation> & { member_id: string; provider_id: string };
        Update: Partial<Conversation>;
        Relationships: [];
      };
      messages: {
        Row: Message;
        // No client Insert path: sending goes through `send_message` so the
        // debit and the insert cannot come apart. The only field a recipient may
        // write is `read_at`, which a trigger enforces.
        Insert: never;
        Update: { read_at: string };
        Relationships: [];
      };
      blocks: {
        Row: Block;
        Insert: { blocker_id: string; blocked_id: string };
        // A block is created or removed, never edited.
        Update: never;
        Relationships: [];
      };
      events: {
        Row: never;
        Insert: { user_id: string; name: TelemetryEvent; props?: Record<string, string | number | boolean> };
        Update: never;
        Relationships: [];
      };
      provider_applications: {
        Row: {
          id: string;
          user_id: string;
          status: ApplicationStatus;
          display_name: string | null;
          gender: Gender | null;
          date_of_birth: string | null;
          headline: string | null;
          languages: string[];
          about: string | null;
          missing_fields: string[];
          submitted_at: string | null;
          reviewed_at: string | null;
          reviewer_note: string | null;
          created_at: string;
        };
        // Written through submit_provider_application, so completeness is
        // computed server-side rather than asserted by the client.
        Insert: never;
        Update: never;
        Relationships: [];
      };
      reviews: {
        Row: Review;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      provider_directory: {
        Row: ProviderSummary;
        Relationships: [];
      };
      conversation_summaries: {
        Row: ConversationSummary;
        Relationships: [];
      };
      my_reports: {
        Row: MyReport;
        Relationships: [];
      };
      my_application: {
        Row: MyApplication;
        Relationships: [];
      };
      provider_earnings: {
        Row: ProviderEarnings;
        Relationships: [];
      };
    };
    Functions: {
      open_conversation: {
        Args: { p_provider_id: string };
        Returns: string;
      };
      send_message: {
        Args: { p_conversation_id: string; p_body: string };
        Returns: SendResult;
      };
      submit_report: {
        Args: {
          p_conversation_id: string;
          p_message_id: string | null;
          p_reason: ReportReason;
          p_detail?: string | null;
        };
        Returns: string;
      };
      submit_provider_application: {
        Args: {
          p_display_name: string;
          p_gender: Gender | null;
          p_date_of_birth: string | null;
          p_headline: string;
          p_languages: string[];
          p_about: string;
        };
        /** The fields still missing. Empty means it entered the queue. */
        Returns: string[];
      };
      submit_review: {
        Args: { p_conversation_id: string; p_rating: number; p_comment?: string | null };
        Returns: undefined;
      };
      claim_daily_tokens: {
        Args: Record<string, never>;
        Returns: ClaimResult;
      };
      delete_user_account: {
        Args: Record<string, never>;
        Returns: undefined;
      };
    };
    Enums: {
      user_role: UserRole;
      application_status: ApplicationStatus;
      report_reason: ReportReason;
      report_status: ReportStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
