-- 006_phone_auth_and_provider_onboarding.sql
--
-- Two decisions and one research pass.
--
-- 1. Phone + OTP is the only identity. Anonymous sessions, Google, Facebook and
--    email all go. That is a real loss, "usable on the first frame, nothing to
--    fill in" was the product's sharpest differentiator, and it buys something
--    the safety work could not: a member who is banned cannot come back for the
--    price of a reinstall, because a phone number is scarce in a way a fresh
--    anonymous row is not. Suspension only means something if identity persists.
--
-- 2. Providers get real onboarding, with an age gate that is a constraint rather
--    than a checkbox.
--
-- Everything else here comes from reading the Clarity/WeHeal listing
-- (com.weheal.weheal, 10M+ installs) and, more usefully, its reviews. Each item
-- notes what it is a response to, because in six months "why is there a
-- median_reply_seconds column" will not be obvious. See docs/clarity-learnings.md.

-- ---------------------------------------------------------------------------
-- 1. Identity and the age gate
-- ---------------------------------------------------------------------------
-- Stored as a date, never exposed. The directory publishes an integer age
-- because "26" is what a member needs and a birth date is a re-identification
-- key we have no reason to hand out.
alter table public.profiles
  add column if not exists date_of_birth date,
  add column if not exists gender text
    check (gender is null or gender in ('female', 'male', 'other')),
  -- One line under the name in the directory. Clarity's rows carry one; ours
  -- carried only "Available now", which tells a member nothing about the person.
  add column if not exists headline text
    check (headline is null or length(btrim(headline)) between 1 and 140),
  add column if not exists languages text[] not null default '{}'::text[],
  -- Maintained by trigger from `reviews`. Denormalised deliberately: the
  -- directory is the hottest read in the app and it should not aggregate.
  add column if not exists rating_avg numeric(3, 2),
  add column if not exists rating_count integer not null default 0,
  -- The answer to the complaint that sank Clarity's rating: "the listener does
  -- not even reply". Published so it is the provider's problem, not a surprise.
  add column if not exists median_reply_seconds integer;

comment on column public.profiles.date_of_birth is
  'Never exposed to another user. The directory publishes a computed integer age.';

-- Any provider admitted before this migration was, by definition, never
-- age-verified, the column did not exist. They cannot be grandfathered in: the
-- whole point of the constraint is that there is no such thing as a provider of
-- unknown age. So they are demoted to member and must reapply through the
-- reviewed path, which now asks for a birth date.
--
-- Destructive, deliberately, and safe only because supply is one seeded test
-- account. Post-launch this would need an outreach window first.
update public.profiles
set role = 'member',
    identity_verified_at = null,
    is_available = false
where role = 'provider' and date_of_birth is null;

-- The age gate. A constraint, not a form field, so there is no route to an
-- underage provider, not through the app, not through the approval function,
-- not through a manual UPDATE by an operator in a hurry.
alter table public.profiles
  drop constraint if exists provider_is_adult;

alter table public.profiles
  add constraint provider_is_adult check (
    role <> 'provider'
    or (date_of_birth is not null and date_of_birth <= (current_date - interval '18 years'))
  );

-- Age is not client-writable once set. Otherwise the gate is a formality: an
-- applicant could pass review and then edit their birth date.
create or replace function public.guard_privileged_profile_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.role is distinct from old.role then
      raise exception 'profiles.role is not client-writable' using errcode = '42501';
    end if;
    if new.identity_verified_at is distinct from old.identity_verified_at then
      raise exception 'profiles.identity_verified_at is not client-writable'
        using errcode = '42501';
    end if;
    if new.token_balance is distinct from old.token_balance then
      raise exception 'profiles.token_balance is not client-writable'
        using errcode = '42501';
    end if;
    if new.suspended_until is distinct from old.suspended_until then
      raise exception 'profiles.suspended_until is not client-writable'
        using errcode = '42501';
    end if;
    -- Writable exactly once: null -> a value. After that it is fixed.
    if old.date_of_birth is not null
      and new.date_of_birth is distinct from old.date_of_birth then
      raise exception 'date of birth cannot be changed once set'
        using errcode = '42501';
    end if;
    -- Reputation is derived from reviews, never asserted by its subject.
    if new.rating_avg is distinct from old.rating_avg
      or new.rating_count is distinct from old.rating_count
      or new.median_reply_seconds is distinct from old.median_reply_seconds then
      raise exception 'reputation columns are not client-writable'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Provider onboarding, with a status a person can act on
