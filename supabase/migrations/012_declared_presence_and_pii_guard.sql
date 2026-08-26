-- ---------------------------------------------------------------------------
-- 012: presence you declare, and PII a client cannot write
-- ---------------------------------------------------------------------------
-- Two finishes to work 011 started, and neither is a new feature so much as the
-- removal of a lie.
--
-- THE FIRST LIE: every presence dot in the app renders `is_available`, which is
-- the provider's directory listing switch. "Listed and open to new
-- conversations" is not "here now", and the app has been saying the second
-- while storing the first. The consequences were visible on both sides: a
-- provider who wanted work but had put the phone down still showed a green dot,
-- and a MEMBER could not appear present at all, because `conversation_peers`
-- hardcodes `peer_available` to false for a member peer. So the provider's
-- inbox rendered `online={false}` on every row, whatever the member wanted.
--
-- 011 stored `presence_visible` and `last_active_at`, which is WhatsApp's Last
-- Seen: a derived stamp behind a visibility switch. That is a genuine and
-- consented signal and it stays exactly as 011 left it, guard and all. What was
-- missing is the declared state, which is the thing the settled decision
-- actually asks for: presence is user-controlled, like WhatsApp's setting, not
-- derived. A stamp says when you were last awake. It cannot say "I am here, talk
-- to me" or "I am around but not now", and those are the two things a person in
-- this product wants to be able to say.
--
-- THE SECOND LIE: 011 added `member_is_pseudonymous`, which makes a member row
-- carrying a birth date, gender or headline unrepresentable. That closes the
-- member half. It leaves the other half open: the RLS policy "Profile updatable
-- by owner" still lets a PROVIDER PATCH their own gender and headline from a
-- client, and members pay to choose a person on exactly those two fields plus
-- the age. A provider admitted at 26 as female could become 22 and male after
-- approval with one request and no reviewer involved. `date_of_birth` was
-- already write-once from 006, so it was the only one of the three with any
-- protection at all.
--
-- The rule carried forward from 010, and it is why this file adds a trigger
-- rather than editing one: 010 tried to extend
-- `guard_privileged_profile_columns` by reproducing the 003 body, and silently
-- deleted the five checks 005 and 006 had added, with no diff to show for it.
-- Postgres runs BEFORE UPDATE triggers in name order and each raises
-- independently, so additive guards compose and cannot regress. This is the
-- fourth on `profiles`, after privileged (003), phone (010) and presence (011).

-- ---------------------------------------------------------------------------
-- 1. The declared state
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'presence_choice') then
    create type public.presence_choice as enum ('here', 'away', 'hidden');
  end if;
end
$$;

alter table public.profiles
  add column if not exists presence public.presence_choice not null default 'hidden';

comment on column public.profiles.presence is
  'What this person has chosen to publish about being reachable, and the one '
  'presence signal any screen should render. Three values because "away" and '
  '"hidden" are observably different to the person looking: away publishes the '
  'word, hidden publishes nothing at all, and collapsing them to a boolean '
  'would mean opting out of presence and declaring yourself absent are the same '
  'statement. Deliberately absent from every guard trigger, like '
  'presence_visible and is_available: being reachable or not is the one thing '
  'about themselves a person must be able to change instantly, and a guard here '
  'would put a support ticket between somebody and the ability to stop being '
  'contacted.';

comment on column public.profiles.is_available is
  'The provider''s directory listing switch: listed for discovery and open to '
  'NEW conversations. Not presence, though every dot in the app read it as '
  'presence until 012. It gates the directory rail, the "N people free now" '
  'count, the directory sort and two partial indexes from 006, so it keeps its '
  'name and its meaning; what it lost is the job it was never right for. A '
  'provider is entitled to be here and closed for work, or listed and asleep.';

-- Backfilled rather than left at the default, because the alternative is that
-- every provider currently showing a dot silently stops showing one the moment
-- this deploys. It does assert a state on their behalf, which is why it is
-- narrow: only providers, and only the ones whose own availability switch is
-- already on. Worth a line in the release notes rather than a silent default.
update public.profiles
set presence = 'here'
where role = 'provider' and is_available and presence = 'hidden';

