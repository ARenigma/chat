-- 005_trust_and_safety.sql
--
-- ADR-0001 item 1: the largest remaining surface, and the one that decides
-- whether the positioning survives contact with real users.
--
-- Five primitives, in the order an incident actually moves through them:
--
--   1. blocks               — the user's own immediate remedy, needs no operator
--   2. reports              — evidence capture, because messages cascade-delete
--   3. moderation_actions   — an append-only record of what an operator did
--   4. suspension           — enforcement, checked in the send path
--   5. rate limiting        — the cheap structural defence against spam/flooding
--
-- Plus `events`, the first-party telemetry table. It lives here rather than in
-- its own migration because the abuse signals worth alerting on (report rate,
-- block rate, send-rejection rate) are the same rows an ops dashboard reads.
--
-- ---------------------------------------------------------------------------
-- A note on retention, because this migration deliberately weakens a claim
-- ---------------------------------------------------------------------------
-- Until now the privacy story was absolute: deleting the auth user cascades to
-- profile -> conversations -> messages, and nothing is retained. Safety breaks
-- that, and pretending otherwise would make the README false.
--
-- A report has to outlive the reported message, or the remedy for "he sent me
-- something illegal" is to destroy the only evidence of it. So `reports` keeps a
-- snapshot of the reported text, and reporter/subject ids are `on delete set
-- null` rather than cascade — the report survives, de-identified.
--
-- Retention is therefore bounded in code, not in a policy document:
-- `purge_expired_reports()` drops resolved reports after 90 days. The README's
-- data-deletion section is updated to say this plainly.

-- ---------------------------------------------------------------------------
-- 1. Blocking — the remedy that needs no operator and no waiting
-- ---------------------------------------------------------------------------
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;

-- A user sees and manages only their own block list. Deliberately no policy that
-- lets anyone read who has blocked *them*: "you have been blocked" is a
-- disclosure that invites retaliation through another account.
create policy "Owner reads own blocks"
  on public.blocks for select using (auth.uid() = blocker_id);

create policy "Owner creates own blocks"
  on public.blocks for insert with check (auth.uid() = blocker_id);

create policy "Owner removes own blocks"
  on public.blocks for delete using (auth.uid() = blocker_id);

-- Symmetric test, used only inside the SECURITY DEFINER send path.
--
-- It must be DEFINER because a member cannot read the other party's block rows
-- under RLS, and it must NOT be callable by a client: with arbitrary arguments
-- it would answer "is A blocked by B" for any pair, which is exactly the
-- disclosure the missing SELECT policy above avoids.
create or replace function public.is_blocked_pair(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = p_a and blocked_id = p_b)
       or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

revoke all on function public.is_blocked_pair(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- 2. Reports — evidence, captured at report time
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'report_reason') then
    create type public.report_reason as enum (
      'harassment',
      'sexual_content',
      -- Separated from sexual_content on purpose: it is the only category with a
      -- legal reporting obligation attached, and it must never sit in a queue
      -- behind spam. The ops runbook routes it first.
      'minor_safety',
      'solicitation',
      -- Not abuse by the other party. Routed to support, not enforcement.
      'self_harm',
      'spam',
      'impersonation',
      'other'
    );
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'report_status') then
    create type public.report_status as enum ('open', 'actioned', 'dismissed');
  end if;
end
$$;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  -- set null, not cascade: see the retention note at the top.
  reporter_id uuid references public.profiles(id) on delete set null,
  subject_user_id uuid references public.profiles(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  reason public.report_reason not null,
  detail text check (detail is null or length(detail) <= 2000),
  -- The reported text, copied at report time. `messages` cascade-deletes with
  -- the account, so without this the evidence disappears with the accused.
  evidence_body text,
  evidence_at timestamptz,
  status public.report_status not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolver_note text
);

create index if not exists reports_triage_idx
  on public.reports (status, reason, created_at desc);
