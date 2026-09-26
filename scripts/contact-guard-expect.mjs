#!/usr/bin/env node
/**
 * Records what the current contact-guard spec does on every fixture row.
 *
 *   node --experimental-strip-types scripts/contact-guard-expect.mjs [--import <set> <blind> <file>]
 *
 * supabase/tests/contact_guard_cases.json holds each row's TRUE label (the
 * author's) and its `expect`: the hard rule ids the mirror returns, the signal
 * ids the SQL returns, and for sequences the window's answer after each
 * message. A known miss or false block keeps its true label with `expect`
 * recording the current behaviour, so an improvement and a regression both
 * show up as a diff, deliberately committed.
 *
 * Jest (__tests__/contactGuard.test.ts) asserts the mirror equals `expect`;
 * pgTAP (the generated 000_contact_guard_parity suite in scripts/db-test.mjs)
 * asserts the SQL equals the same `expect`. That is the parity.
 *
 * Signal ids come from the SQL, which is the only place signal rules exist,
 * so this needs a database with migration 156 applied: DATABASE_URL, e.g. the
 * scratch container `docker run -d --rm --name cg-scratch -p 55439:5432
 * -e POSTGRES_HOST_AUTH_METHOD=trust companionchat/postgres-pgtap:16` after
 * creating schema private and the three Supabase roles.
 *
 * --import appends a labelled set ({rows, sequences}) to the fixture first.
 * `blind` is "yes" when its author never saw the spec, "tuned" once the spec
 * has been adjusted on its misses, "no" for hand-written probes.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = join(ROOT, 'supabase/tests/contact_guard_cases.json');
const DATABASE_URL = process.env.DATABASE_URL ?? '';

const mirror = await import(join(ROOT, 'src/lib/contactGuard.generated.ts'));

let fixture;
try {
  fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
} catch {
  fixture = { rows: [], sequences: [] };
}

const importAt = process.argv.indexOf('--import');
if (importAt >= 0) {
  const [set, blind, file] = process.argv.slice(importAt + 1, importAt + 4);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const seen = new Set(fixture.rows.map(r => r.text));
  for (const r of data.rows ?? []) {
    if (seen.has(r.text)) {
      continue;
    }
    seen.add(r.text);
    fixture.rows.push({
      text: r.text,
      label: r.label,
      category: r.category ?? null,
      surface: r.surface ?? 'chat',
      set,
      blind,
      ...(r.note ? { note: r.note } : {}),
    });
  }
  for (const s of data.sequences ?? []) {
    fixture.sequences.push({
      messages: s.messages,
      label: s.label,
      set,
      blind,
      ...(s.note ? { note: s.note } : {}),
    });
  }
}

/** The sender's last six messages at each step, as the gate reads them. */
const windowsOf = messages =>
  messages.map((_, i) =>
    mirror.contactWindow(messages.slice(Math.max(0, i - 5), i + 1)),
  );

let signals = null;
if (DATABASE_URL !== '') {
  const payload = JSON.stringify(fixture.rows.map(r => r.text)).replace(
    /'/g,
    "''",
  );
  const result = spawnSync(
    'psql',
    [DATABASE_URL, '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'],
    {
      input: `select json_agg(private.contact_guard_signals(x) order by o) from json_array_elements_text('${payload}'::json) with ordinality as a(x, o);`,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    },
  );
  if (result.status !== 0) {
    console.error(result.stderr);
    process.exit(1);
  }
  signals = JSON.parse(result.stdout);
} else {
  console.warn('DATABASE_URL unset: signal expectations are left as they were');
}

fixture.rows = fixture.rows.map((r, i) => ({
  ...r,
  expect: {
    rules: mirror.contactGuardRules(r.text),
    signals: signals ? signals[i] : r.expect?.signals ?? [],
  },
}));
fixture.sequences = fixture.sequences.map(s => ({
  ...s,
  expect: { windows: windowsOf(s.messages) },
}));
fixture.spec = mirror.CONTACT_GUARD_SPEC;

// The repo never spells one messenger's name (see the spec's TG); JSON can
// carry its "g" as an escape, and JSON.parse reads it back as the letter.
const NAME = new RegExp(['tele', 'gram'].join(''), 'gi');
const text = `${JSON.stringify(fixture, null, 1)}\n`.replace(
  NAME,
  m => `${m.slice(0, 4)}\\u0067${m.slice(5)}`,
);
writeFileSync(FIXTURE, text);
console.log(
  `contact-guard expect: ${fixture.rows.length} rows, ${
    fixture.sequences.length
  } sequences, spec ${fixture.spec.slice(0, 8)}`,
);
