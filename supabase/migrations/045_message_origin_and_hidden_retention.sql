-- ===========================================================================
-- 045  Message origin metadata, sequential openers, and 30-day hidden retention
-- ===========================================================================
-- Two product changes that share one migration because they share one table:
--
--   A. Automated provider openers become a SEQUENCE, not a batch. A new
--      `origin` column distinguishes a live human message from an automated
--      opener, and an idempotent ordered step RPC (`insert_next_opener`) inserts
--      exactly one approved template at a time, as the provider, only in the
--      caller's own conversation, and never activates or bills a session.
--
--   B. Session content is HIDDEN on session end, not deleted. It disappears
--      from every participant's app immediately, is retained server-side and
--      inaccessible for 30 days (payment disputes / safety), then permanently
--      purged by a daily cron. Reported evidence keeps its own separate,
--      longer retention (migration 031) and is unaffected.
--
-- Retention decision (owner, latest): hide immediately at session end, retain
-- server-side for 30 days, then purge. NOT indefinite.
--
-- This migration does NOT edit migration 040 (openers) or 031 (end_session)
-- in place; it replaces the relevant functions with CREATE OR REPLACE and adds
-- new columns/policies. References: ADR-0020, ADR-0021.

-- ---------------------------------------------------------------------------
-- 1. Message origin metadata (live vs automated)
-- ---------------------------------------------------------------------------
-- 'live' is the default: every human send (send_message) and every existing row
-- is a live message. 'automated_opener' is written only by the server opener
-- functions below. The gate on the visible session timer reads this column so
-- an automated greeting can never make the clock start.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'message_origin') then
    create type public.message_origin as enum ('live', 'automated_opener');
  end if;
end
$$;

alter table public.messages
  add column if not exists origin public.message_origin not null default 'live';

comment on column public.messages.origin is
  'Who authored this row and how. ''live'' is a real human send (send_message) '
  'or a legacy row; ''automated_opener'' is a server-seeded provider greeting '
  '(insert_next_opener). The visible session timer counts only live provider '
  'messages, so an automated opener never starts billing UI. Migration 045.';

-- ---------------------------------------------------------------------------
-- 1b. One-time backfill: reclassify legacy openers as automated
-- ---------------------------------------------------------------------------
-- Rows written by migration 040's seed_conversation_openers predate the origin
-- column and take the new 'live' default. Left as 'live' each one would (a)
-- falsely satisfy the live-provider timer gate and start the billing clock with
-- no human present, and (b) make insert_next_opener believe a real conversation
-- already began and stop seeding. This reclassifies ONLY those rows.
--
-- Matching is by EXACT body copy, and that is deliberate one-time archaeology,
-- not a reusable rule. The origin of a pre-migration row is unrecoverable from
-- the schema: the only evidence a row is an automated opener is that its text is
-- verbatim one of the three migration 040 templates, sent by the conversation's
-- provider, with no session_id. To avoid misclassifying a person who simply
-- typed one of those sentences, a conversation qualifies only when the WHOLE
-- known 040 sequence (all three exact bodies, each as the provider and
-- sessionless) is present; a partial or coincidental match stays 'live'.
--
-- The exact 040 strings are inlined, not referenced: they are a historical
-- constant that 040's array — since superseded by conversation_opener_templates
-- — froze, and they must not be "kept in sync" with anything. Idempotent: only
-- rows still at origin='live' are rewritten, so a re-run touches nothing. Runs
-- as the migration owner (postgres), before the client-write guard in section 3
-- exists, so the guard does not apply.
update public.messages m
set    origin = 'automated_opener'
from   public.conversations c
where  m.conversation_id = c.id
  and  m.session_id is null
  and  m.sender_id = c.provider_id
  and  m.origin = 'live'
  and  m.body in (
         'Hey — glad you''re here.',
         'How are you doing right now?',
         'I''m here to listen. No rush.'
       )
  and  m.conversation_id in (
         select mm.conversation_id
         from   public.messages mm
         join   public.conversations cc on cc.id = mm.conversation_id
         where  mm.session_id is null
           and  mm.sender_id = cc.provider_id
           and  mm.body in (
                  'Hey — glad you''re here.',
                  'How are you doing right now?',
                  'I''m here to listen. No rush.'
                )
         group by mm.conversation_id
         having count(distinct mm.body) = 3
       );

