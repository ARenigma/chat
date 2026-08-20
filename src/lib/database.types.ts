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

export type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  role: UserRole;
  token_balance: number;
  identity_verified_at: string | null;
  is_available: boolean;
  created_at: string;
  last_refill_at: string | null;
};

/**
 * The member-facing projection of a provider. Deliberately a view with an
 * explicit column list, so a column added to `profiles` later cannot leak into
 * the directory by default.
 */
export type ProviderSummary = {
  id: string;
  display_name: string;
  is_available: boolean;
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
  | 'INSUFFICIENT_BALANCE';

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
      provider_applications: {
        Row: {
          id: string;
          user_id: string;
          status: 'pending' | 'approved' | 'rejected';
          submitted_at: string;
          reviewed_at: string | null;
          reviewer_note: string | null;
        };
        Insert: { user_id: string; status?: 'pending' };
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      provider_directory: {
        Row: ProviderSummary;
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
      claim_daily_tokens: {
        Args: Record<string, never>;
        Returns: ClaimResult;
      };
      delete_user_account: {
        Args: Record<string, never>;
        Returns: undefined;
      };
    };
    Enums: { user_role: UserRole };
    CompositeTypes: Record<string, never>;
  };
};