-- ---------------------------------------------------------------------------
-- The single most useful thing in Clarity's reviews is a *listener* complaining:
-- two weeks on "Unverified Listener / Profile Under Review / Something Missing"
-- with no idea what was missing and no reply from support. That is supply
-- churning in public, in the store listing, where it costs demand too.
--
-- So the status enum is explicit, `missing_fields` is structured rather than
-- prose, and the applicant can read both. A provider should never have to guess.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'application_status') then
    create type public.application_status as enum (
      'draft',
      'submitted',
      'under_review',
      -- The state Clarity's applicant was stuck in, except ours says what is
      -- missing and the applicant can fix it and resubmit without support.
      'needs_info',
      'approved',
      'rejected'
    );
  end if;
end
$$;

-- 003 created this table with a text status and a CHECK. Rebuilt rather than
-- migrated: it has no rows outside a test database, and a partial migration
-- would leave two spellings of the same state.
drop table if exists public.provider_applications cascade;

create table public.provider_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  status public.application_status not null default 'draft',
  -- The application carries its own copy of what was claimed, so a reviewer sees
  -- what was submitted rather than what the profile says today.
  display_name text,
  gender text check (gender is null or gender in ('female', 'male', 'other')),
  date_of_birth date,
  headline text,
  languages text[] not null default '{}'::text[],
  about text check (about is null or length(about) <= 2000),
  -- Structured, so the UI can point at the field instead of printing a sentence.
  missing_fields text[] not null default '{}'::text[],
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer_note text,
  created_at timestamptz not null default now()
);

alter table public.provider_applications enable row level security;

create policy "Applicant reads own application"
  on public.provider_applications for select
  using (auth.uid() = user_id);

create policy "Applicant creates own draft"
  on public.provider_applications for insert
  with check (auth.uid() = user_id and status = 'draft');

-- The applicant may edit their own application while it is theirs to edit. The
-- status transition is not theirs to make, which the trigger below enforces.
create policy "Applicant edits own application"
  on public.provider_applications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.provider_applications from anon, authenticated;
grant select, insert, update on public.provider_applications to authenticated;

-- A client may move draft -> submitted, and needs_info -> submitted. Nothing
-- else. Without this the "approved" state is self-service.
create or replace function public.guard_application_transitions()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.status is distinct from old.status then
      if not (
        (old.status = 'draft' and new.status = 'submitted')
        or (old.status = 'needs_info' and new.status = 'submitted')
      ) then
        raise exception 'an applicant cannot move an application from % to %',
          old.status, new.status using errcode = '42501';
      end if;
    end if;
    if new.missing_fields is distinct from old.missing_fields
      or new.reviewer_note is distinct from old.reviewer_note
      or new.reviewed_at is distinct from old.reviewed_at then
      raise exception 'review fields are not applicant-writable'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_application_transitions on public.provider_applications;
create trigger guard_application_transitions
  before update on public.provider_applications
  for each row execute function public.guard_application_transitions();

/**
 * Submit, with server-side completeness checking.
 *
 * The point is that "what is missing" is computed here and written to
 * `missing_fields`, so the applicant is never told a vague "Something Missing".
 * Returns the list, so the UI can highlight fields on the spot.
 */
