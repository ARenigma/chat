-- ===========================================================================
-- 027  Policy versions and server-authoritative acceptance
-- ===========================================================================
-- Adds the legal-policy acceptance gate that guards all user-generated-
-- content operations (send_message, session RPCs, etc.).
--
-- Two tables:
--   • policy_versions — the published Terms and Privacy documents, versioned.
--   • policy_acceptances — server-authoritative record of each user's
--     acceptance of a specific version.  Never deleted.
--
-- Two app-boot RPCs:
--   • pending_policy_acceptances() — returns the version IDs the calling user
--     still needs to accept.  An empty result means no gate is shown.
--   • accept_policy(version_id) — idempotent acceptance record.
--
-- One session-RPC helper:
--   • user_has_accepted_current_policies(user_id) — SECURITY DEFINER boolean
--     used by session and send_message RPCs (migration 028+) to gate UGC.
--     Inlines the pending-check logic rather than calling
--     pending_policy_acceptances(), which uses auth.uid() internally and
--     cannot be called for an arbitrary user_id.
--
-- Design notes:
--   • is_material=true on a new version means users who already accepted an
--     older version of the same kind are prompted again.  Non-material
--     corrections (typos, formatting) leave is_material=false and do not
--     re-gate existing users.
--   • Acceptance records are append-only (no DELETE policy, no client UPDATE).
--     Legal evidence of acceptance must survive account lifecycle events.

-- ---------------------------------------------------------------------------
-- 1. policy_versions — published Terms and Privacy documents
-- ---------------------------------------------------------------------------

create table public.policy_versions (
  id           uuid        primary key default gen_random_uuid(),
  kind         text        not null check (kind in ('terms', 'privacy')),
  version      integer     not null,
  is_material  boolean     not null default true,
  url          text        not null,
  summary      text        not null default '',
  effective_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (kind, version)
);

comment on table public.policy_versions is
  'Published policy documents. kind+version is the stable identity. '
  'is_material=true means acceptance is required from users who previously '
  'accepted an earlier version of this kind. Managed via admin dashboard.';

alter table public.policy_versions enable row level security;

-- Authenticated users can read all versions — needed for the settings screen
-- and for the acceptance gate to display the correct document URL and summary.
create policy "Authenticated read policy versions"
  on public.policy_versions
  for select to authenticated
  using (true);

-- No client INSERT / UPDATE / DELETE: policy documents are operator-managed
-- and immutable once published.  Service_role is the only writer.

revoke all on public.policy_versions from anon, authenticated;
grant select on public.policy_versions to authenticated;

-- ---------------------------------------------------------------------------
-- 2. policy_acceptances — server-authoritative acceptance records
-- ---------------------------------------------------------------------------

create table public.policy_acceptances (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  policy_kind text        not null check (policy_kind in ('terms', 'privacy')),
  version_id  uuid        not null references public.policy_versions(id),
  accepted_at timestamptz not null default now(),
  device_info text,
  -- One acceptance row per (user, kind, version) — accept_policy is
  -- idempotent via ON CONFLICT DO NOTHING on this constraint.
  unique (user_id, policy_kind, version_id)
);

comment on table public.policy_acceptances is
  'Server-authoritative acceptance records. Required before any UGC operation '
  '(send_message, session RPCs, etc.). Never deleted.';

alter table public.policy_acceptances enable row level security;

create policy "Users read own acceptances"
  on public.policy_acceptances
  for select to authenticated
  using (user_id = auth.uid());

-- No UPDATE or DELETE: acceptance records are legal evidence and must not be
-- retracted or modified by the client.
create policy "Users insert own acceptances"
  on public.policy_acceptances
  for insert to authenticated
  with check (user_id = auth.uid());

create index on public.policy_acceptances (user_id, policy_kind, accepted_at desc);

revoke all on public.policy_acceptances from anon, authenticated;
grant select, insert on public.policy_acceptances to authenticated;

-- ---------------------------------------------------------------------------
-- 3. accept_policy — idempotent acceptance RPC
-- ---------------------------------------------------------------------------

