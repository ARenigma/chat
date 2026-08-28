-- ===========================================================================
-- 014  Image attachments
-- ===========================================================================
-- A message can now carry a photo, the third payload after text and a voice
-- note. Scope is deliberately images only (Amit's call): video adds a second
-- native player and a poster pipeline and is a clean follow-up. Everything here
-- mirrors the voice-note half of 011 rather than inventing a second shape, so
-- the two media paths fail, scope, sweep and prove the same way.
--
-- Trust & safety: attachments are private, participant-scoped, and reportable
-- through the existing safety flow (submit_report snapshots the path, below).
-- Automated image moderation (hash/CSAM + nudity screening on upload) is the
-- named follow-up before any Play release; nothing here ships to Play under the
-- current hold.

-- ---------------------------------------------------------------------------
-- 1. What a message can be, extended
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists attachment_path text,
  -- Kept even though 'image' is the only value today, so the column that a video
  -- follow-up needs already exists and the payload branch below reads as one of a
  -- set rather than as a special case.
  add column if not exists attachment_type text,
  -- The intrinsic pixel size, reported by the picker and trusted for the same
  -- reason voice_duration_ms is: it buys nothing to lie about (billing is per
  -- message, not per pixel) and it is what lets the bubble reserve the right
  -- aspect box before the image decodes, so the transcript does not reflow when a
  -- photo loads.
  add column if not exists attachment_width integer,
  add column if not exists attachment_height integer;

comment on column public.messages.attachment_path is
  'Storage key in the private `attachments` bucket, `<conversation uuid>/<uuid>.<ext>`. '
  'Not client-writable after insert (guard_message_reply_and_voice), so like a '
  'voice note it can only be written once and must point at an object that '
  'already exists.';

-- The payload CHECK becomes text XOR voice XOR image.
--
-- Restated whole rather than amended: 011's note applies here too, two half-true
-- statements about the same columns is how the next person gets it wrong. An
-- image, like a voice note, carries no body caption for now, which keeps the "one
-- payload" invariant that the RPC's equality check depends on.
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
      and attachment_path is null
    )
    or (
      body is null
      and voice_path is not null
      and voice_duration_ms between 1000 and 180000
      and attachment_path is null
    )
    or (
      body is null
      and voice_path is null
      and voice_duration_ms is null
      and attachment_path is not null
      and attachment_type = 'image'
      -- Reported by the picker; a zero or negative dimension is a malformed pick.
      and attachment_width > 0
      and attachment_height > 0
    )
  );

-- The storage policy authorises a read on the first path segment, so a path that
-- is not `<conversation uuid>/<uuid>.<ext>` would make that policy unsound.
-- Stated as a constraint rather than trusted from the uploader, exactly like
-- voice_path_is_scoped. Extensions match the bucket's allowed_mime_types below.
alter table public.messages
  drop constraint if exists attachment_path_is_scoped;

alter table public.messages
  add constraint attachment_path_is_scoped check (
    attachment_path is null
    or attachment_path ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
  );

-- Client-immutability, extended. Same argument as 011: an additive edit to the
-- guard rather than a new trigger, because this IS the trigger that owns message
-- immutability and the columns it protects are the columns a client must never
-- rewrite after send.
create or replace function public.guard_message_reply_and_voice()
returns trigger
language plpgsql
set search_path = public
as $$
begin
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

  if tg_op = 'UPDATE' and current_user in ('authenticated', 'anon') then
    if new.reply_to_id is distinct from old.reply_to_id
      or new.voice_path is distinct from old.voice_path
      or new.voice_duration_ms is distinct from old.voice_duration_ms
      or new.attachment_path is distinct from old.attachment_path
      or new.attachment_type is distinct from old.attachment_type
      or new.attachment_width is distinct from old.attachment_width
      or new.attachment_height is distinct from old.attachment_height then
      raise exception 'only messages.read_at is client-writable'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- Trigger definition is unchanged; the function body above is what moved.
drop trigger if exists guard_message_reply_and_voice on public.messages;
create trigger guard_message_reply_and_voice
  before insert or update on public.messages
  for each row execute function public.guard_message_reply_and_voice();

-- ---------------------------------------------------------------------------
-- 2. Sending one
-- ---------------------------------------------------------------------------
-- send_message gains four attachment parameters. Adding parameters changes the
-- signature, so the 011 five-arg function is dropped first: leaving both would
-- make a five-arg call ambiguous between them.
drop function if exists public.send_message(uuid, text, uuid, text, integer);

create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text default null,
  p_reply_to_id uuid default null,
  p_voice_path text default null,
  p_voice_duration_ms integer default null,
  p_attachment_path text default null,
  p_attachment_width integer default null,
  p_attachment_height integer default null
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
  v_image boolean := p_attachment_path is not null;
  v_recent integer;
  v_suspended timestamptz;
