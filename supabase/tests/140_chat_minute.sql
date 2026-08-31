-- pgTAP for the temporary spend_chat_minute compatibility response.
-- Migration 037 retires client-side chat billing; the server session meter is
-- now the only charge path.

\set ON_ERROR_STOP on
begin;
select plan(5);

select ok(
  to_regprocedure('public.spend_chat_minute()') is not null,
  'spend_chat_minute compatibility function exists'
);

select is(
  pg_get_function_result('public.spend_chat_minute()'::regprocedure),
  'json',
  'spend_chat_minute returns json'
);

select ok(
  has_function_privilege('authenticated', 'public.spend_chat_minute()', 'EXECUTE'),
  'authenticated may call the rollout compatibility function'
);

select ok(
  not has_function_privilege('anon', 'public.spend_chat_minute()', 'EXECUTE'),
  'anon may not call spend_chat_minute'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"00000000-0000-4000-8000-000000000140","role":"authenticated"}';

select is(
  public.spend_chat_minute()::text,
  '{"success" : true, "new_balance" : null, "compat" : "no-op"}',
  'compatibility call succeeds without debiting a wallet'
);

select * from finish();
rollback;
