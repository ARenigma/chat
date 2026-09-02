-- ---------------------------------------------------------------------------
-- 046  Generate a GST invoice for every succeeded recharge
-- ---------------------------------------------------------------------------
-- The `generate-invoice` Edge Function (migration 019 + the function itself) was
-- never invoked: `verify-order` credits tokens and returns, and `mock_recharge`
-- writes the ledger row directly, so no `invoices` row or PDF was ever created
-- and the "Download invoice" action in TransactionHistoryScreen had nothing to
-- render. This wires it, once, for BOTH paths.
--
-- A trigger on `token_transactions`, not a change to each caller: a recharge is
-- "succeeded" either by an INSERT (`mock_recharge`) or by an UPDATE from
-- 'created' (`credit_purchased_recharge`, migration 033). One AFTER trigger on
-- the transition covers both and cannot be forgotten by a future caller.
--
-- Delivery mirrors 009's push sender exactly: the function URL and service_role
-- key live in Vault (empty here, filled out of band — a secret in a migration is
-- a secret in git), and the call goes out through `pg_net` so it never blocks or
-- fails the recharge transaction. `generate-invoice` is idempotent per
-- transaction (invoices.transaction_id is UNIQUE), and the trigger additionally
-- skips a row that already has one, so a re-fire costs nothing.
--
-- Test-harness safe: `scripts/db-test.mjs` runs on a plain postgres+pgTAP image
-- with no pg_net and no Vault. The function resolves `net.http_post` and the
-- vault view at call time, and returns early when the vault view is absent, so a
-- recharge inserted in a test is a silent no-op rather than an error.

-- Vault secrets: created empty, filled out of band. Guarded so re-running never
-- overwrites a rotated value, and skipped entirely where Vault does not exist.
do $$
begin
  if to_regclass('vault.secrets') is null then
    return;
  end if;
  if not exists (select 1 from vault.secrets where name = 'invoice_generator_url') then
    perform vault.create_secret('', 'invoice_generator_url',
      'Full https URL of the generate-invoice Edge Function');
  end if;
  if not exists (select 1 from vault.secrets where name = 'invoice_generator_key') then
    perform vault.create_secret('', 'invoice_generator_key',
      'service_role key used to authenticate the trigger call to generate-invoice');
  end if;
end
$$;

create or replace function public.notify_generate_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_key text;
begin
  -- No Vault means the test harness (also no pg_net): do nothing, successfully.
  if to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;

  -- Already invoiced — the common case on a re-fire. Costs one indexed lookup
  -- rather than a cold-start HTTP request the function would only reject.
  if exists (select 1 from public.invoices where transaction_id = new.id) then
    return null;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'invoice_generator_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'invoice_generator_key';

  -- Unconfigured generator: quiet, like the push sender. The missing invoice is
  -- the symptom; `select * from vault.decrypted_secrets` is the diagnosis.
  if v_url is null or v_url = '' or v_key is null or v_key = '' then
    return null;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('transaction_id', new.id),
    timeout_milliseconds := 20000
  );
  return null;
end;
$$;

revoke all on function public.notify_generate_invoice() from public, anon, authenticated;

comment on function public.notify_generate_invoice() is
  'AFTER trigger: on a recharge reaching status=succeeded, asks the '
  'generate-invoice Edge Function (via pg_net + Vault) to mint the GST invoice '
  'PDF. Idempotent; a no-op where Vault/pg_net are absent.';

-- Two triggers, not one: a WHEN clause cannot reference OLD on INSERT (there is
-- no OLD row) or TG_OP (function-only), so the "fire once, on the transition to
-- succeeded" rule is split by operation.
drop trigger if exists on_recharge_succeeded on public.token_transactions;
drop trigger if exists on_recharge_inserted on public.token_transactions;
drop trigger if exists on_recharge_credited on public.token_transactions;

-- mock_recharge writes a 'succeeded' row directly.
create trigger on_recharge_inserted
  after insert on public.token_transactions
  for each row
  when (new.status = 'succeeded' and new.kind = 'recharge')
  execute function public.notify_generate_invoice();

-- credit_purchased_recharge flips 'created' → 'succeeded'. The status guard keeps
-- an unrelated update to an already-succeeded row from re-triggering.
create trigger on_recharge_credited
  after update on public.token_transactions
  for each row
  when (
    new.status = 'succeeded'
    and new.kind = 'recharge'
    and old.status is distinct from new.status
  )
  execute function public.notify_generate_invoice();
