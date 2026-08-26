#!/usr/bin/env node
/**
 * Stage 4 rollback trigger.
 *
 * Sentry can alert on a crash-free rate, but it cannot halt a Play rollout, so
 * this polls release health and exits non-zero when the release is unhealthy,
 * which lets the workflow run `fastlane halt_rollout` before the bad build
 * reaches more users.
 *
 * Deliberately conservative about the "no data yet" case: a release with too few
 * sessions to judge is reported as pending, not healthy. Treating silence as
 * success is how a bad build gets promoted.
 *
 * Env: SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT, SENTRY_RELEASE.
 * Options: --threshold=99.8 --window=2h --min-sessions=50 --wait=15
 */
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v = 'true'] = a.slice(2).split('=');
      return [k, v];
    }),
);

const THRESHOLD = Number(args.threshold ?? 99.8);
const WINDOW = args.window ?? '2h';
const MIN_SESSIONS = Number(args['min-sessions'] ?? 50);
const WAIT_MINUTES = Number(args.wait ?? 15);

const { SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT, SENTRY_RELEASE } =
  process.env;

for (const [name, value] of Object.entries({
  SENTRY_AUTH_TOKEN,
  SENTRY_ORG,
  SENTRY_PROJECT,
  SENTRY_RELEASE,
})) {
  if (!value) {
    console.error(`release-health: ${name} is not set`);
    process.exit(2);
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchSessions() {
  const url = new URL(
    `https://sentry.io/api/0/organizations/${SENTRY_ORG}/sessions/`,
  );
  url.searchParams.set('project', '-1');
  url.searchParams.set('field', 'sum(session)');
  url.searchParams.append('field', 'crash_free_rate(session)');
  url.searchParams.set('statsPeriod', WINDOW);
  url.searchParams.set('query', `release:"${SENTRY_RELEASE}"`);
  url.searchParams.set('interval', WINDOW);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${SENTRY_AUTH_TOKEN}` },
  });
  if (!response.ok) {
    throw new Error(
      `Sentry responded ${response.status}: ${await response.text()}`,
    );
  }
  const body = await response.json();
  const group = body.groups?.[0];
  return {
    sessions: Number(group?.totals?.['sum(session)'] ?? 0),
    // Sentry returns a 0-1 ratio; null when there is nothing to compute.
    crashFree: group?.totals?.['crash_free_rate(session)'] ?? null,
  };
}

const deadline = Date.now() + WAIT_MINUTES * 60_000;
let attempt = 0;

while (Date.now() < deadline) {
  attempt += 1;
  let reading;
  try {
    reading = await fetchSessions();
  } catch (err) {
    console.error(
      `release-health: ${
        err instanceof Error ? err.message : 'request failed'
      }`,
    );
    await sleep(30_000);
    continue;
  }

  const rate = reading.crashFree === null ? null : reading.crashFree * 100;
  const shown = rate === null ? 'n/a' : `${rate.toFixed(2)}%`;
  console.log(
    `release-health [${attempt}]: ${reading.sessions} session(s) in ${WINDOW}, crash-free ${shown}`,
  );

  if (reading.sessions < MIN_SESSIONS || rate === null) {
    await sleep(60_000);
    continue;
  }

  if (rate < THRESHOLD) {
    console.error(
      `\nrelease-health UNHEALTHY: crash-free ${rate.toFixed(
        2,
      )}% is below ${THRESHOLD}% ` +
        `over ${reading.sessions} sessions, halt the rollout`,
    );
    process.exit(1);
  }

  console.log(
    `\nrelease-health OK: crash-free ${rate.toFixed(2)}% over ${
      reading.sessions
    } sessions ` + `(threshold ${THRESHOLD}%)`,
  );
  process.exit(0);
}

// Never seen enough traffic to judge. Not a pass.
console.error(
  `\nrelease-health PENDING: fewer than ${MIN_SESSIONS} sessions after ${WAIT_MINUTES} minutes. ` +
    'Not promoting a release that has not been exercised.',
);
process.exit(3);
