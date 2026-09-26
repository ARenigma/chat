-- pgTAP for 153: the exact set of functions a client can call, in both
-- directions, and the default that keeps the next one closed.
--
-- WHAT THIS IS GUARDING:
--
--   * Supabase's default privileges grant EXECUTE on every new public function
--     to anon and authenticated by name. A server function that revoked from
--     PUBLIC only was callable by every client, and on 2026-09-25 that
--     included the wallet writers and provider approval (143, 153). 563's
--     sweeps cover functions revoked from PUBLIC. This suite covers
--     everything: a function that never revoked from PUBLIC is callable too.
--   * The inventory is exact. A function that gains a client grant fails
--     1 or 3. A client RPC that loses its grant fails 2 or 4. That happens
--     when a drop-and-create meets 153's closed default, and it breaks the
--     app with "permission denied", so it is caught here rather than on a
--     device. A new client RPC is added to the list on purpose, with its
--     grant.
--   * No trigger function is callable (5), and closing them did not stop a
--     client's write from firing one (6, 7).
--   * The three functions revoked live by hand on 2026-09-25 stay closed (8).
--   * get_active_config serves the domains a client reads and refuses every
--     other one (9-11).
--   * A function created after 153 has no by-name grant to anon or
--     authenticated, and service_role keeps its grant (12).

\set ON_ERROR_STOP on
begin;
select plan(12);

create temporary table expected_callable (role text, proname text) on commit drop;

-- Signed out. CHECK-constraint helpers on rows a client writes, and the
-- signed-out config read.
insert into expected_callable (role, proname)
select 'anon', unnest(array[
  'expertise_list_is_sane', 'get_public_config', 'language_list_is_sane',
  'voice_peaks_ok']);

-- Signed in. The app's RPCs, the story RPCs whose client is next, and the
-- helpers RLS policies, security_invoker views and CHECK constraints call
-- with the client's rights.
insert into expected_callable (role, proname)
select 'authenticated', unnest(array[
  'accept_policy', 'accept_session_request', 'announce_chat_open', 'answer_call',
  'block_story_comment_author', 'block_story_commenter', 'block_target_known_to_me',
  'check_display_name', 'claim_daily_tokens', 'claim_member_profile',
  'claim_session_lease', 'complete_provider_onboarding', 'confirm_chat_session',
  'create_session_request', 'create_story', 'decline_session_request',
  'delete_message', 'delete_story_comment', 'delete_user_account', 'edit_message',
  'end_call', 'end_session', 'expertise_list_is_sane', 'get_active_config',
  'get_active_session', 'get_chat_consent', 'get_home_suggestions',
  'get_my_favorites', 'get_pending_session_request', 'get_provider_ratings',
  'get_public_config', 'get_usage_ledger', 'get_video_switch_quote',
  'heartbeat_call', 'insert_next_opener', 'language_list_is_sane',
  'mark_story_viewed', 'member_handle', 'mock_recharge',
  'my_first_recharge_discount_bps', 'my_story_insights', 'open_conversation',
  'pending_policy_acceptances', 'post_story_comment', 'provider_is_listed',
  'public_display_name', 'react_to_story_comment', 'record_call_quality_samples',
  'record_suggestion_outcome', 'register_push_token', 'report_story',
  'report_story_comment', 'request_media_upgrade', 'respond_media_upgrade',
  'resume_chat_consent', 'send_message', 'send_message_idempotent',
  'set_conversation_name', 'set_member_age_bracket', 'set_my_pan',
  'set_next_call_media_backend', 'set_provider_expertise',
  'shares_conversation_with_me', 'spend_chat_minute', 'start_call',
  'story_comment_is_visible', 'story_is_visible', 'story_media_upload_allowed',
  'story_reaction_counts', 'story_text_has_control', 'story_text_line_breaks',
  'story_text_trim', 'story_viewers', 'submit_provider_application',
  'submit_report', 'submit_review', 'submit_session_review', 'toggle_favorite',
  'toggle_reaction', 'toggle_story_reaction', 'touch_presence',
  'unblock_by_handle', 'unregister_push_token', 'upsert_my_payout_account',
  'voice_peaks_ok']);