create or replace function public.accept_policy(
  p_version_id  uuid,
  p_device_info text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
begin
  -- Validate the version exists and resolve its kind in one lookup.
  select kind into v_kind
  from public.policy_versions
  where id = p_version_id;

  if v_kind is null then
    raise exception 'Unknown policy version' using errcode = 'P0001';
  end if;

  -- ON CONFLICT DO NOTHING makes this idempotent: calling accept_policy twice
  -- for the same version is safe and produces exactly one acceptance row.
  insert into public.policy_acceptances
    (user_id, policy_kind, version_id, device_info)
  values
    (auth.uid(), v_kind, p_version_id, p_device_info)
  on conflict (user_id, policy_kind, version_id) do nothing;
end;
$$;

revoke all on function public.accept_policy(uuid, text) from public, anon, service_role;
grant execute on function public.accept_policy(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. pending_policy_acceptances — app-boot gate query
-- ---------------------------------------------------------------------------
-- Returns the latest effective version per kind that the calling user has NOT
-- yet accepted and that requires acceptance (is_material=true, or no prior
-- acceptance of that kind at all).
-- Empty result → no gate shown; any rows → present the acceptance UI.

create or replace function public.pending_policy_acceptances()
returns table (
  version_id  uuid,
  kind        text,
  url         text,
  summary     text,
  is_material boolean
)
language sql
stable
security definer
set search_path = public
as $$
  -- Latest effective version per kind (kind+version is unique, ordered desc).
  with latest as (
    select distinct on (kind)
      id, kind, url, summary, is_material, effective_at
    from public.policy_versions
    where effective_at <= now()
    order by kind, version desc
  ),
  -- Versions this user has already accepted.
  accepted as (
    select policy_kind, version_id
    from public.policy_acceptances
    where user_id = auth.uid()
  )
  select l.id, l.kind, l.url, l.summary, l.is_material
  from latest l
  -- Show if: not yet accepted this specific version AND (is_material OR no
  -- prior acceptance of this kind at all — i.e. brand-new user).
  where not exists (
    select 1 from accepted a
    where a.policy_kind = l.kind
      and a.version_id  = l.id
  )
  and (
    l.is_material = true
    or not exists (
      select 1 from accepted a
      where a.policy_kind = l.kind
    )
  );
$$;

revoke all on function public.pending_policy_acceptances() from public, anon, service_role;
grant execute on function public.pending_policy_acceptances() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. user_has_accepted_current_policies — server-side UGC gate helper
-- ---------------------------------------------------------------------------
-- Called by session and send_message RPCs (migration 028+) to block UGC
-- until the user has accepted both current Terms and Privacy.
--
-- Inlines the pending-check logic rather than delegating to
-- pending_policy_acceptances(), which uses auth.uid() internally and cannot
-- be called for an arbitrary p_user_id from a SECURITY DEFINER caller.

create or replace function public.user_has_accepted_current_policies(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Returns true when the user has accepted the latest effective version of
  -- every policy kind (terms AND privacy).
  -- Returns false if any current policy is pending acceptance.
  with latest as (
    select distinct on (kind)
      id, kind, is_material
    from public.policy_versions
    where effective_at <= now()
    order by kind, version desc
  ),
  accepted as (
    select policy_kind, version_id
    from public.policy_acceptances
    where user_id = p_user_id
  )
  select not exists (
    select 1
    from latest l
    where not exists (
      select 1 from accepted a
      where a.policy_kind = l.kind
        and a.version_id  = l.id
    )
    and (
      l.is_material = true
      or not exists (
        select 1 from accepted a
        where a.policy_kind = l.kind
      )
    )
  );
$$;

comment on function public.user_has_accepted_current_policies(uuid) is
  'Used by session and send_message RPCs to gate UGC behind policy acceptance. '
  'SECURITY DEFINER; callable by session RPC (also SECURITY DEFINER).';

-- Authenticated so self-check is possible from the mobile client; service_role
-- callers bypass the grant check anyway.
revoke all on function public.user_has_accepted_current_policies(uuid)
  from public, anon, service_role;
grant execute on function public.user_has_accepted_current_policies(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Seed initial policy versions
-- ---------------------------------------------------------------------------
-- Points to existing Vercel deployment pages.  Update urls when a custom
-- domain is live; publish a new version_number rather than updating this row.

do $$
declare
  v_terms_id   uuid := gen_random_uuid();
  v_privacy_id uuid := gen_random_uuid();
begin
  insert into public.policy_versions
    (id, kind, version, is_material, url, summary, effective_at)
  values
    (v_terms_id,   'terms',   1, true,
     'https://bond-app.vercel.app/terms.html',
     'Terms of Service for Pappal — paid 1:1 conversations.',
     now()),
    (v_privacy_id, 'privacy', 1, true,
     'https://bond-app.vercel.app/privacy.html',
     'Privacy Policy for Pappal — how we handle your data.',
     now());
end;
$$;
