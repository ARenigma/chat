# ADR-0031, verification is a local lever before it is a CI dashboard

- **Status:** Accepted (2026-09-20)
- **Decision by:** Amit Ranjan

## Context

Pappal already has 2,138 Jest tests, pgTAP/RLS checks, Gitleaks, Android lint and
release builds, Maestro/device journeys, Macrobenchmark, manifest/Hermes checks,
and release-health rollback logic. The missing property was a closed loop:
agents and developers could commit or push without invoking the same proof.

“Bug free” cannot be guaranteed by any scanner or AI reviewer. The useful target
is layered detection with independent failure modes and reproducible evidence.

## Decision

Build one project verification lever:

- `.cursor/skills/verify-pappal/` explains which proof tier each change needs.
- `scripts/control-pappal.mjs` gives agents stable JSON-capable device control,
  dynamic locators, snapshots, screenshots, and wrappers for existing checks.
- Husky gates secrets/type/lint before commit; every completed commit triggers
  Greptile; push requires `npm run verify`, changed-code SAST, dependency audit,
  and a completed finding-free Greptile review for the exact HEAD.
- GitLab repeats trust-boundary checks: full-history Gitleaks, server-key checks,
  changed-code Semgrep using reviewed local rules, high-severity dependency audit,
  Jest coverage, pgTAP, and the Android release build.
- Local and GitLab static verification share `verify:source` and
  `verify:artifact`; `verify:ci` only adds coverage reporters.
- Device behavior remains a device gate through ARTEMIS, Maestro, UIAutomator,
  and Macrobenchmark. CI green is not device proof.

Greptile is review, not verification. Its comments are checked against code and
platform docs; valid findings get root-cause fixes and regression tests.

## Harness

Do not migrate to Harness now. GitLab already builds, tests, stores Cobertura,
delivers artifacts, and gates releases. Harness Test Intelligence would optimize
an 11-second Jest suite by selecting fewer tests, while Harness itself warns that
test selection conflicts with meaningful full-suite coverage. Adding a second
CI control plane increases credentials, webhooks, policy drift, and debugging
surface without addressing the current bottleneck.

Reconsider when full deterministic tests materially delay feedback even after
parallel GitLab jobs, or when the team needs Harness STO governance enough to
justify migration.

Sources:

- https://github.com/harness/developer-hub/blob/main/docs/continuous-integration/use-ci/run-tests/ti-overview.md
- https://github.com/harness/developer-hub/blob/main/docs/continuous-integration/use-ci/run-tests/code-coverage.md

## Codecov

Do not add Codecov yet. GitLab already ingests `coverage/cobertura-coverage.xml`,
and Jest now fails if the measured baseline regresses. Codecov’s useful delta is
patch coverage and cross-merge-request trends, but current coverage intentionally
collects only `src/lib` and `src/store`; presenting that as whole-product quality
would be misleading for screens, native Kotlin, SQL/RLS, and device behavior.

Reconsider after coverage scope is intentionally expanded and a GitLab Codecov
bot/token can be owned and rotated. Start informational, then gate patch coverage
after a stable baseline exists.

Sources:

- https://docs.codecov.com/docs/gitlab-2-getting-a-codecov-account-and-uploading-coverage
- https://docs.codecov.com/docs/commit-status

## Consequences

- Commits take longer because Greptile runs synchronously after each one. This is
  deliberate and was requested; local commits remain local until clean.
- Pushes are slower but deterministic. Database/device/release tiers stay scoped
  to changes that need them rather than making every edit wait for an emulator.
- Greptile is enabled for the GitHub `origin`; its wrapper overrides repository
  lookup without changing `main`'s GitLab CI upstream.
- Local hooks can always be bypassed with Git's `--no-verify`. GitHub `main` is
  currently unprotected because private-repository protection requires GitHub
  Pro on this account. After upgrading, open one PR to discover Greptile's exact
  check name, then require PRs and that check for `main` (including admins).
- The production dependency graph has zero known advisories after patching the
  RN CLI to 20.1.2 and Metro to 0.84.6. High/critical regressions fail closed.
  Four low advisories remain in the dev-only `paper-jsdom → jsdom` chain; npm
  offers no non-breaking fix, so they stay visible and do not affect the APK.
