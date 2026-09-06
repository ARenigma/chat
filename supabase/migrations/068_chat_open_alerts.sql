-- ===========================================================================
-- 068  "Someone opened your chat" — both ways, and only when it could matter
-- ===========================================================================
-- Goal items 3 and 4 (Amit, 2026-09-05), clarified 2026-09-06: "works both
-- ways, if provider opens then user gets notified and vice versa that next
-- person wants to chat with you". Item 4 is the other half of the same event:
-- when the peer is away, the person who opened is told "we have notified them"
-- rather than left talking into a room.
--
-- ---------------------------------------------------------------------------
-- The four rules, and why each one exists
-- ---------------------------------------------------------------------------
-- 1. THE MEMBER MUST HAVE A MINUTE. Always the member's balance, whoever
--    opened. "if bal > 1 min" in the goal — and it holds in both directions,
--    because pinging a member with an empty wallet to come and talk is pushing
--    them at a paywall, and pinging a provider about a member who cannot pay is
--    wasting the one person whose time is the product.
-- 2. ONLY WHEN THE PEER IS AWAY. Someone who is here does not need to be
--    fetched, and item 4's banner is only true when a notification was actually
--    sent.
-- 3. NOT DURING A SESSION. They are already talking.
-- 4. A COOLDOWN PER DIRECTION. Without it, opening and closing a thread is a
--    doorbell. 30 minutes by default, from admin `thresholds`.
--
-- Honesty rule for the banner: this returns `alerted: true` ONLY when a push
-- was actually dispatched. With the Vault URL unset the whole feature is a
-- quiet no-op (the pattern dispatch_call_push uses, 017:60) and the client says
-- nothing at all — "we have notified them" must never be a guess.

alter table public.conversation_thread_meta
  add column if not exists member_alerted_at   timestamptz,
  add column if not exists provider_alerted_at timestamptz;

comment on column public.conversation_thread_meta.member_alerted_at is
  'When the MEMBER was last told the provider opened this chat (068). Carries '
  'no content, like every other column here: it is a timestamp for a cooldown.';
comment on column public.conversation_thread_meta.provider_alerted_at is
  'When the PROVIDER was last told the member opened this chat (068).';

-- ---------------------------------------------------------------------------
-- announce_chat_open — called by whoever just opened the thread
-- ---------------------------------------------------------------------------
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
  v_peer_presence public.presence_choice;
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

  -- Rule 2: someone who is here does not need fetching.
  select presence into v_peer_presence from public.profiles where id = v_peer;
  if v_peer_presence = 'here' then
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
  '(068). Rules: the MEMBER must hold a minute whoever opened, the peer must be '
  'away, no session may be live, and one alert per direction per cooldown. '
  'Returns alerted=true ONLY when a push was actually dispatched, because the '
  '"we have notified them" banner is built from this answer.';

revoke all on function public.announce_chat_open(uuid) from public, anon;
grant execute on function public.announce_chat_open(uuid) to authenticated;
