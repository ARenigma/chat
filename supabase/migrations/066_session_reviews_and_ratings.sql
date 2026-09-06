-- ===========================================================================
-- 066  A review per session, and the ratings a member reads before spending
-- ===========================================================================
-- Goal items 14 and 10 (Amit, 2026-09-05): a star rating after every
-- disconnect, and a ratings breakdown on the provider's page. Decided
-- 2026-09-06: PER SESSION, and every rating counts toward the average — a
-- member who comes back five times has five opinions, and the distribution
-- chart is only worth drawing if it reflects real volume.
--
-- `public.reviews` has existed since 006 (1..5, an optional comment, a trigger
-- that recomputes profiles.rating_avg / rating_count) but nothing has ever
-- called it: `useSubmitReview` is wired in src/api/provider.ts and no screen
-- mounts it. So this is not a new table, it is the missing granularity and the
-- missing read.
--
-- ---------------------------------------------------------------------------
-- Uniqueness, which is the whole design
-- ---------------------------------------------------------------------------
-- 006 put `unique` on conversation_id: one review per thread, ever. Per-session
-- means many rows per thread, so that constraint has to go — but it is the only
-- thing stopping a member from writing the same conversation's reputation
-- twice, and `submit_review` (which pgTAP 050 and 060 both pin, including its
-- upsert) depends on it.
--
-- So it becomes two PARTIAL unique indexes, which keep the old invariant
-- exactly where it still applies:
--
--   session_id is not null  → one review per session
--   session_id is null      → one review per conversation (the legacy shape,
--                             for any row written before this migration)
--
-- and `submit_review` is re-stated to rate the conversation's LATEST session,
-- so its old contract ("you had a conversation, you may rate it, twice means
-- you changed your mind") survives unchanged.

alter table public.reviews
  add column if not exists session_id uuid
    references public.paid_sessions(id) on delete set null;

comment on column public.reviews.session_id is
  'The paid session being rated (066). Null only for rows written before this '
  'migration, when a review belonged to the whole conversation. Every non-null '
  'value counts toward profiles.rating_avg: a member who returns five times '
  'has five opinions (Amit, 2026-09-06).';

-- Drop 006's column-level unique by discovering its name: it was written as an
-- inline `unique`, so the name is Postgres's and not ours to hardcode.
do $$
declare
  v_name text;
begin
  select con.conname into v_name
  from   pg_constraint con
  where  con.conrelid = 'public.reviews'::regclass
    and  con.contype  = 'u'
    and  con.conkey    = array[
           (select attnum from pg_attribute
            where attrelid = 'public.reviews'::regclass and attname = 'conversation_id')
         ]::smallint[];
  if v_name is not null then
    execute format('alter table public.reviews drop constraint %I', v_name);
  end if;
end
$$;

create unique index if not exists reviews_one_per_session
  on public.reviews (session_id)
  where session_id is not null;

create unique index if not exists reviews_one_per_legacy_conversation
  on public.reviews (conversation_id)
  where session_id is null;

-- The distribution read below groups by rating for one provider.
create index if not exists reviews_provider_rating_idx
  on public.reviews (provider_id, rating);

-- ---------------------------------------------------------------------------
-- submit_session_review — the post-disconnect path
-- ---------------------------------------------------------------------------
create or replace function public.submit_session_review(
  p_session_id uuid,
  p_rating     smallint,
  p_comment    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_session public.paid_sessions%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be 1..5' using errcode = '22023';
  end if;

  select * into v_session from public.paid_sessions where id = p_session_id;
  if not found then
    raise exception 'no such session' using errcode = 'no_data_found';
  end if;

  -- Only the paying side reviews. A provider rating a member is a different
  -- feature with different consequences, and is not this one (006's rule).
  if v_uid <> v_session.member_id then
    raise exception 'only the member may review' using errcode = '42501';
  end if;

  -- Rate it when it is over. A rating mid-session would be a live scoreboard
  -- between two people who are still talking.
  if v_session.status <> 'ended' then
    raise exception 'the session has not ended' using errcode = '22023';
  end if;

  insert into public.reviews (
    conversation_id, session_id, member_id, provider_id, rating, comment
  ) values (
    v_session.conversation_id, p_session_id, v_session.member_id,
    v_session.provider_id, p_rating, nullif(btrim(coalesce(p_comment, '')), '')
  )
  on conflict (session_id) where session_id is not null do update
    set rating = excluded.rating,
        comment = excluded.comment,
        created_at = now();
end;
$$;

comment on function public.submit_session_review(uuid, smallint, text) is
  'The member rates ONE ended session, 1..5 with an optional comment (066). '
  'Re-submitting corrects it rather than adding a second opinion. Every row '
  'counts toward the provider''s average via refresh_provider_rating.';

revoke all on function public.submit_session_review(uuid, smallint, text) from public, anon;
grant execute on function public.submit_session_review(uuid, smallint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- submit_review — 006's conversation-level entry point, kept working
-- ---------------------------------------------------------------------------
-- Re-stated from 006 with ONE behavioural change: it now attaches the review to
-- the conversation's most recent session rather than to the conversation. Its
-- contract is otherwise identical, which is what keeps pgTAP 050 and 060 honest
-- — including "submit twice and the average follows the second one", which now
-- works because both submissions resolve to the same session.
--
-- Deliberately NOT requiring an ended session: this is the lenient path 006
-- described ("you had a conversation, you may rate it"), and 050 rates a
-- session that is still live. submit_session_review above is the strict one.
create or replace function public.submit_review(
  p_conversation_id uuid,
  p_rating smallint,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_member uuid;
  v_provider uuid;
  v_messages integer;
  v_session uuid;
  v_existing uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be 1..5' using errcode = '22023';
  end if;

  select member_id, provider_id into v_member, v_provider
  from public.conversations where id = p_conversation_id;

  if v_member is null then
    raise exception 'no such conversation' using errcode = 'no_data_found';
  end if;
  -- Only the paying side reviews. A provider rating a member is a different
  -- feature with different consequences, and is not this one.
  if v_uid <> v_member then
    raise exception 'only the member may review' using errcode = '42501';
  end if;

  -- A review with nothing behind it is a rating-farming primitive.
  select count(*)::int into v_messages
  from public.messages where conversation_id = p_conversation_id;
  if v_messages < 2 then
    raise exception 'nothing to review yet' using errcode = '22023';
  end if;

  -- The latest session of this conversation, if it has one. Ordering by
  -- accepted_at matches get_active_session (037:737), so "latest" means the
  -- same thing in both places.
  select id into v_session
  from   public.paid_sessions
  where  conversation_id = p_conversation_id
  order  by accepted_at desc nulls last
  limit  1;

  -- Explicit find-then-write rather than ON CONFLICT: the uniqueness now lives
  -- in two partial indexes, and naming a conflict target that depends on which
  -- branch we are in reads far worse than this does.
  select id into v_existing
  from   public.reviews
  where  conversation_id = p_conversation_id
    and  member_id       = v_member
    and  (
      (v_session is not null and session_id = v_session)
      or (v_session is null and session_id is null)
    )
  limit 1;

  if v_existing is not null then
    update public.reviews
    set    rating     = p_rating,
           comment    = nullif(btrim(coalesce(p_comment, '')), ''),
           created_at = now()
    where  id = v_existing;
  else
    insert into public.reviews (
      conversation_id, session_id, member_id, provider_id, rating, comment
    ) values (
      p_conversation_id, v_session, v_member, v_provider, p_rating,
      nullif(btrim(coalesce(p_comment, '')), '')
    );
  end if;
end;
$$;

comment on function public.submit_review(uuid, smallint, text) is
  '006''s conversation-level review, re-stated in 066 to attach to the '
  'conversation''s LATEST session so per-session uniqueness holds. Lenient by '
  'design (no ended-session requirement); submit_session_review is the strict '
  'post-disconnect path.';

revoke all on function public.submit_review(uuid, smallint, text) from public, anon;
grant execute on function public.submit_review(uuid, smallint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_provider_ratings — what the member reads before spending (item 10)
-- ---------------------------------------------------------------------------
-- One RPC rather than a view, because the raw table must stay unreadable to
-- third parties: 006's RLS lets you read only reviews you are party to, which
-- is exactly right and also means a member cannot aggregate a stranger's
-- reputation for themselves. This returns the aggregate and the comments, and
-- never a member id — a five-star review is not a reason to publish who wrote it.
create or replace function public.get_provider_ratings(
  p_provider_id   uuid,
  p_recent_limit  integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_limit  integer := least(greatest(coalesce(p_recent_limit, 5), 1), 20);
  v_avg    numeric;
  v_count  integer;
  v_dist   jsonb;
  v_recent jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  -- Only for someone the directory publishes: a suspended or unverified
  -- provider is not a page a member can reach, so it is not a page to answer
  -- questions about either.
  if not exists (select 1 from public.provider_directory d where d.id = p_provider_id) then
    return null;
  end if;

  select p.rating_avg, p.rating_count into v_avg, v_count
  from   public.profiles p
  where  p.id = p_provider_id;

  -- Five rows, always, in 5..1 order: a chart that omits its empty bars
  -- redraws itself every time somebody rates, and a zero IS the information.
  select jsonb_agg(
           jsonb_build_object('stars', s.stars, 'count', coalesce(c.n, 0))
           order by s.stars desc
         )
  into   v_dist
  from   generate_series(1, 5) as s(stars)
  left join (
    select rating, count(*)::int as n
    from   public.reviews
    where  provider_id = p_provider_id
    group  by rating
  ) c on c.rating = s.stars;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'rating', r.rating,
               'comment', r.comment,
               'created_at', r.created_at
             )
             order by r.created_at desc
           ),
           '[]'::jsonb
         )
  into   v_recent
  from   (
    select rating, comment, created_at
    from   public.reviews
    where  provider_id = p_provider_id
      and  comment is not null
    order  by created_at desc
    limit  v_limit
  ) r;

  return jsonb_build_object(
    'provider_id', p_provider_id,
    'rating_avg',  v_avg,
    'rating_count', coalesce(v_count, 0),
    'distribution', coalesce(v_dist, '[]'::jsonb),
    'recent', v_recent
  );
end;
$$;

comment on function public.get_provider_ratings(uuid, integer) is
  'Aggregate reputation for one provider the directory publishes: average, '
  'count, a five-row 5..1 distribution (zeros included, so the chart does not '
  'reshape as ratings arrive) and the most recent comments. Never returns a '
  'member id. NULL for anyone not in provider_directory. Migration 066.';

revoke all on function public.get_provider_ratings(uuid, integer) from public, anon;
grant execute on function public.get_provider_ratings(uuid, integer) to authenticated;
