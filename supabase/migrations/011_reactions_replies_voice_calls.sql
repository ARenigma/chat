-- ---------------------------------------------------------------------------
-- 011: reactions, replies, voice notes, calls, presence, pseudonymity
-- ---------------------------------------------------------------------------
-- One migration because these are one product change: the chat stops being a
-- text field and becomes a conversation. Splitting them would mean a schema
-- where `messages.body` is nullable but nothing can send a voice note, or a
-- `calls` table with no meter behind it, and neither of those is a state worth
-- being able to deploy.
--
-- Two rules carried forward, both learned the hard way and both load-bearing:
--
--   1. A new guarded column means a NEW guard trigger, never an edit to an
--      existing one. 010 records what happened the one time that was ignored:
--      redefining guard_privileged_profile_columns from the 003 version silently
--      deleted the five checks 005 and 006 had added, with no diff to show for
--      it. Postgres runs BEFORE UPDATE triggers in name order and each raises
--      independently, so additive guards compose and cannot regress.
--
--   2. Anything Supabase-only is guarded rather than assumed. `scripts/db-test
--      .mjs` runs these files against a plain postgres+pgTAP image with no
--      storage schema, no pg_cron, no pg_net and no Vault, and that harness is
--      what proves RLS actually isolates users. 009 set the pattern.
--
-- Section order is a dependency order, not a narrative one. In particular
-- `member_handle` is defined before the views that call it, and
-- `pending_call_pushes` is created after `provider_directory` is rebuilt: a view
-- cannot be dropped while another view selects from it, which is the trap 006
-- documents and 009 then walked into from the other side.

-- ---------------------------------------------------------------------------
-- 1. What a message can be
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists reply_to_id uuid references public.messages(id) on delete set null,
  add column if not exists voice_path text,
  add column if not exists voice_duration_ms integer;

comment on column public.messages.reply_to_id is
  'The message being replied to. `on delete set null`, not cascade: a reply is '
  'its own statement and losing the parent must not erase it. Nothing deletes a '
  'message except the account cascade, so in practice this fires only then.';

comment on column public.messages.voice_duration_ms is
  'Reported by the recorder and trusted, because it buys nothing to lie about: '
  'billing is per message, so a voice note costs one token whether it is three '
  'seconds or three minutes. Contrast public.settle_call, which takes no '
  'duration argument at all, because there the number is money.';

-- The body CHECK becomes a payload CHECK.
--
-- Worth knowing before reading the drop: the 003 constraint was never what
-- blocked a voice note. `length(btrim(null)) > 0` evaluates to NULL and a CHECK
-- passes NULL, so only the NOT NULL stood in the way. Restated as one constraint
-- anyway, because two half-true statements about the same column is how the next
-- person gets it wrong.
alter table public.messages alter column body drop not null;
alter table public.messages drop constraint if exists messages_body_check;

alter table public.messages
  drop constraint if exists message_carries_one_payload;

alter table public.messages
  add constraint message_carries_one_payload check (
    (
      body is not null
      and length(btrim(body)) > 0
      and length(body) <= 4000
      and voice_path is null
      and voice_duration_ms is null
    )
    or (
      body is null
      and voice_path is not null
      -- One second to three minutes. The floor rejects a fat-fingered tap that
      -- produced no audio; the ceiling is what the recorder enforces on device,
      -- and the two numbers belong together rather than in two files.
      and voice_duration_ms between 1000 and 180000
    )
  );

-- The storage policy authorises a read on the first path segment, so a path that
-- is not `<conversation uuid>/<uuid>.m4a` would make that policy unsound. Stated
-- as a constraint rather than trusted from the uploader.
alter table public.messages
  drop constraint if exists voice_path_is_scoped;

alter table public.messages
  add constraint voice_path_is_scoped check (
    voice_path is null
    or voice_path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.m4a$'
  );

-- A reply must live in the same thread as its parent, and a message cannot reply
-- to itself.
--
-- Not expressible as a CHECK, which cannot run a subquery, and not left to
-- send_message either: 004 settled that an invariant about every row belongs in
-- a trigger rather than in the one function that happens to write them today.
--
-- SECURITY INVOKER (the default), and that is the subtle part: `current_user`
-- has to be the caller for the immutability branch to be reached at all. 003
-- records that the sibling guard was once SECURITY DEFINER and that silently
-- disabled every check inside it.
create or replace function public.guard_message_reply_and_voice()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Runs for every writer including the definer send path, because a future
  -- backfill is a writer too.
  if new.reply_to_id is not null then
    if new.reply_to_id = new.id then
      raise exception 'a message cannot reply to itself' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.messages parent
      where parent.id = new.reply_to_id
        and parent.conversation_id = new.conversation_id
    ) then
      raise exception 'a reply must point at a message in the same conversation'
        using errcode = '22023';
    end if;
  end if;

  -- The client-immutability half, and a THIRD trigger on messages rather than an
  -- edit to guard_message_columns. See the note at the top of this file: an
  -- additive guard cannot delete the checks 004 already put there.
  if tg_op = 'UPDATE' and current_user in ('authenticated', 'anon') then
    if new.reply_to_id is distinct from old.reply_to_id
      or new.voice_path is distinct from old.voice_path
      or new.voice_duration_ms is distinct from old.voice_duration_ms then
      raise exception 'only messages.read_at is client-writable'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_message_reply_and_voice on public.messages;
create trigger guard_message_reply_and_voice
  before insert or update on public.messages
  for each row execute function public.guard_message_reply_and_voice();

-- ---------------------------------------------------------------------------
-- 2. Reactions
-- ---------------------------------------------------------------------------
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- A closed set, not free text, and this is the whole safety argument for the
  -- feature. A reaction renders under somebody else's words, in their
  -- transcript, attributed to them at a glance. Free text there is an
  -- unmoderatable content channel aimed at one person, and it would be the only
  -- text in the product that submit_report cannot snapshot as evidence.
  emoji text not null check (emoji in ('❤️', '👍', '😂', '😮', '😢', '🙏')),
  created_at timestamptz not null default now(),
  -- One per user per message. Changing your mind is an upsert and taking it back
  -- is a delete, so there is never a second row to reconcile, and the DELETE
  -- payload Realtime sends is exactly this key, which is all the client needs to
  -- remove the right glyph.
  primary key (message_id, user_id)
);

alter table public.message_reactions enable row level security;

create policy "Participants read reactions"
  on public.message_reactions for select
  using (
    exists (
      select 1
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = message_reactions.message_id
        and (c.member_id = auth.uid() or c.provider_id = auth.uid())
    )
  );

