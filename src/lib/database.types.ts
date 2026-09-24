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
  // The media layer failed after the channel opened (Agora onError / a failed
  // connection state) — the "no audio / won't connect" class. Migration 108.
  | 'call_media_failed'
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
 * What somebody chose to publish about being reachable, between migration 012
 * and 2026-09-17. Three values rather than a boolean because `away` and
 * `hidden` were observably different to the person looking: away published the
 * word, hidden published nothing.
 *
 * DEAD TO THE CLIENT since 2026-09-17. `is_available` is the master switch and
 * the only reachability signal any screen reads (src/lib/presence.ts carries
 * the argument); the picker that wrote this is gone from Settings. The type,
 * the columns and the `presence_choice` enum stay so the rows keep typechecking
 * and nothing is destroyed on the way through, and can be dropped once the new
 * model has been live for a while.
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
  /**
   * The master switch, since 2026-09-17. Off means offline everywhere and the
   * member gets the Notify route; on means online, offering whichever of the
   * three channels below is true. It is also what every dot in the app reads.
   */
  is_available: boolean;
  /**
   * Provider-only in practice: which channels they offer (migration 064).
   * Client-writable by their owner and in no guard trigger, like `presence` —
   * with a database floor (`profiles_at_least_one_channel`) rather than trust,
   * because "offering nothing" is what `is_available = false` already says.
   */
  chat_enabled: boolean;
  audio_enabled: boolean;
  video_enabled: boolean;
  /** listener | astrologer (065). Set once at onboarding; in the 065 guard. */
  provider_category: string;
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
  /**
   * Written only by `touch_presence`, and only while `presence_visible` — so
   * never, in practice: no client has ever called that RPC, which is why the
   * app shows a word rather than a last-seen stamp.
   */
  last_active_at: string | null;
  /**
   * The declared state added by 012, and read by nothing since 2026-09-17:
   * `is_available` is the one reachability signal now. Still written by the
   * database's own defaults and left in place; see `PresenceChoice`.
   */
  presence: PresenceChoice;
  /**
   * Provider directory photo (public Storage URL). Null until set; UI falls
   * back to an initial. Members never publish this off the directory (013).
   *
   * Since 070 this MIRRORS the primary row of `provider_photos` and is written
   * by trigger whenever the gallery changes. It stays client-writable only so a
   * bundled `clay:<seed>` avatar can still be chosen (`useSetClayAvatar`); while
   * a gallery is non-empty the photos win, and the next gallery change
   * overwrites a directly-written value.
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
  /**
   * The member's own answer to the onboarding language step (migration 072):
   * which languages they would rather be talked to in. `not null default '{}'`,
   * so empty means "no preference" and there is no third undeclared state.
   *
   * Client-writable by its owner, and the ONE new column since 063 that is
   * meant to be: it is deliberately absent from
   * `guard_privileged_profile_columns()`, in the same set as `presence`,
   * `presence_visible` and `is_available`. Contrast `age_bracket` directly
   * above, which is in the guard and needs an RPC.
   *
   * Never leaves the owner's own row. It is not in `provider_directory` — the
   * mirror-image fact for the other side of the marketplace is
   * `profiles.languages`, published as `ProviderSummary.languages`, and these
   * two are what `sortByLanguageMatch` compares.
   */
  preferred_languages: string[];
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
  /**
   * The session being rated (migration 066). Null only on rows written before
   * that, when a review belonged to the whole conversation.
   */
  session_id: string | null;
};

/** One bar of the ratings chart. Always five rows, 5..1, zeros included. */
export type RatingBar = { stars: 1 | 2 | 3 | 4 | 5; count: number };

/**
 * What a member reads about a provider's reputation before spending
 * (`get_provider_ratings`, migration 066). Aggregate plus the recent comments,
 * and deliberately never a member id: a five-star review is not a reason to
 * publish who wrote it.
 */
export type ProviderRatings = {
  provider_id: string;
  rating_avg: number | null;
  rating_count: number;
  distribution: RatingBar[];
  recent: { rating: number; comment: string | null; created_at: string }[];
};

/**
 * One published photo in a provider's gallery (migration 070).
 *
 * `url` is the same shape `profiles.avatar_url` holds, because the primary row
 * IS `avatar_url`: a trigger mirrors it, one-directionally. Exactly one row per
 * provider is primary while the gallery is non-empty, and the database enforces
 * it (`provider_photos_one_primary` plus the BEFORE trigger that demotes the old
 * one), so a client never has to demote anything — setting a new primary is one
 * UPDATE of one column.
 */
