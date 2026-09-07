-- ---------------------------------------------------------------------------
-- 071 — the server can read the active config
-- ---------------------------------------------------------------------------
-- Why this exists
-- ---------------------------------------------------------------------------
-- The GST rate had TWO independent sources that agreed only by coincidence:
--
--   * `economics.gst_rate_bps` in the admin control plane (seeded 1800 in
--     migration 026), which is what the APP displays — src/api/appConfig.ts
--     reads it through `public.get_active_config`.
--   * a `GST_RATE_BPS` environment variable on the `generate-invoice` edge
--     function (also defaulting to 1800), which is what the INVOICE taxes at.
--
-- Nothing tied them together. Publishing a new rate from the admin dashboard
-- would have changed every price the app shows while the invoice kept taxing
-- at the old rate — and the invoice is the legal document, so that is the
-- worst place in the system for the two to disagree (Amit, 2026-09-07:
-- "make the invoice read admin config").
--
-- `generate-invoice` therefore now calls `get_active_config('economics')`, the
-- same accessor the client uses. It runs as `service_role`, and migration 026
-- closes with:
--
--   revoke all on function public.get_active_config(text)
--     from public, anon, service_role;
--   grant execute on function public.get_active_config(text) to authenticated;
--
-- so the call would have failed and fallen silently back to the env var,
-- leaving the two sources exactly as divorced as before while looking fixed.
-- That is the whole reason this migration is a separate, explicit step rather
-- than something the edge-function change could carry on its own.
--
-- Why granting it is safe
-- ---------------------------------------------------------------------------
-- The revoke was belt-and-braces from a time when no server consumer existed;
-- it is not a security boundary. `service_role` already bypasses RLS and can
-- read every table in the database, so withholding one STABLE, read-only
-- accessor that returns a config payload — rates, share percentages, feature
-- toggles, no PII and no credentials — denies it nothing it could not obtain
-- another way. What the revoke does buy is that `anon` and `public` still
-- cannot reach it, and this migration does not touch either of them.
--
-- The narrower alternative — exposing the `admin` schema to the REST API so the
-- function could select `admin.config_active` directly — would widen the
-- surface considerably more than this does, for the same one value.
--
-- References: ADR-0023 (versioned admin control plane), migration 026 § 8.
-- ---------------------------------------------------------------------------

grant execute on function public.get_active_config(text) to service_role;

comment on function public.get_active_config(text) is
  'Read-only accessor for billing and session RPCs. Returns the active '
  'prod payload for a config domain, or null if not yet published. '
  'SECURITY DEFINER so authenticated role can read the admin schema row. '
  'Also granted to service_role (migration 071) so generate-invoice taxes at '
  'the same rate the app displays; anon and public remain revoked.';
