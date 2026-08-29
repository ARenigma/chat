-- ===========================================================================
-- 033  credit_purchased_recharge — server-side recharge credit
-- ===========================================================================
-- Called by the cashfree-webhook Edge Function (service_role) after a
-- successful payment verification. Credits purchased_balance (not promo),
-- marks the corresponding token_transactions row as succeeded, and the
-- sync_token_balance trigger (migration 028) keeps token_balance in sync
-- automatically when purchased_balance is updated.
--
-- Idempotent: the status = 'created' guard means a replayed webhook
-- credits tokens at most once.
--
-- Also adds 'recharge_sheet_opened' to the guard_event_shape allowlist so
-- the billing telemetry event can be recorded from the client.
--
-- ADR-0022: server-authoritative payment verification.

create or replace function public.credit_purchased_recharge(
  p_user_id       uuid,
  p_amount        integer,
  p_transaction_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  -- Idempotency: only proceed if the transaction is still in 'created' state.
  update public.token_transactions
  set    status = 'succeeded'
  where  id = p_transaction_id
    and  user_id = p_user_id
    and  status = 'created'
    and  kind = 'recharge';

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- Already processed or not found; return without crediting.
    return;
  end if;

  -- Credit purchased_balance. The sync_token_balance trigger fires on
  -- purchased_balance update and sets token_balance = promo + purchased.
  update public.profiles
  set    purchased_balance = purchased_balance + p_amount
  where  id = p_user_id;
end;
$$;

comment on function public.credit_purchased_recharge(uuid, integer, uuid) is
  'Credit purchased tokens after a successful Cashfree payment. '
  'Idempotent: the status=created guard prevents double-crediting on webhook replay. '
  'Called by the cashfree-webhook Edge Function (service_role). (ADR-0022)';

revoke all on function public.credit_purchased_recharge(uuid, integer, uuid) from public;
-- Not granted to authenticated: only the service_role webhook caller may credit.

-- ---------------------------------------------------------------------------
-- Telemetry allowlist extension: add recharge_sheet_opened
-- ---------------------------------------------------------------------------
-- Reproduced in full per migration 032's comment: the complete allowlist is
-- stated here so a reader of this file gets the whole picture.

create or replace function public.guard_event_shape()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_key text;
begin
  if new.name not in (
    -- 006 originals
    'app_open', 'directory_viewed', 'conversation_opened', 'message_sent',
    'send_rejected', 'refill_opened', 'refill_claimed', 'report_submitted',
    'user_blocked', 'user_unblocked', 'account_deleted', 'identity_linked',
    'signed_in', 'application_submitted', 'availability_changed',
    'review_submitted',
    -- 011 additions
    'reaction_added', 'reaction_removed', 'reply_sent',
    'voice_note_sent', 'voice_note_played',
    'call_started', 'call_answered', 'call_declined', 'call_ended',
    'call_rejected', 'presence_changed',
    -- 032 additions (policy gate + paid sessions)
    'policy_accepted', 'session_requested', 'session_ended',
    -- 033 additions (UCB / Cashfree billing)
    'recharge_sheet_opened'
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
