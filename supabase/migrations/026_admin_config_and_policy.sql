-- ===========================================================================
-- 026  Admin config versioning and policy schema
-- ===========================================================================
-- This migration introduces the private `admin` schema for runtime config
-- management.  Every decision about rates, pack pricing, feature gates and
-- report categories was previously a code constant — a re-deploy to change
-- one number.  The versioned config store lets an operator publish and
-- schedule changes from an admin dashboard without touching the app bundle.
--
-- Design decisions recorded in ADR-0023:
--   • Append-only versioned table (`config_versions`) — no UPDATE on payload.
--     Rollback is always a new version pointing back at old content, not a
--     destructive rewrite of history.
--   • Separate projection (`config_active`) — billing RPCs do a one-row
--     primary-key lookup rather than a MAX(version_number) scan at call time.
--   • Scheduled activation via pg_cron — effective_at lets operators stage a
--     change in advance; the cron job promotes it atomically at the appointed
--     minute.
--   • `admin` schema, not `public` — the RN client never references this
--     schema directly.  Access is via SECURITY DEFINER RPCs in `public`.
--   • `get_active_config(domain)` accessor — the only public surface.
--     Returns null when nothing has been published yet; callers fall back to
--     compile-time defaults.
--
-- References: ADR-0023

-- ---------------------------------------------------------------------------
-- 1. Private admin schema
-- ---------------------------------------------------------------------------

-- Control-plane schema.  The RN mobile client never references this schema
-- directly; all access is mediated by SECURITY DEFINER functions in public.
create schema if not exists admin;

-- ---------------------------------------------------------------------------
-- 2. Config domains — allowed keys, enforced by FK on config_versions
-- ---------------------------------------------------------------------------

create table admin.config_domains (
  key         text primary key,
  description text not null
);

insert into admin.config_domains (key, description) values
  ('economics',        'Per-minute rates and revenue split'),
  ('recharge',         'Recharge pack ladder and Play product IDs'),
  ('wallet',           'Starting grant, daily refill, and promo settings'),
  ('thresholds',       'Low-balance threshold and per-minute rate limits'),
  ('payouts',          'Provider payout cadence, hold, and minimum'),
  ('kill_switches',    'Runtime feature kill switches'),
  ('report_taxonomy',  'Reportable categories'),
  ('auth_ui',          'UI-entry auth flags (displayed only; not server security)');

-- ---------------------------------------------------------------------------
-- 3. Versioned config — immutable, append-only
-- ---------------------------------------------------------------------------
-- Every change = new row.  Never UPDATE payload once committed.
-- Rollback = publish the previous version's payload as a new version_number.

create table admin.config_versions (
  id                uuid        primary key default gen_random_uuid(),
  domain            text        not null references admin.config_domains(key),
  environment       text        not null check (environment in ('staging', 'prod')),
  version_number    bigint      not null,
  status            text        not null default 'draft'
                                check (status in ('draft', 'scheduled', 'active', 'superseded')),
  payload           jsonb       not null,
  payload_sha256    text        not null,
  effective_at      timestamptz not null default now(),
  superseded_at     timestamptz,
  created_by        text        not null,
  published_by      text,
  published_at      timestamptz,
  publish_reason    text,
  -- Staging-to-prod promotion lineage: a prod version points at the staging
  -- version it was promoted from.  Null for drafts created directly in prod.
  source_version_id uuid        references admin.config_versions(id),
  created_at        timestamptz not null default now(),
  unique (domain, environment, version_number)
);

comment on table admin.config_versions is
  'Append-only versioned config store. Never UPDATE payload. '
  'Rollback = publish previous version as a new version_number. '
  'source_version_id tracks staging-to-prod promotion lineage.';

-- Partial unique index: only one 'active' version per domain+environment at
-- a time.  The publish path supersedes the existing active row first, then
-- activates the new one — this constraint is the catch for a buggy concurrent
-- publish rather than the primary serialisation mechanism.
create unique index config_versions_one_active
  on admin.config_versions (domain, environment)
  where status = 'active';

-- Fast lookup of the latest version number; used by the admin dashboard when
-- minting a new draft (max(version_number) + 1).
create index config_versions_domain_env_version
  on admin.config_versions (domain, environment, version_number desc);

-- ---------------------------------------------------------------------------
-- 4. Active projection — one-row lookup for billing RPCs
-- ---------------------------------------------------------------------------
-- Updated atomically every time a version is published or a scheduled version
-- activates.  Billing RPCs read from here (single PK lookup), never from
-- config_versions directly.

create table admin.config_active (
  domain         text        not null,
  environment    text        not null check (environment in ('staging', 'prod')),
  version_id     uuid        not null references admin.config_versions(id),
  payload        jsonb       not null,
  effective_from timestamptz not null,
  updated_at     timestamptz not null default now(),
  primary key (domain, environment)
);

comment on table admin.config_active is
  'Materialized active-version projection. Updated atomically when a version '
  'is published or a scheduled version activates. Billing RPCs read from here '
  '(one row lookup), never from config_versions.';

