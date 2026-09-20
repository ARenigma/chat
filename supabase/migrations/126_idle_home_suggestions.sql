-- ===========================================================================
-- 126  Idle-home provider suggestion campaign (Amit, 2026-09-20)
-- ===========================================================================
--
-- When a member idles on the Home screen for 10 seconds, the app shows up to
-- three sequential "Ravi is calling"-style prompts, one from each of three
-- distinct available providers, 10 seconds apart.
--
-- Design choices (confirmed by Amit 2026-09-20):
--   - No daily cap.
--   - No provider opt-in (any available, unblocked, non-busy provider qualifies).
--   - Copy says "Ravi is calling" even though Ravi did not initiate it.
--   - Three unique providers per campaign; stop if fewer than three qualify.
--   - Provider decline or 30-second timeout → member returns Home.
--   - Feature flag: HOME_SUGGESTIONS_ENABLED (compile-time, off by default).
--   - Accept creates a real provider connection request and push.
--   - Billing/session creation waits for provider acceptance.
--
-- Table `home_suggestion_campaigns` records shown/accepted/declined/expired
-- outcomes so the behavior is observable even without a cap.
-- ---------------------------------------------------------------------------

create table if not exists public.home_suggestion_campaigns (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.profiles(id) on delete cascade,
  provider_id   uuid not null references public.profiles(id) on delete cascade,
  prompt_number smallint not null check (prompt_number between 1 and 3),
  shown_at      timestamptz not null default now(),
  outcome       text not null default 'shown'
                check (outcome in ('shown','accepted','declined','expired')),
  conversation_id uuid,
  created_at    timestamptz not null default now()
);

comment on table public.home_suggestion_campaigns is
  'Idle-home prompt outcomes (126). No cap; every outcome is recorded so '
  'volume is observable. Never exposes provider counts to the member.';

create index if not exists hsc_member_idx on public.home_suggestion_campaigns (member_id, shown_at);
create index if not exists hsc_provider_idx on public.home_suggestion_campaigns (provider_id, shown_at);

alter table public.home_suggestion_campaigns enable row level security;

create policy "Members read own campaigns"
  on public.home_suggestion_campaigns for select
  using (member_id = auth.uid());

-- ---------------------------------------------------------------------------
-- get_home_suggestions — return up to 3 distinct providers for one campaign
-- ---------------------------------------------------------------------------
-- Returns the whole batch at once so the client can pre-load avatars and names
-- before showing the first prompt. The app shows them one at a time, 10 s apart.
--
-- Excludes:
--   • the member themselves
--   • blocked pairs
--   • providers who have an active or ringing call
--   • providers already shown to this member in the last 2 hours
-- ---------------------------------------------------------------------------

create or replace function public.get_home_suggestions()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_rows  jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  -- Only members get prompts.
  if not exists (
    select 1 from public.profiles where id = v_uid and role = 'member'
  ) then
    return '[]'::jsonb;
  end if;

  -- Member must have enough balance for at least 1 minute at the chat rate.
  if not exists (
    select 1 from public.profiles p
    cross join (
      select (payload->>'tokens_per_minute_chat')::integer as rate
      from admin.config_active where domain = 'economics'
    ) ec
    where p.id = v_uid
      and p.token_balance >= coalesce(ec.rate, 22)
  ) then
    return '[]'::jsonb;
  end if;

  -- Pick up to 3 distinct available providers.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'provider_id',  pd.id,
        'display_name', pd.display_name,
        'avatar_url',   pd.avatar_url,
        'headline',     pd.headline
      )
    ),
    '[]'::jsonb
  )
  into v_rows
  from (
    select pd.id, pd.display_name, pd.avatar_url, pd.headline
    from   public.provider_directory pd
    where  pd.is_available = true
      and  pd.id <> v_uid
      -- No active or ringing call for this provider.
      and  not exists (
             select 1 from public.calls c
             where  (c.caller_id = pd.id or c.callee_id = pd.id)
               and  c.status in ('ringing', 'active')
           )
      -- No active paid session.
      and  not exists (
             select 1 from public.paid_sessions ps
             where  ps.provider_id = pd.id
               and  ps.status in ('pending_leases','active','warning','grace')
           )
      -- Not blocked in either direction.
      and  not public.is_blocked_pair(v_uid, pd.id)
      -- Not shown to this member in the last 2 hours.
      and  not exists (
             select 1 from public.home_suggestion_campaigns hsc
             where  hsc.member_id = v_uid
               and  hsc.provider_id = pd.id
               and  hsc.shown_at   > now() - interval '2 hours'
           )
    order by random()
    limit 3
  ) pd;

  return v_rows;
end;
$$;

comment on function public.get_home_suggestions() is
  'Return up to 3 distinct available providers for an idle-home campaign (126). '
  'No daily cap. Called once at idle; client shows providers one per 10 s.';

revoke all on function public.get_home_suggestions() from public, anon;
grant execute on function public.get_home_suggestions() to authenticated;

-- ---------------------------------------------------------------------------
-- record_suggestion_outcome — log what happened to each prompt
-- ---------------------------------------------------------------------------

create or replace function public.record_suggestion_outcome(
  p_provider_id   uuid,
  p_prompt_number smallint,
  p_outcome       text,
  p_conversation_id uuid default null
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.home_suggestion_campaigns (
    member_id, provider_id, prompt_number, outcome, conversation_id
  )
  values (
    auth.uid(), p_provider_id, p_prompt_number, p_outcome, p_conversation_id
  )
  on conflict do nothing;
end;
$$;

comment on function public.record_suggestion_outcome(uuid, smallint, text, uuid) is
  'Record the outcome of a home suggestion prompt (126). Idempotent.';

revoke all on function public.record_suggestion_outcome(uuid, smallint, text, uuid) from public, anon;
grant execute on function public.record_suggestion_outcome(uuid, smallint, text, uuid) to authenticated;
