# ADR-0003 — CI moves to GitLab with a self-hosted runner

- **Status:** Accepted (2026-08-20)
- **Decision by:** Amit Ranjan

## Context

GitHub Actions is disabled at the account level on `ARenigma`
(`HTTP 422: Actions has been disabled for this user`). Repository settings report
Actions enabled, and three pushes touching `ci.yml` produced zero runs. The
four-stage pipeline was therefore written, locally verified, and never executed on
a runner — which is the same as not having one.

An Oracle VPS with a registered GitLab runner already exists and is paid for.

## Decision

Move CI to GitLab and keep the gates identical. `.gitlab-ci.yml` is a translation
of the GitHub workflows, not a redesign.

## What changed in the translation, and why

1. **The database job stopped driving Docker.** A runner using the Docker
   executor cannot nest Docker without privileged mode, and requiring privileged
   mode of a VPS runner is a worse trade than requiring a service image. So
   `db-test.mjs` gained a `DATABASE_URL` mode: given a server it uses it and
   manages nothing. Locally, with no `DATABASE_URL`, it still builds and runs its
   own container, so the developer experience is unchanged.
2. **The pgTAP image is built once and pushed to the project registry**, behind a
   manual job. Compiling pgTAP from source on every pipeline would add minutes to
   every run to produce a byte-identical image.
3. **Android builds run in `reactnativecommunity/react-native-android`**, pinned
   to a tag rather than `latest`. A silently newer SDK is the classic cause of a
   pipeline that worked yesterday.
4. **Production deploys are manual and tag-only**, with the Edge Function shipping
   before the app.

## Consequences

- The runner needs the Docker executor, roughly 8 GB of disk for the Android image
  layer and 4 GB of RAM for R8, and the tag `linux-docker`.
- Compute is now a fixed VPS cost rather than metered minutes, which makes the
  device matrix cheaper to run often.
- Emulator-based E2E is not translated yet. KVM on an Oracle ARM VPS is a separate
  question from the rest of this migration, and pretending otherwise in the config
  would be a job that fails for environmental reasons on every run.
- GitHub remains the code host until the migration is confirmed working, so the
  repo has two remotes for a period. That is deliberate: moving CI and moving the
  origin at the same time makes a failure hard to attribute.
