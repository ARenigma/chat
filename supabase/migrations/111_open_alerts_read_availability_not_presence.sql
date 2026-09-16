-- ===========================================================================
-- 111  "Someone opened your chat" reads availability, not presence
-- ===========================================================================
-- Amit, 2026-09-17: the master availability switch is the whole of "online".
-- `is_available` is read LITERALLY — no liveness check, no `last_active_at`,
-- no second gate — and the separate here/away/hidden control is removed from
-- the app in the same change. Nothing writes `profiles.presence` any more.
--
-- WHAT CHANGED, and it is exactly one gate. Rule 2 of `announce_chat_open`
-- (068:90-95), "someone who is here does not need fetching", moves from
-- `profiles.presence = 'here'` to `profiles.is_available`. A peer who is OPEN
-- counts as present and is not worth a push; a peer who is CLOSED counts as
-- away, and is precisely who the Notify route exists for. Every other rule of
-- 068 is reproduced unchanged and re-read line by line against it: the MEMBER
-- must hold a minute whoever opened, no session may be live, and one alert per
-- direction per `chat_open_alert_cooldown_minutes` from the admin thresholds.
--
-- THE RETURNED REASON STRING STAYS `peer_present`. It is a wire literal, not
-- prose: `src/api/sessions.ts` branches on it to drive the "they came back"
-- state of the Notify control. Renaming it would break that in a client that
-- is already deployed, with nothing in the build to catch it.
--
-- ---------------------------------------------------------------------------
-- The trap this migration exists to close
-- ---------------------------------------------------------------------------
-- Leaving 068's gate on `presence` reads as harmless — a column nobody writes
-- sounds inert. It is not, because presence does not decay. It is
-- `not null default 'hidden'` (012:55) and 012:83-84 backfilled
-- `presence = 'here'` for every provider who was available at the time. With
-- the writer gone those rows are frozen on 'here' forever, the gate returns
-- `peer_present` for each of them, and the push is never dispatched — for
-- exactly the closed providers a member has no other way to reach. Nothing
-- would error. Notify would simply stop, quietly, in the one case it was
-- built for.
--
-- ---------------------------------------------------------------------------
-- Deliberately left in place, and now unread
-- ---------------------------------------------------------------------------
-- `profiles.presence`, `profiles.presence_visible`, `public.touch_presence()`
-- and the `public.presence_choice` enum all stay. Dropping a column is
-- irreversible and is not what was asked for; they can go in a later cleanup
-- once this has been live long enough to be sure of it. `touch_presence()` was
-- never called from the client in the first place, so `last_active_at` has
-- never been written.

-- No explicit BEGIN/COMMIT: the Supabase CLI wraps each file in its own
-- transaction, and a COMMIT inside closes it early.

create or replace function public.announce_chat_open(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_uid         uuid := auth.uid();
  v_member      uuid;
  v_provider    uuid;
  v_peer        uuid;
  v_peer_is_provider boolean;
  v_peer_open   boolean;
  v_balance     integer;
  v_rate        integer;
  v_cooldown    integer;
  v_last        timestamptz;
  v_url         text;
  v_key         text;
begin
  if v_uid is null then
    return jsonb_build_object('alerted', false, 'reason', 'unauthorized');
  end if;

  select member_id, provider_id into v_member, v_provider
  from   public.conversations
  where  id = p_conversation_id;

  if v_member is null then
    return jsonb_build_object('alerted', false, 'reason', 'not_found');
  end if;
  if v_uid not in (v_member, v_provider) then
    return jsonb_build_object('alerted', false, 'reason', 'forbidden');
  end if;

  v_peer := case when v_uid = v_member then v_provider else v_member end;
  v_peer_is_provider := v_peer = v_provider;

  -- Rule 3: they are already talking.
  if exists (
    select 1 from public.paid_sessions
    where  conversation_id = p_conversation_id
      and  status in ('pending_leases', 'active', 'warning', 'grace')
  ) then
    return jsonb_build_object('alerted', false, 'reason', 'in_session');
  end if;

  -- Rule 2: a peer who is OPEN does not need fetching. A member never sets
  -- `is_available` (003:29 defaults it false), so a member peer is always
  -- reachable by this route, which is the intended asymmetry.
  select is_available into v_peer_open from public.profiles where id = v_peer;
  if coalesce(v_peer_open, false) then
    return jsonb_build_object('alerted', false, 'reason', 'peer_present',
                              'peer_present', true);
  end if;

  -- Rule 1: always the MEMBER's wallet, whoever opened.
  select token_balance into v_balance from public.profiles where id = v_member;
  select (payload ->> 'chat_rate_tokens_per_min')::integer into v_rate
  from   admin.config_active
  where  domain = 'economics' and environment = 'prod';
  v_rate := coalesce(v_rate, 22);
  if coalesce(v_balance, 0) < v_rate then
    return jsonb_build_object('alerted', false, 'reason', 'no_balance');
  end if;

  -- Rule 4: one doorbell per direction per cooldown.
  select (payload ->> 'chat_open_alert_cooldown_minutes')::integer into v_cooldown
  from   admin.config_active
  where  domain = 'thresholds' and environment = 'prod';
  v_cooldown := coalesce(v_cooldown, 30);

  select case when v_peer_is_provider then provider_alerted_at else member_alerted_at end
  into   v_last
  from   public.conversation_thread_meta
  where  conversation_id = p_conversation_id;

  if v_last is not null and v_last > now() - make_interval(mins => v_cooldown) then
    return jsonb_build_object('alerted', false, 'reason', 'cooldown',
                              'cooldown_until', v_last + make_interval(mins => v_cooldown));
  end if;

  -- Configured? If not, the whole feature is dark and the caller is told so,
  -- because the banner it drives must never claim a push that did not happen.
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'open_alert_sender_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_sender_key';
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return jsonb_build_object('alerted', false, 'reason', 'not_configured');
  end if;

  insert into public.conversation_thread_meta as m (conversation_id, provider_alerted_at, member_alerted_at)
  values (
    p_conversation_id,
    case when v_peer_is_provider then now() end,
    case when not v_peer_is_provider then now() end
  )
  on conflict (conversation_id) do update
    set provider_alerted_at = case when v_peer_is_provider then now() else m.provider_alerted_at end,
        member_alerted_at   = case when not v_peer_is_provider then now() else m.member_alerted_at end,
        updated_at = now();

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object(
      'conversation_id', p_conversation_id,
      'peer_id', v_peer,
      'opener_id', v_uid
    ),
    timeout_milliseconds := 20000
  );

  return jsonb_build_object('alerted', true, 'reason', null, 'peer_present', false);
end;
$$;

comment on function public.announce_chat_open(uuid) is
  'Either participant opened this chat; tell the other one, if it could matter '
  '(068, regated by 111). Rules: the MEMBER must hold a minute whoever opened, '
  'the peer must be CLOSED — is_available false, since presence is no longer '
  'written or read — no session may be live, and one alert per direction per '
  'cooldown. Returns alerted=true ONLY when a push was actually dispatched, '
  'because the "we have notified them" banner is built from this answer.';

revoke all on function public.announce_chat_open(uuid) from public, anon;
grant execute on function public.announce_chat_open(uuid) to authenticated;
