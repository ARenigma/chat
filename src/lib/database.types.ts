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
  | 'review_submitted'
  // Added by 011. `reaction_removed` is separate from `reaction_added` because
  // a reaction taken back is the interesting half: it is the closest thing the
  // product has to a regret signal.
  | 'reaction_added'
  | 'reaction_removed'
  | 'reply_sent'
  | 'voice_note_sent'
  | 'voice_note_played'
  | 'call_started'
  | 'call_answered'
  | 'call_declined'
  | 'call_ended'
  // A call that never rang: blocked, suspended, busy or out of balance. The
  // reason belongs in `props.reason`, which is why there is one name and not
  // four.
  | 'call_rejected'
  | 'presence_changed';

export type Gender = 'female' | 'male' | 'other';

/**
 * What somebody has chosen to publish about being reachable. Three values rather
 * than a boolean because `away` and `hidden` are observably different to the
 * person looking: away publishes the word, hidden publishes nothing, and
 * collapsing them would make opting out of presence and declaring yourself
 * absent the same statement.
 *
 * Not `is_available`, which is the provider's directory listing switch. Every
 * dot in the app read that as presence until migration 012, which meant a
 * provider who wanted work but had put the phone down still showed as here, and
 * a member could not appear present at all.
 */
export type PresenceChoice = 'here' | 'away' | 'hidden';

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
  /**
   * Provider-only, all three of them. `member_is_pseudonymous` in 011 makes a
   * member row carrying any of these unrepresentable: nobody pays to choose a
   * member, so a member's birth date, gender and headline buy nothing and are
   * pure re-identification risk on the side of the conversation that is talking
   * about the worst week of their life.
   */
  date_of_birth: string | null;
  gender: Gender | null;
  headline: string | null;
  languages: string[];
  /**
   * The user's own setting, like WhatsApp's Last Seen, and the one column added
   * by 011 that a client is meant to write. False by default: presence is not
   * derived from whether the app happens to be in the foreground, because
   * nobody agreed to have that published about them.
   */
  presence_visible: boolean;
  /** Written only by `touch_presence`, and only while `presence_visible`. */
  last_active_at: string | null;
  /**
   * The declared state, added by 012, and the only presence signal a screen
   * should render. Client-writable and deliberately in no guard trigger: being
   * reachable or not is the one thing about themselves a person must be able to
   * change instantly. `useSetPresence` writes it and `presence_visible` together,
   * so there is one control rather than two.
   */
  presence: PresenceChoice;
  /** Derived from `reviews` by trigger. Not writable by its subject. */
  rating_avg: number | null;
  rating_count: number;
  median_reply_seconds: number | null;
  /**
   * Set by `verify_phone`, which only the `verify-phone` Edge Function can call.
   * Migration 010 also adds `phone_e164`; it is deliberately absent from this
   * type, because no screen needs the number and typing it would invite one to
   * hold it.
   */
  phone_verified_at: string | null;
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

/** What the reporter is allowed to see back, deliberately not the resolver note. */
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
  /** The peer's photo (providers only; null for members and until set). */
  peer_avatar_url: string | null;
  /**
   * The peer's declared presence. Replaced `peer_available` in 012: that column
   * resolved the provider's listing switch through a join that is false for
   * every member, so a member could never appear present to the provider waiting
   * on them, however they set it.
   */
  peer_presence: PresenceChoice;
  last_body: string | null;
  /**
   * A voice note has no body, so an inbox reading `last_body` alone renders a
   * blank preview. Null only when the thread has no messages at all.
   */
  last_kind: 'text' | 'voice' | null;
  last_sender_id: string | null;
  unread_count: number;
  reviewed: boolean;
  /** Null unless the peer turned presence on. Resolved through `conversation_peers`. */
  peer_last_active_at: string | null;
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
  /** Member-facing profile photo (public storage URL). Null → initial fallback. */
  avatar_url: string | null;
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
  /**
   * "Is she around now", published only with the provider's own consent. Null
   * whenever `presence_visible` is off, which the view enforces rather than
   * leaving to the client.
   */
  last_active_at: string | null;
  created_at: string;
  /**
   * The declared state, which is what the directory dot renders. `is_available`
   * above is the listing switch and answers a different question: a provider is
   * entitled to be here and closed for work, or listed and asleep.
   */
  presence: PresenceChoice;
};

