-- ===========================================================================
-- 195  Provider trust hardening (sweep A, payments excluded)
-- ===========================================================================
-- Owner, 2026-10-17: "fix part A issues that we parked except payments".
-- Every fix here is an additive trigger or policy, so no large RPC body is
-- restated. The edge functions carry the rest (verify-pan: A5/A14 PAN;
-- verify-payout-account: A4/A6 name match, A14 account). Deliberately NOT here:
--   A1-A3 (payments), and A7/A13's directory rules (owner chose "neither yet":
--   no live provider has 3 photos and only one has a verified account).
--
--   A8  a suspended provider cannot accept a session request (answer_call goes
--       through accept_session_request), and a suspended member cannot become
--       a provider.
--   A9  a report on a provider holds that conversation's unpaid earnings for
--       30 days, and no payout batch is created for a suspended provider.
--   A10 deleting a suspended account records its PAN and payout destination
--       (hashed) so they cannot be reused while the suspension lasts.
--   A11 the avatars bucket gets its size and type limits, cannot be listed
--       publicly, and objects of deleted accounts are purged nightly.
--   A12 a client can only point avatar_url / provider_photos.url at its own
--       folder in this project's avatars bucket.

-- ---------------------------------------------------------------------------
-- A8. Suspension blocks accepting work and becoming a provider
-- ---------------------------------------------------------------------------
create or replace function public.guard_suspended_recipient_accept()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted'
    and exists (
      select 1 from public.profiles
      where id = new.recipient_id and suspended_until > now()
    )
  then
    raise exception 'your account is suspended' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_suspended_recipient_accept() from public, anon, authenticated;

drop trigger if exists guard_suspended_recipient_accept on public.session_requests;
create trigger guard_suspended_recipient_accept
  before update of status on public.session_requests
  for each row execute function public.guard_suspended_recipient_accept();

create or replace function public.guard_suspended_becoming_provider()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role = 'provider' and old.role is distinct from 'provider'
    and new.suspended_until > now()
  then
    raise exception 'your account is suspended' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_suspended_becoming_provider() from public, anon, authenticated;

drop trigger if exists guard_suspended_becoming_provider on public.profiles;
create trigger guard_suspended_becoming_provider
  before update of role on public.profiles
  for each row execute function public.guard_suspended_becoming_provider();

-- ---------------------------------------------------------------------------
-- A9. Reports hold earnings; suspension freezes payouts
-- ---------------------------------------------------------------------------
create or replace function public.hold_reported_earnings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.subject_user_id is null or new.conversation_id is null then
    return new;
  end if;
  -- Only a provider earns; a report on a member matches no ledger rows.
  update public.provider_earnings_ledger l
  set hold_until = greatest(l.hold_until, now() + interval '30 days')
  where l.provider_id = new.subject_user_id
    and l.status in ('pending', 'cleared')
    and l.payout_batch_id is null
    and l.session_id in (
      select ps.id from public.paid_sessions ps
      where ps.conversation_id = new.conversation_id
    );
  return new;
end;
$$;

revoke all on function public.hold_reported_earnings() from public, anon, authenticated;

drop trigger if exists hold_reported_earnings on public.reports;
create trigger hold_reported_earnings
  after insert on public.reports
  for each row execute function public.hold_reported_earnings();

create or replace function public.guard_payout_for_suspended()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from public.profiles
    where id = new.provider_id and suspended_until > now()
  ) then
    raise exception 'provider is suspended; payouts are frozen' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_payout_for_suspended() from public, anon, authenticated;

drop trigger if exists guard_payout_for_suspended on public.provider_payout_batches;
create trigger guard_payout_for_suspended
  before insert on public.provider_payout_batches
  for each row execute function public.guard_payout_for_suspended();

-- ---------------------------------------------------------------------------
-- A10. A suspended account cannot delete its way back in
-- ---------------------------------------------------------------------------
-- sha256 of the normalised value, never the value: the record outlives the
-- account and only has to answer "was this one banned".
create table if not exists public.banned_payout_identifiers (
  kind        text        not null check (kind in ('pan', 'upi', 'bank')),
  value_hash  text        not null,
  until       timestamptz not null,
  created_at  timestamptz not null default now(),
  primary key (kind, value_hash)
);

alter table public.banned_payout_identifiers enable row level security;
revoke all on public.banned_payout_identifiers from public, anon, authenticated;

comment on table public.banned_payout_identifiers is
  'A10 (195): hashed PAN / UPI / bank account of accounts deleted while '
  'suspended, refused on new tax and payout rows until `until`. Server-only.';

create or replace function public.payout_identifier_hash(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(p_value, 'UTF8')), 'hex');
$$;

revoke all on function public.payout_identifier_hash(text) from public, anon, authenticated;

create or replace function public.record_banned_identifiers_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (old.suspended_until > now()) then
    return old;
  end if;
  -- BEFORE DELETE on the parent: the cascade has not reached the tax and
  -- payout rows yet, so they can still be read here.
  insert into public.banned_payout_identifiers (kind, value_hash, until)
  select k, public.payout_identifier_hash(v), old.suspended_until
  from (
    select 'pan' as k, upper(btrim(t.pan)) as v
      from public.provider_tax_profile t
     where t.provider_id = old.id and t.pan is not null
    union all
    select 'upi', lower(btrim(a.upi_vpa))
      from public.provider_payout_accounts a
     where a.provider_id = old.id and a.upi_vpa is not null
    union all
    select 'bank', btrim(a.account_number) || '@' || upper(btrim(a.ifsc))
      from public.provider_payout_accounts a
     where a.provider_id = old.id and a.account_number is not null and a.ifsc is not null
  ) ids
  on conflict (kind, value_hash) do update
    set until = greatest(public.banned_payout_identifiers.until, excluded.until);
  return old;
