-- 016 — engagement nudges: the sender side of the second notification type.
--
-- The engagement notification (a BigPicture of a provider's photo with a warm
-- call to action) is built on the client already; this is what decides who gets
-- one and when. Amit's rules (2026-08-27): target inactive members, feature a
-- random online provider, at most one nudge per member per day.
--
-- Nothing here exposes message content or anything the directory does not already
-- publish — a provider's display name and public photo. Service-role only.

alter table public.profiles
  add column if not exists engagement_nudged_at timestamptz;

comment on column public.profiles.engagement_nudged_at is
  'When this member was last sent a re-engagement nudge. Caps nudges at one/day.';

-- Candidates for a nudge: an INACTIVE member (no activity in 7 days) who has a
-- registered device and has not been nudged in the last 24h, paired with ONE
-- RANDOM online provider that has a public photo. One row per (member, device).
--
-- The lateral join is the targeting: if no provider is currently `here`, a member
-- yields no row — there is no nudge when nobody is around to talk to, which is the
-- honest version of "someone's around". `random()` picks a different provider each
-- run so the same face is not shown every day.
create or replace view public.engagement_candidates
with (security_invoker = true) as
  select
    m.id as member_id,
    t.token,
    t.platform,
    sp.id as provider_id,
    sp.display_name as provider_display_name,
    sp.avatar_url as provider_avatar_url
  from public.profiles m
  join public.push_tokens t on t.user_id = m.id
  cross join lateral (
    select p.id, p.display_name, p.avatar_url
    from public.provider_directory p
    where p.avatar_url is not null
      and p.presence = 'here'
      and p.id <> m.id
    order by random()
    limit 1
  ) sp
  where m.role = 'member'
    and (m.last_active_at is null or m.last_active_at < now() - interval '7 days')
    and (
      m.engagement_nudged_at is null
      or m.engagement_nudged_at < now() - interval '24 hours'
    );

revoke all on public.engagement_candidates from anon, authenticated;

comment on view public.engagement_candidates is
  'Service-role only. One row per (inactive member device, a random online '
  'provider) for the daily engagement nudge. Exposes only what the directory '
  'already publishes; never message content.';

-- Stamp members as nudged. Definer so the send-engagement edge function (service
-- role) can call it after a successful send, the same shape as mark_notified.
create or replace function public.mark_engagement_nudged(p_member_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set engagement_nudged_at = now()
  where id = any(p_member_ids);
$$;

revoke all on function public.mark_engagement_nudged(uuid[]) from public, anon, authenticated;

-- Daily dispatch, mirroring dispatch_pending_pushes (009): skip the HTTP call when
-- there is nobody to nudge, then post to the send-engagement Edge Function with the
-- service key. The function URL is a new Vault secret (`engagement_sender_url`);
-- the key is the same service-role secret the push sender uses. If either is
-- unset the dispatch is a quiet no-op, so the feature stays dark until configured.
create or replace function public.dispatch_engagement_nudges()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_key text;
  v_any int;
begin
  select count(*) into v_any from public.engagement_candidates limit 1;
  if v_any = 0 then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'engagement_sender_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'push_sender_key';

  if v_url is null or v_url = '' or v_key is null or v_key = '' then
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

revoke all on function public.dispatch_engagement_nudges() from public, anon, authenticated;

-- Once a day, not once a minute: a nudge is not time-sensitive, and the view's
-- 24h cap already enforces one per member. 13:00 UTC ~= 18:30 IST, an evening
-- hour when someone is more likely free to talk (and never the middle of the
-- night). Unschedule first so re-running the migration does not stack jobs.
do $$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'dispatch-engagement-nudges') then
    perform cron.unschedule('dispatch-engagement-nudges');
  end if;
  perform cron.schedule(
    'dispatch-engagement-nudges',
    '0 13 * * *',
    'select public.dispatch_engagement_nudges()'
  );
end
$$;