/**
 * The only projection of a MEMBER that another user ever sees, and the mirror
 * image of `provider_directory`. A member peer resolves to a handle, so their
 * display name is unreachable from here by construction.
 */
export type ConversationPeer = {
  conversation_id: string;
  peer_id: string;
  peer_display_name: string;
  /** The provider's listing switch, and false for a member peer by definition. */
  peer_available: boolean;
  peer_last_active_at: string | null;
  peer_is_provider: boolean;
  /** The declared state, published for either role. Added by 012. */
  peer_presence: PresenceChoice;
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
  /**
   * Null on a voice note, and that is the whole point of the change: 011 turned
   * the body CHECK into a payload CHECK, so a row carries text or audio and
   * never both. Every reader has to decide what a bodiless message looks like
   * rather than rendering an empty bubble by accident.
   */
  body: string | null;
  /**
   * The message being replied to. `on delete set null`, so a reply survives
   * losing its parent: a reply is its own statement.
   */
  reply_to_id: string | null;
  /** `<conversation uuid>/<uuid>.m4a` in the private `voice-notes` bucket. */
  voice_path: string | null;
  voice_duration_ms: number | null;
  /**
   * `<conversation uuid>/<uuid>.<ext>` in the private `attachments` bucket, or
   * null. The third payload (014): a message carries text, audio, OR a photo.
   * The intrinsic pixel size rides with it so the bubble can reserve the aspect
   * box before the image decodes and the transcript does not reflow.
   */
  attachment_path: string | null;
  attachment_type: 'image' | null;
  attachment_width: number | null;
  attachment_height: number | null;
  created_at: string;
  read_at: string | null;
};

/**
 * A closed set, not free text, and that is the safety argument for the feature:
 * a reaction renders under somebody else's words in their transcript, so free
 * text there would be an unmoderatable channel aimed at one person.
 *
 * The heart is U+2764 U+FE0F. It must stay byte-identical to the CHECK
 * constraint in migration 011 or every heart reaction comes back BAD_REQUEST,
 * and nothing in typecheck or lint would notice.
 */
export type ReactionEmoji = '❤️' | '👍' | '😂' | '😮' | '😢' | '🙏';

export type MessageReaction = {
  message_id: string;
  user_id: string;
  emoji: ReactionEmoji;
  created_at: string;
};

export type CallMedium = 'voice' | 'video';

export type CallStatus =
  | 'ringing'
  | 'active'
  | 'ended'
  /** Nobody picked up, which is a different fact about a provider from `declined`. */
  | 'missed'
  | 'declined'
  /** Negotiation never completed. Kept apart from `ended` so NAT problems are visible. */
  | 'failed';

export type CallEndReason =
  | 'hangup'
  | 'declined'
  | 'unanswered'
  /** Nobody heartbeated for 90 seconds, so the server stopped the meter. */
  | 'dropped'
  | 'out_of_tokens'
  | 'blocked'
  | 'suspended'
  | 'media_failed';

/**
 * Read-only on the client, every field of it. Each transition goes through an
 * RPC so the meter and the row cannot come apart, and there is no INSERT,
 * UPDATE or DELETE policy on the table at all.
 */
