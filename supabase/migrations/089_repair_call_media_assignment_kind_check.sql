-- ===========================================================================
-- 089  Re-assert 057's calls_media_assignment_kind_check — calls are down
-- ===========================================================================
-- Found on a real device, 2026-09-08, while answering "check if all
-- chats/calls/video calls are operational". They were not: EVERY outgoing call
-- failed at the insert, and the screen blamed the network.
--
--   code    23514
--   message new row for relation "calls" violates check constraint
--           "calls_media_assignment_kind_check"
--   row     (..., voice, ringing, ..., agora, agora-default, null, default)
--
-- The member saw "Could not start just now. Check your connection." — which is
-- what CallScreen says when `start_call` returns no error code at all
-- (CallScreen.tsx, the `else` arm of the start effect). A schema violation
-- wearing a connectivity message is why this survived: nobody debugs their
-- wifi and finds a check constraint.
--
-- ---------------------------------------------------------------------------
-- WHAT IS ACTUALLY WRONG — DRIFT, NOT CODE
-- ---------------------------------------------------------------------------
-- Migration 057 does two things that must travel together:
--
--   1. widens the constraint    sticky|harness  ->  sticky|harness|default
--   2. replaces the trigger     assign_call_media_backend, which now writes
--                               media_assignment_kind := 'default'
--
-- The live database has (2) and not (1). The failing row proves it: the value
-- being rejected is `default`, and only 057's trigger writes that word. So the
-- deployed trigger writes a value the deployed constraint forbids, and the two
-- halves of one migration are on different sides of the fence.
--
-- git is CORRECT and unchanged — 057 in this repo does both. Nothing in the
-- application needs fixing. This is purely the live schema having lost half of
-- an applied migration, which `supabase db push` will never repair on its own:
-- 057 is recorded as applied, so it is never re-run. Only a NEW migration
-- reaches the database, which is what this file is.
--
-- ---------------------------------------------------------------------------
-- WHY IT IS SAFE TO RUN ANYWHERE
-- ---------------------------------------------------------------------------
-- Every statement is idempotent and re-states 057's intent exactly. On a
-- database where 057 landed whole this is a no-op that drops and re-creates an
-- identical constraint; on the drifted one it is the repair. It does not widen
-- the contract beyond 057 — the three permitted kinds are unchanged, and
-- `harness` stays distinguishable from `default` in QoE evidence, which is the
-- reason 057 gave for having a third kind at all.
--
-- The column defaults are re-asserted for the same reason: they are the other
-- DDL half of 057, they cost nothing to repeat, and an insert that bypasses the
-- trigger should not be the thing that finds out they went missing too.
-- ---------------------------------------------------------------------------

alter table public.calls
  drop constraint if exists calls_media_assignment_kind_check;

alter table public.calls
  add constraint calls_media_assignment_kind_check
  check (media_assignment_kind in ('sticky', 'harness', 'default'));

alter table public.calls
  alter column media_backend set default 'agora';

alter table public.calls
  alter column media_assignment_kind set default 'default';

comment on constraint calls_media_assignment_kind_check on public.calls is
  '057, re-asserted by 089. Three kinds: sticky (052 A/B), harness (an explicit '
  'override via set_next_call_media_backend) and default (ordinary production '
  'assignment, written by assign_call_media_backend). 089 exists because the '
  'live database had 057''s trigger writing "default" while still carrying '
  '052''s narrower constraint, which rejected every outgoing call at insert.';
