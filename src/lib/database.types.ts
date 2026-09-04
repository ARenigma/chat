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
  | 'presence_changed'
  // Added by migration 032 (policy gate + paid sessions).
  | 'policy_accepted'
  | 'session_requested'
  | 'session_ended'
  // Added by migration 033 (UCB / Cashfree billing).
  | 'recharge_sheet_opened'
  // Cashfree WebCheckout sandbox events (ADR-0022).
  | 'cashfree_checkout_verify'
  | 'cashfree_checkout_error'
  | 'screen_opened'
  | 'sheet_closed'
  | 'query_slow'
  | 'frame_jank';

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
  /**
   * The one signal for "did the identity step run" (migration 054). The app
   * reads THIS, not `identity_verified_at` and not `date_of_birth is not null` —
   * those two used to be read as flags by different callers and could disagree.
   */
  identity_state: 'none' | 'pending' | 'verified';
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
  about: string | null;
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
  /**
   * Provider directory photo (public Storage URL). Null until set; UI falls
   * back to an initial. Members never publish this off the directory (013).
   */
  avatar_url: string | null;
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
  /** Set when a member completes first-run profile setup. Migration 040. */
  profile_completed_at: string | null;
  /**
   * Self-declared age band. Null until the member completes first-run or the
   * app gate collects it. Four bands: '18-24' | '25-34' | '35-44' | '45+'.
   * Fail-closed: the app gate treats null as undeclared and blocks entry until
   * the bracket is set. Migration 043.
   */
  age_bracket: '18-24' | '25-34' | '35-44' | '45+' | null;
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

/**
 * Provider earnings summary from the `provider_earnings` view (migration 038+).
 * provider_tokens is the 60% share; gross_tokens is full member spend.
 * 1 token = ₹1 (ADR-0021); payouts are via Cashfree Payouts, not yet live.
 */
