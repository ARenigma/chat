-- ===========================================================================
-- 159  The contact guard's human side: the review queues, resolving a row,
--      and a strike from a reported story's media
-- ===========================================================================
-- The ladder (157) sends two kinds of account to a person:
--   * removal_review: a provider at strike 3 ("goes to review for removal");
--   * human_review:   anyone at strike 5 ("suspension or ban").
-- scripts/moderate.mjs reads the queue and resolves rows through the two
-- functions below, with the service role, the way it already resolves
-- reports. Every resolution is written to moderation_actions first, so an
-- enforcement never exists without a record of who ordered it (005).
--
-- Story media gets no automated pre-check (owner, 2026-09-25): reports and
-- strikes only. contact_guard_strike_from_report is that strike: a moderator
-- who finds a phone number or a QR code in a reported story's photo or video
-- adds a strike to its provider, and the ladder runs as for any other.
--
-- A moderator's strike counts whatever the mode, because a person decided
-- it; the pause it can lead to is enforced by the gate only in enforce mode,
-- and the directory hiding (158) applies in every mode.
--
-- Nothing here is callable by a client: every function is revoked from
-- PUBLIC, anon and authenticated and granted to service_role only, and the
-- queue view is service role only. 568's inventory lists client-callable
-- functions, so it is unchanged.

-- ---------------------------------------------------------------------------
-- 1. The queue
-- ---------------------------------------------------------------------------
create or replace view public.contact_guard_review_queue
with (security_invoker = true) as
  select
    r.user_id,
    p.role::text                       as role,
    p.display_name,
    r.review_state,
    r.review_requested_at,
    (select count(*)::int from public.contact_guard_strikes s
     where s.user_id = r.user_id and s.voided_at is null and s.expires_at > now())
                                       as active_strikes,
    r.paused_until,
    r.directory_hidden_until,
    p.suspended_until,
    (select max(e.created_at) from public.contact_guard_events e
     where e.user_id = r.user_id)      as last_event_at,
    (select array_agg(distinct e.category) from public.contact_guard_events e
     where e.user_id = r.user_id and e.outcome = 'blocked' and e.category is not null)
                                       as categories
  from public.contact_guard_restrictions r
  join public.profiles p on p.id = r.user_id
  where r.review_state is not null;

comment on view public.contact_guard_review_queue is
  'Accounts the contact-guard ladder sent to a person (157): removal_review, '
  'a provider at strike 3; human_review, anyone at strike 5. Service role '
  'only; scripts/moderate.mjs contacts reads it (159).';

revoke all on public.contact_guard_review_queue from public, anon, authenticated;
grant select on public.contact_guard_review_queue to service_role;

-- ---------------------------------------------------------------------------
-- 2. Resolving a row
-- ---------------------------------------------------------------------------
-- clear   no further action: the row leaves the queue, strikes stay and
--         expire on their own 90 days;
-- suspend suspended_until = now + p_days (send_message, calls and stories
--         already honour it);
-- ban     suspended_until in 2999, the same "suspension with no end" act uses
--         (moderate.mjs), so there is one enforcement path.
-- For a provider in removal_review, removal is `ban` (or `suspend`): the
-- directory and every provider path already exclude a suspended account.
create or replace function public.contact_guard_resolve_review(
  p_user_id uuid,
  p_action  text,
  p_days    integer default null,
  p_actor   text    default null,
  p_note    text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_state text;
  v_until timestamptz;
  v_audit text;
begin
  if p_action not in ('clear', 'suspend', 'ban') then
    raise exception 'action must be clear, suspend or ban' using errcode = '22023';
  end if;
  if p_action = 'suspend' and (p_days is null or p_days <= 0) then
    raise exception 'suspend needs p_days > 0' using errcode = '22023';
  end if;

  select review_state into v_state
  from public.contact_guard_restrictions
  where user_id = p_user_id
  for update;
  if v_state is null then
    raise exception 'no contact-guard review is open for %', p_user_id using errcode = 'P0002';
  end if;

  v_audit := case p_action when 'clear' then 'none' when 'suspend' then 'suspended' else 'banned' end;
  v_until := case p_action
    when 'suspend' then now() + make_interval(days => p_days)
    when 'ban' then timestamptz '2999-01-01 00:00:00+00'
  end;

  -- The audit row first (005's rule).
  insert into public.moderation_actions (report_id, subject_user_id, action, actor, note)
  values (null, p_user_id, v_audit, coalesce(p_actor, 'ops:unknown'),
          'contact_guard ' || v_state || ': ' || p_action || coalesce(' | ' || p_note, ''));

  if v_until is not null then
    update public.profiles
    set suspended_until = greatest(coalesce(suspended_until, v_until), v_until)
    where id = p_user_id;
  end if;

  update public.contact_guard_restrictions
  set review_state = null, review_requested_at = null, updated_at = now()
  where user_id = p_user_id;

  return jsonb_build_object('user_id', p_user_id, 'was', v_state, 'action', p_action,
                            'suspended_until', v_until);
end;
$$;

comment on function public.contact_guard_resolve_review(uuid, text, integer, text, text) is
  'Resolve a contact-guard review row: clear, suspend (p_days) or ban, '
  'audited in moderation_actions first. Service role only (159).';

revoke all on function public.contact_guard_resolve_review(uuid, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.contact_guard_resolve_review(uuid, text, integer, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. A strike from a reported story's media
-- ---------------------------------------------------------------------------
-- Once per report: a second call answers with the first strike's event and
-- writes nothing, so a retried command cannot strike twice.
create or replace function public.contact_guard_strike_from_report(
  p_report_id uuid,
  p_actor     text default null,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_report public.reports%rowtype;
  v_prior  uuid;
  v_mode   text;
  v_log    jsonb;
begin
  select * into v_report from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'no report %', p_report_id using errcode = 'P0002';
  end if;
  if v_report.evidence_surface is distinct from 'story' or v_report.story_id is null then
    raise exception 'report % is not a story report', p_report_id using errcode = '22023';
  end if;
  if v_report.subject_user_id is null then
    raise exception 'the reported provider''s account is gone' using errcode = 'P0002';
  end if;

  select id into v_prior from public.contact_guard_events
  where row_ref = p_report_id and surface = 'story_media' and tier = 'report';
  if found then
    return jsonb_build_object('event_id', v_prior, 'already', true);
  end if;

  insert into public.moderation_actions (report_id, subject_user_id, action, actor, note)
  values (p_report_id, v_report.subject_user_id, 'warned', coalesce(p_actor, 'ops:unknown'),
          'contact_guard strike from story media' || coalesce(' | ' || p_note, ''));

  v_mode := case when private.contact_guard_mode() = 'enforce' then 'enforce' else 'shadow' end;
  v_log := private.contact_guard_log(
    v_report.subject_user_id, 'story_media', 'media',
    jsonb_build_object('story_id', v_report.story_id, 'row_ref', p_report_id),
    'report', 'blocked', v_mode, array['moderator'], null, null,
    coalesce(v_report.evidence_story_media_path, v_report.story_id::text),
    null, true);

  return v_log || jsonb_build_object('already', false);
end;
$$;

comment on function public.contact_guard_strike_from_report(uuid, text, text) is
  'A moderator''s contact-guard strike against the provider of a reported '
  'story (its media held a contact detail). Once per report; audited in '
  'moderation_actions; runs the 157 ladder. Service role only (159).';

revoke all on function public.contact_guard_strike_from_report(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.contact_guard_strike_from_report(uuid, text, text)
  to service_role;
