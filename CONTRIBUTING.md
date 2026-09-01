# How work gets done here

Every change follows the same path. No exceptions for small changes — the process
exists because "small" is where regressions hide.

## The path

```
issue -> branch -> PR -> CI gates -> review -> squash merge -> tag -> rollout
```

1. **Issue first.** Every branch traces to one. It carries the acceptance
   criteria, so "done" is not a matter of opinion.
2. **Branch from `main`.** Short-lived. `feat/`, `fix/`, `chore/`, `docs/`.
   Trunk-based: if a branch lives longer than about two days, it is too big.
3. **Conventional commits**, enforced by commitlint on `commit-msg`. Scope comes
   from the enum in `commitlint.config.js`, so a message says which layer moved.
4. **Pre-commit** runs lint-staged plus `tsc`. Anything slower belongs in CI.
5. **PR** must state what changed, why, and how to verify. Link the Figma node for
   anything visual.
6. **CI gates** must be green — see below. They are required, not advisory.
7. **Squash merge** to `main`, keeping history linear and each commit releasable.
8. **Tag `v*.*.*`** to release. The release workflow re-runs every gate against
   the tag, because a green run on the branch tip is not evidence about the tag.

## Branch protection on `main`

- Require the `stage 1 and 2 gate` check
- Require linear history, require conversation resolution
- No force push, no deletion
- Solo-founder exception: self-approve, but the checklist is still filled in

## The gates, and what each is for

| Gate                      | Catches                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `tokens:check`            | design tokens changed in Figma without regenerating the theme |
| `tsc --noEmit`            | type errors, strict, with `noUncheckedIndexedAccess`          |
| `eslint --max-warnings=0` | dead code, `any` leaks, floating promises                     |
| `jest`                    | logic, contracts, contrast, and the accent budget             |
| `db-test` (pgTAP)         | RLS holes, missing revokes, broken cascades                   |
| `verify:manifest`         | a dependency adding a permission through manifest merging     |
| `verify:hermes`           | a release build silently shipping plain JS                    |
| Maestro matrix            | journeys on real Android versions and densities               |
| release health            | a bad build reaching more users than it already has           |

## Database changes

Only through `supabase/migrations/`. Never edited in a dashboard, never applied by
hand. Every migration is reviewed and covered by pgTAP before it reaches a real
project. Auth configuration lives in `supabase/config.toml` for the same reason —
so the project's posture is reviewable in a diff.

## Design changes

Figma is the source of truth for design decisions. `design/tokens.json` is their
exported form and `src/theme/tokens.generated.ts` is generated from it. Neither is
hand-edited; `tokens:check` fails the build if they disagree.

## Where product and architecture live

- Product inventory and feature status: `docs/FEATURES.md`
- System shape, flags, migrations: `docs/ARCHITECTURE.md`
- Design source of truth: `DESIGN.md` + `design/tokens.json`
- Agent/project rules: `CLAUDE.md`
- Navigation and list flows: `docs/flows.md`
- Platform conformance log: `docs/android-audit.md`

Do not add a parallel product brief at the repo root; keep status in those docs.

## Architecture decisions

Anything structural gets an ADR in `docs/adr/`, numbered, with status
Proposed / Accepted / Superseded. Write it before building, not after. It records
the options rejected, which is the part that is expensive to reconstruct later.

## Environments

| Environment | Purpose            | Data                              |
| ----------- | ------------------ | --------------------------------- |
| local       | development        | local Supabase, seeded            |
| preview     | one per PR         | ephemeral Supabase branch, seeded |
| staging     | release candidates | anonymised                        |
| production  | live               | real                              |

No one develops against production. No test ever writes to it.
