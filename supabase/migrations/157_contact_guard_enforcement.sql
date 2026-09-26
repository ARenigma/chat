-- ===========================================================================
-- 157  The contact guard decides: mode switch, evidence, strikes, and the gate
--      in every write that carries free text
-- ===========================================================================
-- Owner's rules (Amit, 2026-09-25), final:
--   * HARD (an actual identifier, however disguised: phone, email, UPI id or
--     bank detail, link, handle) BLOCKS the send: chat messages and edits,
--     story comments and captions, and profile fields at save.
--   * SIGNAL (intent with no identifier, "WA pe aao") is FLAGGED for review,
--     never blocked.
--   * Strikes expire after 90 days. Strike 1 blocks and explains; strike 2
--     warns (a provider is also hidden from the directory for 7 days);
--     strike 3 pauses text, voice notes and comments for 24 hours, calls
--     still work (a provider also goes to review for removal); strike 5 goes
--     to human review (suspension or ban).
--   * A number split across messages blocks only the COMPLETING message.
--   * Chat images are refused. UTR and order numbers stay blocked (the
--     refusal carries reason 'reference' and the copy points to Help).
--     Evidence is kept 90 days.
--   * Rollout: a 7-day SHADOW first. Mode is 'off' | 'shadow' | 'enforce',
--     default 'shadow': in shadow every would-be block is logged with its
--     evidence and nobody is blocked or struck.
--
-- The detector is 156, generated from design/contact-guard.spec.mjs. This
-- file is hand-written and only calls it.
--
-- ---------------------------------------------------------------------------
-- The shape: a gate in each write RPC, not a trigger
-- ---------------------------------------------------------------------------
-- A trigger that raised would roll back its own evidence row and the strike
-- with it: Postgres has no autonomous transaction. So each client RPC that
-- takes chat or story text is renamed to <name>_core, untouched, and a thin
-- wrapper with the same arguments and defaults takes its place. The wrapper
-- asks private.contact_guard_gate(), which never raises: it writes the event,
-- counts the strike, and returns a structured refusal the client maps to copy
-- (src/lib/contactGuard.ts), or null to let the core run. Renaming leaves the
-- core bodies byte-for-byte as they were; 054 rewrote send_message once and
-- lost four guards (063), which is the failure this avoids. A structured
-- refusal also makes the outbox drop the message instead of replaying it
-- (src/api/chat.ts, `worthRetrying`).
--
-- Profile fields are the exception. The app saves them with a direct PATCH
-- (src/api/provider.ts) as well as through claim_member_profile and
-- complete_provider_onboarding, so the only single choke point is a trigger.
-- In enforce mode it raises P0011 with {category, field} as the DETAIL, and
-- the refusal is not counted as a strike: the raise rolls the attempt back.
-- In shadow mode it raises nothing and its event row stands. The trigger has
-- no `current_user in ('authenticated','anon')` branch (the repo's convention
-- for column guards, 004:34): the SECURITY DEFINER writers run as the owner,
-- and that branch would exempt exactly them. It exempts writes with no end
-- user instead (auth.uid() null: migrations, the service role, pg_cron).
--
-- NOT here, on purpose: the provider-directory filter for strike 2. The
-- restriction row records directory_hidden_until, but applying it means
-- restating public.provider_directory in full (083:123), and the presence
-- work on another branch (155) restates the same view. Whichever lands second
-- must carry the other's change, so it is left to that merge.

-- ---------------------------------------------------------------------------
-- 1. The mode switch
-- ---------------------------------------------------------------------------
-- kill_switches.contact_guard_mode in admin.config_active (prod), read the way
-- stories_enabled() reads its key (143). Anything but 'off' or 'enforce' reads
-- as 'shadow', so a missing key, a typo or a rolling deploy can only ever land
-- on log-only, never on blocking. The app reads the same key through
-- get_public_config('kill_switches') and predicts a block only in 'enforce'.
create or replace function private.contact_guard_mode()
returns text
language sql
stable
security definer
set search_path = pg_catalog, admin
as $$
  select case (
    select payload ->> 'contact_guard_mode'
    from admin.config_active
    where domain = 'kill_switches' and environment = 'prod'
  )
    when 'off' then 'off'
    when 'enforce' then 'enforce'
    else 'shadow'
  end;
