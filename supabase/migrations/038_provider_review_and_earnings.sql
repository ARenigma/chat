-- ===========================================================================
-- 038  Provider review queue and earnings view rebuild (ADR-0021)
-- ===========================================================================
-- Part A — review claim:
--   • claim_provider_application_review  — moves submitted → under_review so
--     a reviewer's first action is recorded before further decisions are made.
--     Service-role only. The ops queue is the entry point, never a direct UPDATE.
--   • provider_review_queue  — service-only projection over provider_applications
--     for the three queue statuses. Authenticated applicants still use my_application.
--
-- Part B — provider earnings view rebuild:
--   • Replaces the message-era provider_earnings (billable_messages, conversations)
--     with a session-era aggregate over provider_earnings_ledger joined to
--     paid_sessions. Same view name; same security_invoker = true; columns
--     renamed to reflect the paid-session model. (ADR-0021)

-- ---------------------------------------------------------------------------
-- Part A — 1. claim_provider_application_review
-- ---------------------------------------------------------------------------
-- Sets status to under_review and stamps reviewed_at only when the current
-- status is submitted. Any other state raises no_data_found so the caller
-- knows the claim was not applied (race with another reviewer, wrong user-id,
-- or the application is already past submitted).

create or replace function public.claim_provider_application_review(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.provider_applications
  set    status      = 'under_review',
         reviewed_at = now()
  where  user_id = p_user_id
    and  status  = 'submitted';

  if not found then
    -- Follows PostgreSQL no_data_found convention (SQLSTATE P0002). The caller
    -- should re-fetch the application to discover the actual status before retrying.
    raise exception 'no submitted application found for user %', p_user_id
      using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.claim_provider_application_review(uuid) is
  'Moves a submitted provider application to under_review and stamps reviewed_at. '
  'Raises no_data_found (P0002) when status ≠ submitted. '
  'Service-role only — callers are the review console and the admin UI. (ADR-0021)';

revoke all on function public.claim_provider_application_review(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_provider_application_review(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Part A — 2. provider_review_queue
-- ---------------------------------------------------------------------------
-- Operations queue over provider_applications for the three active statuses.
-- Ordered by submitted_at ascending so the oldest submission is first (FIFO).
--
-- This view is service-oriented: no security_invoker means it runs as the
-- definer (service role), bypassing RLS. Authenticated applicants see only
-- their own row via my_application; this view exposes the full queue to ops.
-- Grant select to service_role only.

drop view if exists public.provider_review_queue;

create view public.provider_review_queue as
  select *
  from   public.provider_applications
  where  status in ('submitted', 'under_review', 'needs_info')
  order  by submitted_at asc nulls last;

comment on view public.provider_review_queue is
  'Operations queue over provider_applications for submitted / under_review / '
  'needs_info statuses, oldest-first. Service-role only. '
  'Authenticated applicants read their own application via my_application. (ADR-0021)';

revoke all on public.provider_review_queue from anon, authenticated;
grant select on public.provider_review_queue to service_role;

-- ---------------------------------------------------------------------------
-- Part B — provider_earnings view rebuild
-- ---------------------------------------------------------------------------
-- The message-era view (migration 006) counted billable_messages and
-- conversations against messages + conversations. Those columns are retired
-- now that billing is per-minute via paid_sessions. (ADR-0021)
--
-- The new view aggregates from provider_earnings_ledger joined to paid_sessions
-- for the calling provider. It always returns exactly one aggregate row (no
-- GROUP BY), with zeros when there are no ledger rows.
--
-- Refunded ledger rows (status = 'refunded') are excluded so the totals
-- reflect net earned, not gross before reversal.

drop view if exists public.provider_earnings;

-- Seed from a single-row CTE so a provider with no ledger still gets one row of
-- zeros. A bare FROM ledger JOIN would return zero rows and force every client
-- to special-case null vs {0,0,…}.
create view public.provider_earnings
with (security_invoker = true) as
  with me as (select auth.uid() as uid)
  select
    coalesce(sum(l.minutes_billed), 0)::bigint          as minutes_billed,
    coalesce(sum(l.provider_tokens), 0)::bigint         as provider_tokens,
    coalesce(sum(l.gross_tokens), 0)::bigint            as gross_tokens,
    count(l.id)::bigint                                 as sessions,
    count(distinct ps.member_id)::bigint                as members_served,
    min(l.created_at)                                   as first_earned_at
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
  'migration 038. (ADR-0021)';

grant select on public.provider_earnings to authenticated;

-- ---------------------------------------------------------------------------
-- Part C — public avatars bucket (documented in 013, never created there)
-- ---------------------------------------------------------------------------
-- Seed and FEATURES.md already assume a public `avatars` bucket. Providers
-- upload `{user_id}/…`; anyone may read. Gated on storage.buckets existing so
-- pgTAP (no storage schema) still applies cleanly.

do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'avatars',
    'avatars',
    true,
    5 * 1024 * 1024,
    array['image/jpeg', 'image/png', 'image/webp']
  )
  on conflict (id) do nothing;

  -- Own folder only. Path: {auth.uid()}/filename.
  drop policy if exists "Providers upload own avatar" on storage.objects;
  create policy "Providers upload own avatar"
    on storage.objects for insert to authenticated
    with check (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = auth.uid()::text
    );

  drop policy if exists "Providers update own avatar" on storage.objects;
  create policy "Providers update own avatar"
    on storage.objects for update to authenticated
    using (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = auth.uid()::text
    );

  drop policy if exists "Providers delete own avatar" on storage.objects;
  create policy "Providers delete own avatar"
    on storage.objects for delete to authenticated
    using (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = auth.uid()::text
    );

  drop policy if exists "Public read avatars" on storage.objects;
  create policy "Public read avatars"
    on storage.objects for select to public
    using (bucket_id = 'avatars');
end;
$$;