-- ---------------------------------------------------------------------------
-- 5. Config audit log — append-only, same pattern as moderation_actions
-- ---------------------------------------------------------------------------

create table admin.config_audit (
  id           uuid        primary key default gen_random_uuid(),
  action       text        not null
               check (action in (
                 'draft_created', 'published_staging', 'promoted_prod',
                 'scheduled', 'rollback', 'activation_cron'
               )),
  domain       text,
  version_id   uuid,
  actor        text        not null,
  reason       text        not null default '',
  confirmation text,
  metadata     jsonb,
  created_at   timestamptz not null default now()
);

create index config_audit_created on admin.config_audit (created_at desc);
create index config_audit_domain  on admin.config_audit (domain, created_at desc);

-- An audit trail that can be rewritten is not an audit trail.  Enforced here
-- rather than merely intended, because service_role bypasses RLS and would
-- otherwise be free to edit history.  Same pattern as moderation_actions in
-- migration 005.
create or replace function admin.config_audit_is_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin.config_audit is append-only' using errcode = '42501';
end;
$$;

create trigger config_audit_no_update
  before update or delete on admin.config_audit
  for each row execute function admin.config_audit_is_immutable();

-- ---------------------------------------------------------------------------
-- 6. Founder allowlist and admin sessions
-- ---------------------------------------------------------------------------

create table admin.founder_allowlist (
  email    text        primary key,
  role     text        not null default 'admin'
           check (role in ('operator', 'admin', 'superadmin')),
  added_by text,
  added_at timestamptz not null default now()
);

comment on table admin.founder_allowlist is
  'Server-side admin access gate. Checked in Next.js middleware AND '
  'server route handlers. Google OAuth email must exactly match.';