$$;

comment on function private.contact_guard_mode() is
  'kill_switches.contact_guard_mode: off | shadow | enforce, shadow unless set '
  'to one of the other two. Read by the gate and the profile trigger (157).';

revoke all on function private.contact_guard_mode() from public, anon, authenticated;
grant execute on function private.contact_guard_mode() to service_role;

-- Publish the key as 'shadow' in both environments: 143's block, with the
-- same rule that an environment already carrying the key keeps its value. The
-- console registry (admin/lib/config-registry.ts) declares the field, so a
-- publish of any other kill switch carries this one forward.
do $$
declare
  v_env  text;
  v_id   uuid;
  v_old  uuid;
  v_ver  bigint;
  v_sha  text;
  v_kill jsonb;
begin
  foreach v_env in array array['staging', 'prod'] loop
    select version_id, payload
      into v_old, v_kill
    from admin.config_active
    where domain = 'kill_switches'
      and environment = v_env;

    if v_kill ? 'contact_guard_mode' then
      continue;
    end if;

    v_kill := coalesce(v_kill, '{}'::jsonb)
      || jsonb_build_object('contact_guard_mode', 'shadow');

    if v_old is not null then
      update admin.config_versions
      set status = 'superseded', superseded_at = now()
      where id = v_old;
    end if;

    select coalesce(max(version_number), 0) + 1
      into v_ver
    from admin.config_versions
    where domain = 'kill_switches'
      and environment = v_env;

    v_id := gen_random_uuid();
    v_sha := encode(sha256(v_kill::text::bytea), 'hex');

    insert into admin.config_versions
      (id, domain, environment, version_number, status,
       payload, payload_sha256, effective_at,
       created_by, published_by, published_at, publish_reason)
    values
      (v_id, 'kill_switches', v_env, v_ver, 'active',
       v_kill, v_sha, now(),
       'migration_157', 'migration_157', now(),
       'Register the contact guard mode, shadow first');

    insert into admin.config_active
      (domain, environment, version_id, payload, effective_from, updated_at)
    values
      ('kill_switches', v_env, v_id, v_kill, now(), now())
    on conflict (domain, environment) do update
      set version_id = excluded.version_id,
          payload = excluded.payload,
          effective_from = excluded.effective_from,
          updated_at = excluded.updated_at;

    insert into admin.config_audit
      (action, domain, version_id, actor, reason)
    values
      (case when v_env = 'prod' then 'promoted_prod' else 'published_staging' end,
       'kill_switches', v_id, 'migration_157',
       'contact_guard_mode=shadow (' || v_env || ')');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Evidence
-- ---------------------------------------------------------------------------
-- One row per detection. RLS on with no policy, so only the service role
-- (scripts/moderate.mjs, the admin console) reads it, the way
-- moderation_actions is kept. Evidence lives 90 days (purge_after), the same
-- as a strike, so it lasts exactly as long as what it supports. Account
-- deletion cascades. The excerpt never goes to telemetry: guard_event_shape
-- (108) already refuses body keys.
--
--   tier     hard    an identifier (single message)
--            window  a number completed across messages
--            signal  intent, no identifier
--            report  a moderator's strike from a report (story media, 159)
--   outcome  blocked  refused in enforce mode (the only kind that can strike)
--            shadow   would have been refused; logged and delivered
--            flagged  a signal, for review; never blocked
create table if not exists public.contact_guard_events (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references public.profiles(id) on delete cascade,
  surface          text        not null check (surface in
                     ('chat_send', 'chat_edit', 'story_comment', 'story_caption', 'profile', 'story_media')),
  field            text,
  conversation_id  uuid,
  story_id         uuid,
  row_ref          uuid,
  tier             text        not null check (tier in ('hard', 'window', 'signal', 'report')),
  outcome          text        not null check (outcome in ('blocked', 'shadow', 'flagged')),
  rules            text[]      not null default '{}',
  category         text,
  reason           text,
  excerpt          text        not null check (length(excerpt) <= 4000),
  window_texts     text[],
  mode             text        not null check (mode in ('shadow', 'enforce')),
  spec_version     text        not null,
  counts_as_strike boolean     not null default false,
  created_at       timestamptz not null default now(),
  purge_after      timestamptz not null default now() + interval '90 days',
  voided_at        timestamptz,
  voided_by        text,
  void_reason      text,
  constraint contact_guard_events_strike_is_a_block
    check (not counts_as_strike or outcome = 'blocked')
);