-- ---------------------------------------------------------------------------
-- 2. The fourth guard on profiles
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER (the default) is load-bearing here exactly as it is in the
-- three siblings, and 003 records what happens when it is not: the branch below
-- tests `current_user`, so under DEFINER `current_user` is the function owner,
-- the branch is never reached, and the guard passes everything while looking
-- like it guards.
--
-- What is left able to write these three columns after this:
-- `approve_provider_application`, which is SECURITY DEFINER and copies all five
-- application fields in the same UPDATE that sets role = 'provider'. That is the
-- reviewed path, and it is the only path there should be. 011 already removed
-- the redundant profile write from `submit_provider_application`, so an
-- applicant's claims live in the application row until somebody admits them.
create or replace function public.guard_pii_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    -- Stated per column rather than as one condition, so the error names the
    -- field the caller actually touched. `member_is_pseudonymous` already makes
    -- a member holding any of these unrepresentable; this is the other half,
    -- and it is about a PROVIDER, whose age and gender are the two facts a
    -- member paid to choose them on. A field a member chose on is not a field
    -- its owner gets to restate afterwards without a reviewer.
    if new.date_of_birth is distinct from old.date_of_birth then
      raise exception 'profiles.date_of_birth is not client-writable'
        using errcode = '42501';
    end if;
    if new.gender is distinct from old.gender then
      raise exception 'profiles.gender is not client-writable'
        using errcode = '42501';
    end if;
    if new.headline is distinct from old.headline then
      raise exception 'profiles.headline is not client-writable'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Named to sort between `guard_profile_phone_columns` (010) and
-- `guard_profile_presence_columns` (011). Nothing depends on that order, since
-- each raises independently; it is only so the four read as a set.
drop trigger if exists guard_profile_pii_columns on public.profiles;
create trigger guard_profile_pii_columns
  before update on public.profiles
  for each row execute function public.guard_pii_columns();

-- The known cost, recorded rather than discovered later: a provider cannot edit
-- their own headline after approval. There is no UI for that today (the
-- application screen is the only writer), so nothing breaks now, and when it is
-- asked for the answer is an RPC that re-runs the review rules, not a PATCH.

-- ---------------------------------------------------------------------------
-- 3. The views, replaced rather than dropped where a dependent exists
-- ---------------------------------------------------------------------------
-- `create or replace view` can append a trailing column but cannot remove or
-- reorder one, which is exactly the constraint that makes it safe here:
-- `pending_pushes` selects from `provider_directory` and `conversation_summaries`
-- selects from `conversation_peers`, so a drop would either fail on the
-- dependency or, under CASCADE, silently take the push sender and the inbox with
-- it. 006 documents that trap from one side and 009 walked into it from the
-- other. Replacing also keeps the grants, which a drop would discard.
--
-- Reproduced verbatim below apart from the appended column. That is the
-- dangerous kind of edit, so it is worth saying what proves it: the 050, 060,
-- 070 and 090 suites all read these views, and a dropped column or a changed
-- predicate fails them rather than passing quietly.
create or replace view public.provider_directory
with (security_invoker = false) as
  select
    p.id,
    p.display_name,
    p.gender,
    extract(year from age(p.date_of_birth))::int as age,
    p.headline,
    p.languages,
    p.is_available,
    p.rating_avg,
    p.rating_count,
    p.median_reply_seconds,
    -- Published only with the provider's own consent, null otherwise. Decided
    -- rather than added: the directory already answers "does she reply" with
    -- median_reply_seconds, and this answers "is she around now", which is the
    -- same question on a different axis and one of the two things a member
    -- actually picks a name on.
    case when p.presence_visible then p.last_active_at end as last_active_at,
    p.created_at,
    -- Appended last, which `create or replace` requires. Published unmasked,
    -- including 'hidden', and that is not a leak: it discloses that somebody
    -- chose to say nothing, which is a fact about a setting rather than about
    -- their activity. The client needs all three values to tell "Away" from a
    -- row with no presence line at all.
    p.presence
  from public.profiles p
  where p.role = 'provider'
    and p.identity_verified_at is not null
    and (p.suspended_until is null or p.suspended_until <= now());

comment on view public.provider_directory is
  'The only member-facing projection of a provider. Runs as owner and therefore '
  'bypasses RLS on profiles by design: the column list here IS the privacy '
  'boundary. date_of_birth is deliberately absent, since age is computed, '
  'last_active_at is gated on the provider''s own presence setting, and '
  'presence is what the directory dot renders instead of is_available, which '
  'was a listing switch wearing a presence dot. Never add a column without '
  'deciding it is public to every member.';

