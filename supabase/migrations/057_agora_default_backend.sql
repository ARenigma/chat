-- Agora is the production media backend.
--
-- Overrides via set_next_call_media_backend remain for harness / future A/B;
-- without an override every new call is agora. The client ships only the Agora
-- SDK; livekit/current stay in the enum so a later vendor swap is a client +
-- assignment change, not a schema rewrite.

alter table public.calls
  alter column media_backend set default 'agora';

-- 052 only allowed sticky|harness. Default production assignment needs its own
-- kind so harness overrides stay distinguishable in QoE evidence.
alter table public.calls
  drop constraint if exists calls_media_assignment_kind_check;

alter table public.calls
  add constraint calls_media_assignment_kind_check
  check (media_assignment_kind in ('sticky', 'harness', 'default'));

alter table public.calls
  alter column media_assignment_kind set default 'default';

create or replace function public.assign_call_media_backend()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_override public.call_media_overrides%rowtype;
begin
  delete from public.call_media_overrides
  where conversation_id = new.conversation_id
    and expires_at > now()
  returning * into v_override;

  if found then
    new.media_backend := v_override.backend;
    new.media_experiment_id := v_override.experiment_id;
    new.media_run_id := v_override.run_id;
    new.media_assignment_kind := 'harness';
    return new;
  end if;

  new.media_backend := 'agora';
  new.media_experiment_id := coalesce(new.media_experiment_id, 'agora-default');
  new.media_assignment_kind := 'default';
  return new;
end;
$$;