create index if not exists reports_subject_idx
  on public.reports (subject_user_id, created_at desc);

alter table public.reports enable row level security;

-- A reporter may see that their report exists and its status — closing the loop
-- matters, an unacknowledged report reads as "nothing happened". They may not
-- see the resolver note, so the view below narrows the columns.
create policy "Reporter reads own reports"
  on public.reports for select using (auth.uid() = reporter_id);

-- No client INSERT policy: reporting goes through submit_report so participation
-- is verified and the evidence snapshot cannot be forged or omitted.
-- No client UPDATE or DELETE at all: a report is not withdrawable by the
-- accused, and not editable by the reporter after the fact.

create or replace view public.my_reports
with (security_invoker = true) as
  select id, reason, status, created_at, resolved_at
  from public.reports
  where reporter_id = auth.uid();

grant select on public.my_reports to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Moderation actions — append-only, no client access whatsoever
-- ---------------------------------------------------------------------------
create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.reports(id) on delete set null,
  subject_user_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in (
    'none', 'warned', 'suspended', 'banned', 'conversation_closed'
  )),
  -- Who acted. Free text because the ops surface is a CLI run by a person, not
  -- an authenticated app user; it is the operator's identifier.
  actor text not null,
  note text,
  created_at timestamptz not null default now()
);

alter table public.moderation_actions enable row level security;
-- RLS on with zero policies = no client role can read or write it at all.
-- service_role bypasses RLS, which is the only intended access path.

-- An audit trail that can be rewritten is not an audit trail. Enforced rather
-- than merely intended, because service_role bypasses RLS and would otherwise
-- be free to edit history.
create or replace function public.moderation_actions_are_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'moderation_actions is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists moderation_actions_no_update on public.moderation_actions;
create trigger moderation_actions_no_update
  before update or delete on public.moderation_actions
  for each row execute function public.moderation_actions_are_immutable();

-- ---------------------------------------------------------------------------
-- 4. Enforcement — suspension, checked where it bites
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists suspended_until timestamptz;

comment on column public.profiles.suspended_until is
  'Set only by moderation tooling under service_role. Enforced in send_message '
  'and open_conversation. Null means not suspended; a far-future value is how a '
  'permanent ban is represented, so there is one code path rather than two.';

-- The 003 guard listed the privileged columns explicitly, so a new one is not
-- covered until it is named here. That is the safe direction to fail, but it
-- does mean this function has to be revisited with every such column.
create or replace function public.guard_privileged_profile_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.role is distinct from old.role then
      raise exception 'profiles.role is not client-writable' using errcode = '42501';
    end if;
    if new.identity_verified_at is distinct from old.identity_verified_at then
      raise exception 'profiles.identity_verified_at is not client-writable'
        using errcode = '42501';
    end if;
    if new.token_balance is distinct from old.token_balance then
      raise exception 'profiles.token_balance is not client-writable'
        using errcode = '42501';
    end if;
    if new.suspended_until is distinct from old.suspended_until then
      raise exception 'profiles.suspended_until is not client-writable'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The send path, now with safety checks