-- Tracks when an admin last re-authenticated, so high-risk publishes
-- (e.g. promoting to prod) can require a fresh reauth within N minutes.
create table admin.admin_sessions (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null references admin.founder_allowlist(email),
  reauth_at  timestamptz not null default now(),
  user_agent text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7. RLS — all admin tables: service_role only (zero client policies)
-- ---------------------------------------------------------------------------
-- RLS enabled with zero authenticated-role policies means service_role
-- (which bypasses RLS) is the only writer and reader.  The Next.js admin
-- server routes run under service_role; the mobile client never touches
-- admin.* directly.

alter table admin.config_domains    enable row level security;
alter table admin.config_versions   enable row level security;
alter table admin.config_active     enable row level security;
alter table admin.config_audit      enable row level security;
alter table admin.founder_allowlist enable row level security;
alter table admin.admin_sessions    enable row level security;

-- Exception: the mobile app needs the prod active config for billing RPC
-- self-service reads.  Only prod rows; staging is never client-visible.
-- (Billing RPCs also call get_active_config below which is SECURITY DEFINER
-- and bypasses RLS; this policy is belt-and-suspenders for direct reads.)
create policy "App reads prod active config"
  on admin.config_active
  for select to authenticated
  using (environment = 'prod');

-- ---------------------------------------------------------------------------
-- 8. get_active_config — public SECURITY DEFINER accessor
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so the authenticated role can reach the admin schema row
-- without needing a direct schema or table grant on admin.*.
-- Returns null when no active prod config exists; callers must handle null
-- and fall back to compile-time defaults until first admin publish.

create or replace function public.get_active_config(p_domain text)
returns jsonb
language sql
stable
security definer
set search_path = public, admin
as $$
  select payload
  from admin.config_active
  where domain      = p_domain
    and environment = 'prod';
$$;

comment on function public.get_active_config(text) is
  'Read-only accessor for billing and session RPCs. Returns the active '
  'prod payload for a config domain, or null if not yet published. '
  'SECURITY DEFINER so authenticated role can read the admin schema row.';

revoke all on function public.get_active_config(text) from public, anon, service_role;
grant execute on function public.get_active_config(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. apply_due_config_versions — pg_cron scheduled activation
-- ---------------------------------------------------------------------------
-- Activates any scheduled config versions whose effective_at has passed.
-- FOR UPDATE SKIP LOCKED means concurrent invocations (should the cron tick
-- overlap) cannot double-activate the same version.

create or replace function admin.apply_due_config_versions()
returns void
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  v record;
begin
  for v in
    select cv.*
    from admin.config_versions cv
    where cv.status       = 'scheduled'
      and cv.effective_at <= now()
    order by cv.domain, cv.environment, cv.effective_at
    for update skip locked
  loop
    -- Supersede the current active version so the partial unique index
    -- config_versions_one_active is not violated by the activate step below.
    update admin.config_versions
    set    status        = 'superseded',
           superseded_at = now()
    where  domain      = v.domain
      and  environment = v.environment
      and  status      = 'active';

    -- Promote the scheduled version to active.
    update admin.config_versions
    set    status       = 'active',
           published_at = now()
    where  id = v.id;

    -- Refresh the active projection so billing RPCs see the new payload
    -- on the next call without an additional version scan.
    insert into admin.config_active
      (domain, environment, version_id, payload, effective_from, updated_at)
    values
      (v.domain, v.environment, v.id, v.payload, v.effective_at, now())
    on conflict (domain, environment) do update
      set version_id     = excluded.version_id,
          payload        = excluded.payload,
          effective_from = excluded.effective_from,
          updated_at     = excluded.updated_at;

    -- Immutable audit record.
    insert into admin.config_audit (action, domain, version_id, actor, reason)
    values ('activation_cron', v.domain, v.id, 'pg_cron', 'Scheduled activation');
  end loop;
end;
$$;

-- pg_cron guard — same pattern as migrations 009 and 016.
-- `to_regclass('cron.job')` is null in the pgTAP test harness (plain
-- postgres, no pg_cron), so this block is a no-op there and migrations keep
-- working without the extension.  Unschedule first so re-running the
-- migration does not stack duplicate jobs.
do $$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'apply-config-versions') then
    perform cron.unschedule('apply-config-versions');
  end if;
  perform cron.schedule(
    'apply-config-versions',
    '* * * * *',
    $cron$select admin.apply_due_config_versions()$cron$
  );
end
$$;

-- ---------------------------------------------------------------------------
-- 10. Seed prod launch-ready defaults
-- ---------------------------------------------------------------------------
-- Values reflect all decisions recorded in ADR-0020, ADR-0021, ADR-0022,
-- ADR-0023.  These are the active prod configs from day one; the admin
-- dashboard can publish a new version_number to change any value without a
-- deploy.
--
-- The spec describes a helper procedure defined inside the DO block; nested
-- procedure definitions are not valid PostgreSQL.  The same result is
-- achieved here with a FOR loop over parallel arrays — identical outcome,
-- valid SQL.

do $$
declare
  v_economics     jsonb := '{
    "chat_rate_tokens_per_min":  22,
    "audio_rate_tokens_per_min": 22,
    "video_rate_tokens_per_min": 35,
    "provider_share_percent":    60,
    "gst_rate_bps":              1800
  }';
  v_recharge      jsonb := '{
    "packs_inr":          [100, 300, 500, 1000, 2500, 5000],
    "play_product_ids":   [],
    "cashfree_enabled":   false,
    "play_ucb_enabled":   false
  }';
  v_wallet        jsonb := '{
    "starting_grant_tokens": 0,
    "daily_refill_enabled":  false,
    "daily_refill_tokens":   25
  }';
  v_thresholds    jsonb := '{
    "low_balance_tokens":             22,
    "rate_limit_messages_per_min":    20,
    "unanswered_refund_window_hours": 24
  }';
  v_payouts       jsonb := '{
    "cadence":                  "weekly",
    "hold_days":                7,
    "minimum_paise":            50000,
    "cashfree_payouts_enabled": false
  }';
  v_kill_switches jsonb := '{
    "payments_enabled":          false,
    "calls_enabled":             true,
    "new_registrations_enabled": true,
    "mock_payments_allowed":     true
  }';
  v_report_taxonomy jsonb := '{
    "reasons": [
      "sexual_content",
      "child_safety",
      "harassment",
      "threats_violence",
      "hate_speech",
      "self_harm",
      "scam_spam",
      "impersonation",
      "privacy",
      "illegal_activity",
      "other"
    ]
  }';
  v_auth_ui       jsonb := '{
    "phone_auth_tab_visible":  true,
    "google_auth_tab_visible": true
  }';

  v_domains  text[] := ARRAY[
    'economics', 'recharge', 'wallet', 'thresholds',
    'payouts', 'kill_switches', 'report_taxonomy', 'auth_ui'
  ];
  v_payloads jsonb[];
  v_domain   text;
  v_payload  jsonb;
  v_id       uuid;
  v_sha      text;
  v_i        int;
begin
  v_payloads := ARRAY[
    v_economics, v_recharge, v_wallet, v_thresholds,
    v_payouts, v_kill_switches, v_report_taxonomy, v_auth_ui
  ];

  for v_i in 1..array_length(v_domains, 1) loop
    v_domain  := v_domains[v_i];
    v_payload := v_payloads[v_i];
    v_id      := gen_random_uuid();
    -- sha256 is a PG 11+ built-in; no pgcrypto dependency.
    v_sha     := encode(sha256(v_payload::text::bytea), 'hex');

    insert into admin.config_versions
      (id, domain, environment, version_number, status,
       payload, payload_sha256, effective_at,
       created_by, published_by, published_at, publish_reason)
    values
      (v_id, v_domain, 'prod', 1, 'active',
       v_payload, v_sha, now(),
       'migration_026', 'migration_026', now(),
       'Initial seed from migration 026');

    insert into admin.config_active
      (domain, environment, version_id, payload, effective_from, updated_at)
    values
      (v_domain, 'prod', v_id, v_payload, now(), now());

    -- 'published_staging' is the correct audit action for the initial
    -- migration seed per ADR-0023: there is no staging predecessor to
    -- promote from, so the first version carries the staging publication
    -- label rather than 'promoted_prod'.
    insert into admin.config_audit
      (action, domain, version_id, actor, reason)
    values
      ('published_staging', v_domain, v_id, 'migration_026',
       'Initial prod seed, migration 026');
  end loop;
end;
$$;
