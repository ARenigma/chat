#!/usr/bin/env node
/**
 * Read Pappal's Sentry from the terminal, no browser: the telemetry check that
 * runs after every device or E2E step.
 *
 *   node scripts/sentry/sentry.mjs issues [days=14]   unresolved issues, most frequent first
 *   node scripts/sentry/sentry.mjs since <minutes>    anything first or last seen in the window
 *   node scripts/sentry/sentry.mjs issue <id|PAPPAL-n> latest event: stack, breadcrumbs, tags
 *   node scripts/sentry/sentry.mjs releases           events and new issues per release
 *
 * Read-only by design: resolving or ignoring an issue is a deliberate act in
 * the Sentry UI, never a side effect of a check.
 *
 * Auth: a Sentry auth token with read scopes (org:read, project:read,
 * event:read) in ~/.config/pappal/sentry.env as SENTRY_AUTH_TOKEN, outside the
 * repo, never printed. API: https://docs.sentry.io/api/
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ORG = 'amit-ranjan';
const PROJECT_ID = '4512091519778896';
// The org's own host serves the API for its region (the org is on de.sentry.io).
const BASE = `https://${ORG}.sentry.io/api/0`;

function token() {
  const file = join(homedir(), '.config/pappal/sentry.env');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error(
      `no ${file}: create it with SENTRY_AUTH_TOKEN=<read-scoped token>`,
    );
  }
  const m = text.match(
    /^\s*(?:export\s+)?SENTRY_AUTH_TOKEN\s*=\s*"?([^"\n]+)"?\s*$/m,
  );
  if (!m) throw new Error(`SENTRY_AUTH_TOKEN missing in ${file}`);
  return m[1].trim();
}

const auth = { authorization: `Bearer ${token()}` };

async function api(path) {
  const res = await fetch(BASE + path, { headers: auth });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `${path.split('?')[0]} → ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  return res.json();
}

const tv = t =>
  (t?.topValues ?? []).map(v => `${v.value} ×${v.count}`).join('; ');

async function issueId(ref) {
  if (/^\d+$/.test(ref)) return ref;
  const hits = await api(
    `/organizations/${ORG}/issues/?project=${PROJECT_ID}&query=${encodeURIComponent(
      ref,
    )}&statsPeriod=90d`,
  );
  const hit = hits.find(i => i.shortId === ref);
  if (!hit) throw new Error(`no issue ${ref}`);
  return hit.id;
}

async function listIssues(query, period) {
  const issues = await api(
    `/organizations/${ORG}/issues/?project=${PROJECT_ID}&statsPeriod=${period}&query=${encodeURIComponent(
      query,
    )}&sort=freq&limit=50`,
  );
  if (issues.length === 0) {
    console.log('none');
    return;
  }
  for (const i of issues) {
    const [rel, dev] = await Promise.all([
      api(`/organizations/${ORG}/issues/${i.id}/tags/release/`).catch(
        () => null,
      ),
      api(`/organizations/${ORG}/issues/${i.id}/tags/device/`).catch(
        () => null,
      ),
    ]);
    console.log(
      `${i.shortId} [${i.level}] ${i.count} events, ${
        i.userCount
      } users — ${i.title.slice(0, 110)}\n` +
        `   ${i.culprit ?? ''}\n   first ${i.firstSeen?.slice(
          0,
          16,
        )}  last ${i.lastSeen?.slice(0, 16)}  release ${tv(rel)}  device ${tv(
          dev,
        )}`,
    );
  }
}

const [cmd, arg] = process.argv.slice(2);

switch (cmd) {
  case 'issues':
    await listIssues('is:unresolved', `${Number(arg ?? 14)}d`);
    break;
  case 'since': {
    const minutes = Number(arg ?? 30);
    const since = new Date(Date.now() - minutes * 60_000)
      .toISOString()
      .slice(0, 19);
    await listIssues(`lastSeen:>${since}`, '14d');
    break;
  }
  case 'issue': {
    const id = await issueId(arg);
    const i = await api(`/organizations/${ORG}/issues/${id}/`);
    const e = await api(`/organizations/${ORG}/issues/${id}/events/latest/`);
    console.log(
      `${i.shortId} [${i.level}] ${i.count} events — ${i.title}\n${i.permalink}`,
    );
    for (const x of e.entries ?? []) {
      if (x.type === 'exception') {
        for (const v of x.data?.values ?? []) {
          console.log(`\n${v.type}: ${v.value}`);
          const frames = (v.stacktrace?.frames ?? []).slice(-15).reverse();
          for (const f of frames) {
            console.log(
              `   ${f.inApp ? '*' : ' '} ${f.module ?? f.filename ?? '?'}.${
                f.function ?? '?'
              }:${f.lineNo ?? ''}`,
            );
          }
        }
      }
      if (x.type === 'breadcrumbs') {
        console.log('\nbreadcrumbs (last 20):');
        for (const b of (x.data?.values ?? []).slice(-20)) {
          const what = b.message ?? (b.data ? JSON.stringify(b.data) : '');
          console.log(
            `   ${b.timestamp?.slice(11, 19)} ${b.category ?? ''} ${what.slice(
              0,
              140,
            )}`,
          );
        }
      }
    }
    const tags = (e.tags ?? []).map(t => `${t.key}: ${t.value}`).join(' | ');
    console.log(`\ntags ${tags}`);
    break;
  }
  case 'releases': {
    const rel = await api(
      `/organizations/${ORG}/releases/?project=${PROJECT_ID}&per_page=15`,
    );
    for (const r of rel) {
      console.log(
        `${r.version}  new issues ${r.newGroups}  last event ${
          r.lastEvent?.slice(0, 16) ?? 'none'
        }`,
      );
    }
    break;
  }
  default:
    console.log(
      'usage: issues [days] | since <minutes> | issue <id|PAPPAL-n> | releases',
    );
    process.exitCode = 1;
}
