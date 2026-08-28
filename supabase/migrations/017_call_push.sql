-- 017 — incoming-call push: the third notification type's server side.
--
-- A call rings for ~30s, so unlike messages it cannot wait for a one-minute cron
-- — the push has to go the instant the row is created. So this dispatches from an
-- AFTER INSERT trigger on `calls`, not a schedule. The client builds a CallStyle
-- notification with a full-screen intent from `kind: 'call'`.
--
-- `pending_call_pushes` (011) is recreated with the caller's public photo appended,
-- for the CallStyle Person icon. Same privacy line as the message sender: who is
-- calling and their public photo, never anything else.

-- provider_directory must be rebuilt before this view drops (a view cannot be
-- dropped while another selects from it); it is not, so create-or-replace with the
-- new column appended last is enough.
create or replace view public.pending_call_pushes
with (security_invoker = true) as
  select
    c.id as call_id,
    c.conversation_id,
    c.caller_id as peer_id,
    c.medium,
    coalesce(d.display_name, public.member_handle(c.caller_id)) as caller_display_name,
    t.token,
    t.platform,
    c.created_at,
    d.avatar_url as caller_avatar_url
  from public.calls c
  join public.push_tokens t on t.user_id = c.callee_id
  left join public.provider_directory d on d.id = c.caller_id
  where c.status = 'ringing'
    and c.notified_at is null
    and c.created_at > now() - interval '2 minutes';

revoke all on public.pending_call_pushes from anon, authenticated;

-- Real-time dispatch: fire the call sender the moment a ringing call is inserted.
-- Reads the send-call URL from Vault (`call_sender_url`) and the shared service key
-- (`push_sender_key`); a quiet no-op until both are set, so the feature stays dark
-- until configured. Definer so the trigger can read the Vault regardless of caller.
create or replace function public.dispatch_call_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_key text;
begin
  if new.status <> 'ringing' then
    return new;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'call_sender_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_sender_key';
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('call_id', new.id),
    timeout_milliseconds := 20000
  );
  return new;
end;
$$;

revoke all on function public.dispatch_call_push() from public, anon, authenticated;

drop trigger if exists call_push_on_insert on public.calls;
create trigger call_push_on_insert
  after insert on public.calls
  for each row execute function public.dispatch_call_push();
