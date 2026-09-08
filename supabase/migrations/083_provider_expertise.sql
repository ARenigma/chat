-- ===========================================================================
-- 083  What a provider is actually good for
-- ===========================================================================
-- Amit, 2026-09-08: "we have to take expertise section(ex: anxiety|stress)
-- from clarity for explore section.. so ideally best of both astrotalk and
-- clarity".
--
-- ---------------------------------------------------------------------------
-- Why this is a migration and not a layout change
-- ---------------------------------------------------------------------------
-- The explore row was to be rebuilt on Astrotalk's anatomy with Clarity's
-- topic tags. Astrotalk's own version of that line is a real column — its
-- `skillET` renders "Vedic,  AI Astrologer", measured on the Redmi at 17.1dp
-- under the name. We had nothing to put there. `profiles` carries
-- display_name, headline, about, languages and provider_category, and none of
-- them answers "what do you help with":
--
--   headline           free text, one line, already used for voice ("Here to
--                      listen"). Mining tags out of prose would be a guess
--                      rendered as a fact.
--   provider_category  listener | astrologer. Two values for the whole roster,
--                      so every row in a tab would show the same tag.
--   languages          a different question with the same shape, which is what
--                      makes it the model to copy rather than the column to
--                      overload.
--
-- So the tags are a column. The alternative — deriving them client-side — was
-- rejected because a derived tag cannot be corrected by the person it
-- describes, and this is a claim about a human being.
--
-- ---------------------------------------------------------------------------
-- Shape floor, not an allowlist. 072's rule, applied again on purpose.
-- ---------------------------------------------------------------------------
-- `expertise_list_is_sane` bounds the ARRAY and says nothing about the values,
-- exactly as `language_list_is_sane` does, and for the reason 072 records: the
-- offered set is a product decision, so adding a topic must not require a
-- migration. The vocabulary lives in `src/lib/expertise.ts` and is gated
-- against the provider form by a unit test, the way OFFERED_LANGUAGES is.
--
-- Eight, not twelve. A language list is a capability and longer is strictly
-- more useful; a topic list is a CLAIM, and a provider who says they are expert
-- in twelve things has said nothing. Eight is also more than the row can show,
-- so the ceiling is never what a member sees — the row takes the first three.
--
-- ---------------------------------------------------------------------------
-- Not in the 063 guard, deliberately
-- ---------------------------------------------------------------------------
-- 063's guard is a denylist of SERVER-owned columns, and this is not one. A
-- provider writes their own topics the same way they write their own languages
-- and headline, through the owner-only RLS that 003 already grants. Adding it
-- to the guard would lock the provider out of their own claim. pgTAP 370
-- asserts the write is allowed for the owner and refused for everyone else, so
-- that reasoning is checked rather than asserted here.

-- ---------------------------------------------------------------------------
-- 1. The shape floor
-- ---------------------------------------------------------------------------
create or replace function public.expertise_list_is_sane(p text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select p is null
     or (coalesce(cardinality(p), 0) <= 8
         and not exists (
           select 1 from unnest(p) as e
           where e is null or btrim(e) = '' or length(e) > 40
         ));
$$;

comment on function public.expertise_list_is_sane(text[]) is
  'Shape floor for an expertise array: at most 8 entries, no NULL element, each '
  '1..40 characters after trimming. Deliberately NOT a value allowlist — the '
  'offered set is a product decision and lives in src/lib/expertise.ts, so '
  'adding a topic must not require a migration. Eight rather than languages'' '
  'twelve because a topic list is a claim, not a capability.';

-- ---------------------------------------------------------------------------
-- 2. The columns
-- ---------------------------------------------------------------------------
-- Default '{}' and NOT NULL on both, so every reader gets an array and none has
-- to distinguish "no topics" from "not answered". `languages` is modelled the
-- same way, and the row renderer therefore needs one branch instead of two.
alter table public.profiles
  add column if not exists expertise text[] not null default '{}'::text[];

alter table public.profiles
  drop constraint if exists profiles_expertise_sane;
alter table public.profiles
  add constraint profiles_expertise_sane
  check (public.expertise_list_is_sane(expertise));

comment on column public.profiles.expertise is
  'What this provider helps with, as short topic tags (Anxiety, Relationships, '
  'Tarot). Provider-written, owner-only RLS, deliberately absent from the 063 '
  'guard. Published through provider_directory; the explore row shows the '
  'first three. Empty for members, and empty is legal for a provider — this is '
  'not a promotion requirement the way languages is (075).';

alter table public.provider_applications
  add column if not exists expertise text[] not null default '{}'::text[];

alter table public.provider_applications
  drop constraint if exists provider_applications_expertise_sane;
alter table public.provider_applications
  add constraint provider_applications_expertise_sane
  check (public.expertise_list_is_sane(expertise));

comment on column public.provider_applications.expertise is
  'The applicant''s claimed topics, carried to profiles.expertise on approval. '
  'NOT added to missing_fields: unlike languages (075) an empty list is a valid '
  'application, because a provider with no tags is merely less discoverable '
  'rather than unusable.';

-- ---------------------------------------------------------------------------
-- 3. Publish it
-- ---------------------------------------------------------------------------
-- Restated in full from 065 with one column appended. A view cannot be ALTERed
-- to add a column in the middle and `create or replace` requires the existing
-- columns in the existing order, so the whole list is reproduced — the one
-- place in this codebase where reproducing a body is forced rather than chosen.
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
    case when p.presence_visible then p.last_active_at end as last_active_at,
    p.created_at,
    p.presence,
    p.avatar_url,
    p.about,
    p.chat_enabled,
    p.audio_enabled,
    p.video_enabled,
    p.provider_category,
    p.expertise
  from public.profiles p
  where p.role = 'provider'
    and p.identity_verified_at is not null
    and (p.suspended_until is null or p.suspended_until <= now());

comment on view public.provider_directory is
  'Explicit-column privacy boundary over profiles: what a member may see about '
  'a provider. 064 added the three channel switches; 065 added '
  'provider_category, which the Listeners / Astrologers tabs group by; 083 '
  'added expertise, the topic tags the explore row shows under the name. `age` '
  'is an integer here and has been since 042, which is why the age filter '
  'needs no column of its own.';

-- ---------------------------------------------------------------------------
-- 4. The provider writes their own tags — through a NEW function, not this one
-- ---------------------------------------------------------------------------
-- `complete_provider_onboarding` is NOT touched, and the first draft of this
-- migration touched it. That draft is worth recording because it reproduced the
-- 054 mistake exactly.
--
-- The parameter cannot simply be appended: a 6-arg function whose 6th argument
-- has a default coexists with the 5-arg function rather than replacing it, so
-- every existing 5-arg call becomes "function is not unique". That is the trap
-- 065 documented when it added p_provider_category, and it is why 065 had to
-- DROP first. Dropping means reproducing the body — and the body is 72 lines
-- that gate identity_state = 'verified', read the verified DOB out of
-- provider_tax_profile, enforce 18+, btrim four fields, check the category
-- allowlist and set role, date_of_birth and identity_verified_at in ONE
-- statement so `member_is_pseudonymous` stays satisfied. The draft reproduction
-- silently lost all of it. 054 lost four guards the same way.
--
-- So expertise gets its own function, which is better on its own merits and not
-- only safer:
--
--   * A topic list is not onboarding-shaped. Languages and a headline are
--     settled once; what somebody helps with is the thing they will revise
--     after a month of conversations. Folding it into the completion RPC would
--     mean the only way to change one tag is to resubmit the whole form.
--   * It is the 081 pattern. `send_message` is 295 lines and was WRAPPED rather
--     than edited for the same reason this is added rather than merged.
--
-- Approval (section 5) still carries the applicant's tags across, so the
-- application path is not left behind.
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

  -- Providers only. A member has no directory row, so tags on one would be
  -- storage nobody can read — and the column is on `profiles`, which every
  -- member has.
  select role into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'provider' then
    raise exception 'only a provider has expertise' using errcode = '42501';
  end if;

  -- A sentence rather than a constraint name. The CHECK still stands behind
  -- this and behind the admin console and the seed, which is the point of
  -- having both.
  if not public.expertise_list_is_sane(v_next) then
    raise exception 'at most 8 topics, each 1 to 40 characters'
      using errcode = '22023';
  end if;

  update public.profiles set expertise = v_next where id = v_uid;
  return v_next;
end;
$$;

comment on function public.set_provider_expertise(text[]) is
  'A provider replaces their own topic tags. Separate from '
  'complete_provider_onboarding on purpose: tags are revised long after '
  'onboarding is done, and appending a defaulted parameter to that function '
  'would have made its existing 5-arg signature ambiguous (065''s finding) and '
  'forced a reproduction of its 72-line body (054''s failure). Returns the '
  'stored array so the caller renders what the server kept.';

revoke all on function public.set_provider_expertise(text[]) from public, anon;
grant execute on function public.set_provider_expertise(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Approval carries it
-- ---------------------------------------------------------------------------
-- 075's body with one clause added, using 075's own fallback idiom: an
-- application with no topics leaves whatever the profile already has, so
-- re-approving somebody does not erase tags they set after applying.
--
-- No requirement check, unlike languages. 075 raises when the promotion would
-- produce a provider with no language because a provider nobody can talk to is
-- broken; a provider with no tags is merely harder to find, and blocking an
-- approval on it would put an admin in the way of a person who is otherwise
-- ready.
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

  -- 075. Checked against the RESULT rather than against the application, because
  -- the clause below falls back to the profile's existing column: an
  -- application with no languages is fine if the row being promoted already
  -- carries some, and is not if it does not.
  if coalesce(
       cardinality(
         case
           when array_length(v_app.languages, 1) is null
             then (select languages from public.profiles where id = p_user_id)
           else v_app.languages
         end
       ), 0) = 0 then
    raise exception 'applicant % has no languages: a provider must offer at least one',
      p_user_id using errcode = '22023';
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
      about = coalesce(v_app.about, about),
      languages = case
        when array_length(v_app.languages, 1) is null then languages
        else v_app.languages
      end,
      -- 083, same fallback idiom as languages directly above.
      expertise = case
        when array_length(v_app.expertise, 1) is null then expertise
        else v_app.expertise
      end,
      identity_verified_at = coalesce(identity_verified_at, now())
  where id = p_user_id;
end;
$$;

comment on function public.approve_provider_application(uuid, text) is
  'Admin approval: promotes an applicant to provider from their application '
  'row. 075 added the language requirement, which is checked against the '
  'RESULT of the promotion rather than the application, because the languages '
  'clause falls back to the profile''s existing column. 083 carries expertise '
  'across with the same fallback but no requirement — a provider with no tags '
  'is harder to find, not unusable.';
