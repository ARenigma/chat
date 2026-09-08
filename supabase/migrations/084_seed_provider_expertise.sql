-- ===========================================================================
-- 084  Give every existing provider some expertise tags
-- ===========================================================================
-- Amit, 2026-09-08: "you have still not replaced here to listen with expetise?
-- pls seed and replace just like astrotalk has like tarot, vedic etc".
--
-- ---------------------------------------------------------------------------
-- Why the row still showed a headline
-- ---------------------------------------------------------------------------
-- 083 added `profiles.expertise` with a default of '{}', and the explore card
-- falls back to the provider's headline when the list is empty — which is the
-- correct EMPTY STATE and was the wrong thing to be looking at, because every
-- provider on the roster predates the column and therefore has none. The card
-- was working; there was simply nothing to show.
--
-- Two ways to fix that: wait for providers to fill the picker in (39aa5b0),
-- which is right and slow, or backfill. This backfills.
--
-- ---------------------------------------------------------------------------
-- THIS INVENTS A CLAIM ABOUT A PERSON, which is worse than inventing a number
-- ---------------------------------------------------------------------------
-- `systemRating` manufactures social proof and says so at length. This is a
-- different and sharper thing: expertise is a statement that a named human
-- being is competent to help with anxiety, or grief, or a birth chart. Nobody
-- asked them. If a member picks a provider because the card says "Grief" and
-- that provider has never handled a bereavement, the harm is not a
-- disappointing purchase.
--
-- It is done because Amit asked for it with the roster in front of him, and
-- because every provider currently on it is a test account — Ravi, RaviListens,
-- Mrunal, Ada QA — not a member of the public. That is the fact that makes this
-- acceptable, and it is also the fact that expires.
--
-- SO IT IS BUILT TO BE UNDONE, and narrowly:
--
--   * ONLY providers with an empty array are touched. A provider who has
--     chosen their own tags through the form is never overwritten, so this
--     cannot destroy a real answer, and re-running it is a no-op.
--   * The rows it writes are recoverable: `seeded_expertise_at` records who was
--     backfilled, so `update profiles set expertise = '{}' where
--     seeded_expertise_at is not null` reverses exactly this migration and
--     nothing else.
--   * Section 4 is the rollback, written out, so it does not have to be
--     reconstructed under pressure.
--
-- BEFORE THE FIRST REAL PROVIDER SIGNS UP, this must stop running. It is a
-- one-shot backfill and not a trigger, so it will not touch anyone who joins
-- after it; the danger is somebody re-running it later out of habit. The
-- `seeded_expertise_at` column is what makes that visible in a query.

-- ---------------------------------------------------------------------------
-- 1. Record who we touched
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists seeded_expertise_at timestamptz;

comment on column public.profiles.seeded_expertise_at is
  'Set by migration 084 when this provider''s expertise tags were BACKFILLED '
  'rather than chosen. Non-null means the tags on this row are a placeholder '
  'and nobody claimed them. Cleared to null the moment the provider saves their '
  'own through set_provider_expertise. Query it before trusting expertise as a '
  'statement about a person.';

-- ---------------------------------------------------------------------------
-- 2. The vocabularies, mirrored from src/lib/expertise.ts
-- ---------------------------------------------------------------------------
-- Two lists, because 065 splits the roster and one vocabulary would misdescribe
-- both halves. `__tests__/expertise.test.ts` gates these against the TypeScript
-- constant, so a topic offered here but not in the form (or the reverse) fails
-- the build rather than producing a tag no provider could have chosen.
create or replace function public.seed_expertise_for(p_id uuid, p_category text)
returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_pool text[];
  v_hash bigint;
  v_out  text[] := '{}';
  v_i    int;
  v_pick text;
begin
  v_pool := case
    when p_category = 'astrologer'
      then array['Vedic','Tarot','Numerology','Palmistry','Vastu','Love','Marriage','Career']
    else array['Anxiety','Stress','Relationships','Breakup','Loneliness','Family',
               'Career','Self-esteem','Sleep','Grief']
  end;

  -- Deterministic from the id, like `systemRating` and `seededExperienceYears`
  -- on the client: the same provider must get the same tags on every device and
  -- every run, or re-running this would reshuffle the directory.
  v_hash := abs(hashtextextended(p_id::text, 0));

  -- THREE, which is exactly what the card shows (ROW_EXPERTISE_LIMIT). Seeding
  -- more would put tags on the profile that no row ever displays, so nobody
  -- would ever see — or be able to correct — them.
  for v_i in 0..2 loop
    -- Offset by i so the three picks are different entries rather than three
    -- draws that can collide; the pool is longer than 3 in both branches.
    v_pick := v_pool[1 + ((v_hash / (7 ^ v_i)::bigint + v_i * 3) % array_length(v_pool, 1))::int];
    if not (v_pick = any(v_out)) then
      v_out := v_out || v_pick;
    end if;
  end loop;

  return v_out;
end;
$$;

comment on function public.seed_expertise_for(uuid, text) is
  'Placeholder expertise tags for migration 084''s backfill. Deterministic from '
  'the provider id so a re-run cannot reshuffle the directory. NOT a statement '
  'about the provider — see 084''s header and profiles.seeded_expertise_at.';

-- ---------------------------------------------------------------------------
-- 3. The backfill
-- ---------------------------------------------------------------------------
-- `cardinality(expertise) = 0` is the whole safety property: a provider who has
-- answered for themselves is never overwritten, and running this twice changes
-- nothing the second time.
update public.profiles
set    expertise           = public.seed_expertise_for(id, provider_category),
       seeded_expertise_at = now()
where  role = 'provider'
  and  coalesce(cardinality(expertise), 0) = 0;

-- The provider's own answer always wins, and clears the marker with it, so a
-- row can never be both claimed and flagged as seeded.
create or replace function public.set_provider_expertise(p_expertise text[])
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
  v_next text[] := coalesce(p_expertise, '{}'::text[]);
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'provider' then
    raise exception 'only a provider has expertise' using errcode = '42501';
  end if;

  if not public.expertise_list_is_sane(v_next) then
    raise exception 'at most 8 topics, each 1 to 40 characters'
      using errcode = '22023';
  end if;

  -- 084: whatever the provider says is theirs, so the seeded marker goes.
  update public.profiles
  set    expertise           = v_next,
         seeded_expertise_at = null
  where  id = v_uid;

  return v_next;
end;
$$;

comment on function public.set_provider_expertise(text[]) is
  'A provider replaces their own topic tags. Separate from '
  'complete_provider_onboarding on purpose: tags are revised long after '
  'onboarding is done, and appending a defaulted parameter to that function '
  'would have made its existing 5-arg signature ambiguous (065''s finding) and '
  'forced a reproduction of its 72-line body (054''s failure). 084: clears '
  'seeded_expertise_at, because the provider answering makes it their claim. '
  'Returns the stored array so the caller renders what the server kept.';

-- ---------------------------------------------------------------------------
-- 4. The rollback, written down rather than reconstructed later
-- ---------------------------------------------------------------------------
-- Undoes exactly this migration and nothing a provider chose:
--
--   update public.profiles
--   set    expertise = '{}'::text[], seeded_expertise_at = null
--   where  seeded_expertise_at is not null;
--
-- And to find out how much of the directory is still placeholder:
--
--   select count(*) filter (where seeded_expertise_at is not null) as seeded,
--          count(*) filter (where seeded_expertise_at is null)     as claimed
--   from   public.profiles where role = 'provider';