-- Every public function a role can execute, extension functions aside (pgTAP
-- here, whatever the platform installs live).
create temporary view actual_callable as
select r.role, p.proname::text as proname
from pg_proc p
cross join (values ('anon'), ('authenticated')) as r(role)
where p.pronamespace = 'public'::regnamespace
  and p.prokind in ('f', 'p')
  and not exists (
    select 1 from pg_depend d
    where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  and has_function_privilege(r.role, p.oid, 'EXECUTE');

-- ── The inventory ──────────────────────────────────────────────────────────
select is(
  (select string_agg(distinct proname, ',' order by proname) from (
     select proname from actual_callable where role = 'anon'
     except select proname from expected_callable where role = 'anon') x),
  null,
  '1. nothing outside the list is callable signed out'
);
select is(
  (select string_agg(distinct proname, ',' order by proname) from (
     select proname from expected_callable where role = 'anon'
     except select proname from actual_callable where role = 'anon') x),
  null,
  '2. everything on the signed-out list is still callable'
);
select is(
  (select string_agg(distinct proname, ',' order by proname) from (
     select proname from actual_callable where role = 'authenticated'
     except select proname from expected_callable where role = 'authenticated') x),
  null,
  '3. nothing outside the list is callable signed in'
);
select is(
  (select string_agg(distinct proname, ',' order by proname) from (
     select proname from expected_callable where role = 'authenticated'
     except select proname from actual_callable where role = 'authenticated') x),
  null,
  '4. every client RPC on the list is still callable signed in'
);

-- ── Trigger functions ──────────────────────────────────────────────────────
select is(
  (select string_agg(p.proname, ',' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  null,
  '5. no trigger function is callable by a client'
);

-- A client's own write still fires an invoker trigger, which now runs as a
-- role with no EXECUTE on it. guard_privileged_profile_columns is invoker and
-- refuses a client-written role, so the refusal proves it ran.
insert into auth.users (id) values ('d5680000-0000-4568-8000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"d5680000-0000-4568-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ update public.profiles set role = 'provider'
     where id = 'd5680000-0000-4568-8000-000000000001' $$,
  '42501',
  'profiles.role is not client-writable',
  '6. an invoker trigger still fires on a client write, and still refuses'
);
select lives_ok(
  $$ update public.profiles set preferred_languages = array['en']
     where id = 'd5680000-0000-4568-8000-000000000001' $$,
  '7. and a permitted client write passes through the same triggers'
);

-- ── The 2026-09-25 hotfix ──────────────────────────────────────────────────
reset role;
select is(
  (select string_agg(p.proname, ',' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('get_session_billing_snapshot', 'accrue_ended_paid_session',
                       'purge_expired_reports')
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  null,
  '8. the three functions closed by hand on 2026-09-25 stay closed (153)'
);

-- ── get_active_config ──────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"d5680000-0000-4568-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ select public.get_active_config(d)
     from unnest(array['economics', 'recharge', 'wallet', 'thresholds',
                       'report_taxonomy']) d $$,
  '9. a signed-in client reads every domain the app asks for'
);
select throws_ok(
  $$ select public.get_active_config('media_cogs') $$,
  '42501',
  null,
  '10. and not the media cost domain, which no client reads'
);
select throws_ok(
  $$ select public.get_active_config('a_domain_published_later') $$,
  '42501',
  null,
  '11. nor a domain published after 153'
);

-- ── The default ────────────────────────────────────────────────────────────
reset role;
create function public.probe_568_default_grants() returns integer
language sql as 'select 1';

select is(
  (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text)
   from pg_proc p, aclexplode(p.proacl) a
   where p.oid = 'public.probe_568_default_grants()'::regprocedure
     and a.grantee <> 0
     and a.grantee::regrole::text in ('anon', 'authenticated', 'service_role')),
  array['service_role'],
  '12. a function created after 153 is granted to service_role by name and not to anon or authenticated'
);

select * from finish();
rollback;
