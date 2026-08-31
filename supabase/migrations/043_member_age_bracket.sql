-- ===========================================================================
-- 043  Member age bracket (soft self-declaration)
-- ===========================================================================
-- Adult-only product: members declare a rough age band on first run.
-- Null is allowed initially so existing rows keep loading; the app gate
-- treats null as undeclared and collects the bracket before Home.

-- ---------------------------------------------------------------------------
-- 1. Column + constraint
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists age_bracket text;

-- Postgres has no `add constraint if not exists`, and the column add above is
-- idempotent, so the constraint has to be guarded by hand or a re-run fails
-- halfway and leaves the RPC below uncreated.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_age_bracket_values'
  ) then
    alter table public.profiles
      add constraint profiles_age_bracket_values
        check (age_bracket is null or age_bracket in ('18-24', '25-34', '35-44', '45+'));
  end if;
end
$$;

comment on column public.profiles.age_bracket is
  'Self-declared age band. Null until the member completes first-run or the '
  'app gate prompts them. Four bands (18-24 / 25-34 / 35-44 / 45+), adults '
  'only. Fail-closed: if null when reaching Home, the gate re-shows the picker.';

-- ---------------------------------------------------------------------------
-- 2. RPC: member sets their own age bracket
-- ---------------------------------------------------------------------------

create or replace function public.set_member_age_bracket(p_bracket text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only authenticated users reach this; belt-and-suspenders for SECURITY DEFINER.
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- Members only. Providers do not declare an age band here.
  if (select role from public.profiles where id = auth.uid()) <> 'member' then
    raise exception 'Only members can set age bracket';
  end if;

  -- Validate the bracket against the same set as the check constraint.
  -- Null is not allowed here: the caller must pass a real band.
  if p_bracket is null or p_bracket not in ('18-24', '25-34', '35-44', '45+') then
    raise exception 'Invalid age bracket: must be one of 18-24, 25-34, 35-44, 45+';
  end if;

  update public.profiles
     set age_bracket = p_bracket
   where id = auth.uid();
end;
$$;

-- Grant to authenticated only; providers reaching this get the role check above.
revoke all on function public.set_member_age_bracket(text) from public;
grant execute on function public.set_member_age_bracket(text) to authenticated;

comment on function public.set_member_age_bracket(text) is
  'Member-only RPC to record a self-declared age band. '
  'Validates against the same four values as the check constraint. '
  'Idempotent: calling again updates the stored value.';