export type ProviderPhoto = {
  id: string;
  provider_id: string;
  url: string;
  is_primary: boolean;
  created_at: string;
};

/**
 * The ceiling the 070 trigger raises P0010 above.
 *
 * Six, not ten: two rows of three tiles in the provider's manager, and a page
 * indicator that still reads as dots rather than a smear on a 360dp hero. The
 * number is duplicated here only so the UI can grey out the add button before a
 * round trip; the database is what actually refuses the seventh.
 */
export const MAX_PROVIDER_PHOTOS = 6;

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
   * The peer's master switch, and what the inbox dot and the chat header read
   * since 2026-09-17.
   *
   * NEEDS A VIEW MIGRATION. `conversation_peers` has resolved this column since
   * 011 (`case when peer.role = 'provider' then peer.is_available else false
   * end`), but `conversation_summaries` — last rebuilt in 037 — does not project
   * it or `peer_is_provider`, so both are absent from the wire until a migration
   * adds `pe.peer_available` and `pe.peer_is_provider` to that select list.
   * Until then every peer reads as not-loaded, which is the fail-closed
   * direction: no dot and no line, rather than a claim.
   */
  peer_available: boolean;
  /**
   * Whether the peer has a listing switch at all. A member does not, so `false`
   * above means "member" rather than "closed", and the two must not render the
   * same way: telling a provider that the member they are talking to is away is
   * inventing a fact about a person. Same migration as `peer_available`.
   */
  peer_is_provider: boolean;
  /**
   * The peer's declared presence. Replaced `peer_available` in 012, and read by
   * nothing since 2026-09-17; see `PresenceChoice`.
   */
  peer_presence: PresenceChoice | null;
  /** Null unless the peer turned presence on. Unread; see `PresenceChoice`. */
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
  /**
   * The master switch, and what the directory dot renders since 2026-09-17: on
   * is online and offering the channels below, off is offline and the Notify
   * route. Published by `provider_directory` since 083.
   */
  is_available: boolean;
  rating_avg: number | null;
  rating_count: number;
  /** Published so "does she actually reply" is answerable before spending. */
  median_reply_seconds: number | null;
  /** Never written by anything; unread since 2026-09-17. See `PresenceChoice`. */
  last_active_at: string | null;
  created_at: string;
  /** The declared state. Unread since 2026-09-17; see `PresenceChoice`. */
  presence: PresenceChoice;
  /**
   * Which channels this provider offers (migration 064), under the master
   * switch above: `is_available` is whether they are open at all, and these are
   * what they are willing to do while they are — a provider who types at 2am but
   * will not be on camera. At least one is always true
   * (`profiles_at_least_one_channel`).
   *
   * A member is shown ONLY the actions these permit, plus a line naming the
   * limit (`offeredChannelsLine`), so a channel that is not offered is absent
   * rather than dead; the trigger on `session_requests` is what enforces it.
   */
  chat_enabled: boolean;
  audio_enabled: boolean;
  video_enabled: boolean;
  /**
   * listener | astrologer (migration 065): which tab a member finds them
   * under, and what search filters by. A tag on the same provider — same
   * onboarding, same rates. Read it through `categoryOf` in
   * lib/providerFilters.ts, which defaults a row from an older server.
   */
  provider_category: string;
  /**
   * What this provider helps with, as short topic tags (migration 083):
   * Anxiety, Relationships, Tarot. Provider-written and never derived — a tag
   * mined out of the headline would be a guess about a human being rendered as
   * a fact.
   *
   * Always an array, never null: the column is `not null default '{}'`, so the
   * explore row branches on `length` rather than on nullness. Empty is legal —
   * unlike languages (075) this is not a promotion requirement, because a
   * provider with no tags is harder to find rather than unusable.
   *
   * Read it through `rowExpertise` in lib/expertise.ts, which dedupes and caps
   * it; 083's CHECK is a shape floor and permits 'Anxiety' and 'anxiety' in the
   * same array.
   */
  expertise: string[];
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
  /** Set when the sender edits their message within the edit window (103). */
  edited_at: string | null;
  /** Set when the sender soft-deletes their message; body becomes null (103). */
  deleted_at: string | null;
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
export type CallMediaBackend = 'current' | 'livekit' | 'agora';

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
  /** Server-owned media assignment; both endpoints read the same value. */
  media_backend: CallMediaBackend;
  media_experiment_id: string | null;
  media_run_id: string | null;
  media_assignment_kind: 'sticky' | 'harness';
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
  | 'RATE_LIMITED'
  /**
   * Migration 064: the provider has switched this channel off. Distinct from
   * FORBIDDEN, which the member cannot act on — this one they can, by picking a
   * channel the provider still offers. Reaches the client two ways: as a
   * structured error from `start_call`, and as a raised P0009 from the trigger
   * for a first text (`send_message` inserts the request directly).
   */
  | 'CHANNEL_DISABLED_BY_PROVIDER';

