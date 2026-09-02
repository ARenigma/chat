/**
 * backfill-invoices.mjs — one-off: mint a GST invoice for every already-succeeded
 * recharge that does not have one yet.
 *
 * Going forward, the `on_recharge_succeeded` trigger (migration 046) invokes
 * generate-invoice for new recharges. This covers the rows that predate it —
 * including the dev/mock recharges used for testing.
 *
 * Auth: fetches the project's service_role key via the Supabase CLI (same as
 * scripts/dev-session.mjs) and uses it only in memory to authorise the
 * generate-invoice calls. It is never printed.
 *
 * Usage:  node scripts/backfill-invoices.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const g = k =>
  (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim();
const URL_BASE = g('SUPABASE_URL');
const ANON = g('SUPABASE_ANON_KEY');
if (!URL_BASE || !ANON) {
  throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY missing from .env');
}
const ref = new URL(URL_BASE).hostname.split('.')[0];

const keysRaw = execFileSync(
  'npx',
  [
    'supabase',
    'projects',
    'api-keys',
    '--project-ref',
    ref,
    '--output',
    'json',
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
);
const SERVICE_ROLE = JSON.parse(keysRaw).find(
  k => k.name === 'service_role',
)?.api_key;
if (!SERVICE_ROLE) {
  throw new Error('could not read service_role key from supabase CLI');
}

const svc = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'content-type': 'application/json',
};

// Succeeded recharges with the embedded invoice (if any), so we can skip the
// ones already covered.
const listRes = await fetch(
  `${URL_BASE}/rest/v1/token_transactions` +
    `?select=id,created_at,invoices(id)&status=eq.succeeded&kind=eq.recharge&order=created_at.asc`,
  { headers: svc },
);
if (!listRes.ok) {
  throw new Error(`list failed: ${listRes.status} ${await listRes.text()}`);
}
const rows = await listRes.json();
const pending = rows.filter(r => !r.invoices || r.invoices.length === 0);
console.log(
  `${rows.length} succeeded recharges, ${pending.length} without an invoice`,
);

let ok = 0;
let failed = 0;
for (const row of pending) {
  const res = await fetch(`${URL_BASE}/functions/v1/generate-invoice`, {
    method: 'POST',
    headers: svc,
    body: JSON.stringify({ transaction_id: row.id }),
  });
  if (res.ok) {
    const body = await res.json();
    ok += 1;
    console.log(
      `  ✓ ${row.id} → ${body.invoice_number ?? body.document_type ?? 'ok'}`,
    );
  } else {
    failed += 1;
    console.error(`  ✗ ${row.id} → ${res.status} ${await res.text()}`);
  }
}
console.log(`done: ${ok} generated, ${failed} failed`);