-- Supabase grants ALL on new public tables by default, so every table added here
-- states its privileges rather than assuming them (005's note). SELECT only:
-- there is deliberately no INSERT or DELETE policy, because a reaction has to be
-- gated on blocking and is_blocked_pair is not readable from a policy.
revoke all on public.message_reactions from anon, authenticated;
grant select on public.message_reactions to authenticated;

-- Guarded so re-running the migration on the hosted project is not an error.
-- Default replica identity (the primary key) is enough here, unlike messages:
-- the insert payload carries the whole new row and the delete payload carries
-- (message_id, user_id), which identifies the reaction because there is only
-- ever one per pair.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_reactions'
  ) then
    execute 'alter publication supabase_realtime add table public.message_reactions';
  end if;
end
$$;

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
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  select m.conversation_id, c.member_id, c.provider_id
    into v_conversation, v_member, v_provider
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where m.id = p_message_id;

  if v_conversation is null then
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
-- 3. The send path, carrying three payload shapes instead of one
-- ---------------------------------------------------------------------------
-- Replaced rather than overloaded. A second `send_message` with extra defaulted
-- parameters would leave two candidates for a two-argument call and PostgREST
-- would have to guess; dropping the old signature is the only way to keep one
-- send path. `src/api/chat.ts` calls it with named arguments, so the client is
-- unaffected, but supabase/tests/020 asserts the old argument list and has to be
-- updated with it.
drop function if exists public.send_message(uuid, text);

-- Order is unchanged from 005 and still deliberate: identity, shape,
-- participation, the reply-parent lookup, enforcement, rate, money. The parent
-- lookup sits after participation on purpose. Run any earlier it would answer
-- "does message X exist in conversation Y" for a thread the caller is not in.
create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text default null,
  p_reply_to_id uuid default null,
  p_voice_path text default null,
  p_voice_duration_ms integer default null
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
  v_trimmed text := nullif(btrim(p_body), '');
  v_voice boolean := p_voice_path is not null;
  v_recent integer;
  v_suspended timestamptz;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  -- Exactly one payload. Equality rather than a chain of ifs because both
  -- degenerate cases are the same mistake: true = true is text and voice
  -- together, false = false is an empty send.
  if (v_trimmed is not null) = v_voice then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  if v_trimmed is not null and length(v_trimmed) > 4000 then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  if v_voice and (
    p_voice_duration_ms is null
    or p_voice_duration_ms < 1000
    or p_voice_duration_ms > 180000
  ) then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  -- The upload lives under the conversation it belongs to and the storage policy
  -- authorises on that prefix. Checked here too, so a member cannot attach audio
  -- from one of their threads to another of their threads.
  if v_voice and split_part(p_voice_path, '/', 1) <> p_conversation_id::text then
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

  -- The trigger would catch this too, but as an exception that rolls back the
  -- debit rather than as a rejection the client already knows how to render.
  if p_reply_to_id is not null and not exists (
    select 1 from public.messages
    where id = p_reply_to_id and conversation_id = p_conversation_id
  ) then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;

  v_other := case when v_uid = v_member then v_provider else v_member end;

  select suspended_until into v_suspended from public.profiles where id = v_uid;
  if v_suspended is not null and v_suspended > now() then
    return json_build_object('success', false, 'error', 'SUSPENDED');
  end if;

  if public.is_blocked_pair(v_uid, v_other) then
    return json_build_object('success', false, 'error', 'BLOCKED');
  end if;

  select count(*)::int into v_recent
  from public.messages
  where sender_id = v_uid and created_at > now() - interval '1 minute';

  if v_recent >= 20 then
    return json_build_object('success', false, 'error', 'RATE_LIMITED');
  end if;

  -- A voice note is one message and costs one token, exactly like a line of
  -- text. Not per second: one token per message is an invariant with a parity
  -- test behind it, and metering audio by length would put a meter in the chat,
  -- which is the mechanism behind Clarity's worst reviews and the reason there
  -- is no meter outside a call.
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

  insert into public.messages (
    conversation_id, sender_id, body, reply_to_id, voice_path, voice_duration_ms
  )
  values (
    p_conversation_id, v_uid, v_trimmed, p_reply_to_id,
    p_voice_path, p_voice_duration_ms
  )
  returning * into v_message;

  update public.conversations
  set last_message_at = v_message.created_at
  where id = p_conversation_id;

  return json_build_object(
    'success', true,
    'message_id', v_message.id,
    'created_at', v_message.created_at,
    'kind', case when v_voice then 'voice' else 'text' end,
    'new_balance', case when v_uid = v_member then v_balance - 1 else null end
  );
end;
$$;