end;
$$;

revoke all on function public.record_banned_identifiers_on_delete() from public, anon, authenticated;

drop trigger if exists record_banned_identifiers_on_delete on public.profiles;
create trigger record_banned_identifiers_on_delete
  before delete on public.profiles
  for each row execute function public.record_banned_identifiers_on_delete();

create or replace function public.guard_banned_pan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pan is not null and exists (
    select 1 from public.banned_payout_identifiers
    where kind = 'pan'
      and value_hash = public.payout_identifier_hash(upper(btrim(new.pan)))
      and until > now()
  ) then
    raise exception 'this PAN cannot be used' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_banned_pan() from public, anon, authenticated;

drop trigger if exists guard_banned_pan on public.provider_tax_profile;
create trigger guard_banned_pan
  before insert or update of pan on public.provider_tax_profile
  for each row execute function public.guard_banned_pan();

create or replace function public.guard_banned_payout_destination()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.banned_payout_identifiers b
    where b.until > now()
      and (
        (b.kind = 'upi' and new.upi_vpa is not null
          and b.value_hash = public.payout_identifier_hash(lower(btrim(new.upi_vpa))))
        or (b.kind = 'bank' and new.account_number is not null and new.ifsc is not null
          and b.value_hash = public.payout_identifier_hash(
            btrim(new.account_number) || '@' || upper(btrim(new.ifsc))))
      )
  ) then
    raise exception 'this payout account cannot be used' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_banned_payout_destination() from public, anon, authenticated;

drop trigger if exists guard_banned_payout_destination on public.provider_payout_accounts;
create trigger guard_banned_payout_destination
  before insert or update of upi_vpa, account_number, ifsc on public.provider_payout_accounts
  for each row execute function public.guard_banned_payout_destination();

-- ---------------------------------------------------------------------------
-- A12. Client avatar and photo URLs must be this project's own avatars folder
-- ---------------------------------------------------------------------------
-- The host is pinned, as 087/112/113/122 pin it for the seed photos. Members
-- keep clay: seeds; server paths (seeds, the photo mirror) are not clients.
-- Inlined in both guards, not a helper: the guards run as the client (they
-- read current_user), and a revoked helper would be uncallable from them.

create or replace function public.guard_client_avatar_url()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
    and (tg_op = 'INSERT' or new.avatar_url is distinct from old.avatar_url)
    and new.avatar_url is not null
    and new.avatar_url not like 'clay:%'
    and not starts_with(new.avatar_url, 'https://uvghvhcrovmuwivgijvl.supabase.co/storage/v1/object/public/avatars/' || new.id::text || '/')
  then
    raise exception 'a profile photo must be uploaded to your own folder'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_client_avatar_url() from public, anon, authenticated;

drop trigger if exists guard_client_avatar_url on public.profiles;
create trigger guard_client_avatar_url
  before insert or update of avatar_url on public.profiles
  for each row execute function public.guard_client_avatar_url();

create or replace function public.guard_client_photo_url()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
    and (tg_op = 'INSERT' or new.url is distinct from old.url)
    and (new.url is null
         or not starts_with(new.url, 'https://uvghvhcrovmuwivgijvl.supabase.co/storage/v1/object/public/avatars/' || new.provider_id::text || '/'))
  then
    raise exception 'a photo must be uploaded to your own folder'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_client_photo_url() from public, anon, authenticated;

drop trigger if exists guard_client_photo_url on public.provider_photos;
create trigger guard_client_photo_url
  before insert or update of url on public.provider_photos
  for each row execute function public.guard_client_photo_url();

-- ---------------------------------------------------------------------------
-- A11. Avatars bucket: limits, no public listing, deleted accounts purged
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  -- 038 inserted these limits `on conflict do nothing`; the live bucket
  -- predates it and had neither.
  update storage.buckets
     set file_size_limit = 5242880,
         allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
   where id = 'avatars';

  -- A public bucket serves /object/public/ URLs without any SELECT policy;
  -- the policy only added listing and API reads for everyone. Owners keep
  -- reads of their own folder (the x-upsert upload and remove() need it).
  drop policy if exists "Public read avatars" on storage.objects;
  drop policy if exists "Owners read own avatar" on storage.objects;
  create policy "Owners read own avatar"
    on storage.objects for select to authenticated
    using (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = auth.uid()::text
    );
end;
$$;

create or replace function public.purge_orphaned_avatars()
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
  -- Same guard lift as 094's purges, for this transaction only.
  perform set_config('storage.allow_delete_query', 'true', true);
  with gone as (
    delete from storage.objects o
    where o.bucket_id = 'avatars'
      and (storage.foldername(o.name))[1] ~ '^[0-9a-f-]{36}$'
      and o.created_at < now() - interval '24 hours'
      and not exists (
        select 1 from public.profiles p
        where p.id::text = (storage.foldername(o.name))[1]
      )
    returning 1
  )
  select count(*)::int into v_count from gone;
  return v_count;
end;
$$;

revoke all on function public.purge_orphaned_avatars() from public, anon, authenticated;

comment on function public.purge_orphaned_avatars() is
  'A11 (195): removes avatars-bucket objects whose owner folder (a uuid) '
  'belongs to no profile any more, i.e. deleted accounts. Seed photos live '
  'under seed/ and are never matched. Nightly by pg_cron.';

do $$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'purge-orphaned-avatars') then
    perform cron.unschedule('purge-orphaned-avatars');
  end if;
  perform cron.schedule(
    'purge-orphaned-avatars', '41 4 * * *',
    $c$select public.purge_orphaned_avatars()$c$
  );
end;
$$;