-- ---------------------------------------------------------------------------
-- 2. Hidden-retention columns
-- ---------------------------------------------------------------------------
-- hidden_at: when the row stopped being visible to participants (session end).
-- purge_after: hidden_at + 30 days; the daily cron deletes rows past this.
-- Both are NULL for live, visible rows. Neither is client-writable (guarded and
-- excluded from RLS below).

alter table public.messages
  add column if not exists hidden_at   timestamptz,
  add column if not exists purge_after timestamptz;

comment on column public.messages.hidden_at is
  'Set when a session ends: the row becomes invisible to both participants '
  'immediately (RLS filters hidden_at is not null). Retained server-side for '
  'safety/payment disputes. Migration 045.';
comment on column public.messages.purge_after is
  'hidden_at + 30 days. purge_expired_hidden_content() permanently deletes the '
  'row after this. Reported evidence has its own separate retention. Migration 045.';

-- Partial indexes: the daily purge scans only expired hidden rows, and the RLS
-- visibility check benefits from a cheap hidden_at filter.
create index if not exists messages_purge_after
  on public.messages (purge_after) where purge_after is not null;
create index if not exists messages_hidden_at
  on public.messages (hidden_at) where hidden_at is not null;

-- ---------------------------------------------------------------------------
-- 3. Guard: origin and retention columns are not client-writable
-- ---------------------------------------------------------------------------
-- A NEW guard trigger, never an edit to guard_message_columns (004): additive
-- guards compose in name order and cannot silently regress one another (011).
-- The definer opener/end_session functions run as the owner, so current_user is
-- not 'authenticated'/'anon' there and this guard does not block them.

create or replace function public.guard_message_retention_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.origin      is distinct from old.origin
      or new.hidden_at   is distinct from old.hidden_at
      or new.purge_after is distinct from old.purge_after then
      raise exception 'messages.origin/hidden_at/purge_after are not client-writable'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_message_retention_columns on public.messages;
create trigger guard_message_retention_columns
  before update on public.messages
  for each row execute function public.guard_message_retention_columns();

-- ---------------------------------------------------------------------------
-- 4. Approved opener templates (single source of truth)
-- ---------------------------------------------------------------------------
-- The opener copy lives in one table so seed_conversation_openers and
-- insert_next_opener cannot drift. Only approved rows are ever inserted, and a
-- caller can supply neither the body nor the sender — both are taken from this
-- table and the conversation row. Service-role only (RLS on, no client policy);
-- clients reach it exclusively through the definer RPCs.