/**
 * The call RPCs reuse `send_message`'s error vocabulary and add two of their own,
 * so they share a type rather than widening `SendError`: `BUSY` and `GONE` have
 * no meaning on a message, and putting them there would force two nonsense
 * entries into the composer's notice map.
 */
/**
 * `SERVER_ERROR` is not a code any RPC returns. It is synthesised by
 * src/api/calls.ts when the RPC RAISES rather than answering — a schema
 * violation, a revoked grant, a signature change — so that the screen can say
 * something true instead of blaming the network. See the note there; the
 * 2026-09-08 call outage spent a day looking like bad wifi because there was no
 * such code and every raise collapsed to `null`.
 */
/**
 * `ALREADY_RINGING` (M23, 2026-09-17 audit, migration 120): the other party is
 * already calling THIS user in the same conversation. `start_call` returns
 * `call_id` alongside it — the existing (not the refused) call's id — so the
 * caller can be offered a way to answer it instead of a plain refusal.
 */
// INVALID_MEDIUM onward: request_media_upgrade (132).
export type CallError = SendError | 'BUSY' | 'GONE' | 'SERVER_ERROR' | 'ALREADY_RINGING' | 'INVALID_MEDIUM' | 'VIDEO_DISABLED' | 'ALREADY_IN_MEDIUM' | 'UPGRADE_PENDING';

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
  media_backend?: CallMediaBackend;
  media_experiment_id?: string | null;
  /** What `start_call` wanted in the member's wallet, on INSUFFICIENT_BALANCE. */
  minimum?: number;
  error?: CallError;
  /**
   * The Postgres SQLSTATE, present only on a synthesised `SERVER_ERROR`. It is
   * the five characters that identify the fault class (23514 a check
   * constraint, 42501 a grant, 42883 a signature) and it is safe to log:
   * Postgres puts the constraint NAME here, never row values — those live in
   * `error.details`, which is deliberately not carried.
   */
  sqlstate?: string;
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
 *  `app_flags.mock_payments = true`; inert (MOCK_DISABLED) in production.
 *  `RATE_LIMITED` (migration 117): capped at 3 calls per user per 24h,
 *  regardless of the server flag's state. */
export type MockRechargeResult = {
  success: boolean;
  transaction_id?: string;
  new_balance?: number;
  error?: 'NOT_AUTHENTICATED' | 'MOCK_DISABLED' | 'INVALID_AMOUNT' | 'RATE_LIMITED';
};

/** Added by migration 019. */
export type TokenTransactionKind = 'recharge' | 'refund' | 'adjustment';
export type TokenTransactionStatus =
  | 'created'
  | 'succeeded'
  | 'failed'
  | 'refunded';

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

/**
 * Stories (migrations 143-152): a provider's photo or video that lives for 24
 * hours. Any MEMBER sees a LISTED provider's live stories unless the two are
 * blocked; a provider sees only their own. Every read path already filters
 * expiry, role and blocks, so a row a client receives is always one it may
 * show.
 */
export type StoryMediaType = 'image' | 'video';

export type Story = {
  /** Minted by the client before upload: the media is named after it. */
  id: string;
  provider_id: string;
  media_type: StoryMediaType;
  /**
   * Key in the PRIVATE `stories` bucket, `{provider_id}/{id}.{ext}`
   * (jpg/jpeg/png/webp for an image, mp4 for a video). No client can sign it:
   * the bucket has no client read policy (144). Get a URL from the
   * `story-media-url` Edge Function (`{ story_id }` in, `StoryMediaUrl` out),
   * which signs for at most 60 seconds while this row is visible.
   */
  media_path: string;
  /**
   * 1-200 characters with something visible in them and at most 3 line
   * breaks, or null. A blank-looking caption is stored as null (143).
   */
  caption: string | null;
  /** Image: display time, 1-15s (7s when not given). Video: clip length, 1-30s. */
  duration_ms: number;
  created_at: string;
  /** Always created_at + 24h. */
  expires_at: string;
};