revoke all on function public.send_message(uuid, text, uuid, text, integer) from public;
grant execute on function public.send_message(uuid, text, uuid, text, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reporting a voice note
-- ---------------------------------------------------------------------------
-- Without this, "he sent me something vile" is unreportable the moment it is
-- spoken rather than typed, which would make voice notes the one channel with no
-- safety story. Same reasoning as evidence_body in 005.
alter table public.reports
  add column if not exists evidence_voice_path text;

-- Signature unchanged, so the grants and the 040 assertions about them still
-- hold. Only the snapshot widens.
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
  v_voice text;
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

  select count(*)::int into v_recent
  from public.reports
  where reporter_id = v_uid and created_at > now() - interval '1 hour';

  if v_recent >= 10 then
    raise exception 'too many reports, try again later' using errcode = '54000';
  end if;

  -- Same two conditions as before: in the reported conversation, and not written
  -- by the reporter. A voice note snapshots its path instead of its text, and
  -- the purge job below treats that path as retained.
  if p_message_id is not null then
    select body, voice_path, created_at into v_body, v_voice, v_at
    from public.messages
    where id = p_message_id
      and conversation_id = p_conversation_id
      and sender_id = v_subject;
  end if;

  insert into public.reports (
    reporter_id, subject_user_id, conversation_id, message_id,
    reason, detail, evidence_body, evidence_voice_path, evidence_at
  )
  values (
    v_uid, v_subject, p_conversation_id, p_message_id,
    p_reason, btrim(p_detail), v_body, v_voice, v_at
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_report(uuid, uuid, public.report_reason, text) from public;
grant execute on function public.submit_report(uuid, uuid, public.report_reason, text)
  to authenticated;

-- Dropped rather than replaced: the new column belongs beside evidence_body
-- where a reviewer reads it, and `create or replace view` can only append.
-- scripts/moderate.mjs selects the whole row, so column order is free.
drop view if exists public.moderation_queue;

create view public.moderation_queue as
  select
    r.id,
    r.reason,
    r.status,
    r.created_at,
    r.detail,
    r.evidence_body,
    r.evidence_voice_path,
    r.subject_user_id,
    r.conversation_id,
    (select count(*) from public.reports r2
      where r2.subject_user_id = r.subject_user_id) as reports_against_subject,
    p.suspended_until,
    p.role as subject_role
  from public.reports r
  left join public.profiles p on p.id = r.subject_user_id
  where r.status = 'open'
  order by
    (r.reason = 'minor_safety') desc,
    (r.reason = 'self_harm') desc,
    r.created_at asc;

revoke all on public.moderation_queue from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Where the audio lives
-- ---------------------------------------------------------------------------
-- Supabase Storage, and the whole block is guarded: the pgTAP harness is plain
-- Postgres with no storage schema, and a migration that only applies on the
-- hosted project is a migration the tests cannot see (009).
--
-- Policies go through EXECUTE for the same reason. `create policy on
-- storage.objects` in a bare file would fail to parse a table that is not there.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent, skipping the voice-notes bucket (expected in the test harness)';
    return;
  end if;

  -- Private, and small: three minutes of mono AAC is about 1.4 MB, so 2 MiB is a
  -- ceiling a real recording never reaches and a video file always does.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('voice-notes', 'voice-notes', false, 2097152, array['audio/mp4', 'audio/aac'])
  on conflict (id) do update
    set public = false,
        file_size_limit = 2097152,
        allowed_mime_types = array['audio/mp4', 'audio/aac'];

  execute $p$drop policy if exists "Participants read voice notes" on storage.objects$p$;
  execute $p$
    create policy "Participants read voice notes"
      on storage.objects for select to authenticated
      using (
        bucket_id = 'voice-notes'
        and exists (
          select 1 from public.conversations c
          -- Comparing as text, not casting the segment to uuid: a malformed name
          -- would raise inside a policy, which turns a denied read into a 500.
          where c.id::text = split_part(storage.objects.name, '/', 1)
            and (c.member_id = auth.uid() or c.provider_id = auth.uid())
        )
      )
  $p$;

  execute $p$drop policy if exists "Participants upload voice notes" on storage.objects$p$;
  execute $p$
    create policy "Participants upload voice notes"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'voice-notes'
        and owner = auth.uid()
        and exists (
          select 1 from public.conversations c
          where c.id::text = split_part(storage.objects.name, '/', 1)
            and (c.member_id = auth.uid() or c.provider_id = auth.uid())
        )
      )
  $p$;

  -- No UPDATE and no DELETE policy for any client, and that is the same decision
  -- 004 made about message text: a recording the sender can replace or destroy
  -- after the fact is worthless as evidence, and the abuse report that quotes it
  -- is the thing being protected. Removal is purge_orphaned_voice_notes' job.
end
$$;

-- Retention, in code rather than in a document (005's rule).
create or replace function public.purge_orphaned_voice_notes()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_count integer := 0;
begin
  -- Defined unconditionally and inert where storage does not exist: plpgsql
  -- resolves storage.objects at call time, not at creation time.
  if to_regclass('storage.objects') is null then
    return 0;
  end if;

  -- An object has no message for one of two reasons: the account was deleted (a
  -- message cascades, its audio does not, and without this the deletion promise
  -- in web/privacy.html is false) or an upload was abandoned before send. The 24
  -- hour floor is what separates the second from a recording that is uploaded
  -- but not yet sent, and deleting those would break the composer.
  --
  -- Reported audio is exempt. reports keeps evidence for 90 days precisely
  -- because messages die with the accused, and dropping the recording would
  -- leave the report pointing at nothing.
  with gone as (
    delete from storage.objects o
    where o.bucket_id = 'voice-notes'
      and o.created_at < now() - interval '24 hours'
      and not exists (select 1 from public.messages m where m.voice_path = o.name)
      and not exists (select 1 from public.reports r where r.evidence_voice_path = o.name)
    returning 1
  )
  select count(*)::int into v_count from gone;
  return v_count;
end;
$$;

revoke all on function public.purge_orphaned_voice_notes() from public, anon, authenticated;
grant execute on function public.purge_orphaned_voice_notes() to service_role;

-- ---------------------------------------------------------------------------
-- 6. Calls
-- ---------------------------------------------------------------------------
-- The media is P2P WebRTC and never touches us, which is the point: there is no
-- recording because there is nothing in the path that could record. Signalling
-- rides a Realtime broadcast channel keyed on the call id, so no SDP or ICE
-- candidate is ever stored. They are per-call and worthless a second later.
--
-- What the database owns is the part that has to be authoritative: who called
-- whom, whether it connected, and what it cost.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'call_medium') then
    create type public.call_medium as enum ('voice', 'video');
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'call_status') then
    create type public.call_status as enum (
      'ringing',
      'active',
      'ended',
      -- Nobody picked up. Distinguished from declined because "she did not
      -- answer" and "she said no" are different facts about a provider.
      'missed',
      'declined',
      -- Negotiation never completed. Lumping this into ended would hide a NAT
      -- traversal problem that support has no other way to see.
      'failed'
    );
  end if;
end
$$;

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  -- Either party may dial, so these are caller/callee and not member/provider.
  -- Who pays is a separate question, answered from the conversation.
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  medium public.call_medium not null,
  status public.call_status not null default 'ringing',
  created_at timestamptz not null default now(),
  -- The answer, not the invitation. The meter reads this and nothing else.
  started_at timestamptz,
  ended_at timestamptz,
  -- Liveness, not duration. Advanced by heartbeat_call so the ticker can tell a
  -- call that ended badly from one that is still up.
  last_seen_at timestamptz not null default now(),
  minutes_billed integer not null default 0 check (minutes_billed >= 0),
  tokens_debited integer not null default 0 check (tokens_debited >= 0),
  end_reason text check (end_reason is null or end_reason in (
    'hangup', 'declined', 'unanswered', 'dropped',
    'out_of_tokens', 'blocked', 'suspended', 'media_failed'
  )),
  notified_at timestamptz,
  constraint call_parties_distinct check (caller_id <> callee_id),
  constraint call_ends_after_it_starts check (
    ended_at is null or started_at is null or ended_at >= started_at
  ),
  -- A ring has nothing to bill and a bill must have an answer behind it. Stated
  -- as a constraint so a metering bug cannot invent revenue out of a call that
  -- never connected.
  constraint billing_implies_an_answer check (
    started_at is not null or (minutes_billed = 0 and tokens_debited = 0)
  )
);

create index if not exists calls_conversation_idx
  on public.calls (conversation_id, created_at desc);
create index if not exists calls_live_idx
  on public.calls (status) where status in ('ringing', 'active');

-- One live call per thread and per person. These exist for the double-tap race:
-- two start_call statements landing together would otherwise start two meters on
-- the same wallet. They cannot express "either column", so start_call checks the
-- general case and these are the backstop.
create unique index if not exists calls_one_live_per_conversation_idx
  on public.calls (conversation_id) where status in ('ringing', 'active');
create unique index if not exists calls_one_live_per_caller_idx
  on public.calls (caller_id) where status in ('ringing', 'active');
create unique index if not exists calls_one_live_per_callee_idx
  on public.calls (callee_id) where status in ('ringing', 'active');