begin
  if v_uid is null then
    return json_build_object('success', false, 'error', 'UNAUTHORIZED');
  end if;

  -- Exactly one payload, now three-way. The count-of-true is the honest
  -- generalisation of 011's `(text) = (voice)`: zero payloads is an empty send,
  -- two is a contradiction, and both are the same BAD_REQUEST.
  if (v_trimmed is not null)::int + v_voice::int + v_image::int <> 1 then
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
  if v_image and (
    p_attachment_width is null
    or p_attachment_height is null
    or p_attachment_width <= 0
    or p_attachment_height <= 0
  ) then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  -- Each upload lives under the conversation it belongs to and the storage policy
  -- authorises on that prefix. Checked here too, so a member cannot attach media
  -- from one of their threads to another of their threads.
  if v_voice and split_part(p_voice_path, '/', 1) <> p_conversation_id::text then
    return json_build_object('success', false, 'error', 'BAD_REQUEST');
  end if;
  if v_image and split_part(p_attachment_path, '/', 1) <> p_conversation_id::text then
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

  -- A photo is one message and costs one token, exactly like a line of text or a
  -- voice note. The per-message invariant (and its parity test) does not learn a
  -- new case for media.
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
    conversation_id, sender_id, body, reply_to_id,
    voice_path, voice_duration_ms,
    attachment_path, attachment_type, attachment_width, attachment_height
  )
  values (
    p_conversation_id, v_uid, v_trimmed, p_reply_to_id,
    p_voice_path, p_voice_duration_ms,
    p_attachment_path, case when v_image then 'image' else null end,
    p_attachment_width, p_attachment_height
  )
  returning * into v_message;

  update public.conversations
  set last_message_at = v_message.created_at
  where id = p_conversation_id;

  return json_build_object(
    'success', true,
    'message_id', v_message.id,
    'created_at', v_message.created_at
  );
end;
$$;

revoke all on function public.send_message(uuid, text, uuid, text, integer, text, integer, integer)
  from public, anon;
grant execute on function public.send_message(uuid, text, uuid, text, integer, text, integer, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Where the photos live
-- ---------------------------------------------------------------------------
-- Mirror of the voice-notes bucket in 011, same guards for the pgTAP harness and
-- the same participant-scoped policies. Private, and read only through a signed
-- URL minted per view.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent, skipping the attachments bucket (expected in the test harness)';
    return;
  end if;

  -- Private. 10 MiB is generous for a phone photo (a 12MP JPEG is ~4 MB) and a
  -- hard stop well under anything a video would need, so the ceiling itself keeps
  -- the images-only scope honest.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('attachments', 'attachments', false, 10485760,
          array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
    set public = false,
        file_size_limit = 10485760,
        allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

  execute $p$drop policy if exists "Participants read attachments" on storage.objects$p$;
  execute $p$
    create policy "Participants read attachments"
      on storage.objects for select to authenticated
      using (
        bucket_id = 'attachments'
        and exists (
          select 1 from public.conversations c
          where c.id::text = split_part(storage.objects.name, '/', 1)
            and (c.member_id = auth.uid() or c.provider_id = auth.uid())
        )
      )
  $p$;

  execute $p$drop policy if exists "Participants upload attachments" on storage.objects$p$;
  execute $p$
    create policy "Participants upload attachments"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'attachments'
        and owner = auth.uid()
        and exists (
          select 1 from public.conversations c
          where c.id::text = split_part(storage.objects.name, '/', 1)
            and (c.member_id = auth.uid() or c.provider_id = auth.uid())
        )
      )
  $p$;

  -- No UPDATE and no DELETE policy, same evidence argument as voice notes: a
  -- photo the sender can swap or destroy after it is seen or reported is
  -- worthless as evidence. Removal is the sweep's job.
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Retention
-- ---------------------------------------------------------------------------
create or replace function public.purge_orphaned_attachments()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_count integer := 0;
begin
  if to_regclass('storage.objects') is null then
    return 0;
  end if;

  -- Orphaned for one of two reasons, same as voice notes: the account was deleted
  -- (the message cascades, the object does not) or an upload was abandoned before
  -- send. The 24 hour floor separates an abandoned upload from one that is
  -- uploaded but not yet sent, which deleting would break the composer.
  with gone as (
    delete from storage.objects o
    where o.bucket_id = 'attachments'
      and o.created_at < now() - interval '24 hours'
      and not exists (select 1 from public.messages m where m.attachment_path = o.name)
    returning 1
  )
  select count(*)::int into v_count from gone;
  return v_count;
end;
$$;

revoke all on function public.purge_orphaned_attachments() from public, anon, authenticated;
grant execute on function public.purge_orphaned_attachments() to service_role;

-- Nightly sweep, guarded like the voice-note one so a project without pg_cron
-- (the test harness) does not fail the migration.
do $$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'purge-orphaned-attachments') then
    perform cron.unschedule('purge-orphaned-attachments');
  end if;
  perform cron.schedule(
    'purge-orphaned-attachments', '23 4 * * *',
    $c$select public.purge_orphaned_attachments()$c$
  );
end
$$;