export type ProviderEarnings = {
  minutes_billed: number;
  provider_tokens: number;
  gross_tokens: number;
  sessions: number;
  members_served: number;
  first_earned_at: string | null;
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
 * One row per thread for the inbox. Backed by the `conversation_summaries`
 * view (last rebuilt in migration 031: no message content by design).
 *
 * ADR-0020: ephemeral session content must never surface in list views.
 * `last_body`, `last_kind`, `last_sender_id`, `unread_count`, and `reviewed`
 * were removed in migration 031. Use `last_preview_kind` for the row icon and
 * `last_session_at` for ordering and timestamp display.
 */
export type ConversationSummary = {
  /** The conversation id (column renamed from `id` in migration 031). */
  conversation_id: string;
  peer_id: string;
  peer_display_name: string | null;
  /** The peer's photo (providers only; null for members and until set). */
  peer_avatar_url: string | null;
  /**
   * The peer's declared presence. Replaced `peer_available` in 012: that
   * column resolved the provider's listing switch through a join that was false
   * for every member.
   */
  peer_presence: PresenceChoice | null;
  /** Null unless the peer turned presence on. */
  peer_last_active_at: string | null;
  /**
   * Timestamp of the most recent session event for this thread (populated by
   * send_message and session lifecycle). Use for ordering and row timestamp.
   * Null for conversations that pre-date migration 030.
   */
  last_session_at: string | null;
  /**
   * Channel of the most recent session (chat/audio/video). Null when no
   * session has been started on this thread.
   */
  last_session_channel: 'chat' | 'audio' | 'video' | null;
  /** Duration in seconds of the most recent session. */
  last_session_duration_seconds: number | null;
  /** Content-free label used to choose the inbox row copy/icon. */
  last_preview_kind: 'text' | 'voice' | 'image' | 'call' | 'session' | null;
  /** Latest paid-session lifecycle state; metadata only. */
  last_session_status:
    | 'pending_leases'
    | 'active'
    | 'warning'
    | 'grace'
    | 'ended'
    | 'reported_hold'
    | null;
  /**
   * Unread count for the member side of the thread. The caller must use
   * `i_am_member` to pick the right counter: if `i_am_member` is true, use
   * `unread_count_member`; otherwise use `unread_count_provider`.
   */
  unread_count_member: number;
  unread_count_provider: number;
  /**
   * Whether the caller is the paying side of *this* thread. Not the same as
   * `profiles.role === 'member'`: a member admitted as a provider keeps the
   * threads they paid for. See migration 007.
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
  /** Longer About paragraph. Distinct from the one-line headline. */
  about: string | null;
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
/**
 * How a message came to exist. `live` is a real human send (`send_message`) and
 * every legacy row; `automated_opener` is a server-seeded provider greeting
 * (`insert_next_opener`). The visible session timer counts only `live` provider
 * messages, so an automated opener can never start the clock. Migration 045.
 */
export type MessageOrigin = 'live' | 'automated_opener';

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
   * Normalised (0..1) amplitude samples captured by the recorder, downsampled
   * to VOICE_BARS before send. Null on pre-023 rows and on text/image messages;
   * the client falls back to flat bars when absent. Added by migration 023.
   */
  voice_peaks: number[] | null;
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
  /**
   * The paid session this row belongs to, or null for a sessionless row (an
   * automated opener, or pre-request content before a session existed). Added
   * by migration 030; surfaced here in 045 because the timer gate needs it.
   */
  session_id: string | null;
  /**
   * Live human send vs automated provider opener. The visible session timer is
   * gated on a `live` provider message, so an opener never counts. Migration 045.
   */
  origin: MessageOrigin;
  created_at: string;
  read_at: string | null;
  // hidden_at / purge_after are deliberately absent: they are the server-only
  // 30-day retention columns (migration 045). A client can never SELECT a
  // hidden row (RLS filters hidden_at is not null), so these never reach the
  // app, and typing them would invite code that tried to read them.
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
  | 'POLICY_REQUIRED'
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
  kind?: 'text' | 'voice' | 'image';
  /** Null when the sender is the provider: a reply costs nothing. */
  new_balance?: number | null;
  session_id?: string | null;
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
  session_id?: string | null;
  session_request_id?: string;
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

/**
 * Returned by the `spend_chat_minute` RPC.
 *
 * Migration 037: spend_chat_minute is now a no-op compatibility shim.
 * `success` is always true, `new_balance` is always null, and `compat`
 * identifies the no-op behaviour. The session meter (meter_active_sessions
 * cron) is the sole billing path. Remove calls to this RPC once all clients
 * are on the session-aware path.
 */
export type SpendChatMinuteResult = {
  success: boolean;
  /** Always null in migration 037+; billing is handled by the session meter. */
  new_balance: null;
  compat: 'no-op';
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

/**
 * A published Terms or Privacy document. Managed via admin dashboard; immutable
 * once published. Migration 027.
 */
export type PolicyVersion = {
  id: string;
  kind: 'terms' | 'privacy';
  version: number;
  is_material: boolean;
  url: string;
  summary: string;
  effective_at: string;
};

/**
 * Server-authoritative acceptance record. Never deleted. Migration 027.
 */
export type PolicyAcceptance = {
  id: string;
  user_id: string;
  policy_kind: 'terms' | 'privacy';
  version_id: string;
  accepted_at: string;
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
      /**
       * Where a provider is paid. Details are saved via upsert_my_payout_account
       * and verified by the verify-payout-account Edge function (048); the client
       * only ever SELECTs its own row.
       */
      provider_payout_accounts: {
        Row: {
          id: string;
          method: 'upi' | 'bank';
          upi_vpa: string | null;
          account_number: string | null;
          ifsc: string | null;
          account_holder_name: string | null;
          verification_status: 'unverified' | 'pending' | 'verified' | 'failed';
          name_at_bank: string | null;
          verification_error: string | null;
          is_default: boolean;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** PAN for tax only (not KYC). Saved via set_my_pan, verified by verify-pan. */
      provider_tax_profile: {
        Row: {
          pan: string | null;
          pan_name: string | null;
          status: 'not_provided' | 'pending' | 'verified' | 'failed';
          failure_reason: string | null;
        };
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
      my_payout_readiness: {
        Row: { payout_account_verified: boolean; pan_verified: boolean; can_go_live: boolean };
        Relationships: [];
      };
    };
    Functions: {
      upsert_my_payout_account: {
        Args: {
          p_method: string;
          p_upi_vpa?: string | null;
          p_account_number?: string | null;
          p_ifsc?: string | null;
          p_account_holder_name?: string | null;
        };
        Returns: string;
      };
      set_my_pan: {
        Args: { p_pan: string };
        Returns: undefined;
      };
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
          /** Waveform peaks for a voice message; ignored for text and image sends. Added by 023. */
          p_voice_peaks?: number[] | null;
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
      /** Auto-approve: go live as a provider in one call. Migration 051. */
      complete_provider_onboarding: {
        Args: {
          p_display_name: string;
          p_headline: string;
          p_languages: string[];
          p_about: string;
        };
        Returns: undefined;
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
       * Self-scoped SECURITY DEFINER (migration 022). Sub-minute remainders are
       * drained to exactly 0 (never stranded). Returns OUT_OF_TOKENS only when
       * the balance is already 0 — positive balances always yield a successful
       * debit, and last=true signals the final minute was just served.
       */
      spend_chat_minute: {
        Args: Record<string, never>;
        Returns: SpendChatMinuteResult;
      };
      delete_user_account: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      /**
       * Returns the latest effective version per kind that the calling user has
       * NOT yet accepted and that requires acceptance. Empty → no gate. Migration 027.
       */
      pending_policy_acceptances: {
        Args: Record<string, never>;
        Returns: Array<{
          version_id: string;
          kind: 'terms' | 'privacy';
          url: string;
          summary: string;
          is_material: boolean;
        }>;
      };
      /**
       * Idempotent acceptance record. ON CONFLICT DO NOTHING. Migration 027.
       */
      accept_policy: {
        Args: { p_version_id: string; p_device_info?: string | null };
        Returns: void;
      };
      check_display_name: {
        Args: { p_name: string };
        Returns: { status: 'available' | 'taken' | 'invalid'; message: string };
      };
      claim_member_profile: {
        Args: { p_display_name: string; p_avatar_seed: string };
        Returns: {
          status: string;
          message: string;
          display_name?: string;
          avatar_url?: string;
        };
      };
      /**
       * Member-only RPC to record a self-declared age band. Migration 043.
       * Valid values: '18-24' | '25-34' | '35-44' | '45+'.
       */
      set_member_age_bracket: {
        Args: { p_bracket: string };
        Returns: void;
      };
      seed_conversation_openers: {
        Args: { p_provider_id: string };
        Returns: {
          conversation_id: string;
          seeded: boolean;
          message_count: number;
        };
      };
      /**
       * Idempotent ordered opener step: inserts exactly one approved provider
       * opener into the caller's own conversation, as the provider, without ever
       * creating or billing a session. Returns the step plus the next body so
       * the client can pace a length-aware typing delay. Migration 045.
       */
      insert_next_opener: {
        Args: { p_provider_id: string };
        Returns: {
          conversation_id: string;
          inserted: boolean;
          done: boolean;
          step: number;
          total: number;
          message_id?: string;
          created_at?: string;
          body: string | null;
          next_body: string | null;
        };
      };
      /**
       * Request a paid session for a conversation/channel. Returns the request id.
       * Migration 030 (pre-launch; stubs present for type-safety).
       */
      create_session_request: {
        Args: { p_conversation_id: string; p_channel: string };
        Returns: string;
      };
      /** Accept a pending session request. Returns the session id. Migration 030. */
      accept_session_request: {
        Args: { p_request_id: string };
        Returns: string;
      };
      /** End an active session with an optional content report. Migration 030. */
      end_session: {
        Args: {
          p_session_id: string;
          p_end_reason?: string | null;
          p_report_reason?: string | null;
          p_report_message_ids?: string[] | null;
          p_report_statement?: string | null;
        };
        Returns: void;
      };
      /**
       * Renew a participant's foreground lease. Returns the session status
       * string so the client can react to `'ended'` (e.g. balance exhausted).
       * Migration 030.
       */
      claim_session_lease: {
        Args: { p_session_id: string; p_kind: string };
        Returns: string;
      };
      /**
       * Returns the active production payload for a config domain.
       * Requires authentication. Used by billing/session RPCs server-side;
       * also callable from authenticated mobile clients. Migration 026.
       */
      get_active_config: {
        Args: { p_domain: string };
        Returns: Record<string, unknown> | null;
      };
      /**
       * Returns the active production payload for a publicly-accessible
       * config domain (kill_switches, auth_ui). Callable by anon and
       * authenticated roles. Migration 035.
       */
      get_public_config: {
        Args: { p_domain: string };
        Returns: Record<string, unknown> | null;
      };
      /**
       * Returns the live session (pending_leases or active) for a conversation,
       * or null if none. Migration 037.
       */
      get_active_session: {
        Args: { p_conversation_id: string };
        Returns: {
          id: string;
          conversation_id: string;
          status: string;
          channel: string;
          member_id: string;
          provider_id: string;
          rate_tokens_per_min: number;
          started_at: string | null;
          accepted_at: string | null;
          ended_at: string | null;
          last_activity_at: string | null;
        } | null;
      };
      /**
       * Returns the most recent non-expired pending session request for a
       * conversation visible to the caller, or null if none. Migration 037.
       */
      get_pending_session_request: {
        Args: { p_conversation_id: string };
        Returns: {
          id: string;
          channel: string;
          initiator_id: string;
          recipient_id: string;
          expires_at: string;
          created_at: string;
        } | null;
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
