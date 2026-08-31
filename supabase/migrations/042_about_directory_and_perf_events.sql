-- 042 — publish provider about on the directory, and extend telemetry for
-- motion / load / cache signals (no third-party analytics SDK).

alter table public.profiles
  add column if not exists about text
    check (about is null or length(about) <= 2000);

comment on column public.profiles.about is
  'Member-facing About paragraph. Copied from the approved application. '
  'Null on members. Directory publishes it; headline stays the one-line tag.';

update public.profiles p
set about = a.about
from public.provider_applications a
where a.user_id = p.id
  and p.role = 'provider'
  and p.about is null
  and a.about is not null;

-- Seed cards (scripts/seed-dev.sql ids) so About is never the headline twice.
update public.profiles set about = v.about
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid,
   'I sit with whatever you bring and I do not rush you toward a conclusion. Most people already know what they think; they need a quiet hour where nobody is scoring them. Ask for advice if you want it. Otherwise I just stay with you.'),
  ('22222222-2222-4222-8222-222222222222'::uuid,
   'Late nights are when the real sentences come out. I am used to that hour: the half-formed worry, the thing you cannot say at dinner. We can ramble, we can sit in silence, we can start again. I will still be here after nine.'),
  ('33333333-3333-4333-8333-333333333333'::uuid,
   'Some days you do not want a plan. You want someone who will not fill the gaps. I listen first and I stay there unless you ask me to step in. If all you need is a witness for twenty minutes, that is enough work for me.'),
  ('44444444-4444-4444-8444-444444444444'::uuid,
   'Tell me the ordinary parts. The commute, the message you did not send, the week that felt longer than it was. I like the small facts; they are usually where the feeling is hiding. We can go slow. Nothing here has to be impressive.')
) as v(id, about)
where profiles.id = v.id;

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
    p.about
  from public.profiles p
  where p.role = 'provider'
    and p.identity_verified_at is not null
    and (p.suspended_until is null or p.suspended_until <= now());

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
      about = coalesce(v_app.about, about),
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
    'review_submitted',
    'reaction_added', 'reaction_removed', 'reply_sent',
    'voice_note_sent', 'voice_note_played',
    'call_started', 'call_answered', 'call_declined', 'call_ended',
    'call_rejected', 'presence_changed',
    'policy_accepted', 'session_requested', 'session_ended',
    'recharge_sheet_opened',
    'cashfree_checkout_verify', 'cashfree_checkout_error',
    'screen_opened', 'sheet_closed', 'query_slow', 'frame_jank'
  ) then
    raise exception 'unknown event name: %', new.name using errcode = '22023';
  end if;

  if pg_column_size(new.props) > 2048 then
    raise exception 'event props too large' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(new.props) loop
    if v_key ~* '(body|message|content|text|detail|email|phone|name|token)' then
      raise exception 'prop key "%" looks like PII or message content', v_key
        using errcode = '22023';
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.guard_event_shape() is
  'Allowlist guard for telemetry event names and prop keys. (through 042)';