alter table public.calls enable row level security;

create policy "Participants read their calls"
  on public.calls for select
  using (auth.uid() = caller_id or auth.uid() = callee_id);

-- No INSERT, UPDATE or DELETE policy at all, for the same reason messages has
-- none: every transition goes through an RPC so the meter and the row cannot
-- come apart. A client that could UPDATE this table could zero its own bill.
revoke all on public.calls from anon, authenticated;
grant select on public.calls to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'calls'
  ) then
    execute 'alter publication supabase_realtime add table public.calls';
  end if;
end
$$;

-- Full replica identity, as with messages in 003 and for the same reason: the
-- ring arrives as the INSERT and every transition after it (answered, ended,
-- out_of_tokens) arrives as an UPDATE whose payload has to be enough to drive
-- the call screen without a refetch.
alter table public.calls replica identity full;

-- ---------------------------------------------------------------------------
-- 7. The meter
-- ---------------------------------------------------------------------------
-- The price, stated once, as a function so the client can read it from the
-- authority instead of hardcoding a number the member would see as a lie.
--
-- Voice and video cost the same. The bandwidth is P2P and costs us nothing; what
-- the member is buying is the provider's minute, and that is the same minute
-- either way. Two rates would also mean two constants to keep in step for no
-- economic reason.
create or replace function public.call_tokens_per_minute()
returns integer language sql immutable as $$ select 5 $$;

-- A couple of minutes in hand before the phone rings, so a call cannot connect
-- and die thirty seconds in. Nothing is reserved: an unanswered call is free and
-- the balance is only re-read when a minute is actually billed.
create or replace function public.call_minimum_minutes()
returns integer language sql immutable as $$ select 2 $$;

revoke all on function public.call_tokens_per_minute() from public;
revoke all on function public.call_minimum_minutes() from public;
grant execute on function public.call_tokens_per_minute() to authenticated, service_role;
grant execute on function public.call_minimum_minutes() to authenticated, service_role;

-- Everything about billing a call, once.
--
-- Read the signature first, because it is the design: there is no duration
-- parameter. The only inputs are started_at, written when the callee answered,
-- and now(). A client can claim a call ran for an hour and nothing changes,
-- because nothing it says is read. Contrast deduct_user_token, which takes an
-- amount and is therefore service_role only; this takes no amount at all.
--
-- Callable by nobody. is_blocked_pair set that precedent: a function whose
-- arguments would be dangerous in a client's hands gets no grant, and the RPCs
-- that wrap it bring their own authorisation.
create or replace function public.settle_call(p_call_id uuid)
returns public.calls
language plpgsql
security definer
set search_path = public
as $$
declare
  v_call public.calls;
  v_member uuid;
  v_rate integer := public.call_tokens_per_minute();
  v_owed integer;
  v_delta integer;
  v_balance integer;
  v_affordable integer;
begin
  select * into v_call from public.calls where id = p_call_id for update;
  if v_call.id is null then
    return null;
  end if;
  if v_call.status <> 'active' or v_call.started_at is null then
    return v_call;
  end if;

  select member_id into v_member
  from public.conversations where id = v_call.conversation_id;

  -- Minute one is owed the moment the call is answered, then one per whole
  -- minute after that.
  --
  -- The number this is deliberately not is three. Clarity's most-upvoted
  -- negative review is "even if you cancel in 15 seconds you are charged for 3
  -- minutes", and docs/clarity-learnings.md records that as the single most
  -- valuable finding in the research. One minute is the smallest honest unit of
  -- a per-minute price; three is a fee wearing a rate's clothes. Billing only
  -- completed minutes was the other option and it makes a 59-second call free
  -- and repeatable, which is a different way to not have a business.
  v_owed := floor(extract(epoch from (now() - v_call.started_at)) / 60)::int + 1;
  v_delta := v_owed - v_call.minutes_billed;

  if v_delta <= 0 then
    return v_call;
  end if;

  -- Only the member pays, whichever side dialled. A provider calling a member
  -- does not bill the provider, and it does not bill nobody either.
  select token_balance into v_balance
  from public.profiles where id = v_member
  for update;

  -- Integer division, so this floors: whole minutes the wallet can actually
  -- cover.
  v_affordable := least(v_delta, coalesce(v_balance, 0) / v_rate);

  if v_affordable > 0 then
    update public.profiles
    set token_balance = token_balance - (v_affordable * v_rate)
    where id = v_member;

    update public.calls
    set minutes_billed = minutes_billed + v_affordable,
        tokens_debited = tokens_debited + (v_affordable * v_rate)
    where id = p_call_id
    returning * into v_call;
  end if;

  -- Out of money mid-call: end it here. The alternative is not a debt, because
  -- token_balance has a >= 0 CHECK, so an overdraw is a constraint violation
  -- that rolls back the whole tick and silently stops billing every other call
  -- in the same sweep.
  if v_affordable < v_delta then
    update public.calls
    set status = 'ended', ended_at = now(), end_reason = 'out_of_tokens'
    where id = p_call_id
    returning * into v_call;
  end if;

  return v_call;
end;
$$;

revoke all on function public.settle_call(uuid) from public, anon, authenticated;

-- The ticker. pg_cron on a one-minute tick, which is its floor and also exactly
-- the billing granularity, so nothing is lost to the schedule.
--
-- It exists for the case where both clients vanish mid-call: without it a killed
-- app leaves a live row, and since the balance is finite the meter would run the
-- member's wallet to zero for a call they were not on. That is the Clarity
-- grievance with a different cause, which is why last_seen_at is checked here.
create or replace function public.meter_active_calls()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_touched integer := 0;
  r record;
begin
  -- A ring nobody answers must not stay live: it holds the one-live-call index
  -- against both parties and it leaves a phone buzzing.
  update public.calls
  set status = 'missed', ended_at = now(), end_reason = 'unanswered'
  where status = 'ringing'
    and created_at < now() - interval '45 seconds';

  for r in
    select c.id, c.caller_id, c.callee_id, c.last_seen_at
    from public.calls c
    where c.status = 'active'
  loop
    -- Settle first in every branch, so whatever ends the call is billed up to
    -- the moment it ended and not past it.
    perform public.settle_call(r.id);

    -- Blocking and suspension are re-checked every tick, not only at the start.
    -- A block placed during a call has to end it, or the remedy closes the text
    -- channel and leaves the louder one open.
    if public.is_blocked_pair(r.caller_id, r.callee_id) then
      update public.calls
      set status = 'ended', ended_at = now(), end_reason = 'blocked'
      where id = r.id and status = 'active';
    elsif exists (
      select 1 from public.profiles
      where id in (r.caller_id, r.callee_id)
        and suspended_until is not null and suspended_until > now()
    ) then
      update public.calls
      set status = 'ended', ended_at = now(), end_reason = 'suspended'
      where id = r.id and status = 'active';
    elsif r.last_seen_at < now() - interval '90 seconds' then
      -- Nobody has said they are still here for a minute and a half. Billed to
      -- the last minute the server observed, and no further.
      --
      -- The honest limit of P2P billing, written down rather than papered over:
      -- two peers whose media keeps flowing after the server ends the call are
      -- not billed for it. No schema can reach into a stream it never carries.
      -- What this does guarantee is the direction that matters, which is that
      -- nobody is charged for time the server did not observe.
      update public.calls
      set status = 'ended', ended_at = now(), end_reason = 'dropped'
      where id = r.id and status = 'active';
    end if;

    v_touched := v_touched + 1;
  end loop;

  return v_touched;