export type Call = {
  id: string;
  conversation_id: string;
  /** Either party may dial, so these are caller/callee, not member/provider. */
  caller_id: string;
  callee_id: string;
  medium: CallMedium;
  status: CallStatus;
  created_at: string;
  /** The answer, not the invitation. The meter reads this and nothing else. */
  started_at: string | null;
  ended_at: string | null;
  last_seen_at: string;
  minutes_billed: number;
  tokens_debited: number;
  end_reason: CallEndReason | null;
  notified_at: string | null;
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

/**
 * The call RPCs reuse `send_message`'s error vocabulary and add two of their own,
 * so they share a type rather than widening `SendError`: `BUSY` and `GONE` have
 * no meaning on a message, and putting them there would force two nonsense
 * entries into the composer's notice map.
 */
export type CallError = SendError | 'BUSY' | 'GONE';

export type SendResult = {
  success: boolean;
  message_id?: string;
  created_at?: string;
  /** Which payload shape landed, so a caller need not re-derive it. */
  kind?: 'text' | 'voice';
  /** Null when the sender is the provider: a reply costs nothing. */
  new_balance?: number | null;
  error?: SendError;
};

/** `toggle_reaction` returns the resulting state, because which of add, replace or remove happened is not derivable from the arguments. */
export type ReactionResult = {
  success: boolean;
  /** Null means the reaction was taken back. */
  emoji?: ReactionEmoji | null;
  error?: SendError;
};

export type CallResult = {
  success: boolean;
  call_id?: string;
  medium?: CallMedium;
  status?: CallStatus;
  started_at?: string;
  end_reason?: CallEndReason | null;
  minutes_billed?: number;
  tokens_debited?: number;
  /** The price, read from the authority rather than hardcoded on the device. */
  tokens_per_minute?: number;
  /** What `start_call` wanted in the member's wallet, on INSUFFICIENT_BALANCE. */
  minimum?: number;
  error?: CallError;
};

export type ClaimResult = {
  success: boolean;
  new_balance?: number;
  error?: 'UNAUTHORIZED' | 'NO_PROFILE' | 'TOO_SOON';
  retry_after?: string;
};

/** Returned by the `spend_chat_minute` RPC (migration 021). */
export type SpendChatMinuteResult = {
  success: boolean;
  new_balance?: number;
  error?: 'UNAUTHORIZED' | 'INSUFFICIENT_BALANCE';
};

/** Returned by the `mock_recharge` RPC (migration 020). Only callable when
 *  `app_flags.mock_payments = true`; inert (MOCK_DISABLED) in production. */
export type MockRechargeResult = {
  success: boolean;
  transaction_id?: string;
  new_balance?: number;
  error?: 'NOT_AUTHENTICATED' | 'MOCK_DISABLED' | 'INVALID_AMOUNT';
};

/** Added by migration 019. */
export type TokenTransactionKind = 'recharge' | 'refund' | 'adjustment';
export type TokenTransactionStatus = 'created' | 'succeeded' | 'failed' | 'refunded';

/**
 * One immutable ledger row per wallet event. Readable by the member who owns
 * it; written only by service_role via complete_recharge.
 */
export type TokenTransactionRow = {
  id: string;
  user_id: string;
  kind: TokenTransactionKind;
  status: TokenTransactionStatus;
  amount_paise: number;
  tokens_delta: number;
  gateway: string | null;
  gateway_ref: string | null;
  gateway_order_id: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceDocumentType = 'tax_invoice' | 'bill_of_supply';

/** GST invoice record. Readable by the member who owns the linked transaction. */
export type InvoiceRow = {
  id: string;
  transaction_id: string;
  invoice_number: string;
  document_type: InvoiceDocumentType;
  fy: string;
  issued_at: string;
  seller: Record<string, unknown>;
  buyer: Record<string, unknown>;
  place_of_supply: string | null;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  gst_rate_bps: number;
  pdf_path: string | null;
  created_at: string;
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
      /**
       * Writes go through `toggle_reaction`, which is the only place the block
       * check can happen: `is_blocked_pair` is deliberately not callable by a
       * client, so an RLS policy (which runs as the caller) cannot consult it.
       */
      message_reactions: {
        Row: MessageReaction;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * Every transition is an RPC, so the meter and the row cannot come apart.
       * A client that could write here could zero its own bill.
       */
      calls: {
        Row: Call;
        Insert: never;
        Update: never;
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
      /**
       * Registration happens through `register_push_token`, never an insert,
       * the client must not be able to name the user a token belongs to. Delete
       * is allowed so a sign-out can revoke this device.
       */
      push_tokens: {
        Row: { token: string; user_id: string; platform: string; created_at: string; last_seen_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * Event-sourced ledger: one immutable row per wallet movement.
       * Clients may SELECT their own rows; all writes go through complete_recharge
       * (service_role). The `invoices` table has a unique FK to this.
       */
      token_transactions: {
        Row: TokenTransactionRow;
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'invoices_transaction_id_fkey';
            columns: ['id'];
            isOneToOne: true;
            referencedRelation: 'invoices';
            referencedColumns: ['transaction_id'];
          },
        ];
      };
      /**
       * GST invoice record linked 1:1 to a token_transaction. Clients may SELECT
       * invoices for transactions they own; only service_role writes.
       */
      invoices: {
        Row: InvoiceRow;
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: 'invoices_transaction_id_fkey';
            columns: ['transaction_id'];
            isOneToOne: true;
            referencedRelation: 'token_transactions';
            referencedColumns: ['id'];
          },
        ];
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
      conversation_peers: {
        Row: ConversationPeer;
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
      /**
       * One send path for all payload shapes. Every argument after the
       * conversation id is defaulted, so the existing two-argument call site is
       * unchanged, but exactly one of `p_body`, `p_voice_path` and
       * `p_attachment_path` may be set (014 made the payload three-way).
       */
      send_message: {
        Args: {
          p_conversation_id: string;
          p_body?: string | null;
          p_reply_to_id?: string | null;
          p_voice_path?: string | null;
          p_voice_duration_ms?: number | null;
          p_attachment_path?: string | null;
          p_attachment_width?: number | null;
          p_attachment_height?: number | null;
        };
        Returns: SendResult;
      };
      toggle_reaction: {
        Args: { p_message_id: string; p_emoji: ReactionEmoji };
        Returns: ReactionResult;
      };
      start_call: {
        Args: { p_conversation_id: string; p_medium: CallMedium };
        Returns: CallResult;
      };
      answer_call: {
        Args: { p_call_id: string };
        Returns: CallResult;
      };
      /**
       * Liveness plus a settle, so the figure on screen is the figure the server
       * has actually charged. Also the only thing that tells a call in progress
       * apart from one whose app was killed.
       */
      heartbeat_call: {
        Args: { p_call_id: string };
        Returns: CallResult;
      };
      end_call: {
        Args: { p_call_id: string; p_reason?: string };
        Returns: CallResult;
      };
      touch_presence: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      /** The price, so the pre-call sheet quotes the server rather than a literal. */
      call_tokens_per_minute: {
        Args: Record<string, never>;
        Returns: number;
      };
      call_minimum_minutes: {
        Args: Record<string, never>;
        Returns: number;
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
      register_push_token: {
        Args: { p_token: string; p_platform?: string };
        Returns: void;
      };
      submit_review: {
        Args: { p_conversation_id: string; p_rating: number; p_comment?: string | null };
        Returns: undefined;
      };
      claim_daily_tokens: {
        Args: Record<string, never>;
        Returns: ClaimResult;
      };
      /**
       * Dev-only mock payment that writes a real ledger row and credits the
       * balance. Gated by app_flags.mock_payments; returns MOCK_DISABLED when
       * the flag is false (which it is in production).
       */
      mock_recharge: {
        Args: { p_amount_paise: number; p_tokens: number };
        Returns: MockRechargeResult;
      };
      /**
       * Deducts one chat minute (22 tokens) from the calling user's balance.
       * Self-scoped SECURITY DEFINER (migration 021). Returns success +
       * new_balance, or INSUFFICIENT_BALANCE if the balance is too low.
       */
      spend_chat_minute: {
        Args: Record<string, never>;
        Returns: SpendChatMinuteResult;
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
      call_medium: CallMedium;
      call_status: CallStatus;
      presence_choice: PresenceChoice;
    };
    CompositeTypes: Record<string, never>;
  };
};
