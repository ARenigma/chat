#!/usr/bin/env bash
# Greptile's CLI reviews committed branch changes only. Husky runs `review`
# after every commit, then `status` blocks push unless HEAD has a completed,
# finding-free review.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mode="${1:-status}"
commit_ref="${2:-HEAD}"
report_dir="$(git rev-parse --git-path greptile)"
report="$report_dir/latest.txt"
mkdir -p "$report_dir"

if ! command -v greptile >/dev/null 2>&1; then
  echo "greptile-review: Greptile CLI is missing." >&2
  echo "Install: brew install greptileai/tap/greptile" >&2
  exit 2
fi

# CI intentionally lives on GitLab, so `main` tracks the `gitlab` remote.
# Greptile is connected to the GitHub repository at `origin`. Its CLI resolves
# repositories from the current branch's tracking remote; override that lookup
# for this process only without changing pull/push behavior for the branch.
branch="$(git branch --show-current)"
if [[ -z "$branch" ]]; then
  echo "greptile-review: detached HEAD is not a reviewable local branch." >&2
  exit 2
fi
greptile_github() {
  env \
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="branch.${branch}.remote" \
    GIT_CONFIG_VALUE_0=origin \
    greptile "$@"
}

repo_status="$(greptile_github init --json 2>/dev/null || true)"
if ! printf '%s' "$repo_status" | node -e '
let input = "";
process.stdin.on("data", chunk => { input += chunk });
process.stdin.on("end", () => {
  try {
    const value = JSON.parse(input);
    process.exit(["connected", "enabled"].includes(value.status) ? 0 : 1);
  } catch {
    process.exit(1);
  }
});
'; then
  echo "greptile-review: this repository is not connected to Greptile." >&2
  echo "Run \`greptile init\` in an interactive terminal as a pappal org admin." >&2
  exit 2
fi

case "$mode" in
  review)
    echo "greptile-review: reviewing committed changes at $(git rev-parse --short HEAD)…"
    greptile_github review --agent --no-color | tee "$report"
    ;;
  status)
    set +e
    greptile_github review status --commit "$commit_ref" --agent --no-color >"$report" 2>&1
    status=$?
    set -e
    cat "$report"
    case "$status" in
      0) ;;
      1)
        echo "greptile-review: $commit_ref has no completed review. Run: npm run review:greptile" >&2
        exit 1
        ;;
      3)
        echo "greptile-review: HEAD review is still running. Wait, then retry push." >&2
        exit 1
        ;;
      4|5)
        echo "greptile-review: HEAD review failed or was cancelled. Re-run it." >&2
        exit 1
        ;;
      *)
        echo "greptile-review: status check failed with exit $status." >&2
        exit "$status"
        ;;
    esac
    ;;
  *)
    echo "Usage: $0 {review|status}" >&2
    exit 2
    ;;
esac

# Greptile's review command reports completion separately from findings. Keep
# P0/P1/P2 comments fail-closed: fix valid findings, commit, and let the new
# commit trigger a fresh review. This pattern matches severity badges in the
# documented plain/agent output without depending on an unpublished JSON schema.
# Inside a POSIX bracket a backslash is literal, so `]` goes first rather than
# `\]`: the old `[[:space:]\]:-]` closed early and BSD grep never matched a
# finding, which let every push through (found 2026-09-24).
if grep -Eq '(^|[[:space:][])P[012]([][:space:]:-]|$)' "$report"; then
  echo "greptile-review: unresolved P0/P1/P2 findings remain." >&2
  echo "Fix them, verify the change, and commit again before pushing." >&2
  exit 1
fi

echo "greptile-review: $commit_ref is reviewed with no P0/P1/P2 findings."
