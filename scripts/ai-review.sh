#!/usr/bin/env bash
# Local AI code review for every push, standing in for Greptile while its trial
# is exhausted (Amit, 2026-09-25: "use cheap model for reviewer like sonnet so
# its fast"). Reviews <remote>/main..HEAD, split by file into chunks reviewed in
# parallel by Claude Sonnet, and fails closed on any P0/P1/P2 finding, the same
# rule the Greptile gate enforced.
#
#   bash scripts/ai-review.sh [base-ref]      (default: origin/main)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

base="${1:-origin/main}"

# One-off escape hatch, only on Amit's say-so (2026-09-25: "push now, file
# findings"). Logged loudly; every other pre-push gate still runs.
if [ "${AI_REVIEW_SKIP:-}" = "1" ]; then
  echo "ai-review: SKIPPED by AI_REVIEW_SKIP=1 (owner-approved one-off)." >&2
  exit 0
fi
model="${AI_REVIEW_MODEL:-sonnet}"
jobs="${AI_REVIEW_JOBS:-6}"
chunk_bytes="${AI_REVIEW_CHUNK_BYTES:-120000}"
report_dir="$(git rev-parse --git-path ai-review)"
work="$report_dir/work"
report="$report_dir/latest.txt"

if ! command -v claude >/dev/null 2>&1; then
  echo "ai-review: the claude CLI is missing (https://docs.claude.com/claude-code)." >&2
  exit 1
fi

rm -rf "$work"
mkdir -p "$work"

# Generated or bulk files carry no reviewable logic.
skip='^(supabase/schema/snapshot\.txt|package-lock\.json|src/theme/.*\.generated\.ts|src/lib/.*\.generated\.ts|web/tokens\.css|assets/fonts/.*)$'
git diff --name-only "$base"..HEAD | grep -Ev "$skip" > "$work/files" || true
if [ ! -s "$work/files" ]; then
  echo "ai-review: nothing to review between $base and HEAD."
  : > "$report"
  exit 0
fi

# Pack per-file diffs into chunks of about $chunk_bytes.
n=0
size=0
: > "$work/chunk-$n.diff"
while IFS= read -r f; do
  git diff "$base"..HEAD -- "$f" > "$work/one.diff"
  s=$(wc -c < "$work/one.diff")
  if [ "$size" -gt 0 ] && [ $((size + s)) -gt "$chunk_bytes" ]; then
    n=$((n + 1))
    size=0
    : > "$work/chunk-$n.diff"
  fi
  cat "$work/one.diff" >> "$work/chunk-$n.diff"
  size=$((size + s))
done < "$work/files"

prompt='You are a strict senior code reviewer blocking merges, like Greptile. Review the unified diff on stdin (React Native Android app + Supabase Postgres migrations, RLS, Edge Functions). Report ONLY real defects with a concrete failure scenario: correctness, security, privacy, races, data loss, broken tests. No style nits, no praise, no summaries.
Output format, one finding per line, nothing else:
P0|P1|P2 <path>:<line> <one-sentence defect and scenario>
P0 = security or data loss, P1 = user-visible breakage, P2 = real but narrow bug.
You see ONE chunk of a larger diff; other files are reviewed separately. Never report something as missing, unregistered or not passed just because it is not in this chunk: flag only defects provable from the code shown. Do not report robustness nits in test helpers unless a test passes on broken code today.
If there are no such defects, output exactly: NONE'

review_chunk() {
  local chunk="$1"
  local out="${chunk%.diff}.out"
  # One retry: a transient CLI or API failure is not a finding.
  if ! claude -p --model "$model" "$prompt" < "$chunk" > "$out" 2> "${out}.err"; then
    sleep 5
    if ! claude -p --model "$model" "$prompt" < "$chunk" > "$out" 2>> "${out}.err"; then
      echo "REVIEW-FAILED $(basename "$chunk")" > "$out"
    fi
  fi
}
export -f review_chunk
export model prompt

ls "$work"/chunk-*.diff | xargs -P "$jobs" -I{} bash -c 'review_chunk "$@"' _ {}

cat "$work"/chunk-*.out > "$report"
echo "ai-review: $(ls "$work"/chunk-*.diff | wc -l | tr -d ' ') chunk(s) reviewed by $model"

if grep -q '^REVIEW-FAILED' "$report"; then
  cat "$report"
  echo "ai-review: a chunk could not be reviewed; failing closed." >&2
  exit 1
fi
if grep -Eq '^P[012] ' "$report"; then
  grep -E '^P[012] ' "$report"
  echo "ai-review: unresolved P0/P1/P2 findings. Fix them and push again." >&2
  exit 1
fi
echo "ai-review: no P0/P1/P2 findings."