create index if not exists contact_guard_events_user_created
  on public.contact_guard_events (user_id, created_at desc);
create index if not exists contact_guard_events_purge
  on public.contact_guard_events (purge_after);
create index if not exists contact_guard_events_conversation
  on public.contact_guard_events (conversation_id, created_at desc)
  where conversation_id is not null;

alter table public.contact_guard_events enable row level security;
revoke all on table public.contact_guard_events from public, anon, authenticated;
grant select, insert, update, delete on table public.contact_guard_events to service_role;

comment on table public.contact_guard_events is
  'Every contact-guard detection with its evidence, 90 days (157). Service '
  'role only. Append-only apart from the three void columns.';

-- Append-only: an event is evidence, and the only edit is voiding it (a false
-- positive a moderator clears). Deleting is the purge's job.
create or replace function private.contact_guard_events_append_only()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason'])
     is distinct from (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason']) then
    raise exception 'contact_guard_events is append-only; only the void columns change'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.contact_guard_events_append_only() from public, anon, authenticated;

drop trigger if exists contact_guard_events_append_only on public.contact_guard_events;
create trigger contact_guard_events_append_only
  before update on public.contact_guard_events
  for each row execute function private.contact_guard_events_append_only();

-- ---------------------------------------------------------------------------
-- 3. Strikes and restrictions
-- ---------------------------------------------------------------------------
-- A strike is a blocked event that counted. Separate from the evidence so a
-- change to evidence retention cannot move the ladder. Active = unvoided and
-- unexpired (90 days).
create table if not exists public.contact_guard_strikes (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  event_id   uuid        references public.contact_guard_events(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days',
  voided_at  timestamptz
);

create index if not exists contact_guard_strikes_user_active
  on public.contact_guard_strikes (user_id, expires_at desc);

alter table public.contact_guard_strikes enable row level security;
revoke all on table public.contact_guard_strikes from public, anon, authenticated;
grant select, insert, update, delete on table public.contact_guard_strikes to service_role;

-- What the ladder has done to a user. paused_until pauses text, voice notes
-- and comments (never calls); directory_hidden_until is a provider's strike-2
-- hiding (applied by the directory, see the header); review_state queues a
-- human: removal_review for a provider at strike 3, human_review at strike 5.
create table if not exists public.contact_guard_restrictions (
  user_id                 uuid        primary key references public.profiles(id) on delete cascade,
  paused_until            timestamptz,
  directory_hidden_until  timestamptz,
  review_state            text        check (review_state in ('removal_review', 'human_review')),
  review_requested_at     timestamptz,
  updated_at              timestamptz not null default now()
);

alter table public.contact_guard_restrictions enable row level security;
revoke all on table public.contact_guard_restrictions from public, anon, authenticated;
grant select, insert, update, delete on table public.contact_guard_restrictions to service_role;

-- The ladder's numbers in one place, so the gate and the tests read the same.
create or replace function private.contact_guard_policy()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'strike_days', 90,
    'evidence_days', 90,
    'warn_at', 2,
    'hide_provider_at', 2,
    'hide_provider_days', 7,
    'pause_at', 3,
    'pause_hours', 24,
    'provider_removal_review_at', 3,
    'human_review_at', 5,
    'incident_merge_minutes', 10,
    'cooldown_attempts', 5,
    'cooldown_minutes', 10,
    'window_messages', 6,
    'window_minutes', 15,
    'max_length', 4000
  );
$$;

revoke all on function private.contact_guard_policy() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Logging and the ladder
-- ---------------------------------------------------------------------------
-- Writes one event. For a blocked event it also decides the strike and runs
-- the ladder, and returns what the refusal reports.
create or replace function private.contact_guard_log(
  p_user     uuid,
  p_surface  text,
  p_field    text,
  p_ctx      jsonb,
  p_tier     text,
  p_outcome  text,
  p_mode     text,
  p_rules    text[],
  p_category text,
  p_reason   text,
  p_excerpt  text,
  p_window   text[] default null,
  p_force    boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_policy   jsonb := private.contact_guard_policy();
  v_event    uuid;
  v_counts   boolean := false;
  v_strikes  integer := 0;
  v_role     text;
  v_pause    timestamptz;
  v_hidden   timestamptz;
begin
  if p_outcome = 'blocked' and p_force then
    -- A moderator's strike (a reported story's media, 159) always counts.
    v_counts := true;
  elsif p_outcome = 'blocked' then
    -- One honest mistake retyped three times in a minute is one incident.
    v_counts := not exists (
      select 1 from public.contact_guard_strikes s
      where s.user_id = p_user
        and s.voided_at is null
        and s.expires_at > now()
        and s.created_at > now() - make_interval(mins => (v_policy ->> 'incident_merge_minutes')::int)
    );
  end if;

  insert into public.contact_guard_events
    (user_id, surface, field, conversation_id, story_id, row_ref, tier, outcome,
     rules, category, reason, excerpt, window_texts, mode, spec_version,
     counts_as_strike, purge_after)
  values
    (p_user, p_surface, p_field,
     nullif(p_ctx ->> 'conversation_id', '')::uuid,
     nullif(p_ctx ->> 'story_id', '')::uuid,
     nullif(p_ctx ->> 'row_ref', '')::uuid,
     p_tier, p_outcome, coalesce(p_rules, '{}'), p_category, p_reason,
     left(coalesce(p_excerpt, ''), 4000), p_window, p_mode,
     private.contact_guard_spec_version(), v_counts,
     now() + make_interval(days => (v_policy ->> 'evidence_days')::int))
  returning id into v_event;

  if p_outcome <> 'blocked' then
    return jsonb_build_object('event_id', v_event);
  end if;

  if v_counts then
    insert into public.contact_guard_strikes (user_id, event_id, expires_at)
    values (p_user, v_event, now() + make_interval(days => (v_policy ->> 'strike_days')::int));
  end if;

  select count(*) into v_strikes
  from public.contact_guard_strikes s
  where s.user_id = p_user and s.voided_at is null and s.expires_at > now();

  select role::text into v_role from public.profiles where id = p_user;

  if v_counts then
    insert into public.contact_guard_restrictions (user_id) values (p_user)
    on conflict (user_id) do nothing;

    update public.contact_guard_restrictions r
    set paused_until = case
          when v_strikes >= (v_policy ->> 'pause_at')::int
            then greatest(coalesce(r.paused_until, now()), now() + make_interval(hours => (v_policy ->> 'pause_hours')::int))
          else r.paused_until
        end,
        directory_hidden_until = case
          when v_role = 'provider' and v_strikes >= (v_policy ->> 'hide_provider_at')::int
            then greatest(coalesce(r.directory_hidden_until, now()), now() + make_interval(days => (v_policy ->> 'hide_provider_days')::int))
          else r.directory_hidden_until
        end,
        review_state = case
          when v_strikes >= (v_policy ->> 'human_review_at')::int then 'human_review'
          when v_role = 'provider' and v_strikes >= (v_policy ->> 'provider_removal_review_at')::int
            then coalesce(r.review_state, 'removal_review')
          else r.review_state
        end,
        review_requested_at = case
          when (v_strikes >= (v_policy ->> 'human_review_at')::int
                or (v_role = 'provider' and v_strikes >= (v_policy ->> 'provider_removal_review_at')::int))
            then coalesce(r.review_requested_at, now())
          else r.review_requested_at
        end,
        updated_at = now()
    where r.user_id = p_user;
  end if;

  select paused_until, directory_hidden_until into v_pause, v_hidden
  from public.contact_guard_restrictions where user_id = p_user;

  return jsonb_build_object(
    'event_id', v_event,
    'strikes', v_strikes,
    'warn', v_strikes >= (v_policy ->> 'warn_at')::int,
    'restricted_until', case when v_pause > now() then v_pause end,
    'directory_hidden_until', case when v_hidden > now() then v_hidden end
  );
end;
$$;

revoke all on function private.contact_guard_log(uuid, text, text, jsonb, text, text, text, text[], text, text, text, text[], boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The gate
-- ---------------------------------------------------------------------------
-- Called first by every wrapper. Never raises. Returns a refusal as jsonb, or
-- null to let the core run. In order:
--   1. length, before anything else: the core's own cap has not run yet, and
--      without this one client can send megabytes into a detector that costs
--      microseconds per character;
--   2. the mode ('off' returns null at once);
--   3. the caller (no user, or chat to a conversation they are not in, is
--      left to the core to refuse);
--   4. in enforce mode, a pause from the ladder (text, voice notes, edits and
--      comments; never calls, which do not come through here);
--   5. in enforce mode, the cooldown: five blocked attempts in ten minutes;
--   6. for chat, the send rate limit, so a flood past it never pays for
--      detection (the core refuses it right after);
--   7. the hard rules, then for a chat fragment the window over the sender's
--      last messages in this conversation (only the completing message is
--      refused; the earlier parts stay delivered, as the owner decided);
--   8. otherwise the signal rules, logged as flagged and never refused.
create or replace function private.contact_guard_gate(
  p_surface text,
  p_text    text,
  p_ctx     jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_policy  jsonb := private.contact_guard_policy();
  v_mode    text;
  v_uid     uuid := auth.uid();
  v_conv    uuid := nullif(p_ctx ->> 'conversation_id', '')::uuid;
  v_hit     boolean;
  v_window  text;
  v_recent  text[];
  v_rules   text[];
  v_signals text[];
  v_cat     text;
  v_reason  text;
  v_tier    text;
  v_pause   timestamptz;
  v_log     jsonb;
  v_count   integer;
  v_limit   integer;
begin
  if p_text is not null and length(p_text) > (v_policy ->> 'max_length')::int then
    return jsonb_build_object('success', false, 'error', 'CONTACT_TOO_LONG');
  end if;

  v_mode := private.contact_guard_mode();
  if v_mode = 'off' or v_uid is null then
    return null;
  end if;

  if p_surface in ('chat_send', 'chat_edit') and v_conv is not null and not exists (
    select 1 from public.conversations c
    where c.id = v_conv and v_uid in (c.member_id, c.provider_id)
  ) then
    return null;
  end if;

  if v_mode = 'enforce' and p_surface in ('chat_send', 'chat_edit', 'story_comment') then
    select paused_until into v_pause
    from public.contact_guard_restrictions where user_id = v_uid;
    if v_pause > now() then
      return jsonb_build_object(
        'success', false, 'error', 'CONTACT_RESTRICTED',
        'restricted_until', v_pause);
    end if;
  end if;

  if p_text is null or btrim(p_text) = '' then
    return null;
  end if;

  if v_mode = 'enforce' then
    select count(*) into v_count
    from public.contact_guard_events e
    where e.user_id = v_uid
      and e.outcome = 'blocked'
      and e.created_at > now() - make_interval(mins => (v_policy ->> 'cooldown_minutes')::int);
    if v_count >= (v_policy ->> 'cooldown_attempts')::int then
      return jsonb_build_object(
        'success', false, 'error', 'CONTACT_COOLDOWN',
        'retry_after_s', (v_policy ->> 'cooldown_minutes')::int * 60);
    end if;
  end if;

  if p_surface = 'chat_send' then
    v_limit := coalesce(
      (public.get_active_config('thresholds') ->> 'rate_limit_messages_per_min')::integer, 20);
    select count(*) into v_count
    from public.messages
    where sender_id = v_uid and created_at > now() - interval '60 seconds';
    if v_count >= v_limit then
      return null;
    end if;
  end if;

  v_hit := private.contact_guard_blocked(p_text);
  v_tier := 'hard';

  if not v_hit and p_surface = 'chat_send' and v_conv is not null
     and private.contact_guard_fragment(p_text) <> '' then
    select array_agg(body order by created_at) into v_recent
    from (
      select m.body, m.created_at
      from public.messages m
      where m.conversation_id = v_conv
        and m.sender_id = v_uid
        and m.origin = 'live'
        and m.deleted_at is null
        and m.body is not null
        and m.created_at > now() - make_interval(mins => (v_policy ->> 'window_minutes')::int)
      order by m.created_at desc
      limit (v_policy ->> 'window_messages')::int - 1
    ) recent;
    if v_recent is not null then
      v_window := private.contact_guard_window(v_recent || p_text);
      if v_window is not null then
        v_hit := true;
        v_tier := 'window';
      end if;
    end if;
  end if;

  if v_hit then
    if v_tier = 'window' then
      v_rules := array['window'];
      v_cat := 'window';
    else
      v_rules := private.contact_guard_rules(p_text);
      v_cat := private.contact_guard_category(v_rules);
      v_reason := private.contact_guard_reason(v_rules);
    end if;

    v_log := private.contact_guard_log(
      v_uid, p_surface, p_ctx ->> 'field', p_ctx, v_tier,
      case when v_mode = 'enforce' then 'blocked' else 'shadow' end,
      v_mode, v_rules, v_cat, v_reason, p_text, v_recent);

    if v_mode <> 'enforce' then
      return null;
    end if;

    return jsonb_build_object(
      'success', false,
      'error', 'CONTACT_INFO',
      'category', v_cat,
      'reason', v_reason,
      'field', coalesce(p_ctx ->> 'field', 'body'),
      'surface', case when p_surface in ('chat_send', 'chat_edit') then 'chat' else p_surface end,
      'strikes', v_log -> 'strikes',
      'warn', v_log -> 'warn',
      'restricted_until', v_log -> 'restricted_until',
      'directory_hidden_until', v_log -> 'directory_hidden_until',
      'spec', left(private.contact_guard_spec_version(), 8));
  end if;

  v_signals := private.contact_guard_signals(p_text);
  if cardinality(v_signals) > 0 then
    perform private.contact_guard_log(
      v_uid, p_surface, p_ctx ->> 'field', p_ctx, 'signal', 'flagged', v_mode,
      v_signals, null, null, p_text);
  end if;
  return null;
end;
$$;

comment on function private.contact_guard_gate(text, text, jsonb) is
  'The contact guard''s decision for one piece of text a user is about to '
  'write (157). Never raises; returns a refusal or null.';

revoke all on function private.contact_guard_gate(text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The wrappers
-- ---------------------------------------------------------------------------
-- Each core keeps its body and its comment and loses every client grant; each
-- wrapper is new, so 153's default gives it no grant, and it is granted to
-- authenticated here. The names a client calls do not change, so 568's
-- inventory and 563's allowlist are unchanged.

-- 6a. send_message. send_message_idempotent calls public.send_message by name
-- (081), so it runs through this wrapper for both old and new clients.
alter function public.send_message(uuid, text, uuid, text, integer, text, integer, integer, real[])
  rename to send_message_core;
revoke all on function public.send_message_core(uuid, text, uuid, text, integer, text, integer, integer, real[])
  from public, anon, authenticated;
grant execute on function public.send_message_core(uuid, text, uuid, text, integer, text, integer, integer, real[])
  to service_role;

create function public.send_message(
  p_conversation_id    uuid,
  p_body               text     default null,
  p_reply_to_id        uuid     default null,
  p_voice_path         text     default null,
  p_voice_duration_ms  integer  default null,
  p_attachment_path    text     default null,
  p_attachment_width   integer  default null,
  p_attachment_height  integer  default null,
  p_voice_peaks        real[]   default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refusal jsonb;
begin
  -- Chat images are refused while the guard is on: nothing reads the text in
  -- a photo, and the v2 chat has no picker. Voice notes carry no text to
  -- check but are paused with text by the ladder.
  if p_attachment_path is not null and private.contact_guard_mode() <> 'off' then
    return json_build_object('success', false, 'error', 'IMAGES_DISABLED');
  end if;

  v_refusal := private.contact_guard_gate(
    'chat_send', p_body,
    jsonb_build_object('conversation_id', p_conversation_id, 'field', 'body'));
  if v_refusal is not null then
    return v_refusal::json;
  end if;

  return public.send_message_core(
    p_conversation_id, p_body, p_reply_to_id, p_voice_path, p_voice_duration_ms,
    p_attachment_path, p_attachment_width, p_attachment_height, p_voice_peaks);
end;
$$;

comment on function public.send_message(uuid, text, uuid, text, integer, text, integer, integer, real[]) is
  'Send a message: the contact guard''s gate (157), then send_message_core '
  '(077''s body, unchanged).';

revoke all on function public.send_message(uuid, text, uuid, text, integer, text, integer, integer, real[])
  from public, anon;
grant execute on function public.send_message(uuid, text, uuid, text, integer, text, integer, integer, real[])
  to authenticated, service_role;

-- 6b. edit_message. An edit is a new chance to put an identifier in front of
-- somebody, so it gets the single-message check; the window is for sends.
alter function public.edit_message(uuid, text) rename to edit_message_core;
revoke all on function public.edit_message_core(uuid, text) from public, anon, authenticated;
grant execute on function public.edit_message_core(uuid, text) to service_role;

create function public.edit_message(
  p_message_id uuid,
  p_body       text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv    uuid;
  v_refusal jsonb;
begin
  -- Only the sender's own message names a conversation; anything else is the
  -- core's NOT_FOUND to give.
  select conversation_id into v_conv
  from public.messages
  where id = p_message_id and sender_id = auth.uid();

  if v_conv is not null then
    v_refusal := private.contact_guard_gate(
      'chat_edit', p_body,
      jsonb_build_object('conversation_id', v_conv, 'row_ref', p_message_id, 'field', 'body'));
    if v_refusal is not null then
      return v_refusal;
    end if;
  end if;

  return public.edit_message_core(p_message_id, p_body);
end;
$$;

comment on function public.edit_message(uuid, text) is
  'Edit your own text message: the contact guard''s gate (157), then '
  'edit_message_core (103''s body, unchanged).';

revoke all on function public.edit_message(uuid, text) from public, anon;
grant execute on function public.edit_message(uuid, text) to authenticated;

-- 6c. post_story_comment. A retry of a comment already posted goes straight
-- to the core, which answers with it, as 147 promises: a change in between
-- (here, a mode flip) must not turn a success into an error.
alter function public.post_story_comment(uuid, uuid, text) rename to post_story_comment_core;
revoke all on function public.post_story_comment_core(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.post_story_comment_core(uuid, uuid, text) to service_role;

create function public.post_story_comment(
  p_comment_id uuid,
  p_story_id   uuid,
  p_body       text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refusal jsonb;
begin
  if not exists (
    select 1 from public.story_comments
    where id = p_comment_id and author_id = auth.uid()
  ) then
    v_refusal := private.contact_guard_gate(
      'story_comment', p_body,
      jsonb_build_object('story_id', p_story_id, 'row_ref', p_comment_id, 'field', 'body'));
    if v_refusal is not null then
      return v_refusal::json;
    end if;
  end if;

  return public.post_story_comment_core(p_comment_id, p_story_id, p_body);
end;
$$;

comment on function public.post_story_comment(uuid, uuid, text) is
  'Comment on a story: the contact guard''s gate (157), then '
  'post_story_comment_core (147''s body, unchanged).';

revoke all on function public.post_story_comment(uuid, uuid, text) from public, anon;
grant execute on function public.post_story_comment(uuid, uuid, text) to authenticated;

-- 6d. create_story, for its caption. Same retry rule as 6c.
alter function public.create_story(uuid, text, text, text, integer) rename to create_story_core;
revoke all on function public.create_story_core(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_story_core(uuid, text, text, text, integer) to service_role;

create function public.create_story(
  p_story_id    uuid,
  p_media_type  text,
  p_media_path  text,
  p_caption     text default null,
  p_duration_ms integer default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refusal jsonb;
begin
  if p_caption is not null and not exists (
    select 1 from public.stories
    where id = p_story_id and provider_id = auth.uid()
  ) then
    v_refusal := private.contact_guard_gate(
      'story_caption', p_caption,
      jsonb_build_object('story_id', p_story_id, 'row_ref', p_story_id, 'field', 'caption'));
    if v_refusal is not null then
      return v_refusal::json;
    end if;
  end if;

  return public.create_story_core(p_story_id, p_media_type, p_media_path, p_caption, p_duration_ms);
end;
$$;

comment on function public.create_story(uuid, text, text, text, integer) is
  'Post a story: the contact guard''s gate on the caption (157), then '
  'create_story_core (143''s body, unchanged). Story media gets reports and '
  'strikes only, no pre-check, as the owner decided.';

revoke all on function public.create_story(uuid, text, text, text, integer) from public, anon;
grant execute on function public.create_story(uuid, text, text, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Profile fields, at save
-- ---------------------------------------------------------------------------
-- Every text a profile shows: the public name, headline and about, the legacy
-- username (001:7), and the three lists, each joined with spaces so a number
-- split across entries is read whole. Only a field that changed is read, so
-- a row written before the guard never blocks an unrelated save.
create or replace function private.contact_guard_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_mode    text;
  v_uid     uuid := auth.uid();
  v_field   text;
  v_new     text;
  v_old     text;
  v_rules   text[];
  v_signals text[];
begin
  if v_uid is null then
    return new;
  end if;
  v_mode := private.contact_guard_mode();
  if v_mode = 'off' then
    return new;
  end if;

  foreach v_field in array array['display_name', 'headline', 'about', 'username',
                                 'expertise', 'languages', 'preferred_languages'] loop
    v_new := case v_field
      when 'display_name' then new.display_name
      when 'headline' then new.headline
      when 'about' then new.about
      when 'username' then new.username
      when 'expertise' then array_to_string(new.expertise, ' ')
      when 'languages' then array_to_string(new.languages, ' ')
      when 'preferred_languages' then array_to_string(new.preferred_languages, ' ')
    end;
    if tg_op = 'UPDATE' then
      v_old := case v_field
        when 'display_name' then old.display_name
        when 'headline' then old.headline
        when 'about' then old.about
        when 'username' then old.username
        when 'expertise' then array_to_string(old.expertise, ' ')
        when 'languages' then array_to_string(old.languages, ' ')
        when 'preferred_languages' then array_to_string(old.preferred_languages, ' ')
      end;
    end if;
    continue when v_new is null or btrim(v_new) = '' or v_new is not distinct from v_old;
    continue when length(v_new) > 4000;

    if private.contact_guard_blocked(v_new) then
      v_rules := private.contact_guard_rules(v_new);
      if v_mode = 'enforce' then
        raise exception 'CONTACT_INFO'
          using errcode = 'P0011',
                detail = jsonb_build_object(
                  'category', private.contact_guard_category(v_rules),
                  'field', v_field)::text,
                hint = 'Contact details, links and social usernames cannot be saved to a profile.';
      end if;
      perform private.contact_guard_log(
        new.id, 'profile', v_field, '{}'::jsonb, 'hard', 'shadow', v_mode, v_rules,
        private.contact_guard_category(v_rules), private.contact_guard_reason(v_rules), v_new);
    else
      v_signals := private.contact_guard_signals(v_new);
      if cardinality(v_signals) > 0 then
        perform private.contact_guard_log(
          new.id, 'profile', v_field, '{}'::jsonb, 'signal', 'flagged', v_mode, v_signals,
          null, null, v_new);
      end if;
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function private.contact_guard_profile_fields() from public, anon, authenticated;

drop trigger if exists guard_profile_contact_fields on public.profiles;
create trigger guard_profile_contact_fields
  before insert or update of display_name, headline, about, username,
                             expertise, languages, preferred_languages
  on public.profiles
  for each row execute function private.contact_guard_profile_fields();

-- ---------------------------------------------------------------------------
-- 8. Retention: evidence and strikes go at 90 days
-- ---------------------------------------------------------------------------
create or replace function private.contact_guard_purge()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_events  integer;
  v_strikes integer;
begin
  delete from public.contact_guard_strikes where expires_at <= now();
  get diagnostics v_strikes = row_count;
  delete from public.contact_guard_events where purge_after <= now();
  get diagnostics v_events = row_count;
  delete from public.contact_guard_restrictions r
  where coalesce(r.paused_until, '-infinity') <= now()
    and coalesce(r.directory_hidden_until, '-infinity') <= now()
    and r.review_state is null;
  return v_events + v_strikes;
end;
$$;

comment on function private.contact_guard_purge() is
  'Deletes contact-guard evidence and strikes past their 90 days, and '
  'restriction rows with nothing left in force (157). pg_cron, daily.';

revoke all on function private.contact_guard_purge() from public, anon, authenticated;
grant execute on function private.contact_guard_purge() to service_role;

-- Guarded like 090's schedule, so the harness (no pg_cron) applies this file.
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron unavailable, skipping the contact-guard purge schedule (expected in the test harness)';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'purge-contact-guard') then
    perform cron.unschedule('purge-contact-guard');
  end if;
  perform cron.schedule('purge-contact-guard', '17 3 * * *', 'select private.contact_guard_purge()');
end;
$$;

notify pgrst, 'reload schema';
