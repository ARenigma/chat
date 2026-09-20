#!/usr/bin/env bash
# Deterministic local/CI security gate.
#
# staged: fast secret scan for pre-commit.
# push:   changed-code SAST + dependency criticals before remote writes.
# sast:   changed-code SAST for the pinned Semgrep CI image.
# dependencies: critical known-vulnerability gate for the Node job.
# ci:     both, for a developer machine with all tools installed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mode="${1:-push}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'security-check: missing %s. %s\n' "$1" "$2" >&2
    exit 2
  }
}

case "$mode" in
  staged)
    need gitleaks "Install with: brew install gitleaks"
    exec gitleaks git --staged --redact --no-banner --config .gitleaks.toml
    ;;

  push)
    need gitleaks "Install with: brew install gitleaks"
    need semgrep "Install with: brew install semgrep"

    base="${SECURITY_BASE_REF:-origin/main}"
    if ! git rev-parse --verify "$base^{commit}" >/dev/null 2>&1; then
      printf 'security-check: %s is unavailable; fetch the remote before pushing.\n' "$base" >&2
      exit 2
    fi

    gitleaks git --redact --no-banner --config .gitleaks.toml \
      --log-opts="${base}..HEAD"
    semgrep scan --validate --config .semgrep.yml
    semgrep scan --config .semgrep.yml --baseline-commit "$base" --error \
      --exclude node_modules --exclude android/.gradle --exclude android/app/build \
      --exclude coverage --exclude admin/.next .
    npm audit --omit=dev --audit-level=critical
    ;;

  sast)
    need semgrep "Use the pinned Semgrep image in CI."
    semgrep scan --validate --config .semgrep.yml
    base="${SEMGREP_BASELINE_COMMIT:-${CI_MERGE_REQUEST_DIFF_BASE_SHA:-${CI_COMMIT_BEFORE_SHA:-origin/main}}}"
    # GitLab uses all-zero before-SHA for the first commit on a branch.
    if [[ "$base" =~ ^0+$ ]] || ! git rev-parse --verify "$base^{commit}" >/dev/null 2>&1; then
      base="HEAD~1"
    fi
    semgrep scan --config .semgrep.yml --baseline-commit "$base" --error \
      --exclude node_modules --exclude android/.gradle --exclude android/app/build \
      --exclude coverage --exclude admin/.next .
    ;;

  dependencies)
    npm audit --omit=dev --audit-level=high
    ;;

  ci)
    "$0" sast
    "$0" dependencies
    ;;

  *)
    printf 'Usage: %s {staged|push|sast|dependencies|ci}\n' "$0" >&2
    exit 2
    ;;
esac