create or replace function public.submit_provider_application(
  p_display_name text,
  p_gender text,
  p_date_of_birth date,
  p_headline text,
  p_languages text[],
  p_about text
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_missing text[] := '{}'::text[];
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  if btrim(coalesce(p_display_name, '')) = '' then
    v_missing := array_append(v_missing, 'display_name');
  end if;
  if p_gender is null or p_gender not in ('female', 'male', 'other') then
    v_missing := array_append(v_missing, 'gender');
  end if;
  if p_date_of_birth is null then
    v_missing := array_append(v_missing, 'date_of_birth');
  elsif p_date_of_birth > (current_date - interval '18 years') then
    -- Not "missing": stated and disqualifying. Said plainly rather than as a
    -- silent rejection weeks later.
    raise exception 'providers must be 18 or older' using errcode = '22023';
  end if;
  if btrim(coalesce(p_headline, '')) = '' then
    v_missing := array_append(v_missing, 'headline');
  end if;
  if p_languages is null or array_length(p_languages, 1) is null then
    v_missing := array_append(v_missing, 'languages');
  end if;
  if btrim(coalesce(p_about, '')) = '' then
    v_missing := array_append(v_missing, 'about');
  end if;

  insert into public.provider_applications as pa (
    user_id, status, display_name, gender, date_of_birth,
    headline, languages, about, missing_fields, submitted_at
  )
  values (
    v_uid,
    (case when array_length(v_missing, 1) is null then 'submitted' else 'draft' end)
      ::public.application_status,
    nullif(btrim(p_display_name), ''), p_gender, p_date_of_birth,
    nullif(btrim(p_headline), ''), coalesce(p_languages, '{}'::text[]),
    nullif(btrim(p_about), ''),
    v_missing,
    case when array_length(v_missing, 1) is null then now() else null end
  )
  on conflict (user_id) do update set
    status = case
      when array_length(v_missing, 1) is not null then pa.status
      when pa.status in ('draft', 'needs_info') then 'submitted'::public.application_status
      else pa.status
    end,
    display_name = excluded.display_name,
    gender = excluded.gender,
    date_of_birth = coalesce(pa.date_of_birth, excluded.date_of_birth),
    headline = excluded.headline,
    languages = excluded.languages,
    about = excluded.about,
    missing_fields = v_missing,
    submitted_at = case
      when array_length(v_missing, 1) is null then now() else pa.submitted_at
    end;

  -- The profile carries the applicant's own details from the moment they are
  -- given, so the age constraint has something to check at approval time.
  -- `nullif` throughout: a draft legitimately carries blanks, and profiles has a
  -- length CHECK on headline that an empty string fails. Blank means "not
  -- answered yet", so it must not overwrite a previously good value either.
  update public.profiles
  set date_of_birth = coalesce(date_of_birth, p_date_of_birth),
      gender = coalesce(p_gender, gender),
      display_name = coalesce(nullif(btrim(p_display_name), ''), display_name),
      headline = coalesce(nullif(btrim(p_headline), ''), headline),
      languages = case
        when array_length(p_languages, 1) is null then languages else p_languages
      end
  where id = v_uid;

  return v_missing;
end;
$$;

revoke all on function public.submit_provider_application(text, text, date, text, text[], text)
  from public;
grant execute on function public.submit_provider_application(text, text, date, text, text[], text)
  to authenticated;

-- What the applicant can see about their own application. A view so the reviewer
-- note is shown but nothing about other applicants ever is.
create or replace view public.my_application
with (security_invoker = true) as
  select
    status,
    missing_fields,
    reviewer_note,
    submitted_at,
    reviewed_at,
    created_at
  from public.provider_applications
  where user_id = auth.uid();

grant select on public.my_application to authenticated;

-- Approval, rewritten for the new statuses and the age gate.
create or replace function public.approve_provider_application(
  p_user_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.provider_applications;
begin
  select * into v_app from public.provider_applications where user_id = p_user_id;
  if v_app is null then
    raise exception 'no application for %', p_user_id using errcode = 'no_data_found';
  end if;
  if array_length(v_app.missing_fields, 1) is not null then
    raise exception 'application for % is incomplete: %',
      p_user_id, array_to_string(v_app.missing_fields, ', ') using errcode = '22023';
  end if;
  if v_app.date_of_birth is null
    or v_app.date_of_birth > (current_date - interval '18 years') then
    raise exception 'applicant % is not verifiably 18 or older', p_user_id
      using errcode = '22023';
  end if;

  update public.provider_applications
  set status = 'approved', reviewed_at = now(), reviewer_note = p_note,
      missing_fields = '{}'::text[]
  where user_id = p_user_id;

  update public.profiles
  set role = 'provider',
      display_name = coalesce(v_app.display_name, display_name),
      gender = coalesce(v_app.gender, gender),
      date_of_birth = coalesce(date_of_birth, v_app.date_of_birth),
      headline = coalesce(v_app.headline, headline),
      languages = case
        when array_length(v_app.languages, 1) is null then languages
        else v_app.languages
      end,
      identity_verified_at = coalesce(identity_verified_at, now())
  where id = p_user_id;
end;
$$;

revoke all on function public.approve_provider_application(uuid, text) from public;
grant execute on function public.approve_provider_application(uuid, text) to service_role;

-- The other two outcomes, so an operator is not reduced to hand-written UPDATEs.
create or replace function public.request_application_info(
  p_user_id uuid,
  p_missing text[],
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.provider_applications
  set status = 'needs_info',
      missing_fields = coalesce(p_missing, '{}'::text[]),
      reviewer_note = p_note,
      reviewed_at = now()
  where user_id = p_user_id;
  if not found then
    raise exception 'no application for %', p_user_id using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function public.reject_provider_application(
  p_user_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.provider_applications
  set status = 'rejected', reviewed_at = now(), reviewer_note = p_note
  where user_id = p_user_id;
  if not found then
    raise exception 'no application for %', p_user_id using errcode = 'no_data_found';
  end if;
end;
$$;

revoke all on function public.request_application_info(uuid, text[], text) from public;
grant execute on function public.request_application_info(uuid, text[], text) to service_role;
revoke all on function public.reject_provider_application(uuid, text) from public;
grant execute on function public.reject_provider_application(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Reviews, reputation a member can see before spending anything
-- ---------------------------------------------------------------------------
-- Clarity's rows carry "5.0 ★ 39+ reviews" and ours carried nothing, which means
-- a member choosing between two names is choosing at random. One review per
-- conversation, by the member only.
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  provider_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists reviews_provider_idx on public.reviews (provider_id, created_at desc);

alter table public.reviews enable row level security;

-- A provider may read reviews about them; a member may read their own. Neither
-- may read a third party's, so the raw table is not a reputation scraper.
create policy "Participants read reviews"
  on public.reviews for select
  using (auth.uid() = member_id or auth.uid() = provider_id);

revoke all on public.reviews from anon, authenticated;
grant select on public.reviews to authenticated;

-- Written through an RPC so authorship and the one-per-conversation rule cannot
-- be forged, and so a provider can never review themselves.
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

  insert into public.reviews (conversation_id, member_id, provider_id, rating, comment)
  values (p_conversation_id, v_member, v_provider, p_rating, btrim(p_comment))
  on conflict (conversation_id) do update
    set rating = excluded.rating, comment = excluded.comment, created_at = now();
end;
$$;

revoke all on function public.submit_review(uuid, smallint, text) from public;
grant execute on function public.submit_review(uuid, smallint, text) to authenticated;

-- Denormalise on write. The directory reads this thousands of times for every
-- one review written.
create or replace function public.refresh_provider_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid := coalesce(new.provider_id, old.provider_id);
begin
  update public.profiles p
  set rating_avg = sub.avg_rating,
      rating_count = sub.n
  from (
    select round(avg(rating)::numeric, 2) as avg_rating, count(*)::int as n
    from public.reviews where provider_id = v_provider
  ) sub
  where p.id = v_provider;
  return null;
end;
$$;

drop trigger if exists refresh_provider_rating on public.reviews;
create trigger refresh_provider_rating
  after insert or update or delete on public.reviews
  for each row execute function public.refresh_provider_rating();

-- ---------------------------------------------------------------------------
-- 4. Nobody pays for silence
-- ---------------------------------------------------------------------------
-- The most-upvoted negative review of Clarity is about being billed while the
-- listener said nothing. Per-message billing already avoids the worst of it,
-- there is no meter running, but a member can still pay for messages that were
-- never answered, which is the same grievance with a different shape.
--
-- So an unanswered message is refunded. Not as goodwill: it is the difference
-- between a marketplace and a slot machine, and it puts the incentive on the
-- provider to reply.
alter table public.messages
  add column if not exists refunded_at timestamptz;

create or replace function public.refund_unanswered_messages(
  p_after interval default interval '24 hours'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer := 0;
  r record;
begin
  -- A member message is unanswered when the provider has sent nothing in that
  -- conversation since it arrived.
  for r in
    select m.id, m.sender_id, m.conversation_id
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.sender_id = c.member_id
      and m.refunded_at is null
      and m.created_at < now() - p_after
      and not exists (
        select 1 from public.messages reply
        where reply.conversation_id = m.conversation_id
          and reply.sender_id = c.provider_id
          and reply.created_at > m.created_at
      )
  loop
    update public.messages set refunded_at = now() where id = r.id;
    perform public.credit_user_token(r.sender_id, 1);
    v_total := v_total + 1;
  end loop;

  return v_total;
end;
$$;

revoke all on function public.refund_unanswered_messages(interval) from public;
grant execute on function public.refund_unanswered_messages(interval) to service_role;

-- Published reply latency, so "does she actually reply" is answerable before a
-- member spends anything. Median rather than mean: one abandoned thread should
-- not define a provider who is otherwise responsive.
create or replace function public.refresh_reply_latencies()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with pairs as (
    select
      c.provider_id,
      extract(epoch from (reply.created_at - inbound.created_at)) as seconds
    from public.messages inbound
    join public.conversations c on c.id = inbound.conversation_id
    join lateral (
      select created_at from public.messages r
      where r.conversation_id = inbound.conversation_id
        and r.sender_id = c.provider_id
        and r.created_at > inbound.created_at
      order by r.created_at asc
      limit 1
    ) reply on true
    where inbound.sender_id = c.member_id
      and inbound.created_at > now() - interval '30 days'
  ),
  medians as (
    select provider_id,
           percentile_cont(0.5) within group (order by seconds)::int as median_seconds
    from pairs group by provider_id
  )
  update public.profiles p
  set median_reply_seconds = m.median_seconds
  from medians m
  where p.id = m.provider_id;

  select count(*)::int into v_count
  from public.profiles where median_reply_seconds is not null;
  return v_count;
end;
$$;

revoke all on function public.refresh_reply_latencies() from public;
grant execute on function public.refresh_reply_latencies() to service_role;

-- ---------------------------------------------------------------------------
-- 5. The directory, enriched
-- ---------------------------------------------------------------------------
-- Ours published a name and "Available now". Clarity's row carries a photo,
-- name, gender, age, rating, review count, a one-line bio and a price, which is
-- the difference between choosing a person and picking a name off a list.
--
-- Age is computed here and the birth date is not exposed. Price is deliberately
-- absent: it is one token per message for everyone, an invariant with a parity
-- test behind it, and per-provider pricing would break both.
-- `conversation_summaries` joins this view, so the drop has to take it with it.
-- Both are recreated below; dropping only the directory fails with a dependency
-- error, and CASCADE without recreating would silently remove the inbox.
drop view if exists public.conversation_summaries;
drop view if exists public.provider_directory;

create view public.provider_directory
with (security_invoker = false) as
  select
    p.id,
    p.display_name,
    p.gender,
    -- Integer years, not a date.
    extract(year from age(p.date_of_birth))::int as age,
    p.headline,
    p.languages,
    p.is_available,
    p.rating_avg,
    p.rating_count,
    p.median_reply_seconds,
    p.created_at
  from public.profiles p
  where p.role = 'provider'
    and p.identity_verified_at is not null
    and (p.suspended_until is null or p.suspended_until <= now());

comment on view public.provider_directory is
  'The only member-facing projection of a provider. Runs as owner and therefore '
  'bypasses RLS on profiles by design: the column list here IS the privacy '
  'boundary. date_of_birth is deliberately absent, age is computed. Never add a '
  'column without deciding it is public to every member.';

revoke all on public.provider_directory from anon;
grant select on public.provider_directory to authenticated;

-- Recreated after the directory it depends on, with an explicit column list
-- rather than a `select *` that would now pull the enriched directory columns
-- into a different surface by accident.
create view public.conversation_summaries
with (security_invoker = true) as
  select
    c.id,
    c.last_message_at,
    case when c.member_id = auth.uid() then c.provider_id else c.member_id end
      as peer_id,
    d.display_name as peer_display_name,
    coalesce(d.is_available, false) as peer_available,
    (select m.body from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc limit 1) as last_body,
    (select m.sender_id from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc limit 1) as last_sender_id,
    (select count(*) from public.messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and m.read_at is null) as unread_count,
    -- Drives the "how was it?" prompt without a second query.
    exists (select 1 from public.reviews r where r.conversation_id = c.id)
      as reviewed
  from public.conversations c
  left join public.provider_directory d
    on d.id = case when c.member_id = auth.uid() then c.provider_id else c.member_id end
  where c.member_id = auth.uid() or c.provider_id = auth.uid();

revoke all on public.conversation_summaries from anon;
grant select on public.conversation_summaries to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Provider's own working view
-- ---------------------------------------------------------------------------
-- Earnings, because Clarity's positive reviews are all from listeners talking
-- about money. A provider with no visibility into what they have earned has no
-- reason to stay.
--
-- One token spent by a member is one unit of provider earnings. Converting that
-- to currency is Stripe Connect's problem and is not built; counting it is not.
create or replace view public.provider_earnings
with (security_invoker = true) as
  select
    count(*) filter (where m.refunded_at is null) as billable_messages,
    count(*) filter (where m.refunded_at is not null) as refunded_messages,
    count(distinct c.member_id) as members_served,
    count(distinct c.id) as conversations,
    min(m.created_at) as first_message_at
  from public.conversations c
  join public.messages m on m.conversation_id = c.id and m.sender_id = c.member_id
  where c.provider_id = auth.uid();

grant select on public.provider_earnings to authenticated;

create index if not exists profiles_directory_sort_idx
  on public.profiles (is_available desc, rating_avg desc nulls last)
  where role = 'provider';

-- ---------------------------------------------------------------------------
-- 7. Telemetry allowlist, extended for the new surfaces
-- ---------------------------------------------------------------------------
-- Redefined rather than appended to, because the allowlist is the whole schema
-- of this table and it should be readable in one place. `__tests__/telemetry.
-- test.ts` asserts this list and the TypeScript union are identical.
create or replace function public.guard_event_shape()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_key text;
begin
  if new.name not in (
    'app_open', 'directory_viewed', 'conversation_opened', 'message_sent',
    'send_rejected', 'refill_opened', 'refill_claimed', 'report_submitted',
    'user_blocked', 'user_unblocked', 'account_deleted', 'identity_linked',
    'signed_in', 'application_submitted', 'availability_changed',
    'review_submitted'
  ) then
    raise exception 'unknown event name: %', new.name using errcode = '22023';
  end if;

  if pg_column_size(new.props) > 2048 then
    raise exception 'event props too large' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(new.props) loop
    if v_key ~* '(body|message|content|text|detail|email|phone|name|token)' then
      raise exception 'event props may not carry "%"', v_key using errcode = '22023';
    end if;
  end loop;

  return new;
end;
$$;