end;
$$;

revoke all on function public.meter_active_calls() from public, anon, authenticated;
grant execute on function public.meter_active_calls() to service_role;

create or replace function public.start_call(
  p_conversation_id uuid,
  p_medium public.call_medium
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
  v_suspended timestamptz;
  v_balance integer;
  v_minimum integer := public.call_tokens_per_minute() * public.call_minimum_minutes();
  v_recent integer;
  v_call public.calls;
begin
  -- Same order as send_message, on purpose. Nothing is debited here at all,
  -- because a ring is free, but the rejections still have to run before the
  -- phone buzzes.
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  select member_id, provider_id into v_member, v_provider
  from public.conversations where id = p_conversation_id;

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

  -- The requirement, stated with the same function send_message uses so the two
  -- cannot drift. If anything this is the more important of the two: a message
  -- waits to be read and a ring does not.
  if public.is_blocked_pair(v_uid, v_other) then
    return json_build_object('success', false, 'error', 'BLOCKED');
  end if;

  -- Ring-flooding is harassment with a vibration attached, and it costs the
  -- flooder nothing because an unanswered call is free. 10/hour, the ceiling
  -- submit_report uses and for the same reason.
  select count(*)::int into v_recent
  from public.calls
  where caller_id = v_uid and created_at > now() - interval '1 hour';

  if v_recent >= 10 then
    return json_build_object('success', false, 'error', 'RATE_LIMITED');
  end if;

  if exists (
    select 1 from public.calls
    where status in ('ringing', 'active')
      and (caller_id in (v_uid, v_other) or callee_id in (v_uid, v_other))
  ) then
    return json_build_object('success', false, 'error', 'BUSY');
  end if;

  -- The MEMBER's wallet, whoever dialled. A provider ringing a member with an
  -- empty balance is refused rather than connected and cut off thirty seconds
  -- later, which is the worse of the two experiences and bills for it.
  select token_balance into v_balance from public.profiles where id = v_member;
  if coalesce(v_balance, 0) < v_minimum then
    return json_build_object(
      'success', false, 'error', 'INSUFFICIENT_BALANCE', 'minimum', v_minimum
    );
  end if;

  insert into public.calls (conversation_id, caller_id, callee_id, medium)
  values (p_conversation_id, v_uid, v_other, p_medium)
  returning * into v_call;

  return json_build_object(
    'success', true,
    'call_id', v_call.id,
    'medium', v_call.medium,
    'tokens_per_minute', public.call_tokens_per_minute()
  );
end;
$$;

revoke all on function public.start_call(uuid, public.call_medium) from public;
grant execute on function public.start_call(uuid, public.call_medium) to authenticated;

create or replace function public.answer_call(p_call_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_call public.calls;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  select * into v_call from public.calls where id = p_call_id for update;
  if v_call.id is null then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;
  -- Only the phone that is ringing. The caller answering their own call would
  -- start the meter with nobody on the other end.
  if v_call.callee_id <> v_uid then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;
  if v_call.status <> 'ringing' then
    return json_build_object('success', false, 'error', 'GONE');
  end if;

  update public.calls
  set status = 'active', started_at = now(), last_seen_at = now()
  where id = p_call_id;

  -- Bill minute one by settling a zero-second call, rather than with separate
  -- first-minute arithmetic. One code path means there is no second formula to
  -- disagree with the ticker.
  v_call := public.settle_call(p_call_id);

  return json_build_object(
    'success', true,
    'status', v_call.status,
    'started_at', v_call.started_at,
    'tokens_debited', v_call.tokens_debited
  );
end;
$$;

revoke all on function public.answer_call(uuid) from public;
grant execute on function public.answer_call(uuid) to authenticated;

-- Liveness plus a settle, so the number the client shows on screen is the number
-- the server has actually charged. Also the only thing that distinguishes a call
-- still in progress from one whose app was killed.
create or replace function public.heartbeat_call(p_call_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_call public.calls;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  update public.calls
  set last_seen_at = now()
  where id = p_call_id
    and status = 'active'
    and (caller_id = v_uid or callee_id = v_uid);

  if not found then
    -- Either the call is over or it was never theirs, and a heartbeat is the
    -- wrong place to tell those apart out loud: an id that does not exist gets
    -- the same answer as an id belonging to strangers, so a beat cannot be used
    -- to probe for live calls.
    select * into v_call from public.calls where id = p_call_id;
    if v_call.id is null or (v_call.caller_id <> v_uid and v_call.callee_id <> v_uid) then
      return json_build_object('success', false, 'error', 'FORBIDDEN');
    end if;
    return json_build_object('success', true, 'status', v_call.status,
      'tokens_debited', v_call.tokens_debited);
  end if;

  v_call := public.settle_call(p_call_id);

  return json_build_object(
    'success', true,
    'status', v_call.status,
    'minutes_billed', v_call.minutes_billed,
    'tokens_debited', v_call.tokens_debited
  );
end;
$$;

revoke all on function public.heartbeat_call(uuid) from public;
grant execute on function public.heartbeat_call(uuid) to authenticated;

-- p_reason is consulted for exactly one thing: whether the media failed, which
-- is the only outcome the client knows and the server cannot infer. Everything
-- else is derived from who ended it and whether it had connected, because an
-- accurate call log is what a member reads to decide whether they were charged
-- fairly, and a client-supplied outcome is not evidence of anything.
create or replace function public.end_call(
  p_call_id uuid,
  p_reason text default 'hangup'
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_call public.calls;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  select * into v_call from public.calls where id = p_call_id for update;
  if v_call.id is null then
    return json_build_object('success', false, 'error', 'NOT_FOUND');
  end if;
  if v_uid <> v_call.caller_id and v_uid <> v_call.callee_id then
    return json_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  -- Both clients hang up, so the second one must not be an error the UI has to
  -- explain away.
  if v_call.status in ('ended', 'missed', 'declined', 'failed') then
    return json_build_object('success', true, 'status', v_call.status,
      'end_reason', v_call.end_reason, 'tokens_debited', v_call.tokens_debited);
  end if;

  if v_call.status = 'active' then
    -- Settle before closing, or the cheapest call is one that always ends at
    -- 0:59 of a minute.
    v_call := public.settle_call(p_call_id);

    -- The meter may have ended it first, out of tokens. Its verdict stands.
    if v_call.status <> 'active' then
      return json_build_object('success', true, 'status', v_call.status,
        'end_reason', v_call.end_reason, 'tokens_debited', v_call.tokens_debited);
    end if;

    -- The cast is not decoration. A CASE over two bare literals resolves to
    -- `text`, and assigning text to an enum column fails at runtime with
    -- "column status is of type call_status but expression is of type text",
    -- which no amount of typechecking on the client would have caught. 006 hit
    -- the same thing on application_status.
    update public.calls
    set status = case
          when p_reason = 'media_failed' then 'failed' else 'ended'
        end::public.call_status,
        ended_at = now(),
        end_reason = case when p_reason = 'media_failed' then 'media_failed' else 'hangup' end
    where id = p_call_id
    returning * into v_call;
  else
    -- Still ringing, so nothing was billed and nothing will be. Who hung up is
    -- the whole difference between declined and missed.
    update public.calls
    set status = case
          when v_uid = v_call.callee_id then 'declined' else 'missed'
        end::public.call_status,
        ended_at = now(),
        end_reason = case when v_uid = v_call.callee_id then 'declined' else 'unanswered' end
    where id = p_call_id
    returning * into v_call;
  end if;

  return json_build_object(
    'success', true,
    'status', v_call.status,
    'end_reason', v_call.end_reason,
    'minutes_billed', v_call.minutes_billed,
    'tokens_debited', v_call.tokens_debited
  );
end;
$$;

revoke all on function public.end_call(uuid, text) from public;
grant execute on function public.end_call(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Presence, as a setting rather than a derivation
-- ---------------------------------------------------------------------------
-- Real presence stays ephemeral: it lives in a Realtime presence channel and is
-- never written down, so there is no history of when anybody was online to leak
-- or subpoena. What is stored is the setting, and a last-seen stamp that only
-- exists while the setting is on.
alter table public.profiles
  add column if not exists presence_visible boolean not null default false,
  add column if not exists last_active_at timestamptz;

comment on column public.profiles.presence_visible is
  'The user''s own setting, like WhatsApp''s Last Seen. Deliberately absent from '
  'every guard trigger: it is the one column added here that a client is meant '
  'to write. Defaults to false because a product whose pitch is safety does not '
  'start telling a paid stranger when you were last awake without being asked.';

comment on column public.profiles.last_active_at is
  'Written only by touch_presence(). Guarded, because a client that could write '
  'it could also backdate it, and presence you can forge reads as "away" while '
  'somebody is watching, which is worse than no presence at all.';

create or replace function public.touch_presence()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  -- Nothing is recorded while the setting is off, so opting out leaves no trail
  -- at rest rather than a trail a view happens to hide. The difference matters
  -- the day somebody asks the table directly.
  update public.profiles
  set last_active_at = now()
  where id = auth.uid() and presence_visible;
end;
$$;

revoke all on function public.touch_presence() from public;
grant execute on function public.touch_presence() to authenticated;

-- A THIRD guard trigger on profiles. See the note at the top: 010 tried to
-- extend guard_privileged_profile_columns by rewriting it from the 003 version
-- and silently deleted the five checks 005 and 006 had added. Additive composes.
--
-- SECURITY INVOKER (the default) is load-bearing, as in both siblings: under
-- DEFINER `current_user` is the owner, the branch is never reached, and the
-- guard passes everything.
create or replace function public.guard_presence_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.last_active_at is distinct from old.last_active_at then
      raise exception 'profiles.last_active_at is not client-writable'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_presence_columns on public.profiles;
create trigger guard_profile_presence_columns
  before update on public.profiles
  for each row execute function public.guard_presence_columns();

-- `is_available` is untouched and is not presence: it is the provider's work
-- toggle, an intention rather than an observation, and a provider is entitled to
-- be online and unavailable.

-- ---------------------------------------------------------------------------
-- 9. Member pseudonymity
-- ---------------------------------------------------------------------------
-- A member is paying to choose a person, so a provider keeps an age and a
-- gender. Nobody is paying to choose a member, so a member's birth date, gender
-- and headline buy nothing and are pure re-identification risk on the one side
-- of the conversation that is talking about the worst week of their life.
--
-- Nulled first, because the constraint would otherwise fail on any member who
-- filled in a provider application and withdrew it. Destructive and deliberately
-- so: there is no version of this where keeping a member's birth date is right.
update public.profiles
set date_of_birth = null, gender = null, headline = null
where role = 'member';

alter table public.profiles
  drop constraint if exists member_is_pseudonymous;

alter table public.profiles
  add constraint member_is_pseudonymous check (
    role = 'provider'
    or (date_of_birth is null and gender is null and headline is null)
  );

-- The constraint above is only satisfiable because submit_provider_application
-- stops writing an applicant's details onto their profile before approval.
--
-- That write was redundant: approve_provider_application already copies all five
-- fields from the application row in the same UPDATE that sets role = 'provider',
-- so the age gate still has something to check at exactly the moment it checks.
-- Nothing reads them earlier. useProfile selects the caller's own row and the
-- application screens read my_application.
--
-- Reproduced in full below and identical to the 006 definition apart from the
-- deleted UPDATE. That is the dangerous kind of edit (010's five silently
-- dropped guards were exactly this shape), so the 050 suite is what proves it:
-- if any of the missing-field computation moved, those assertions fail.
create or replace function public.submit_provider_application(
  p_display_name text,
  p_gender text,
  p_date_of_birth date,
  p_headline text,
  p_languages text[],
  p_about text
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_missing text[] := '{}'::text[];
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  if btrim(coalesce(p_display_name, '')) = '' then
    v_missing := array_append(v_missing, 'display_name');
  end if;
  if p_gender is null or p_gender not in ('female', 'male', 'other') then
    v_missing := array_append(v_missing, 'gender');
  end if;
  if p_date_of_birth is null then
    v_missing := array_append(v_missing, 'date_of_birth');
  elsif p_date_of_birth > (current_date - interval '18 years') then
    raise exception 'providers must be 18 or older' using errcode = '22023';
  end if;
  if btrim(coalesce(p_headline, '')) = '' then
    v_missing := array_append(v_missing, 'headline');
  end if;
  if p_languages is null or array_length(p_languages, 1) is null then
    v_missing := array_append(v_missing, 'languages');
  end if;
  if btrim(coalesce(p_about, '')) = '' then
    v_missing := array_append(v_missing, 'about');
  end if;

  insert into public.provider_applications as pa (
    user_id, status, display_name, gender, date_of_birth,
    headline, languages, about, missing_fields, submitted_at
  )
  values (
    v_uid,
    (case when array_length(v_missing, 1) is null then 'submitted' else 'draft' end)
      ::public.application_status,
    nullif(btrim(p_display_name), ''), p_gender, p_date_of_birth,
    nullif(btrim(p_headline), ''), coalesce(p_languages, '{}'::text[]),
    nullif(btrim(p_about), ''),
    v_missing,
    case when array_length(v_missing, 1) is null then now() else null end
  )
  on conflict (user_id) do update set
    status = case
      when array_length(v_missing, 1) is not null then pa.status
      when pa.status in ('draft', 'needs_info') then 'submitted'::public.application_status
      else pa.status
    end,
    display_name = excluded.display_name,
    gender = excluded.gender,
    date_of_birth = coalesce(pa.date_of_birth, excluded.date_of_birth),
    headline = excluded.headline,
    languages = excluded.languages,
    about = excluded.about,
    missing_fields = v_missing,
    submitted_at = case
      when array_length(v_missing, 1) is null then now() else pa.submitted_at
    end;

  -- The profile write that used to be here is gone. The application is the only
  -- place an applicant's details live until a reviewer admits them.

  return v_missing;
end;
$$;

revoke all on function public.submit_provider_application(text, text, date, text, text[], text)
  from public;
grant execute on function public.submit_provider_application(text, text, date, text, text[], text)
  to authenticated;

-- The handle, promoted out of the client.
--
-- ProviderHomeScreen already renders `Member ${peer_id.slice(0, 4)}` when the
-- directory join comes back null, and send-push already says "Someone" for the
-- same reason. Both are the same missing fact invented twice, in two places,
-- differently. This is that fact, and the output is byte-identical to the
-- client's current fallback so nothing changes on screen.
--
-- Granted freely because it discloses nothing: it is a pure function of an id
-- the caller already holds.
create or replace function public.member_handle(p_id uuid)
returns text
language sql
immutable
as $$
  select 'Member ' || left(replace(p_id::text, '-', ''), 4)
$$;

revoke all on function public.member_handle(uuid) from public;
grant execute on function public.member_handle(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. The views, rebuilt in dependency order
-- ---------------------------------------------------------------------------
-- The order is the trap 006 documents from one side and 009 walked into from the
-- other: pending_pushes and conversation_summaries both select from
-- provider_directory, so dropping the directory alone fails and CASCADE without
-- recreating silently removes the inbox and the push sender.
drop view if exists public.conversation_summaries;
drop view if exists public.pending_pushes;
drop view if exists public.provider_directory;

create view public.provider_directory
with (security_invoker = false) as
  select
    p.id,
    p.display_name,
    p.gender,
    extract(year from age(p.date_of_birth))::int as age,
    p.headline,
    p.languages,
    p.is_available,
    p.rating_avg,
    p.rating_count,
    p.median_reply_seconds,
    -- Published only with the provider's own consent, null otherwise. Decided
    -- rather than added: the directory already answers "does she reply" with
    -- median_reply_seconds, and this answers "is she around now", which is the
    -- same question on a different axis and one of the two things a member
    -- actually picks a name on.
    case when p.presence_visible then p.last_active_at end as last_active_at,
    p.created_at
  from public.profiles p
  where p.role = 'provider'
    and p.identity_verified_at is not null
    and (p.suspended_until is null or p.suspended_until <= now());

comment on view public.provider_directory is
  'The only member-facing projection of a provider. Runs as owner and therefore '
  'bypasses RLS on profiles by design: the column list here IS the privacy '
  'boundary. date_of_birth is deliberately absent, since age is computed, and '
  'last_active_at is gated on the provider''s own presence setting. Never add a '
  'column without deciding it is public to every member.';

revoke all on public.provider_directory from anon;
grant select on public.provider_directory to authenticated;

-- The mirror image of provider_directory: the only projection of a MEMBER that
-- another user ever sees.
--
-- Definer, so it can read profiles across RLS the way the directory does, which
-- makes two things load-bearing rather than decorative: the column list, and the
-- auth.uid() predicate in the WHERE. Under service_role auth.uid() is null and
-- this returns nothing, which is the correct closed direction.
--
-- A member's display_name is absent by construction and so are the three columns
-- the constraint above forbids. The handle is a pure function of an id the
-- caller already has, so this view hands over no new fact about anybody.
create view public.conversation_peers
with (security_invoker = false) as
  select
    c.id as conversation_id,
    peer.id as peer_id,
    case
      when peer.role = 'provider' then peer.display_name
      else public.member_handle(peer.id)
    end as peer_display_name,
    case when peer.role = 'provider' then peer.is_available else false end
      as peer_available,
    case when peer.presence_visible then peer.last_active_at end
      as peer_last_active_at,
    (peer.role = 'provider') as peer_is_provider
  from public.conversations c
  join public.profiles peer
    on peer.id = case
      when c.member_id = auth.uid() then c.provider_id else c.member_id
    end
  where c.member_id = auth.uid() or c.provider_id = auth.uid();

comment on view public.conversation_peers is
  'The peer of every thread the caller is in. Definer, so the auth.uid() '
  'predicate in the WHERE is the access control and not a convenience. A member '
  'peer resolves to a handle: their display_name, birth date, gender and '
  'headline are unreachable from here by construction.';

revoke all on public.conversation_peers from anon, authenticated;
grant select on public.conversation_peers to authenticated;

-- Recreated with the peer name coming from conversation_peers instead of
-- provider_directory. Two consequences, both improvements:
--
--   1. a provider's inbox stops rendering a blank row for a member thread and
--      shows the handle the client used to invent;
--   2. a suspended provider's thread keeps its name for the member who is in it,
--      instead of going nameless because the directory excludes them. The
--      directory's job is discovery, not addressing an existing conversation.
create view public.conversation_summaries
with (security_invoker = true) as
  select
    c.id,
    c.last_message_at,
    case when c.member_id = auth.uid() then c.provider_id else c.member_id end
      as peer_id,
    pe.peer_display_name,
    coalesce(pe.peer_available, false) as peer_available,
    pe.peer_last_active_at,
    (select m.body from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc limit 1) as last_body,
    -- `body` is null on a voice note, so an inbox reading last_body alone renders
    -- a blank preview. This is what lets it say "Voice note" without a second
    -- query and without inventing a placeholder body in the send path.
    (select case when m.voice_path is null then 'text' else 'voice' end
      from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc limit 1) as last_kind,
    (select m.sender_id from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc limit 1) as last_sender_id,
    (select count(*) from public.messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and m.read_at is null) as unread_count,
    exists (select 1 from public.reviews r where r.conversation_id = c.id)
      as reviewed,
    (c.member_id = auth.uid()) as i_am_member
  from public.conversations c
  left join public.conversation_peers pe on pe.conversation_id = c.id
  where c.member_id = auth.uid() or c.provider_id = auth.uid();

comment on view public.conversation_summaries is
  'One row per thread the caller participates in. `i_am_member` is the '
  'authoritative answer to "am I the paying side of THIS thread", and '
  'profiles.role is not, because a promoted provider keeps their member-side '
  'threads. `last_kind` exists because a voice note has no body to preview.';

revoke all on public.conversation_summaries from anon;
grant select on public.conversation_summaries to authenticated;

-- Unchanged from 009 except for the sender name, which now resolves through
-- member_handle instead of leaving the Edge Function to say "Someone". Still no
-- body column: the promise in web/privacy.html is that a notification says who
-- replied and never what they said, and that holds because there is nothing here
-- to select.
create view public.pending_pushes
with (security_invoker = true) as
  select
    m.id as message_id,
    m.conversation_id,
    m.sender_id as peer_id,
    t.token,
    t.platform,
    coalesce(d.display_name, public.member_handle(m.sender_id)) as sender_display_name,
    m.created_at
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  join public.push_tokens t
    on t.user_id = case when m.sender_id = c.member_id then c.provider_id else c.member_id end
  left join public.provider_directory d on d.id = m.sender_id
  where m.read_at is null
    and m.notified_at is null
    and m.created_at > now() - interval '24 hours';

revoke all on public.pending_pushes from anon, authenticated;

comment on view public.pending_pushes is
  'One row per (undelivered message, recipient device). Never exposes the message '
  'body: a notification says who replied, not what they said. Service role only.';

-- ---------------------------------------------------------------------------
-- 11. Making a call ring a sleeping phone
-- ---------------------------------------------------------------------------
-- react-native-callkeep is out (stale at Nov 2024, and its build.gradle already
-- broke this build once), so there is no OS call UI to hand this to. The ring is
-- an in-app screen driven by Realtime while the app is up, and a high-priority
-- data push otherwise. Without this view calls only work foregrounded, which is
-- not "fully operational".
--
-- Created after section 10 on purpose: it selects from provider_directory, and a
-- view cannot be dropped while another view depends on it.
create view public.pending_call_pushes
with (security_invoker = true) as
  select
    c.id as call_id,
    c.conversation_id,
    c.caller_id as peer_id,
    c.medium,
    coalesce(d.display_name, public.member_handle(c.caller_id)) as caller_display_name,
    t.token,
    t.platform,
    c.created_at
  from public.calls c
  join public.push_tokens t on t.user_id = c.callee_id
  left join public.provider_directory d on d.id = c.caller_id
  where c.status = 'ringing'
    and c.notified_at is null
    -- Shorter than the message window on purpose: a two-minute-old ring is not
    -- worth waking a phone for, it is worth a missed-call row.
    and c.created_at > now() - interval '2 minutes';

revoke all on public.pending_call_pushes from anon, authenticated;

comment on view public.pending_call_pushes is
  'One row per (ringing call, callee device). Carries who is calling and on which '
  'medium, and nothing about the conversation behind it. Service role only.';

create or replace function public.mark_calls_notified(p_call_ids uuid[])
returns integer
language sql
security definer
set search_path = public
as $$
  with touched as (
    update public.calls
    set notified_at = now()
    where id = any(p_call_ids) and notified_at is null
    returning 1
  )
  select count(*)::int from touched;
$$;

revoke all on function public.mark_calls_notified(uuid[]) from public, anon, authenticated;
grant execute on function public.mark_calls_notified(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 12. Telemetry allowlist
-- ---------------------------------------------------------------------------
-- Restated in full rather than appended to, because the allowlist IS the schema
-- of this table and it should be readable in one place. Read the warning before
-- editing: __tests__/telemetry.test.ts takes the LAST definition of this
-- function across all migrations as the authority and asserts set equality with
-- the TelemetryEvent union. Dropping a name here silently deletes a metric, in
-- exactly the way 010 nearly deleted five guards. All sixteen names from 006 are
-- reproduced below; eleven are new.
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
    'user_blocked', 'user_unblocked', 'account_deleted', 'identity_linked',
    'signed_in', 'application_submitted', 'availability_changed',
    'review_submitted',
    'reaction_added', 'reaction_removed', 'reply_sent',
    'voice_note_sent', 'voice_note_played',
    'call_started', 'call_answered', 'call_declined', 'call_ended',
    'call_rejected', 'presence_changed'
  ) then
    raise exception 'unknown event name: %', new.name using errcode = '22023';
  end if;

  if pg_column_size(new.props) > 2048 then
    raise exception 'event props too large' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(new.props) loop
    if v_key ~* '(body|message|content|text|detail|email|phone|name|token)' then
      raise exception 'event props may not carry "%"', v_key using errcode = '22023';
    end if;
  end loop;

  return new;
end;
$$;

-- Ring-flooding and out-of-tokens cutoffs are new abuse and new grievance, and
-- 005 put the signals worth alerting on in this view rather than in a saved
-- query so the runbook and the dashboard cannot drift.
drop view if exists public.safety_metrics;

create view public.safety_metrics as
  select
    date_trunc('day', created_at) as day,
    count(*) filter (where name = 'message_sent') as messages_sent,
    count(*) filter (where name = 'voice_note_sent') as voice_notes_sent,
    count(*) filter (where name = 'send_rejected') as sends_rejected,
    count(*) filter (where name = 'call_started') as calls_started,
    count(*) filter (where name = 'call_rejected') as calls_rejected,
    count(*) filter (where name = 'report_submitted') as reports_submitted,
    count(*) filter (where name = 'user_blocked') as blocks_created,
    count(distinct user_id) as active_users
  from public.events
  where created_at > now() - interval '90 days'
  group by 1
  order by 1 desc;

revoke all on public.safety_metrics from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13. Scheduling, Supabase-only and guarded
-- ---------------------------------------------------------------------------
-- Same shape as 009: the harness has no pg_cron, and a migration that only
-- applies on the hosted project is a migration the tests cannot see.
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron unavailable, skipping the call meter schedule (expected in the test harness)';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'meter-active-calls') then
    perform cron.unschedule('meter-active-calls');
  end if;
  -- Every minute, which is pg_cron's floor and also the billing granularity, so
  -- nothing is lost to the schedule. end_call settles a hang-up between ticks.
  perform cron.schedule(
    'meter-active-calls', '* * * * *', 'select public.meter_active_calls()'
  );

  if exists (select 1 from cron.job where jobname = 'purge-orphaned-voice-notes') then
    perform cron.unschedule('purge-orphaned-voice-notes');
  end if;
  perform cron.schedule(
    'purge-orphaned-voice-notes', '17 4 * * *',
    'select public.purge_orphaned_voice_notes()'
  );
end
$$;