create table if not exists public.conversation_opener_templates (
  step        smallint    primary key check (step > 0),
  body        text        not null
              check (length(btrim(body)) > 0 and length(body) <= 4000),
  is_approved boolean     not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.conversation_opener_templates is
  'Ordered, approved provider opener copy. The only source of automated opener '
  'bodies: callers of insert_next_opener/seed_conversation_openers cannot supply '
  'a body or sender. Service-role only; clients use the definer RPCs. Migration 045.';

alter table public.conversation_opener_templates enable row level security;
revoke all on public.conversation_opener_templates from anon, authenticated;

insert into public.conversation_opener_templates (step, body, is_approved) values
  (1, 'Hey — really glad you reached out. 🙂', true),
  (2, 'How are you feeling right now?', true),
  (3, 'No rush at all. I''m here whenever you''re ready. 💬', true)
on conflict (step) do update
  set body        = excluded.body,
      is_approved = excluded.is_approved;

-- ---------------------------------------------------------------------------
-- 5. insert_next_opener — idempotent, ordered, single-step opener RPC
-- ---------------------------------------------------------------------------
-- Inserts exactly ONE approved template as the provider into the caller's own
-- conversation, in order, and returns the step plus the next body so the client
-- can pace a length-aware typing delay. Guarantees:
--   • only the authenticated member's conversation (open_conversation gate);
--   • sender is always the conversation's provider, body always a template —
--     the caller supplies neither, so no provider impersonation is possible;
--   • session_id stays NULL, so this never creates/accepts/activates/bills a
--     session (send_message's session logic is bypassed entirely);
--   • idempotent under retry/interruption/double-mount: a per-conversation row
--     lock serialises concurrent steps and the cursor is the count of existing
--     automated openers, so a repeat cannot duplicate a message;
--   • stops as soon as any live message exists (a real conversation started).

create or replace function public.insert_next_opener(p_provider_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_conv_id    uuid;
  v_member     uuid;
  v_provider   uuid;
  v_auto_count int;
  v_total      int;
  v_live       boolean;
  v_template   public.conversation_opener_templates%rowtype;
  v_next_body  text;
  v_msg        public.messages%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  -- open_conversation resolves (or creates once) the caller's conversation with
  -- this provider AS THE MEMBER, and rejects a non-provider target. This is the
  -- only conversation a caller can seed: they cannot pass an arbitrary id.
  v_conv_id := public.open_conversation(p_provider_id);

  -- Serialise concurrent steps for this conversation so a double-mount cannot
  -- insert the same step twice.
  perform 1 from public.conversations where id = v_conv_id for update;

  select member_id, provider_id
  into   v_member, v_provider
  from   public.conversations
  where  id = v_conv_id;

  if v_member is null or v_member <> v_uid then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select count(*)::int into v_total
  from   public.conversation_opener_templates
  where  is_approved;

  select count(*)::int into v_auto_count
  from   public.messages
  where  conversation_id = v_conv_id
    and  origin          = 'automated_opener';

  select exists (
    select 1 from public.messages
    where  conversation_id = v_conv_id
      and  origin          = 'live'
  ) into v_live;

  -- Nothing left to do: a real conversation has started, or all openers exist.
  if v_live or v_auto_count >= v_total then
    return jsonb_build_object(
      'conversation_id', v_conv_id,
      'inserted', false,
      'done', true,
      'step', v_auto_count,
      'total', v_total,
      'body', null,
      'next_body', null
    );
  end if;

  -- The next approved template in order (0-based cursor = existing count).
  select * into v_template
  from   public.conversation_opener_templates
  where  is_approved
  order  by step
  offset v_auto_count
  limit  1;

  if not found then
    return jsonb_build_object(
      'conversation_id', v_conv_id,
      'inserted', false,
      'done', true,
      'step', v_auto_count,
      'total', v_total,
      'body', null,
      'next_body', null
    );
  end if;

  -- Insert exactly one opener. sender_id is the conversation's provider and body
  -- is the approved template; the caller supplied neither. session_id is NULL,
  -- so touch_session_activity is a no-op and no billing path is touched.
  insert into public.messages (conversation_id, sender_id, body, origin)
  values (v_conv_id, v_provider, v_template.body, 'automated_opener')
  returning * into v_msg;

  -- Body of the step after this one, so the client can size the next delay.
  select body into v_next_body
  from   public.conversation_opener_templates
  where  is_approved
  order  by step
  offset v_auto_count + 1
  limit  1;

  return jsonb_build_object(
    'conversation_id', v_conv_id,
    'inserted', true,
    'done', (v_auto_count + 1) >= v_total,
    'step', v_auto_count + 1,
    'total', v_total,
    'message_id', v_msg.id,
    'created_at', v_msg.created_at,
    'body', v_template.body,
    'next_body', v_next_body
  );
end;
$$;

comment on function public.insert_next_opener(uuid) is
  'Idempotent ordered opener step: inserts one approved template as the provider '
  'into the caller''s own conversation. Never creates/bills a session; caller '
  'cannot supply body or sender. Returns {conversation_id, inserted, done, step, '
  'total, body, next_body}. Migration 045.';

revoke all on function public.insert_next_opener(uuid)
  from public, anon, service_role;
grant execute on function public.insert_next_opener(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. seed_conversation_openers — kept compatible, now origin-aware
-- ---------------------------------------------------------------------------
-- Preserves the migration 040 signature and return shape for any caller still
-- on the batch path, but (a) reads the same approved templates table and (b)
-- marks every inserted row origin='automated_opener' so it never counts toward
-- the live-message timer gate. New clients use insert_next_opener instead.

create or replace function public.seed_conversation_openers(p_provider_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_conv_id uuid;
  v_count   int;
  v_seeded  int := 0;
  v_template public.conversation_opener_templates%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  v_conv_id := public.open_conversation(p_provider_id);

  select count(*)::int into v_count
  from   public.messages m
  where  m.conversation_id = v_conv_id;

  if v_count > 0 then
    return jsonb_build_object(
      'conversation_id', v_conv_id,
      'seeded', false,
      'message_count', v_count
    );
  end if;

  for v_template in
    select * from public.conversation_opener_templates
    where is_approved order by step
  loop
    insert into public.messages (conversation_id, sender_id, body, origin)
    values (v_conv_id, p_provider_id, v_template.body, 'automated_opener');
    v_seeded := v_seeded + 1;
  end loop;

  return jsonb_build_object(
    'conversation_id', v_conv_id,
    'seeded', v_seeded > 0,
    'message_count', v_seeded
  );
end;
$$;

comment on function public.seed_conversation_openers(uuid) is
  'Compatibility batch seed of approved provider openers (origin=automated_opener) '
  'when a thread is empty. Idempotent once any message exists. New clients use '
  'insert_next_opener for the sequential path. Migration 045.';

revoke all on function public.seed_conversation_openers(uuid) from public;
grant execute on function public.seed_conversation_openers(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. RLS: hidden rows are invisible and immutable to participants
-- ---------------------------------------------------------------------------
-- Members and providers can neither SELECT nor mutate a hidden message.
-- service_role (bypassrls) and moderation tooling retain full access.

drop policy if exists "Participants read messages" on public.messages;
create policy "Participants read messages"
  on public.messages for select
  using (
    hidden_at is null
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.member_id = auth.uid() or c.provider_id = auth.uid())
    )
  );

drop policy if exists "Recipient marks messages read" on public.messages;
create policy "Recipient marks messages read"
  on public.messages for update
  using (
    hidden_at is null
    and sender_id <> auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.member_id = auth.uid() or c.provider_id = auth.uid())
    )
  )
  with check (sender_id <> auth.uid());

-- Reactions must not leak the existence or content of a hidden message: a
-- reaction is readable only while its message is visible.
drop policy if exists "Participants read reactions" on public.message_reactions;
create policy "Participants read reactions"
  on public.message_reactions for select
  using (
    exists (
      select 1
      from   public.messages m
      join   public.conversations c on c.id = m.conversation_id
      where  m.id        = message_reactions.message_id
        and  m.hidden_at is null
        and  (c.member_id = auth.uid() or c.provider_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 7b. toggle_reaction must not reach a hidden message
-- ---------------------------------------------------------------------------
-- toggle_reaction (migration 011) is SECURITY DEFINER, so it bypasses the RLS
-- SELECT filter added above that hides ended-session content. Without this, a
-- participant still holding a message id from before settlement could add or
-- remove a reaction on a hidden message — mutating retained-but-invisible data
-- and, via the returned state, confirming the row still exists.
--
-- Faithful copy of the 011 function with ONE behavioural addition: a hidden
-- message reads as NOT_FOUND, the SAME response as an unknown id, so existence
-- is never disclosed. Every other check (auth, participant, suspension, block,
-- toggle/replace semantics, the check_violation handler) and the grant are
-- preserved unchanged.
create or replace function public.toggle_reaction(
  p_message_id uuid,
  p_emoji text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conversation uuid;
  v_member uuid;
  v_provider uuid;
  v_other uuid;
  v_existing text;
  v_suspended timestamptz;
  v_hidden timestamptz;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  select m.conversation_id, c.member_id, c.provider_id, m.hidden_at
    into v_conversation, v_member, v_provider, v_hidden
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where m.id = p_message_id;

  -- A hidden message reads as absent: NOT_FOUND, identical to an unknown id, so
  -- the reaction path cannot confirm that retained content still exists.
  if v_conversation is null or v_hidden is not null then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;
  if v_uid <> v_member and v_uid <> v_provider then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  v_other := case when v_uid = v_member then v_provider else v_member end;

  select suspended_until into v_suspended from public.profiles where id = v_uid;
  if v_suspended is not null and v_suspended > now() then
    return json_build_object('success', false, 'error', 'SUSPENDED');
  end if;

  -- A reaction appears in the other person's transcript and lights up their
  -- device, so it is contact. Gated with the same function send_message uses, or
  -- a block closes the text channel and leaves this one open.
  if public.is_blocked_pair(v_uid, v_other) then
    return json_build_object('success', false, 'error', 'BLOCKED');
  end if;

  -- No rate limit, deliberately. The row count is bounded by the messages you
  -- can see, one per message, so there is nothing to flood; the only churn is
  -- Realtime traffic on a thread you are already in.

  select emoji into v_existing
  from public.message_reactions
  where message_id = p_message_id and user_id = v_uid;

  -- The same emoji again means take it back; a different one replaces. Returning
  -- the resulting state rather than void is what lets an optimistic client
  -- settle: which of the three happened is not derivable from the arguments.
  if v_existing = p_emoji then
    delete from public.message_reactions
    where message_id = p_message_id and user_id = v_uid;
    return json_build_object('success', true, 'emoji', null);
  end if;

  insert into public.message_reactions (message_id, user_id, emoji)
  values (p_message_id, v_uid, p_emoji)
  on conflict (message_id, user_id) do update
    set emoji = excluded.emoji, created_at = now();

  return json_build_object('success', true, 'emoji', p_emoji);
exception
  -- The emoji CHECK, caught rather than re-listed here. Listing the set twice is
  -- how the two copies drift; caught so an off-list emoji reads as every other
  -- rejection instead of an unhandled Postgres error.
  when check_violation then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
end;
$$;

revoke all on function public.toggle_reaction(uuid, text) from public;
grant execute on function public.toggle_reaction(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. end_session — settle exactly as before, but HIDE instead of DELETE
-- ---------------------------------------------------------------------------
-- Faithful replacement of migration 031's end_session. The ONLY behavioural
-- change is the content step: instead of purge_session_content() deleting rows,
-- all relevant conversation content is marked hidden immediately with a 30-day
-- purge_after. Everything else — report evidence copy, reported_hold fence,
-- billing settlement/accrual, lease release, thread metadata — is preserved.
--
-- Scope of the hide, deliberately:
--   • messages linked to this session (session_id = p_session_id); AND
--   • sessionless content in the same conversation (session_id is null): the
--     automated openers and any pre-request content that never got a session_id
--     and therefore escaped the old session_id-scoped purge.
--   • bounded to created_at <= now() and hidden_at is null so a LATER session's
--     content (a different, non-null session_id) and already-hidden prior rows
--     are never touched.

create or replace function public.end_session(
  p_session_id         uuid,
  p_end_reason         text                   default 'manual',
  p_report_reason      public.report_reason   default null,
  p_report_message_ids uuid[]                 default null,
  p_report_statement   text                   default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session    public.paid_sessions%rowtype;
  v_minutes    integer;
  v_report_id  uuid;
  v_case_id    uuid;
begin
  select * into v_session
  from   public.paid_sessions
  where  id = p_session_id
  for update;

  if not found or v_session.status in ('ended', 'reported_hold') then
    raise exception 'Session not found or already ended' using errcode = 'P0008';
  end if;

  if auth.uid() not in (v_session.member_id, v_session.provider_id) then
    raise exception 'Not a participant' using errcode = 'P0001';
  end if;

  -- Billed minutes: only active time counts. A session that never started
  -- (pending_leases, warning) has zero billed minutes.
  v_minutes := case
    when v_session.started_at is null then 0
    else greatest(
      0,
      floor(extract(epoch from (now() - v_session.started_at)) / 60)::integer
    )
  end;

  -- Report path: copy evidence BEFORE the content is hidden. Evidence has its
  -- own separate, longer retention (migration 031) and is never affected by the
  -- 30-day content purge.
  if p_report_reason is not null then
    select public.submit_report(
      v_session.conversation_id,
      null,
      p_report_reason,
      p_report_statement
    ) into v_report_id;

    if p_report_message_ids is not null then
      insert into public.moderation_cases (report_id)
      values (v_report_id)
      returning id into v_case_id;

      insert into public.report_evidence (
        case_id, kind, body, storage_path, captured_at, retain_until
      )
      select
        v_case_id,
        case
          when m.voice_path      is not null then 'voice'
          when m.attachment_path is not null then 'image'
          else 'text'
        end,
        m.body,
        coalesce(m.voice_path, m.attachment_path),
        m.created_at,
        now() + interval '1 year'
      from public.messages m
      where m.id         = any(p_report_message_ids)
        and m.session_id = p_session_id;

      if p_report_statement is not null then
        insert into public.report_evidence (
          case_id, kind, body, captured_at, retain_until
        ) values (
          v_case_id, 'statement', p_report_statement,
          now(), now() + interval '1 year'
        );
      end if;
    end if;

    -- Fence the session in reported_hold while evidence commits, exactly as
    -- migration 031 did.
    update public.paid_sessions
    set    status     = 'reported_hold',
           ended_at   = now(),
           end_reason = p_end_reason
    where  id = p_session_id;
  end if;

  -- Hide (not delete) all relevant content. It leaves both participants' apps
  -- immediately (RLS) and is retained server-side for 30 days, then purged by
  -- purge_expired_hidden_content(). A later session in the same conversation
  -- carries a different non-null session_id and is excluded.
  update public.messages
  set    hidden_at   = now(),
         purge_after = now() + interval '30 days'
  where  conversation_id = v_session.conversation_id
    and  hidden_at is null
    and  created_at <= now()
    and  (session_id = p_session_id or session_id is null);

  -- Terminal state for the session row.
  update public.paid_sessions
  set    status     = 'ended',
         ended_at   = now(),
         end_reason = p_end_reason
  where  id = p_session_id;

  -- Release both participant leases.
  delete from public.session_leases where session_id = p_session_id;

  -- Record provider accrual for any minutes that were billed.
  if v_minutes > 0 and v_session.rate_tokens_per_min is not null then
    perform public.record_provider_accrual(
      v_session.provider_id,
      p_session_id,
      v_minutes,
      v_session.rate_tokens_per_min,
      v_session.provider_share_percent,
      v_session.payout_hold_days,
      v_session.economics_config_version_id
    );
  end if;

  -- Update thread metadata (content-free): the inbox still shows peer, date,
  -- channel, duration. last_preview_kind maps chat→'session', calls→'call'.
  insert into public.conversation_thread_meta (
    conversation_id,
    last_session_at,
    last_session_channel,
    last_session_duration_seconds,
    last_preview_kind,
    updated_at
  ) values (
    v_session.conversation_id,
    now(),
    v_session.channel,
    v_minutes * 60,
    case v_session.channel
      when 'chat' then 'session'
      else             'call'
    end,
    now()
  )
  on conflict (conversation_id) do update
    set last_session_at              = excluded.last_session_at,
        last_session_channel         = excluded.last_session_channel,
        last_session_duration_seconds = excluded.last_session_duration_seconds,
        last_preview_kind            = excluded.last_preview_kind,
        updated_at                   = excluded.updated_at;
end;
$$;

revoke all on function
  public.end_session(uuid, text, public.report_reason, uuid[], text)
  from public, anon, service_role;
grant execute on function
  public.end_session(uuid, text, public.report_reason, uuid[], text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 9. purge_expired_hidden_content — daily permanent deletion
-- ---------------------------------------------------------------------------
-- Deletes hidden messages (and their reactions) whose 30-day purge_after has
-- passed. Idempotent: nothing matches on a second run. Storage objects
-- (voice_path/attachment_path) are orphaned by the delete and collected by the
-- existing orphan-purge crons (migration 011). Reported evidence lives in
-- report_evidence with its own retain_until and is purged separately by
-- purge_expired_evidence() (migration 031) — this function never touches it.

create or replace function public.purge_expired_hidden_content()
returns integer   -- count of message rows deleted
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Reactions first. message_reactions.message_id is ON DELETE CASCADE, so the
  -- message delete below would remove these anyway; doing it explicitly keeps
  -- the function's intent legible and independent of the cascade.
  delete from public.message_reactions r
  using public.messages m
  where r.message_id  = m.id
    and m.hidden_at   is not null
    and m.purge_after is not null
    and m.purge_after < now();

  delete from public.messages
  where hidden_at   is not null
    and purge_after is not null
    and purge_after < now();

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

comment on function public.purge_expired_hidden_content() is
  'Permanently deletes hidden messages/reactions past their 30-day purge_after. '
  'Idempotent. Storage orphans go to the existing orphan crons; reported '
  'evidence is retained separately. Migration 045.';

revoke all on function public.purge_expired_hidden_content()
  from public, anon, authenticated;
grant execute on function public.purge_expired_hidden_content() to service_role;

do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron unavailable, skipping purge-expired-hidden-content schedule (expected in the test harness)';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'purge-expired-hidden-content') then
    perform cron.unschedule('purge-expired-hidden-content');
  end if;
  -- 03:30 daily. Content retention is 30 days; a daily sweep is the right
  -- resolution and stays clear of the 03:00 evidence sweep (migration 031).
  perform cron.schedule(
    'purge-expired-hidden-content',
    '30 3 * * *',
    $cron$select public.purge_expired_hidden_content()$cron$
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 10. conversation_summaries stays metadata-only
-- ---------------------------------------------------------------------------
-- The active view (migration 037) already projects no message body — only peer
-- identity/presence, session metadata, and unread counts. It joins
-- conversation_thread_meta and paid_sessions status, never messages, so hidden
-- content cannot surface through it. No redefinition is needed here; this note
-- and the pgTAP assertions (test 190) keep that invariant explicit.

-- ---------------------------------------------------------------------------
-- 11. Media reads follow message visibility, not just the conversation path
-- ---------------------------------------------------------------------------
-- The read policies in migrations 011 (voice-notes) and 014 (attachments)
-- authorise a SELECT on the object's FIRST PATH SEGMENT alone: any participant
-- in the conversation whose id prefixes the object name can read it. That
-- outlives the message. Once end_session hides a message, its row disappears
-- from the client but the object is still readable — and a signed URL still
-- mintable — by a participant who kept the path, which leaks the very content
-- the hide was meant to remove.
--
-- Both read policies are replaced so a SELECT requires an ASSOCIATED, VISIBLE
-- message: a public.messages row whose voice_path / attachment_path equals this
-- object, with hidden_at IS NULL, in a conversation the caller is in. When the
-- message is hidden or purged, the object stops being readable and no new signed
-- URL can be minted. The UPLOAD policies are deliberately left untouched: an
-- upload precedes its message row, so gating it on one would break the composer;
-- their participant-prefix check is unchanged, and orphaned objects are still
-- swept by purge_orphaned_voice_notes / purge_orphaned_attachments.
--
-- Guarded and driven through EXECUTE for the same reason as 011/014: the pgTAP
-- harness is plain Postgres with no storage schema, and `create policy on
-- storage.objects` in a bare file would fail to parse a table that is not there.
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema absent, skipping media-visibility policy replacement (expected in the test harness)';
    return;
  end if;

  -- voice-notes: bucket and policy names verified against migration 011.
  execute $p$drop policy if exists "Participants read voice notes" on storage.objects$p$;
  execute $p$
    create policy "Participants read voice notes"
      on storage.objects for select to authenticated
      using (
        bucket_id = 'voice-notes'
        and exists (
          select 1
          from   public.messages m
          join   public.conversations c on c.id = m.conversation_id
          where  m.voice_path = storage.objects.name
            and  m.hidden_at is null
            and  (c.member_id = auth.uid() or c.provider_id = auth.uid())
        )
      )
  $p$;

  -- attachments: bucket and policy names verified against migration 014.
  execute $p$drop policy if exists "Participants read attachments" on storage.objects$p$;
  execute $p$
    create policy "Participants read attachments"
      on storage.objects for select to authenticated
      using (
        bucket_id = 'attachments'
        and exists (
          select 1
          from   public.messages m
          join   public.conversations c on c.id = m.conversation_id
          where  m.attachment_path = storage.objects.name
            and  m.hidden_at is null
            and  (c.member_id = auth.uid() or c.provider_id = auth.uid())
        )
      )
  $p$;
end
$$;