-- The peer projection gains the same column, and this is the half that could
-- not be expressed before at all: `peer_available` is `case when peer.role =
-- 'provider' then peer.is_available else false end`, so a member peer is false
-- forever and a provider's inbox could never show a member as present however
-- the member set it.
--
-- The spec this implements called for a separate `visible_presence` view for
-- exactly that job. It was written against a tree without `conversation_peers`,
-- and a second SECURITY DEFINER view whose only access control is its own
-- `auth.uid()` predicate is a second place to get that predicate wrong. 004 is
-- the record of what a decorative definer boundary costs. One boundary, one
-- predicate, one column list.
create or replace view public.conversation_peers
with (security_invoker = false) as
  select
    c.id as conversation_id,
    peer.id as peer_id,
    case
      when peer.role = 'provider' then peer.display_name
      else public.member_handle(peer.id)
    end as peer_display_name,
    case when peer.role = 'provider' then peer.is_available else false end
      as peer_available,
    case when peer.presence_visible then peer.last_active_at end
      as peer_last_active_at,
    (peer.role = 'provider') as peer_is_provider,
    -- Not gated on role, which is the entire point: a member declares presence
    -- on the same terms a provider does, and the person who most needs to know
    -- whether the other one is there is the one waiting for a reply.
    peer.presence as peer_presence
  from public.conversations c
  join public.profiles peer
    on peer.id = case
      when c.member_id = auth.uid() then c.provider_id else c.member_id
    end
  where c.member_id = auth.uid() or c.provider_id = auth.uid();

comment on view public.conversation_peers is
  'The peer of every thread the caller is in. Definer, so the auth.uid() '
  'predicate in the WHERE is the access control and not a convenience. A member '
  'peer resolves to a handle: their display_name, birth date, gender and '
  'headline are unreachable from here by construction. `peer_presence` is the '
  'declared state and is published for either role; `peer_available` is the '
  'provider''s listing switch and is false for a member by definition.';

-- Dropped and recreated rather than replaced, because a column is going away
-- and `create or replace` cannot remove one. Safe to drop precisely because
-- nothing selects from it: `pending_pushes` reads `provider_directory` and the
-- inbox reads this. Grants are re-stated below for the same reason.
--
-- `peer_available` is removed rather than kept beside the new column. It could
-- have stayed harmlessly, and that is the argument against it: a column named
-- "available" that four screens read as "present" is the trap this migration
-- exists to close, and leaving it means the next reader has to rediscover which
-- of two similar columns is the honest one. TypeScript finding every read site
-- is the intended failure mode.
drop view if exists public.conversation_summaries;

create view public.conversation_summaries
with (security_invoker = true) as
  select
    c.id,
    c.last_message_at,
    case when c.member_id = auth.uid() then c.provider_id else c.member_id end
      as peer_id,
    pe.peer_display_name,
    coalesce(pe.peer_presence, 'hidden'::public.presence_choice) as peer_presence,
    pe.peer_last_active_at,
    (select m.body from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc limit 1) as last_body,
    -- `body` is null on a voice note, so an inbox reading last_body alone renders
    -- a blank preview. This is what lets it say "Voice note" without a second
    -- query and without inventing a placeholder body in the send path.
    (select case when m.voice_path is null then 'text' else 'voice' end
      from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc limit 1) as last_kind,
    (select m.sender_id from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc limit 1) as last_sender_id,
    (select count(*) from public.messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and m.read_at is null) as unread_count,
    exists (select 1 from public.reviews r where r.conversation_id = c.id)
      as reviewed,
    (c.member_id = auth.uid()) as i_am_member
  from public.conversations c
  left join public.conversation_peers pe on pe.conversation_id = c.id
  where c.member_id = auth.uid() or c.provider_id = auth.uid();

comment on view public.conversation_summaries is
  'One row per thread the caller participates in. `i_am_member` is the '
  'authoritative answer to "am I the paying side of THIS thread", and '
  'profiles.role is not, because a promoted provider keeps their member-side '
  'threads. `last_kind` exists because a voice note has no body to preview. '
  '`peer_presence` replaced `peer_available` in 012: the old column resolved '
  'the provider''s listing switch through a join that is false for every member, '
  'so a member could never appear present to the provider waiting on them.';

revoke all on public.conversation_summaries from anon;
grant select on public.conversation_summaries to authenticated;
