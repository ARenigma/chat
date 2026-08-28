-- ===========================================================================
-- 023  Voice-note waveform peaks
-- ===========================================================================
-- Sender-side amplitude peaks are captured by the recorder and rendered in the
-- Composer review panel (VoiceDraft.peaks, already downsampled to VOICE_BARS)
-- but were never persisted, so every playback waveform showed flat bars. This
-- migration threads them end-to-end: column → constraint → immutability guard →
-- send_message RPC.
--
-- Design choices worth stating:
--   - real[] rather than numeric[]: 0..1 normalised floats need no precision
--     guarantee; real (4 bytes) is half the storage of double precision.
--   - nullable: existing voice rows remain valid as-is; the client falls back to
--     FLAT bars for rows that predate this column.
--   - length-gated at 64: the recorder downsamples to VOICE_BARS (32) before
--     sending, but accepting up to 64 leaves room for a future higher-resolution
--     capture without another schema change. Senders supplying more than 64 are
--     rejected so the constraint is an honest bound, not advisory.

-- ---------------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists voice_peaks real[] default null;

comment on column public.messages.voice_peaks is
  'Normalised (0..1) amplitude samples captured by the recorder and downsampled '
  'to VOICE_BARS before send. Null on pre-023 rows and on text/image messages. '
  'When present, array_length is between 1 and 64.';

-- ---------------------------------------------------------------------------
-- 2. Payload constraint, extended
-- ---------------------------------------------------------------------------
-- Restated whole, as 014 did for 011, so there is exactly one place to read
-- the full invariant. voice_peaks must be null in the text and image branches,
-- and is optional-but-length-gated in the voice branch.
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
      and voice_peaks is null
    )
    or (
      body is null
      and voice_path is not null
      and voice_duration_ms between 1000 and 180000
      and attachment_path is null
      and (voice_peaks is null or (array_length(voice_peaks, 1) between 1 and 64))
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
      and voice_peaks is null
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Immutability guard, extended
-- ---------------------------------------------------------------------------
-- voice_peaks joins the set of columns a client may never rewrite after send,
-- for the same reason as voice_path: the waveform is a claim about what was
-- recorded and must not be altered after delivery.
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
      or new.voice_peaks is distinct from old.voice_peaks
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
-- 4. send_message, extended
-- ---------------------------------------------------------------------------
-- Adding a parameter changes the signature, so the 014 eight-arg function is
-- dropped first: leaving both would make an eight-arg call ambiguous between
-- them. Named-argument callers at the old arity are unaffected because the new
-- parameter is last and defaults to null.
drop function if exists public.send_message(uuid, text, uuid, text, integer, text, integer, integer);

create or replace function public.send_message(
  p_conversation_id uuid,
  p_body text default null,
  p_reply_to_id uuid default null,
  p_voice_path text default null,
  p_voice_duration_ms integer default null,
  p_attachment_path text default null,
  p_attachment_width integer default null,
  p_attachment_height integer default null,
  p_voice_peaks real[] default null
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
  -- Peaks are only meaningful on a voice message, and an over-length array is
  -- rejected rather than silently truncated: the sender controls downsampling
  -- and supplying more than 64 values is a client bug worth surfacing.
  if v_voice and p_voice_peaks is not null
    and array_length(p_voice_peaks, 1) > 64 then
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
    voice_path, voice_duration_ms, voice_peaks,
    attachment_path, attachment_type, attachment_width, attachment_height
  )
  values (
    p_conversation_id, v_uid, v_trimmed, p_reply_to_id,
    p_voice_path, p_voice_duration_ms,
    -- Force null for non-voice sends: the constraint enforces this too, but
    -- being explicit here means the INSERT never attempts to store peaks against
    -- a text or image message even if the constraint were somehow relaxed later.
    case when v_voice then p_voice_peaks else null end,
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

revoke all on function public.send_message(uuid, text, uuid, text, integer, text, integer, integer, real[])
  from public, anon;
grant execute on function public.send_message(uuid, text, uuid, text, integer, text, integer, integer, real[])
  to authenticated;
