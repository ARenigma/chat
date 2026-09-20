-- 128  Enable RLS on Truecaller private identity tables
--
-- Migration 127 created these tables in a non-exposed schema, revoked every app
-- grant, and exposed only SECURITY DEFINER service-role RPCs. That is already a
-- strong boundary, but repository policy requires RLS on every table carrying
-- user/security data as an independent layer.
--
-- No policies are created. service_role RPCs are SECURITY DEFINER and the table
-- owner bypasses RLS; anon/authenticated have neither schema/table grants nor
-- policies, so direct access remains impossible.

alter table private.external_identities enable row level security;
alter table private.pending_identity_challenges enable row level security;
