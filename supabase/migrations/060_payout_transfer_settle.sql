-- ===========================================================================
-- 060  Payout transfer settle hardening + INR sync asserts
-- ===========================================================================
-- cashfree-payout previously marked batches completed on RECEIVED/PENDING.
-- Cashfree docs: a transfer is successful only when status=SUCCESS AND
-- status_code=COMPLETED (TRANSFER_ACKNOWLEDGED). Intermediate accepts stay
-- processing; the webhook is terminal. REVERSED after completed must unwind.
--
-- Also grants service_role EXECUTE (050 revoked PUBLIC without an explicit
-- service_role grant) and adds assert helpers for product ↔ COGS INR checks.

-- 1. Stamp Cashfree id without completing (sync accept path).
create or replace function public.mark_provider_payout_submitted(
  p_batch_id     uuid,
  p_cashfree_id  text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.provider_payout_batches
  set cashfree_batch_id = coalesce(p_cashfree_id, cashfree_batch_id)
  where id = p_batch_id
    and status = 'processing';
end;
$$;

comment on function public.mark_provider_payout_submitted(uuid, text) is
  'Records cf_transfer_id while the batch stays processing. Terminal state '
  'comes from settle_provider_payout_batch via TRANSFER_* webhook.';

revoke all on function public.mark_provider_payout_submitted(uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_provider_payout_submitted(uuid, text)
  to service_role;

-- 2. Idempotent settle: processing→completed|failed; completed→failed on reverse.
create or replace function public.settle_provider_payout_batch(
  p_batch_id        uuid,
  p_cashfree_id     text,
  p_ok              boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.provider_payout_batches
  where id = p_batch_id
  for update;

  if not found then
    return;
  end if;

  if p_ok then
    if v_status in ('processing', 'pending') then
      update public.provider_payout_batches
      set status = 'completed',
          cashfree_batch_id = coalesce(p_cashfree_id, cashfree_batch_id),
          completed_at = now()
      where id = p_batch_id;
    end if;
    -- already completed: idempotent no-op (webhook replay)
    return;
  end if;

  if v_status = 'failed' then
    return;
  end if;

  update public.provider_payout_batches
  set status = 'failed',
      cashfree_batch_id = coalesce(p_cashfree_id, cashfree_batch_id),
      completed_at = null
  where id = p_batch_id;

  -- Release claimed earnings (paid) back to cleared for retry — including
  -- TRANSFER_REVERSED after a prior completed settle.
  update public.provider_earnings_ledger
  set status = 'cleared', payout_batch_id = null
  where payout_batch_id = p_batch_id;
end;
$$;

comment on function public.settle_provider_payout_batch(uuid, text, boolean) is
  'Terminal payout settle. Success only from processing/pending. Failure '
  '(or bank reverse) reverts linked earnings to cleared. Idempotent.';

revoke all on function public.settle_provider_payout_batch(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.settle_provider_payout_batch(uuid, text, boolean)
  to service_role;

revoke all on function public.create_provider_payout_batch(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.create_provider_payout_batch(uuid, boolean)
  to service_role;

-- 3. Pure INR arithmetic check for a call row (product ↔ share ↔ estimate).
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
begin
  select * into c from public.calls where id = p_call_id;
  if not found then
    raise exception 'call not found' using errcode = 'P0002';
  end if;
  if c.minutes_billed <= 0 then
    raise exception 'call has no billed minutes' using errcode = 'P0001';
  end if;

  select * into v_ps from public.paid_sessions where call_id = p_call_id;

  select l.* into e
  from public.provider_earnings_ledger l
  where v_ps.id is not null and l.session_id = v_ps.id;
  v_has_e := found;

  if v_has_e then
    if e.gross_tokens <> e.minutes_billed * e.rate_per_min then
      raise exception 'gross_tokens != minutes_billed × rate_per_min'
        using errcode = 'P0001';
    end if;
    if v_ps.id is null then
      raise exception 'earnings exist without paid_session for call'
        using errcode = 'P0001';
    end if;
    if e.provider_tokens <> (e.gross_tokens * v_ps.provider_share_percent) / 100 then
      raise exception 'provider_tokens != gross × provider_share_percent / 100'
        using errcode = 'P0001';
    end if;
  end if;

  select * into u from public.media_channel_usage where call_id = p_call_id;
  v_has_u := found;

  select payload into v_cfg
  from admin.config_active
  where domain = 'media_cogs' and environment = 'prod';
  v_voice := coalesce((v_cfg ->> 'voice_paise_per_conv_min')::integer, 16);
  v_hd := coalesce((v_cfg ->> 'video_hd_paise_per_conv_min')::integer, 66);
  v_cogs := c.minutes_billed * (
    case when c.medium = 'video' then v_hd else v_voice end
  );

  if v_has_u and u.source = 'product_estimate' and u.cost_paise_est <> v_cogs then
    raise exception 'product_estimate COGS != minutes × media_cogs rate'
      using errcode = 'P0001';
  end if;
  if v_has_u and u.source = 'product_estimate'
     and u.conversation_minutes <> c.minutes_billed then
    raise exception 'product_estimate minutes != call.minutes_billed'
      using errcode = 'P0001';
  end if;

  v_take := coalesce(e.gross_tokens, c.tokens_debited)
    - coalesce(e.provider_tokens, 0);

  return jsonb_build_object(
    'call_id', p_call_id,
    'medium', c.medium,
    'product_minutes', c.minutes_billed,
    'member_tokens', c.tokens_debited,
    'member_paise', c.tokens_debited * 100,
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
  'Verifies earnings ledger arithmetic and product_estimate COGS for a call. '
  'Returns INR legs; raises on internal inconsistency. Not invoice truth.';

revoke all on function public.assert_call_inr_sync(uuid)
  from public, anon, authenticated;
grant execute on function public.assert_call_inr_sync(uuid) to service_role;