-- ---------------------------------------------------------------------------
-- Order matters and is deliberate: identity, then shape, then participation,
-- then enforcement, then rate, then money. Nothing is debited until every
-- rejection has had its chance, so a blocked or throttled send cannot cost a
-- token.
create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_member uuid;
  v_provider uuid;
  v_other uuid;
  v_balance integer;
  v_message public.messages;
  v_trimmed text := btrim(p_body);
  v_recent integer;
  v_suspended timestamptz;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;
  if v_trimmed = '' or length(v_trimmed) > 4000 then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;

  select member_id, provider_id into v_member, v_provider
  from public.conversations
  where id = p_conversation_id;

  if v_member is null then
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

  -- Symmetric: blocking someone also stops them reaching you. A one-way block
  -- would let the blocker keep talking at someone who wanted them gone.
  if public.is_blocked_pair(v_uid, v_other) then
    return json_build_object('success', false, 'error', 'BLOCKED');
  end if;

  -- 20 messages/minute. High enough that a fast human typing short lines never
  -- sees it, low enough that scripted flooding stops being viable.
  select count(*)::int into v_recent
  from public.messages
  where sender_id = v_uid and created_at > now() - interval '1 minute';

  if v_recent >= 20 then
    return json_build_object('success', false, 'error', 'RATE_LIMITED');
  end if;

  if v_uid = v_member then
    select token_balance into v_balance
    from public.profiles where id = v_uid
    for update;

    if v_balance is null or v_balance < 1 then
      return json_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
    end if;

    update public.profiles
    set token_balance = token_balance - 1
    where id = v_uid;
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation_id, v_uid, v_trimmed)
  returning * into v_message;

  update public.conversations
  set last_message_at = v_message.created_at
  where id = p_conversation_id;

  return json_build_object(
    'success', true,
    'message_id', v_message.id,
    'created_at', v_message.created_at,
    'new_balance', case when v_uid = v_member then v_balance - 1 else null end
  );
end;
$$;

revoke all on function public.send_message(uuid, text) from public;
grant execute on function public.send_message(uuid, text) to authenticated;

-- Opening a thread is also gated: a blocked or suspended user should not be able
-- to start a new conversation as a way around either state.
create or replace function public.open_conversation(p_provider_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_suspended timestamptz;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if v_uid = p_provider_id then
    raise exception 'cannot open a conversation with yourself' using errcode = '22023';
  end if;

  select suspended_until into v_suspended from public.profiles where id = v_uid;
  if v_suspended is not null and v_suspended > now() then
    raise exception 'SUSPENDED' using errcode = '42501';
  end if;

  if public.is_blocked_pair(v_uid, p_provider_id) then
    raise exception 'BLOCKED' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_provider_id
      and role = 'provider'
      and identity_verified_at is not null
      and (suspended_until is null or suspended_until <= now())
  ) then
    raise exception 'not an admitted provider' using errcode = '22023';
  end if;

  insert into public.conversations (member_id, provider_id)
  values (v_uid, p_provider_id)
  on conflict (member_id, provider_id) do nothing;

  select id into v_id from public.conversations
  where member_id = v_uid and provider_id = p_provider_id;

  return v_id;
end;
$$;

revoke all on function public.open_conversation(uuid) from public;
grant execute on function public.open_conversation(uuid) to authenticated;

-- A suspended provider should also drop out of the directory rather than take
-- new members while under review.
drop view if exists public.provider_directory;

create view public.provider_directory
with (security_invoker = false) as
  select
    p.id,
    p.display_name,
    p.is_available,
    p.created_at
  from public.profiles p
  where p.role = 'provider'
    and p.identity_verified_at is not null
    and (p.suspended_until is null or p.suspended_until <= now());

comment on view public.provider_directory is
  'The only member-facing projection of a provider. Runs as owner and therefore '
  'bypasses RLS on profiles by design: the column list here IS the privacy '
  'boundary. Never add a column without deciding it is public to every member.';

