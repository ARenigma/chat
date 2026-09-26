-- 170: an account deletion ends every live session, including one that
-- started while the deletion was taking its locks.
--
-- 150 gave delete_user_account a lock prologue: the caller's live sessions
-- FOR UPDATE (v_locked), then every profile it will touch FOR UPDATE in id
-- order, then end_session on each of v_locked. The profile lock re-derived
-- "the other side of each live session" with a second, independent query,
-- and in READ COMMITTED each statement takes its own snapshot. A session
-- that committed between the two statements, or while the profile lock
-- waited on a row somebody else held, was in the second query and not in
-- v_locked: its counterpart's profile was locked, and the session was never
-- ended. The delete of auth.users then reached it through the SET NULL of
-- 100 while it was still live, and paid_sessions_live_rows_are_identified
-- (100) refused that (23514): the session was not left anonymous, but the
-- person's "Delete account" failed on a constraint error for a session the
-- function exists to end first.
--
-- Nothing can start a session for the caller once the caller's profile is
-- held FOR UPDATE: paid_sessions.member_id and provider_id reference
-- profiles, and the foreign key check of an insert takes FOR KEY SHARE on
-- the row, which waits for FOR UPDATE (and then fails, the profile gone). So
-- the prologue now:
--
--   1. locks the live sessions, as before;
--   2. locks the profiles of exactly those sessions and the caller's own,
--      derived from v_locked rather than read again;
--   3. asks, in a new statement and so a new snapshot taken with the
--      caller's profile held, whether any live session is missing from
--      v_locked. One that is started in the gap.
--
-- A gap session cannot simply be locked then: that would take a session
-- after profiles, the reverse of the order end_session and
-- meter_active_sessions take (a session, then its member's profile), which
-- is the deadlock 150 exists to remove. So the attempt is undone instead:
-- steps 1-3 run in a block with an exception handler, which is a
-- subtransaction, and raising out of it releases the row locks it took
-- ("if a lock is acquired after establishing a savepoint, the lock is
-- released immediately if the savepoint is rolled back to"). The next
-- attempt's step 1 sees the new session and locks it in order. Sessions do
-- not start for one account faster than a millisecond apart, so a second
-- attempt is the most any deletion should need; after three, it refuses
-- with serialization_failure (40001), the code a client already treats as
-- "try again", rather than delete around a session it could not end.
-- https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-ROWS
-- https://www.postgresql.org/docs/16/plpgsql-control-structures.html#PLPGSQL-ERROR-TRAPPING
--
-- Steps 1-4 of 150's body are unchanged. CREATE OR REPLACE keeps the grant
-- (002, 028, 100, 150); it is a client RPC and stays in 568's list.
create or replace function public.delete_user_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchased  integer;
  v_tx_id      uuid;
  v_session_id uuid;
  v_locked     uuid[];
  v_attempt    integer := 0;
begin
  -- 0. The lock order (150): the live sessions, then every profile, and no
  --    live session left out of the first (170, above).
  loop
    v_attempt := v_attempt + 1;
    begin
      select coalesce(array_agg(id order by created_at), '{}')
      into   v_locked
      from (
        select id, created_at
        from   public.paid_sessions
        where  (member_id = auth.uid() or provider_id = auth.uid())
          and  status not in ('ended', 'reported_hold')
        order  by created_at
        for update
      ) s;

      -- The other side of each session just locked, never of a session read
      -- again: a second read can see one that the lock above did not take.
      perform 1
      from   public.profiles p
      where  p.id = auth.uid()
         or  p.id in (
               select case when ps.member_id = auth.uid() then ps.provider_id else ps.member_id end
               from   public.paid_sessions ps
               where  ps.id = any(v_locked))
      order  by p.id
      for update;

      -- A new statement, so a snapshot taken with the caller's profile held:
      -- every session that will ever exist for the caller is visible now.
      if exists (
        select 1
        from   public.paid_sessions ps
        where  (ps.member_id = auth.uid() or ps.provider_id = auth.uid())
          and  ps.status not in ('ended', 'reported_hold')
          and  not (ps.id = any(v_locked))
      ) then
        raise exception 'a paid session started while the deletion took its locks'
          using errcode = 'P0011';
      end if;
      exit;
    exception when sqlstate 'P0011' then
      if v_attempt >= 3 then
        raise exception 'delete_user_account: a paid session keeps starting, try again'
          using errcode = '40001';
      end if;
    end;
  end loop;

  -- 1. End anything still running. 'system' is an accepted end_reason (091).
  --    end_session's own participant check passes because the caller IS a
  --    participant — this runs before auth.uid()'s profile is gone.
  foreach v_session_id in array v_locked loop
    perform public.end_session(v_session_id, 'system', null, null, null);
  end loop;

  -- 2. Freeze any purchased balance as an account_close_hold ledger entry and
  --    queue it for admin refund review before the cascade removes the rows.
  select purchased_balance
  into   v_purchased
  from   public.profiles
  where  id = auth.uid();

  if v_purchased > 0 then
    insert into public.token_transactions (
      user_id, kind, status, amount_paise, tokens_delta
    ) values (
      auth.uid(), 'account_close_hold', 'created',
      v_purchased * 100, -v_purchased
    )
    returning id into v_tx_id;

    insert into public.refund_reviews (
      user_id, transaction_id, purchased_tokens, amount_paise
    ) values (
      auth.uid(), v_tx_id, v_purchased, v_purchased * 100
    );
  end if;

  -- 3. The caller's story rows, by hand and before the cascade, in the order
  --    every other story path takes them (150, section 6).
  delete from public.stories where provider_id = auth.uid();
  delete from public.story_views where viewer_id = auth.uid();
  delete from public.story_reactions where member_id = auth.uid();
  delete from public.story_comments where author_id = auth.uid();

  -- 4. auth.users → profiles → conversations / messages / leases / requests
  --    cascade; paid_sessions and the billing ledgers are anonymised in place.
  --    The refund_reviews row cascades via transaction_id.
  delete from auth.users where id = auth.uid();
end;
$$;

comment on function public.delete_user_account() is
  'Deletes the caller''s account (002, 028, 100, 150, 170). Locks its live '
  'sessions and then every profile they touch in id order, the order a story '
  'report takes (150), and retries the prologue when a session started in '
  'between (170), so every live session is ended and none is left active '
  'with a NULL participant; freezes purchased balance for refund review, '
  'deletes its own stories, views, reactions and comments in a story '
  'delete''s lock order, then deletes auth.users and lets the FK rules run: '
  'session mechanics cascade, billing records are anonymised.';