/**
 * The `story-media-url` Edge Function's answer: a signed URL for one story's
 * media, good for `expires_in` seconds (60 at most, never past the story's
 * expiry). A 404 means missing, expired, blocked or not an audience, alike.
 */
export type StoryMediaUrl = {
  url: string;
  media_type: StoryMediaType;
  expires_in: number;
};

/** The caller's own "seen" rows (145); nobody else's are readable. */
export type StoryView = {
  story_id: string;
  viewer_id: string;
  viewed_at: string;
};

/** The caller's own reaction to a story (146), from the 011 emoji set. */
export type StoryReaction = {
  story_id: string;
  member_id: string;
  emoji: ReactionEmoji;
  created_at: string;
};

/** `story_reaction_counts`: counts only, never who. */
export type StoryReactionCount = {
  emoji: ReactionEmoji;
  reaction_count: number;
};

/**
 * One row of `story_comment_feed` (148), the public comment list and the ONLY
 * read of comments: the `story_comments` table itself is not readable by any
 * client, because its rows carry the author's account id (147). The commenter
 * is a public name and avatar only; `is_own` is how a client knows to offer
 * delete.
 */
export type StoryCommentFeedItem = {
  id: string;
  story_id: string;
  body: string;
  created_at: string;
  /** A chosen username, or `member_handle()` for someone who never picked one. */
  author_display_name: string;
  /**
   * A `clay:<seed>` avatar, or null. Never a URL: avatar_url is
   * client-writable, and a URL here would make every viewer's phone fetch a
   * server the commenter chose. Resolve with `avatarImageSource`.
   */
  author_avatar_url: string | null;
  is_own: boolean;
  /** The story provider's one public reaction to this comment, if any. */
  creator_reaction: ReactionEmoji | null;
};

/** The story provider's single reaction to a comment on their own story (148). */
export type StoryCommentReaction = {
  comment_id: string;
  provider_id: string;
  emoji: ReactionEmoji;
  created_at: string;
};

/** `story_viewers` (149): the provider's viewer list. The only read of who reacted. */
export type StoryViewer = {
  viewer_id: string;
  display_name: string;
  /**
   * A `clay:<seed>` avatar, or null. Never a URL. Viewers are members (143),
   * whose avatar is a clay pick; anything else draws the initial.
   */
  avatar_url: string | null;
  viewed_at: string;
  reaction: ReactionEmoji | null;
};

/** `my_story_insights` (149): one row per live story of the caller's. */
export type MyStoryInsight = {
  story_id: string;
  media_type: StoryMediaType;
  created_at: string;
  expires_at: string;
  view_count: number;
  reaction_count: number;
  comment_count: number;
};

/**
 * Every code the story RPCs return. NOT_FOUND covers missing, expired and
 * blocked alike, on purpose, so it never says which. STORIES_DISABLED is the
 * kill switch (kill_switches.stories_enabled); it stops adding content and
 * never stops deleting or reporting.
 */
export type StoryError =
  | 'UNAUTHORIZED'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'SUSPENDED'
  | 'POLICY_REQUIRED'
  | 'STORIES_DISABLED'
  /** create_story: the caller is not a listed provider. */
  | 'NOT_LISTED'
  /** create_story: nothing was uploaded at media_path. */
  | 'MEDIA_MISSING'
  /** create_story: the upload's content type is not what its file name says. */
  | 'MEDIA_MISMATCH'
  /** create_story: 30 live stories already. */
  | 'LIMIT_REACHED'
  /**
   * post_story_comment: 5 on this story (ever) or 20 overall in the last
   * hour. delete_story_comment with a report reason: the 10 reports an hour
   * are spent, and nothing was deleted.
   */
  | 'RATE_LIMITED';

export type CreateStoryResult = {
  success: boolean;
  story_id?: string;
  created_at?: string;
  expires_at?: string;
  error?: StoryError;
};

export type MarkStoryViewedResult = {
  success: boolean;
  /** False on a repeat view and on the provider's own. */
  first_view?: boolean;
  error?: StoryError;
};

/** toggle_story_reaction / react_to_story_comment. Null emoji means taken back. */
export type StoryReactionResult = {
  success: boolean;
  emoji?: ReactionEmoji | null;
  error?: StoryError;
};

export type PostStoryCommentResult = {
  success: boolean;
  comment_id?: string;
  created_at?: string;
  error?: StoryError;
};