revoke all on public.provider_directory from anon;
grant select on public.provider_directory to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Reporting
-- ---------------------------------------------------------------------------
create or replace function public.submit_report(
  p_conversation_id uuid,
  p_message_id uuid,
  p_reason public.report_reason,
  p_detail text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_member uuid;
  v_provider uuid;
  v_subject uuid;
  v_body text;
  v_at timestamptz;
  v_id uuid;
  v_recent integer;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  select member_id, provider_id into v_member, v_provider
  from public.conversations where id = p_conversation_id;

  if v_member is null then
    raise exception 'no such conversation' using errcode = 'no_data_found';
  end if;
  if v_uid <> v_member and v_uid <> v_provider then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  v_subject := case when v_uid = v_member then v_provider else v_member end;

  -- Reporting is itself abusable: mass false reports are a harassment vector and
  -- they bury the real queue. 10/hour is generous for a person in distress.
  select count(*)::int into v_recent
  from public.reports
  where reporter_id = v_uid and created_at > now() - interval '1 hour';

  if v_recent >= 10 then
    raise exception 'too many reports, try again later' using errcode = '54000';
  end if;

  -- Snapshot the evidence. Only a message in the reported conversation, so a
  -- report cannot be used to exfiltrate text from a thread the reporter is not
  -- part of, and only one the reporter did not write.
  if p_message_id is not null then
    select body, created_at into v_body, v_at
    from public.messages
    where id = p_message_id
      and conversation_id = p_conversation_id
      and sender_id = v_subject;
  end if;

  insert into public.reports (
    reporter_id, subject_user_id, conversation_id, message_id,
    reason, detail, evidence_body, evidence_at
  )
  values (
    v_uid, v_subject, p_conversation_id, p_message_id,
    p_reason, btrim(p_detail), v_body, v_at
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_report(uuid, uuid, public.report_reason, text) from public;
grant execute on function public.submit_report(uuid, uuid, public.report_reason, text)
  to authenticated;

-- Bounded retention, enforced in code rather than promised in a document.
create or replace function public.purge_expired_reports()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with gone as (
    delete from public.reports
    where status <> 'open'
      and resolved_at is not null
      and resolved_at < now() - interval '90 days'
    returning 1
  )
  select count(*)::int into v_count from gone;
  return v_count;
end;
$$;

revoke all on function public.purge_expired_reports() from public;
grant execute on function public.purge_expired_reports() to service_role;

-- ---------------------------------------------------------------------------
-- 7. Telemetry — first-party, and structurally unable to carry a message
-- ---------------------------------------------------------------------------
-- No third-party analytics SDK. That is not squeamishness: the manifest gate
-- allows exactly INTERNET and VIBRATE, the Play data-safety declaration says no
-- advertising id and no analytics SDK, and adding one would make both false. A
-- table we own costs nothing and keeps the claim true.
create table if not exists public.events (
  -- uuid rather than bigserial for two reasons: a sequential id tells any reader
  -- how many events exist, and a serial needs a separate USAGE grant on its
  -- sequence, which is one more thing to get wrong. Ordering comes from
  -- created_at, which is what every query actually uses.
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  name text not null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_name_time_idx on public.events (name, created_at desc);
create index if not exists events_time_idx on public.events (created_at desc);

alter table public.events enable row level security;

-- Write-only from the client's point of view. There is no SELECT policy at all:
-- a client can emit its own events and can never read anybody's, including its
-- own. Reading is for service_role and the Grafana datasource user.
create policy "Own events insertable"
  on public.events for insert
  with check (auth.uid() = user_id);

-- The allowlist is the schema. An unknown event name is a bug or an attempt to
-- smuggle free text through the `name` column, and either way it should fail
-- loudly at insert rather than quietly pollute the metrics.
create or replace function public.guard_event_shape()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_key text;
begin
  if new.name not in (
    'app_open', 'directory_viewed', 'conversation_opened', 'message_sent',
    'send_rejected', 'refill_opened', 'refill_claimed', 'report_submitted',
    'user_blocked', 'user_unblocked', 'account_deleted', 'identity_linked'
  ) then
    raise exception 'unknown event name: %', new.name using errcode = '22023';
  end if;

  if pg_column_size(new.props) > 2048 then
    raise exception 'event props too large' using errcode = '22023';
  end if;

  -- Telemetry must not become a side channel for the content the Sentry scrubber
  -- works so hard to keep off the wire. Enforced here because the client is the
  -- least trustworthy place to enforce it.
  for v_key in select jsonb_object_keys(new.props) loop
    if v_key ~* '(body|message|content|text|detail|email|phone|name|token)' then
      raise exception 'event props may not carry "%"', v_key using errcode = '22023';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists guard_event_shape on public.events;
create trigger guard_event_shape
  before insert on public.events
  for each row execute function public.guard_event_shape();

-- Supabase grants ALL on new public tables to anon/authenticated by default, so
-- every table added here needs its privileges stated rather than assumed. RLS
-- would stop the reads anyway, but a missing policy then becomes a data leak
-- instead of a denied query, and defence in depth is cheap.
revoke all on public.events from anon, authenticated;
grant insert on public.events to authenticated;

revoke all on public.blocks from anon, authenticated;
grant select, insert, delete on public.blocks to authenticated;

-- No UPDATE anywhere: a block is created or removed, never edited.
revoke all on public.reports from anon, authenticated;
-- SELECT only, and RLS narrows it to the reporter's own rows. Needed because
-- my_reports is security_invoker and therefore runs with the caller's rights.
grant select on public.reports to authenticated;

revoke all on public.moderation_actions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Ops read models. Views rather than saved queries, so the runbook and the
--    dashboard cannot drift from each other.
-- ---------------------------------------------------------------------------
create or replace view public.moderation_queue as
  select
    r.id,
    r.reason,
    r.status,
    r.created_at,
    r.detail,
    r.evidence_body,
    r.subject_user_id,
    r.conversation_id,
    -- Repeat offenders should not look like first-time reports.
    (select count(*) from public.reports r2
      where r2.subject_user_id = r.subject_user_id) as reports_against_subject,
    p.suspended_until,
    p.role as subject_role
  from public.reports r
  left join public.profiles p on p.id = r.subject_user_id
  where r.status = 'open'
  order by
    -- minor_safety first, always, regardless of age.
    (r.reason = 'minor_safety') desc,
    (r.reason = 'self_harm') desc,
    r.created_at asc;

revoke all on public.moderation_queue from anon, authenticated;

create or replace view public.safety_metrics as
  select
    date_trunc('day', created_at) as day,
    count(*) filter (where name = 'message_sent') as messages_sent,
    count(*) filter (where name = 'send_rejected') as sends_rejected,
    count(*) filter (where name = 'report_submitted') as reports_submitted,
    count(*) filter (where name = 'user_blocked') as blocks_created,
    count(distinct user_id) as active_users
  from public.events
  where created_at > now() - interval '90 days'
  group by 1
  order by 1 desc;

revoke all on public.safety_metrics from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. The inbox read model
-- ---------------------------------------------------------------------------
-- Chat history needs a list of threads with a preview and an unread count. Doing
-- that client-side is three round trips per row; doing it here is one query.
--
-- `security_invoker = true` is the whole security argument: RLS on
-- `conversations` and `messages` applies as the caller, so this view cannot
-- return a thread you are not part of. Contrast with provider_directory, which
-- is definer precisely because it must cross that boundary.
--
-- The display name comes from provider_directory rather than a join on profiles,
-- because migration 004 removed the policy that let members read provider rows —
-- the directory view is now the only sanctioned path to a provider's name.
create or replace view public.conversation_summaries
with (security_invoker = true) as
  select
    c.id,
    c.last_message_at,
    case when c.member_id = auth.uid() then c.provider_id else c.member_id end
      as peer_id,
    d.display_name as peer_display_name,
    coalesce(d.is_available, false) as peer_available,
    (select m.body from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc limit 1) as last_body,
    (select m.sender_id from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc limit 1) as last_sender_id,
    (select count(*) from public.messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and m.read_at is null) as unread_count
  from public.conversations c
  left join public.provider_directory d
    on d.id = case when c.member_id = auth.uid() then c.provider_id else c.member_id end
  where c.member_id = auth.uid() or c.provider_id = auth.uid();

revoke all on public.conversation_summaries from anon;
grant select on public.conversation_summaries to authenticated;
