-- 190 — display name editing for live providers, direct-write guard on provider
--       profile columns, earnings pending/paid split, usage ledger excludes
--       refunded tokens.
--
-- C6a — display name editing
-- -----------------------------------------------------------------
-- A live provider could change headline/about/languages through the Edit profile
-- screen (180) but had no way to change their display name at all after going live.
-- `update_provider_profile` is extended with an optional p_display_name parameter
-- validated against the same rules as onboarding plus a 30-day throttle.
--
-- The old 3-arg overload is dropped so exactly one overload exists.
--
-- Validation rules (all server-enforced, mirrored client-side):
--   • 2–30 characters after trimming
--   • letters, digits and underscores only (same charset as check_display_name)
--   • no reserved word (pappal, support, admin, official, team, staff,
--     moderator, help) as a case-insensitive substring
--   • not a phone number (≥6 consecutive digits, or ≥8 digits total)
--   • case-insensitive uniqueness across all profiles (profiles_display_name_lower_unique)
--   • at most one change per 30 days (display_name_changed_at column added below)
--
-- C6b — direct-write guard
-- -----------------------------------------------------------------
-- Clients could PATCH about/languages directly (and historically expertise).
-- headline was already guarded by guard_pii_columns (012). This adds an additive
-- BEFORE UPDATE trigger that refuses a direct authenticated/anon write to any of
-- display_name/headline/about/languages/expertise on a provider row.
-- SECURITY DEFINER paths (complete_provider_onboarding, claim_member_profile,
-- update_provider_profile) pass because current_user is the function owner.
-- Member rows are untouched: role <> 'provider' short-circuits the check.
--
-- D1 — earnings pending/paid split
-- -----------------------------------------------------------------
-- provider_earnings view gains pending_tokens (status pending or cleared) and
-- paid_tokens (status paid) so the You-tab card can show both figures.
-- Copied from migration 038 Part B and extended.
--
-- D2 — usage ledger excludes refunded earnings
-- -----------------------------------------------------------------
-- get_usage_ledger counted refunded provider earnings in the tokens column.
-- A refunded row is kept visible (so the status label reaches the screen) but
-- its token value is forced to 0, matching the net earned.
-- Copied from migration 124 and patched.

-- ---------------------------------------------------------------------------
-- C6a-0: column to track the last display name change
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists display_name_changed_at timestamptz;

comment on column public.profiles.display_name_changed_at is
  'UTC timestamp of the last provider display_name change (190). '
  'Null if the name has never been changed after going live. '
  'update_provider_profile enforces a 30-day cooldown using this column.';

-- ---------------------------------------------------------------------------
-- C6a-1: drop the old 3-arg overload so exactly one overload remains
-- ---------------------------------------------------------------------------
drop function if exists public.update_provider_profile(text, text, text[]);