export type DeleteStoryCommentResult = {
  success: boolean;
  /** Set when a report reason was given and the report was filed first. */
  report_id?: string | null;
  error?: StoryError;
};

/** block_story_commenter (152). Says nothing about the author, by design. */
export type BlockStoryCommenterResult = {
  success: boolean;
  error?: StoryError;
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
        Insert: Partial<Conversation> & {
          member_id: string;
          provider_id: string;
        };
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
        Insert: {
          user_id: string;
          name: TelemetryEvent;
          props?: Record<string, string | number | boolean>;
        };
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
      /**
       * The provider's own rows: they insert and delete, and the ONLY column a
       * client may update is `is_primary` — and only upwards
       * (`guard_provider_photo_columns`, migration 070). A url a provider can
       * rewrite after it is published is a url that can be swapped for something
       * else after a member has looked at it, so replacing a photo is a delete
       * and an insert; and clearing `is_primary` would leave a non-empty gallery
       * with no face, so the way to stop a photo being the face is to make
       * another one the face.
       */
      provider_photos: {
        Row: ProviderPhoto;
        Insert: { provider_id: string; url: string };
        Update: { is_primary: boolean };
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
        Row: {
          token: string;
          user_id: string;
          platform: string;
          created_at: string;
          last_seen_at: string;
        };
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
          /** Migration 056. Held here, not on profiles, until promotion. */
          verified_dob: string | null;
          status: 'not_provided' | 'pending' | 'verified' | 'failed';
          failure_reason: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Stories (143). Written only by create_story; the provider may DELETE their own. */
      stories: {
        Row: Story;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Own rows only (145). Written by mark_story_viewed. */
      story_views: {
        Row: StoryView;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Own row only (146). Written by toggle_story_reaction. */
      story_reactions: {
        Row: StoryReaction;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Public as far as the comment is (148). Written by react_to_story_comment. */
      story_comment_reactions: {
        Row: StoryCommentReaction;
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
        Row: {
          payout_account_verified: boolean;
          pan_verified: boolean;
          can_go_live: boolean;
        };
        Relationships: [];
      };
      story_comment_feed: {
        Row: StoryCommentFeedItem;
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
      /**
       * `send_message` with the reference app-style idempotency (migration 081). A retry
       * carrying the same `p_client_nonce` returns the ORIGINAL message with
       * `deduped: true` rather than inserting a second row.
       *
       * The nonce is first in the argument list on the server so the two
       * functions can never be confused positionally; named args here make that
       * moot, but the order is mirrored anyway.
       */
      send_message_idempotent: {
        Args: {
          /** Client-generated v4 uuid. Reused unchanged on retry — that reuse is what makes the retry safe. */
          p_client_nonce: string | null;
          p_conversation_id: string;
          p_body?: string | null;
          p_reply_to_id?: string | null;
          p_voice_path?: string | null;
          p_voice_duration_ms?: number | null;
          p_attachment_path?: string | null;
          p_attachment_width?: number | null;
          p_attachment_height?: number | null;
          p_voice_peaks?: number[] | null;
        };
        Returns: SendResult;
      };
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
      set_next_call_media_backend: {
        Args: {
          p_conversation_id: string;
          p_backend: CallMediaBackend;
          p_experiment_id: string;
          p_run_id: string;
        };
        Returns: undefined;
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
      record_call_quality_samples: {
        Args: {
          p_call_id: string;
          p_samples: Array<Record<string, unknown>>;
        };
        Returns: number;
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
          /**
           * listener | astrologer (migration 065). Defaulted server-side, and
           * the 4-arg signature was DROPPED rather than overloaded so no call
           * can be ambiguous.
           */
          p_provider_category?: string;
        };
        Returns: undefined;
      };
      register_push_token: {
        Args: { p_token: string; p_platform?: string };
        Returns: void;
      };
      submit_review: {
        Args: {
          p_conversation_id: string;
          p_rating: number;
          p_comment?: string | null;
        };
        Returns: undefined;
      };
      submit_session_review: {
        Args: {
          p_session_id: string;
          p_rating: number;
          p_comment?: string | null;
        };
        Returns: undefined;
      };
      get_provider_ratings: {
        Args: { p_provider_id: string; p_recent_limit?: number };
        Returns: ProviderRatings | null;
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
      confirm_chat_session: {
        Args: { p_request_id: string };
        Returns: string;
      };
      decline_session_request: {
        Args: { p_request_id: string };
        Returns: { success: boolean; status?: string; error?: string };
      };
      announce_chat_open: {
        Args: { p_conversation_id: string };
        Returns: {
          alerted: boolean;
          reason: string | null;
          peer_present?: boolean;
        };
      };
      get_usage_ledger: {
        Args: { p_limit?: number; p_before?: string | null };
        Returns: unknown;
      };
      /** Edit the body of a message within the edit window. Migration 103. */
      edit_message: {
        Args: { p_message_id: string; p_body: string };
        Returns: unknown;
      };
      /** Soft-delete a message (sets deleted_at, clears body). Migration 103. */
      delete_message: {
        Args: { p_message_id: string };
        Returns: unknown;
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
          minutes_billed: number;
          next_bill_at: string | null;
          /** Member only; null for the provider and before activation. Migration 062. */
          seconds_remaining: number | null;
        } | null;
      };
      /**
       * Returns the most recent non-expired pending session request for a
       * conversation visible to the caller, or null if none. Migration 037.
       */
      /**
       * 083: a provider replaces their own topic tags, and is told what was
       * stored rather than trusting what it sent.
       *
       * Refuses a non-provider with 42501 and an over-long list with 22023 and
       * a sentence — the CHECK behind it would report a constraint name, which
       * is not something a caller can act on.
       */
      set_provider_expertise: {
        Args: { p_expertise: string[] };
        Returns: string[];
      };
      /** 082: has the member declined a paid session in this conversation? */
      get_chat_consent: {
        Args: { p_conversation_id: string };
        Returns: { declined: boolean; declined_at: string | null };
      };
      /**
       * 082: member reverses their own decline. `request_id` is non-null only
       * when a joined request is already waiting, so the caller can confirm it.
       */
      resume_chat_consent: {
        Args: { p_conversation_id: string };
        Returns: {
          success: boolean;
          request_id: string | null;
          provider_joined: boolean;
          error?: string;
        };
      };
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
      /** 143. Upload to `stories/{uid}/{p_story_id}.{ext}` first; a retry with the same id is the same story. */
      create_story: {
        Args: {
          p_story_id: string;
          p_media_type: StoryMediaType;
          p_media_path: string;
          p_caption?: string | null;
          p_duration_ms?: number | null;
        };
        Returns: CreateStoryResult;
      };
      mark_story_viewed: {
        Args: { p_story_id: string };
        Returns: MarkStoryViewedResult;
      };
      /** 146. Members only; the same emoji again takes it back. */
      toggle_story_reaction: {
        Args: { p_story_id: string; p_emoji: ReactionEmoji };
        Returns: StoryReactionResult;
      };
      story_reaction_counts: {
        Args: { p_story_id: string };
        Returns: StoryReactionCount[];
      };
      /** 147. Members only: the story's provider cannot reply. 1-500 visible characters, at most 6 lines. */
      post_story_comment: {
        Args: { p_story_id: string; p_body: string };
        Returns: PostStoryCommentResult;
      };
      /**
       * 150. The comment's author, or the story's provider. The provider may
       * pass a report reason: the report is filed first, in the same
       * transaction, and if it is refused nothing is deleted.
       */
      delete_story_comment: {
        Args: {
          p_comment_id: string;
          p_report_reason?: ReportReason | null;
          p_report_detail?: string | null;
        };
        Returns: DeleteStoryCommentResult;
      };
      /**
       * 152. The story's provider blocks a comment's author, with no prior
       * conversation needed. Report first: once blocked, the author's comments
       * are hidden from the provider too.
       */
      block_story_commenter: {
        Args: { p_comment_id: string };
        Returns: BlockStoryCommenterResult;
      };
      /** 148. The story's provider only; the same emoji again takes it back. */
      react_to_story_comment: {
        Args: { p_comment_id: string; p_emoji: ReactionEmoji };
        Returns: StoryReactionResult;
      };
      /** 149. The story's provider only; raises 42501 for anyone else. */
      story_viewers: {
        Args: { p_story_id: string };
        Returns: StoryViewer[];
      };
      my_story_insights: {
        Args: Record<string, never>;
        Returns: MyStoryInsight[];
      };
      /**
       * 150. Same shape and failure mode as submit_report: returns the report id,
       * raises 54000 past 10 reports an hour (shared with submit_report).
       */
      report_story: {
        Args: {
          p_story_id: string;
          p_reason: ReportReason;
          p_detail?: string | null;
        };
        Returns: string;
      };
      report_story_comment: {
        Args: {
          p_comment_id: string;
          p_reason: ReportReason;
          p_detail?: string | null;
        };
        Returns: string;
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
