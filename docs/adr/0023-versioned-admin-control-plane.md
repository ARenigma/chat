# ADR-0023, Versioned admin control plane

- **Status:** Accepted (2026-08-29)
- **Decision by:** Amit Ranjan

---

## Context

All billing knobs, kill switches, the recharge catalog, policy versions, and
the report taxonomy currently live as build-time constants in `src/config.ts`
or as unmaintainable SQL (`002_bootstrap_and_grants.sql` daily-refill amount,
`app_flags.mock_payments`). At any paid-service scale, changing a rate or
flipping a kill switch requires a code deploy. There is no audit trail, no
safe rollback, and no staging rehearsal.

Specifically lacking a managed home:

- Global session rates (chat/audio/video per minute)
- Provider revenue split percentage
- Recharge pack catalog and Play product IDs
- Starting balance grant and daily refill enable/amount
- Low-balance threshold, rate-limit config, refund window
- Provider payout cadence, hold period, minimum
- Kill switches (`PAYMENTS_ENABLED`, `CALLS_ENABLED`, etc.)
- Report taxonomy (categories shown in the end-session report sheet)
- UI flags (which auth entry points are shown)

---

## Decision

### Same-repo Next.js admin app at `admin/`

A Next.js (App Router) workspace lives at `admin/` in the same repository.
It is deployed to **admin.pappal.live** on Vercel, sharing the same Supabase
project (with environment discrimination via `APP_ENV`).

Choosing same-repo over a separate repo:

- Config schema migrations ship alongside app migrations in the same PR.
- TypeScript types for the config shape are shared.
- No cross-repo deploy coordination.

### Auth: Supabase Google OAuth + founder email allowlist

Admin access is gated by Supabase Auth (Google OAuth) plus a server-side
check that the authenticated email is in an admin allowlist. The allowlist is
configured as a Supabase secret, not in the database, so it cannot be altered
via the admin UI itself.

The service-role key is **server-only** and never passed to the client (never
`NEXT_PUBLIC_`). All admin reads and writes go through server actions or API
routes.

### Draft → active version lifecycle

Every configuration change follows a versioned lifecycle:

1. **Draft**: changes are composed in the UI but not yet live.
2. **Active**: a publish action promotes a draft to active; the previous active
   becomes a historical version (immutable).
3. **Audit log**: every publish records the actor, timestamp, previous version,
   and a required plain-language reason.
4. **Effective-date scheduling**: a draft may be published with a future
   effective date; the config service reads the active version that is
   effective as of `now()`.
5. **Rollback**: implemented as "publish previous version as a new version."
   There is no in-place revert; the audit trail is append-only.

### Production publish requires: single-admin typed confirmation + fresh Google auth

To publish to production:

- The admin types a reason (minimum 20 characters).
- Supabase re-prompts for Google authentication (fresh session, not a cached
  token).
- A single-admin gate: only one production publish may be in-flight at a time.

**Staging hard-rejects real external side effects.** A staging publish cannot
trigger a real Cashfree webhook, a real FCM push to real devices, or a real
Play Billing acknowledgement. The config service checks `APP_ENV` before any
external call.

### Controlled knobs

The following are runtime-configurable via the admin control plane:

| Category            | Knobs                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Economics           | Chat/audio/video per-minute rates; provider revenue share %                                 |
| Recharge catalog    | Token packs (name, token amount, GST-inclusive price); Play product IDs; active/inactive    |
| Wallet / promos     | Starting balance grant (tokens); daily refill enable; daily refill amount                   |
| Thresholds          | Low-balance warning threshold; rate-limit window and count; refund window (hours)           |
| Payout policy       | Cadence (weekly/biweekly/monthly); hold period (days); minimum payout (₹); enabled/disabled |
| Kill switches       | `PAYMENTS_ENABLED`; `CALLS_ENABLED`; `PHONE_AUTH_ENABLED`; `MOCK_PAYMENTS`                  |
| Report taxonomy     | Report categories shown in the end-session sheet (label, severity, enabled)                 |
| UI auth-entry flags | Which sign-in methods are shown in the auth screen                                          |

### NOT runtime-configurable

The following remain in code or schema and require a deploy to change:

- RLS policies (security boundary; must be reviewed and deployed deliberately)
- Auth provider config (Supabase Dashboard / `config.toml`)
- Schema shape (still migrated via `supabase/migrations/`)
- Invoice number format (tax compliance; sequence already in DB)
- Provider age gate (legal requirement; not a business knob)

### Break-glass fallback

The CLI moderation script (`scripts/moderate.mjs`) remains as a break-glass
fallback for the cases where the admin UI is unreachable (Vercel outage,
bad deploy). It reads directly from the Supabase service role and must be
kept in sync with the config schema.

---

## Consequences

- **New `admin/` Next.js workspace**: separate `package.json`, separate Vercel
  project, separate `.env.local`. Shares only the Supabase project and
  TypeScript types.
- **New config schema migrations**: a `admin_config_versions` table (or
  equivalent) with the versioned config JSONB blob, effective date, actor,
  reason, and status. Schema lives in `supabase/migrations/` like all other
  schema changes.
- **`src/config.ts` build-time constants retire progressively**: as each knob
  moves to the admin control plane, the corresponding constant in `src/config.ts`
  becomes a runtime fetch. Until the admin plane is live, the build-time
  constant remains the authoritative value.
- **`contract.test.ts` must assert** that every kill switch consumed by the app
  has a corresponding admin config key — preventing a new flag from being added
  in `config.ts` without a matching admin knob.
