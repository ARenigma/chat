---
name: verify-pappal
description: Verifies Pappal changes through deterministic static, database, Android device, visual, motion, and release checks. Use after changing app behavior, before claiming completion, when reproducing a bug, and before committing or pushing.
---

# Verify Pappal

Close the loop with executable evidence. Do not substitute a green unit test for
device behavior, or a screenshot for motion.

## Launch

```bash
npm run android:qa
npm run control -- launch
```

`android:qa` installs a debug APK with its JS embedded, so proof does not depend
on Metro. Ready means `npm run control -- info --json` reports the expected
version and `com.companionchat/.MainActivity` as foreground.

Only drive one device at a time. When several are attached, ask which serial and
pass `--serial`; never guess. Do not run two agents against one device.

Teardown:

```bash
npm run control -- cleanup
```

## Doctor

Run first, after any surprising state, and after a failed drive:

```bash
npm run control -- doctor --json
```

`ready` proves required host tools, one selected authorized device, the app
package, and `.env`. `degraded` includes the exact repair step. Do not drive a
degraded instance.

Read [features/README.md](features/README.md) for user paths, stable IDs, and
existing drivers. `docs/FEATURES.md` remains the implementation inventory.

## Drive

Use ARTEMIS for autonomous journeys and Android-owned UI. Use the helper for
deterministic setup and observation:

```bash
npm run control -- snapshot --out artifacts/verification/state.xml
npm run control -- tap --id settings
npm run control -- wait-settle
npm run control -- screenshot artifacts/verification/after-settings.png
```

Locators are `testID` first, then visible text/accessibility. `click-xy` is an
explicit fallback only after a live snapshot proves no dynamic locator exists.

Choose the smallest sufficient proof, then run the broader gate:

```bash
npm run verify                 # generated artifacts, TS, lint, Jest, manifest, bundle
npm run verify:ci              # exact GitLab static gate, including coverage
npm run verify:full            # verify + real Postgres/pgTAP
npm run android:v2-device-gates
npm run e2e:install
npm run android:benchmark:feel
npm run android:framestats
npm run android:lint
```

Database/RPC/RLS changes require pgTAP. UI/state changes require ARTEMIS/device
proof. Motion requires video/frame inspection. Native SDK work requires logcat
showing that SDK path, not merely a working fallback.

## Evidence

Store durable run evidence under `artifacts/verification/` (gitignored):

```bash
npm run control -- snapshot --out artifacts/verification/<feature>-before.xml
npm run control -- screenshot artifacts/verification/<feature>-after.png
```

Exercise the real user path, capture the action and resulting state, and verify
side effects (database rows, logs, notification/API events) beside what is
visible. Test-only deep links are setup, never the whole proof.

Report commands/exit status, serial/API/build variant, evidence paths, native
logs where relevant, and any exact blocker.

## Cleanup

Run `npm run control -- cleanup` after every successful or failed drive. It
force-stops only `com.companionchat`; it never kills by process name, clears app
data, or removes `artifacts/verification/`. If `e2e.mjs` started local Supabase,
let its own teardown stop the instance it owns.

After cleanup, assert evidence still exists.

## Helpers

- `scripts/control-pappal.mjs` — executable app doctor/driver/evidence helper.
- `scripts/e2e.mjs` — owns local Supabase, seed state, Maestro, and teardown.
- `scripts/v2-device-gates.mjs` — deterministic V2 geometry probe.
- `scripts/call-sim.mjs` — two-endpoint call harness.
- `scripts/framestats.mjs` and Macrobenchmark tasks — performance evidence.

Never say “cannot verify” until the relevant command or ARTEMIS diagnostic has
failed and the failure is named.

Run `/maintain-verification-skill` after user-facing routes, stable IDs, device
prerequisites, or harness commands change.
