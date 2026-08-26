-- ---------------------------------------------------------------------------
-- 009, what the sender needs that 008 did not provide
-- ---------------------------------------------------------------------------
-- 008 built the table, the registration RPC and the view, and the client half
-- was verified on a device. Writing the sender surfaced one gap and one choice.
--
-- The gap: `pending_pushes` exposed no sender id, so a notification could be
-- delivered but not *opened* anywhere. `src/lib/push.ts` reads `data.peerId` and
-- routes to that conversation; without it, tapping the notification lands on the
-- inbox and the user has to find the thread again. Adding it costs nothing,
-- the sender id is already on the row being joined.
--
-- The choice: the peer id is a user id, and this view is service-role only, so
-- publishing it here does not widen anything a client can reach.

-- Dropped rather than replaced: `create or replace view` can only *append*
-- columns, and peer_id belongs next to conversation_id where it is read, not
-- bolted onto the end. Nothing depends on this view except the sender.
drop view if exists public.pending_pushes;

create view public.pending_pushes
with (security_invoker = true) as
  select
    m.id as message_id,
    m.conversation_id,
    -- The peer, from the recipient's point of view: whoever sent the message is
    -- who the recipient wants to open. Named peer_id rather than sender_id
    -- because that is the meaning on the device, and the client's contract is
    -- `data.peerId`.
    m.sender_id as peer_id,
    t.token,
    t.platform,
    d.display_name as sender_display_name,
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
-- Invoking the sender
-- ---------------------------------------------------------------------------
-- pg_cron on a one-minute tick, which is its floor. That is a real latency
-- decision, so it is written down rather than inherited: while the app is
-- foregrounded Realtime already delivers instantly, so this only governs how
-- long a *backgrounded* reply waits, up to 60 seconds. A database webhook on
-- insert would make it immediate, at the cost of putting the service-role key
-- in the database (Vault) and a cold start per message. Worth doing; not worth
-- blocking the first release on.
-- Everything from here to the end is Supabase-only, and it is guarded rather
-- than assumed. `scripts/db-test.mjs` runs these migrations against a plain
-- postgres+pgTAP image that has no pg_cron, no pg_net and no Vault, and it must
-- keep working, because that harness is what proves RLS actually isolates users.
-- A migration that only applies on the hosted project is a migration the tests
-- cannot see.
--
-- The function itself is created unconditionally below: plpgsql resolves
-- `net.http_post` and `vault.decrypted_secrets` at call time, not at creation,
-- so it defines cleanly on a database where neither exists and simply never runs
-- there.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  else
    raise notice 'pg_cron/pg_net unavailable, skipping push scheduling (expected in the test harness)';
  end if;
end
$$;

-- The function URL and the key it authenticates with are configuration, not
-- schema, so they live in Vault rather than in this file. Created empty and
-- filled out of band: a secret in a migration is a secret in git. Guarded so
-- re-running never overwrites a rotated value.
do $$
begin
  if to_regclass('vault.secrets') is null then
    return;
  end if;
  if not exists (select 1 from vault.secrets where name = 'push_sender_url') then
    perform vault.create_secret('', 'push_sender_url',
      'Full https URL of the send-push Edge Function');
  end if;
  if not exists (select 1 from vault.secrets where name = 'push_sender_key') then
    perform vault.create_secret('', 'push_sender_key',
      'service_role key used to authenticate the cron call to send-push');
  end if;
end
$$;

create or replace function public.dispatch_pending_pushes()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_key text;
  v_pending int;
begin
  -- Nothing to send is the common case, and it should cost one index scan
  -- rather than an HTTP request. The Edge Function is idempotent either way;
  -- this is about not paying for a cold start sixty times an hour for nothing.
  select count(*) into v_pending from public.pending_pushes limit 1;
  if v_pending = 0 then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_sender_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_sender_key';

  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    -- Deliberately quiet: an unconfigured sender must not fill the logs once a
    -- minute forever. The absence of notifications is the symptom, and
    -- `select * from vault.decrypted_secrets` is the diagnosis.
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end;
$$;

revoke all on function public.dispatch_pending_pushes() from public, anon, authenticated;

-- Unschedule first so re-running the migration does not stack duplicate jobs.
do $$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'dispatch-pending-pushes') then
    perform cron.unschedule('dispatch-pending-pushes');
  end if;
  perform cron.schedule(
    'dispatch-pending-pushes',
    '* * * * *',
    'select public.dispatch_pending_pushes()'
  );
end
$$;