-- ---------------------------------------------------------------------------
-- C6a-2: new 4-arg overload — copied body from 180, extended for display_name
-- ---------------------------------------------------------------------------
create function public.update_provider_profile(
  p_headline     text,
  p_about        text,
  p_languages    text[],
  p_display_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid := auth.uid();
  v_role           text;
  v_headline       text        := btrim(coalesce(p_headline, ''));
  v_about          text        := btrim(coalesce(p_about, ''));
  v_languages      text[]      := coalesce(p_languages, '{}'::text[]);
  v_display_name   text;
  v_last_changed   timestamptz;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'provider' then
    raise exception 'only a provider has a public profile' using errcode = '42501';
  end if;

  -- Headline/about/languages validations (copied from 180 verbatim).
  if length(v_headline) not between 1 and 140 then
    raise exception 'a headline is 1 to 140 characters' using errcode = '22023';
  end if;
  if length(v_about) not between 1 and 2000 then
    raise exception 'about is 1 to 2000 characters' using errcode = '22023';
  end if;
  if cardinality(v_languages) = 0 or not public.language_list_is_sane(v_languages) then
    raise exception 'at least one language, at most 12, each 1 to 40 characters'
      using errcode = '22023';
  end if;

  -- Display name change is optional; the parameter defaults to null and is skipped
  -- when not supplied so existing 3-arg callers continue working (the 4th arg
  -- defaults and the name is left untouched).
  if p_display_name is not null then
    v_display_name := btrim(p_display_name);

    -- Length: 2–30 characters (provider names may be shorter than the member
    -- check_display_name floor of 3 and may exceed its ceiling of 24).
    if length(v_display_name) not between 2 and 30 then
      raise exception 'a display name is 2 to 30 characters' using errcode = '22023';
    end if;

    -- Charset: letters, digits and underscores only, matching check_display_name
    -- and the handles the generator produces.
    if v_display_name !~ '^[a-zA-Z0-9_]+$' then
      raise exception 'letters, numbers, and underscores only' using errcode = '22023';
    end if;

    -- Reserved words: case-insensitive substring match. A name that contains
    -- "pappal", "admin" etc. would impersonate the platform.
    if lower(v_display_name) ~ '(pappal|support|admin|official|team|staff|moderator|help)' then
      raise exception 'that name is not available' using errcode = '22023';
    end if;

    -- Phone number: six or more consecutive digits, or eight or more digits
    -- in total. Mirrors stageNamePii's phone branch in src/lib/stageName.ts.
    if v_display_name ~ '\d{6,}'
      or length(regexp_replace(v_display_name, '[^0-9]', '', 'g')) >= 8
    then
      raise exception 'don''t put a phone number in your display name'
        using errcode = '22023';
    end if;

    -- Uniqueness: case-insensitive, excluding the caller's own current row.
    -- The unique index profiles_display_name_lower_unique would refuse the UPDATE
    -- anyway; this raises a readable sentence instead of a constraint name.
    if exists (
      select 1 from public.profiles
      where lower(display_name) = lower(v_display_name)
        and id <> v_uid
        and btrim(coalesce(display_name, '')) <> ''
    ) then
      raise exception 'that name is already taken' using errcode = '22023';
    end if;

    -- 30-day cooldown: providers may change their display name at most once a month.
    select display_name_changed_at into v_last_changed
    from public.profiles where id = v_uid;

    if v_last_changed is not null
      and v_last_changed > now() - interval '30 days'
    then
      raise exception 'display names can only change once every 30 days'
        using errcode = '22023';
    end if;
  end if;

  -- Single UPDATE for all fields so the contact guard (157) sees the whole write
  -- in one statement and the row cannot half-update.
  update public.profiles
  set
    headline                = v_headline,
    about                   = v_about,
    languages               = v_languages,
    -- coalesce: when p_display_name was null, v_display_name is null and the
    -- existing name is kept. When supplied, write the trimmed value.
    display_name            = coalesce(v_display_name, display_name),
    display_name_changed_at = case
      when v_display_name is not null then now()
      else display_name_changed_at
    end
  where id = v_uid;
end;
$$;

comment on function public.update_provider_profile(text, text, text[], text) is
  'A live provider replaces their own headline, about and languages (180), and '
  'optionally their display name (190). The display name change is validated: '
  '2–30 chars, letters/digits/underscores, no reserved word, no phone number, '
  'case-insensitive uniqueness, and throttled to once per 30 days. '
  'The only client path to these fields since 012/190 closed the PATCH. '
  'Restates the columns'' CHECKs as sentences (22023); the contact guard still '
  'refuses contact details at save (P0011). Expertise stays with '
  'set_provider_expertise (083).';

-- 153 closes the default; without the grant the RPC is permission-denied.
revoke all on function public.update_provider_profile(text, text, text[], text) from public, anon;
grant execute on function public.update_provider_profile(text, text, text[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- C6b: guard direct client writes to provider profile columns
-- ---------------------------------------------------------------------------
-- Pattern follows migration 112 (guard_provider_avatar_is_a_photograph): a
-- separate BEFORE UPDATE trigger function, additive, never a rewrite of an
-- existing guard. Postgres fires BEFORE triggers in name order; each raises
-- independently so this composes with guard_pii_columns (012) and
-- guard_privileged_profile_columns (063) without reproducing their bodies.
create or replace function public.guard_provider_profile_columns_direct_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Trusted paths (complete_provider_onboarding, claim_member_profile,
  -- update_provider_profile, set_provider_expertise) run as SECURITY DEFINER
  -- so current_user is the function owner, not 'authenticated' or 'anon'.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- Guard only provider rows. A member setting up their profile arrives here
  -- with role = 'member' (or null for the very first write) and passes.
  -- `is distinct from`, not coalesce(role, ''): role is the user_role enum
  -- and '' is not one of its values, so the coalesce failed every update.
  if new.role is distinct from 'provider' then
    return new;
  end if;

  -- Raise when any of the five guarded columns is being changed by a direct
  -- client PATCH. update_provider_profile writes them through its own
  -- SECURITY DEFINER context, which already passed the check above.
  if new.display_name is distinct from old.display_name
    or new.headline    is distinct from old.headline
    or new.about       is distinct from old.about
    or new.languages   is distinct from old.languages
    or new.expertise   is distinct from old.expertise
  then
    raise exception
      'direct writes to provider profile fields are not permitted; use update_provider_profile'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_provider_profile_columns_direct_write() is
  'BEFORE UPDATE guard on public.profiles (190): refuses a direct client write '
  '(current_user in authenticated/anon) to display_name, headline, about, '
  'languages or expertise on a provider row. SECURITY DEFINER writers pass '
  'because their current_user is the function owner. Member rows are untouched. '
  'Additive per 012 — does not touch guard_pii_columns or '
  'guard_privileged_profile_columns.';

-- Closed to clients like every trigger function (153; pgTAP 568).
revoke all on function public.guard_provider_profile_columns_direct_write()
  from public, anon, authenticated;

drop trigger if exists guard_provider_profile_columns_direct_write on public.profiles;
create trigger guard_provider_profile_columns_direct_write
  before update on public.profiles
  for each row
  execute function public.guard_provider_profile_columns_direct_write();

-- ---------------------------------------------------------------------------
-- D1: provider_earnings view — add pending_tokens and paid_tokens
-- ---------------------------------------------------------------------------
-- Copied exactly from migration 038 Part B and extended.

drop view if exists public.provider_earnings;

create view public.provider_earnings
with (security_invoker = true) as
  with me as (select auth.uid() as uid)
  select
    coalesce(sum(l.minutes_billed), 0)::bigint          as minutes_billed,
    coalesce(sum(l.provider_tokens), 0)::bigint         as provider_tokens,
    coalesce(sum(l.gross_tokens), 0)::bigint            as gross_tokens,
    count(l.id)::bigint                                 as sessions,
    count(distinct ps.member_id)::bigint                as members_served,
    min(l.created_at)                                   as first_earned_at,
    -- D1: tokens still in the clearing window (accrued, not yet payable).
    -- 'pending' = hold_until not yet passed; 'cleared' = hold done, awaiting payout run.
    coalesce(
      sum(l.provider_tokens) filter (where l.status in ('pending', 'cleared')), 0
    )::bigint                                           as pending_tokens,
    -- D1: tokens that have been paid out.
    coalesce(
      sum(l.provider_tokens) filter (where l.status = 'paid'), 0
    )::bigint                                           as paid_tokens
  from   me
  left join public.provider_earnings_ledger l
    on l.provider_id = me.uid
   and l.status <> 'refunded'
  left join public.paid_sessions ps
    on ps.id = l.session_id;

comment on view public.provider_earnings is
  'Session-era earnings aggregate for the calling provider. Always one row. '
  'Joins provider_earnings_ledger to paid_sessions; excludes refunded rows. '
  'Replaces the message-era view (billable_messages, conversations) retired in '
  'migration 038 (ADR-0021). Adds pending_tokens and paid_tokens split (190).';

grant select on public.provider_earnings to authenticated;

-- ---------------------------------------------------------------------------
-- D2: get_usage_ledger — refunded provider earnings shown as 0 tokens
-- ---------------------------------------------------------------------------
-- Copied exactly from migration 124 and patched: the tokens case expression
-- now returns 0 when the provider's ledger row has status = 'refunded'. The
-- row stays in the result so the 'refunded' earnings_status label reaches the
-- screen; only the monetary figure is corrected to reflect the reversal.

create or replace function public.get_usage_ledger(
  p_limit  integer default 50,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid    := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_rows  jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row order by row_started_at desc), '[]'::jsonb)
  into   v_rows
  from (
    select
      jsonb_build_object(
        'session_id',      ps.id,
        'channel',         ps.channel,
        'started_at',      ps.started_at,
        'ended_at',        ps.ended_at,
        -- Actual wall-clock elapsed seconds for display (124). Null when either
        -- timestamp is absent; client falls back to minutes_billed * 60.
        'elapsed_seconds', case
          when ps.started_at is not null and ps.ended_at is not null
            then greatest(0, floor(extract(epoch from (ps.ended_at - ps.started_at))))::integer
        end,
        'minutes',         ps.minutes_billed,
        'i_am_member',     ps.member_id = v_uid,
        -- D2: a refunded provider row is shown with 0 tokens so the running sum
        -- is net-earned, not gross before reversal. The row stays visible so the
        -- 'refunded' earnings_status label reaches the screen.
        'tokens', case
          when ps.member_id = v_uid  then ps.tokens_debited
          when e.status = 'refunded' then 0
          else coalesce(e.provider_tokens, 0)
        end,
        'earnings_status', case when ps.provider_id = v_uid then e.status end,
        'peer_id', case
          when ps.member_id = v_uid then ps.provider_id
          else ps.member_id
        end,
        'peer_name', case
          when ps.member_id = v_uid
            then coalesce(d.display_name, 'Someone')
          else public.member_handle(ps.member_id)
        end
      ) as row,
      coalesce(ps.started_at, ps.accepted_at) as row_started_at
    from   public.paid_sessions ps
    left join public.provider_directory d on d.id = ps.provider_id
    left join public.provider_earnings_ledger e
           on e.session_id = ps.id and e.provider_id = v_uid
    where  (ps.member_id = v_uid or ps.provider_id = v_uid)
      and  ps.minutes_billed > 0
      and  (p_before is null or coalesce(ps.started_at, ps.accepted_at) < p_before)
    order  by coalesce(ps.started_at, ps.accepted_at) desc
    limit  v_limit
  ) t;

  return v_rows;
end;
$$;

comment on function public.get_usage_ledger(integer, timestamptz) is
  'Per-session usage for the caller, newest first (069, 124, 190). One RPC for '
  'both roles: a member reads what they spent, a provider reads their own share, '
  'and neither is shown the other''s figure. Billed sessions only. elapsed_seconds '
  'is wall-clock talk time for display; minutes_billed is what was charged. '
  'Refunded provider earnings appear with tokens = 0 (190) so the running sum '
  'is net earned, not gross before reversal. Carries no message content.';

revoke all on function public.get_usage_ledger(integer, timestamptz) from public, anon;
grant execute on function public.get_usage_ledger(integer, timestamptz) to authenticated;
