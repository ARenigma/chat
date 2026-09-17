-- The email a Google OAuth provider returns is not guaranteed to match the
-- casing the founder typed when the row was added to the allowlist, and
-- `.eq('email', user.email)` in every admin call site is byte-for-byte. A
-- Telegram-CTO audit (2026-09-17) named this: one capital letter in either
-- place silently locks out a real founder, because `maybeSingle()` just
-- returns null and the caller cannot tell "not a founder" from "typo".
--
-- Normalise what is already there, then make normalised the only shape the
-- column can hold, the same way 004's guard triggers make a column's shape a
-- database fact rather than an application convention every call site has to
-- remember. `admin_sessions.email` carries the same values (FK to this
-- column) and is normalised first so the FK never has to look at a row that
-- does not exist yet.
update admin.admin_sessions set email = lower(email);
update admin.founder_allowlist set email = lower(email);

alter table admin.founder_allowlist
  add constraint founder_allowlist_email_is_lowercase check (email = lower(email));

comment on constraint founder_allowlist_email_is_lowercase on admin.founder_allowlist is
  'Every call site normalises the session email with .toLowerCase() before the '
  'lookup (admin/lib/auth/founder.ts); this constraint is what makes that the '
  'only way a row can be added, not merely the current convention.';
