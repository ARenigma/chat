-- The INR reconciliation no longer assumes one rate per session.
--
-- 132 made a video switch charge only the difference: the session's rate
-- moves from voice to video mid-call and the switch minute carries a one-off
-- delta. record_provider_accrual (132) therefore books gross as the sum of the
-- session's succeeded usage_debit rows, which is what the member actually
-- paid. assert_call_inr_sync still demanded gross = minutes_billed ×
-- rate_per_min, so every switched call would fail reconciliation even though
-- the money is right.
--
-- The check now compares gross against the same debit rows the accrual sums.
-- For a call that never switches the two definitions agree; all 48 ledger rows
-- in prod satisfied the new check when this was written (2026-09-24).

create or replace function public.assert_call_inr_sync(p_call_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, admin
as $$
declare
  c          public.calls%rowtype;
  e          public.provider_earnings_ledger%rowtype;
  u          public.media_channel_usage%rowtype;
  v_ps       public.paid_sessions%rowtype;
  v_cfg      jsonb;
  v_has_e    boolean := false;
  v_has_u    boolean := false;
  v_voice    integer;
  v_hd       integer;
  v_cogs     integer;
  v_take     integer;
  v_minutes  integer;
  v_tokens   integer;
  v_debited  integer;
begin
  select * into c from public.calls where id = p_call_id;
  if not found then
    raise exception 'call not found' using errcode = 'P0002';
  end if;

  select * into v_ps from public.paid_sessions where call_id = p_call_id;
  if not found or v_ps.minutes_billed <= 0 then
    raise exception 'call has no billed paid_session minutes' using errcode = 'P0001';
  end if;

  v_minutes := v_ps.minutes_billed;
  v_tokens := v_ps.tokens_debited;

  select l.* into e
  from public.provider_earnings_ledger l
  where l.session_id = v_ps.id;
  v_has_e := found;

  if v_has_e then
    select coalesce(sum(-t.tokens_delta), 0)::integer
    into v_debited
    from public.token_transactions t
    where t.session_id = v_ps.id
      and t.kind = 'usage_debit'
      and t.status = 'succeeded';
    if e.gross_tokens <> v_debited then
      raise exception 'gross_tokens != sum of the session''s usage debits'
        using errcode = 'P0001';
    end if;
    if e.provider_tokens <> (e.gross_tokens * v_ps.provider_share_percent) / 100 then
      raise exception 'provider_tokens != gross × provider_share_percent / 100'
        using errcode = 'P0001';
    end if;
  end if;

  select * into u
  from public.media_channel_usage
  where call_id = p_call_id and source = 'product_estimate';
  v_has_u := found;

  select payload into v_cfg
  from admin.config_active
  where domain = 'media_cogs' and environment = 'prod';
  v_voice := coalesce((v_cfg ->> 'voice_paise_per_conv_min')::integer, 16);
  v_hd := coalesce((v_cfg ->> 'video_hd_paise_per_conv_min')::integer, 66);
  v_cogs := v_minutes * (
    case when c.medium = 'video' then v_hd else v_voice end
  );

  if v_has_u and u.cost_paise_est <> v_cogs then
    raise exception 'product_estimate COGS != minutes × media_cogs rate'
      using errcode = 'P0001';
  end if;
  if v_has_u and u.conversation_minutes <> v_minutes then
    raise exception 'product_estimate minutes != paid_sessions.minutes_billed'
      using errcode = 'P0001';
  end if;

  v_take := coalesce(e.gross_tokens, v_tokens) - coalesce(e.provider_tokens, 0);

  return jsonb_build_object(
    'call_id', p_call_id,
    'medium', c.medium,
    'product_minutes', v_minutes,
    'member_tokens', v_tokens,
    'member_paise', v_tokens * 100,
    'gross_tokens', e.gross_tokens,
    'provider_tokens', e.provider_tokens,
    'provider_paise', coalesce(e.provider_tokens, 0) * 100,
    'platform_take_tokens', v_take,
    'platform_take_paise', v_take * 100,
    'agora_cost_paise_est', coalesce(u.cost_paise_est, v_cogs),
    'margin_after_media_paise',
      v_take * 100 - coalesce(u.cost_paise_est, v_cogs),
    'earnings_status', e.status,
    'cogs_source', u.source,
    'inr_sync_ok', true
  );
end;
$$;

comment on function public.assert_call_inr_sync(uuid) is
  'Verifies earnings ledger arithmetic (gross = the session''s usage debits) and '
  'product_estimate COGS against paid_sessions.minutes_billed. Raises on internal '
  'inconsistency. Not invoice truth.';
