#!/usr/bin/env bash
# FB-20 (P1-20) — consolidated release-CI failure reporting.
#
# The old release.yml created ONE GitHub issue per failed matrix job, with
# no dedup, no grouping and only a 6000-byte log tail. This script is the
# replacement, run by the `report` job in .github/workflows/release.yml
# (which runs once per workflow run, only when something failed):
#
#   * Groups failures by workflow-run + platform + fingerprint: the
#     fingerprint is the first 12 hex of sha256(job-name + the last 30
#     non-empty, de-ANSIed lines of that job's log). The same failure
#     recurring on the same platform gets the same fingerprint.
#   * Dedups: before creating anything it lists open issues labelled
#     `ci-failure` and skips any fingerprint that already has one — one
#     issue per distinct failure, not one per failed run.
#   * Complete logs are archived by the build job itself (always-uploaded
#     build-log artifacts); the issue body links the run and carries the
#     failing tail, it is not the archive.
#
# Inputs (env):
#   GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_REF_NAME, GITHUB_SERVER_URL
#   LOG_DIR     — directory holding the downloaded build-log artifacts
#                 (build-<os>.log, one per matrix job)
#   FAILED_LOG  — optional file with `gh run view --log-failed` output,
#                 used for jobs with no build-log artifact (the release job)
#   CI_JOBS_JSON    (tests only) — file with {"jobs":[{"name","conclusion"}]}
#                   in place of the `gh api` call
#   CI_OPEN_ISSUES  (tests only) — file with one open `ci-failure` issue
#                   title per line, in place of the `gh issue list` call
#   CI_DRY_RUN=1    (tests only) — print the `gh issue create` commands
#                   instead of running them
# Exit 0 always on the reporting path itself: a reporting failure must
# never fail the release run (the job is best-effort by design).
set -u
LOG_DIR="${LOG_DIR:-ci-logs}"
FAILED_LOG="${FAILED_LOG:-failed.log}"
REPO="${GITHUB_REPOSITORY:-}"
RUN_ID="${GITHUB_RUN_ID:-}"
REF="${GITHUB_REF_NAME:-}"
SERVER="${GITHUB_SERVER_URL:-https://github.com}"

fingerprint() {
  # $1 = job name, $2 = log file (may not exist)
  local job="$1" log="$2" tail=""
  if [ -f "$log" ]; then
    tail="$(tail -n 30 "$log" 2>/dev/null | sed -e 's/\x1b\[[0-9;]*m//g' | grep -v '^[[:space:]]*$' || true)"
  fi
  printf '%s\n%s' "$job" "$tail" | sha256sum | cut -c1-12
}

open_titles() {
  if [ -n "${CI_OPEN_ISSUES:-}" ] && [ -f "$CI_OPEN_ISSUES" ]; then cat "$CI_OPEN_ISSUES"; return 0; fi
  gh issue list --label ci-failure --state open --limit 100 --json title --jq '.[].title' 2>/dev/null || true
}

failed_jobs() {
  if [ -n "${CI_JOBS_JSON:-}" ] && [ -f "$CI_JOBS_JSON" ]; then
    node -e "const j=require(process.argv[1]);for(const x of j.jobs||[]){if(x.conclusion==='failure')console.log(x.name)}" "$CI_JOBS_JSON" 2>/dev/null || true
    return 0
  fi
  gh api "repos/${REPO}/actions/runs/${RUN_ID}/jobs?per_page=100" --jq '.jobs[] | select(.conclusion == "failure") | .name' 2>/dev/null || true
}

log_for_job() {
  # Build jobs carry their platform in the name ("Build (ubuntu-latest)").
  local job="$1"
  for os in ubuntu-latest windows-latest macos-latest; do
    case "$job" in *"$os"*) [ -f "$LOG_DIR/build-$os.log" ] && { echo "$LOG_DIR/build-$os.log"; return 0; } ;; esac
  done
  [ -f "$FAILED_LOG" ] && { echo "$FAILED_LOG"; return 0; }
  echo ""
}

main() {
  local titles created=0 skipped=0
  titles="$(open_titles)"
  while IFS= read -r job; do
    [ -n "$job" ] || continue
    local log fp title
    log="$(log_for_job "$job")"
    fp="$(fingerprint "$job" "$log")"
    title="Release CI failure: $job [$fp] ($REF)"
    if printf '%s\n' "$titles" | grep -F -q "[$fp]"; then
      echo "SKIP $job fingerprint $fp — open issue already exists"
      skipped=$((skipped + 1))
      continue
    fi
    local body="The release job \`$job\` failed.
Run: $SERVER/$REPO/actions/runs/$RUN_ID
Fingerprint: \`$fp\` (job + last 30 log lines — the same failure on the same platform reopens nothing; it lands here again only after the existing issue is closed.)
Complete logs: the run's build-log artifacts (7-day retention).

Last log lines:
\`\`\`
$( [ -f "$log" ] && tail -n 60 "$log" 2>/dev/null || echo '(no log captured)' )
\`\`\`"
    if [ -n "${CI_DRY_RUN:-}" ]; then
      echo "CREATE $title"
      printf '%s\n' "$body"
    else
      gh issue create --label ci-failure --title "$title" --body "$body" >/dev/null 2>&1 || echo "WARN could not create issue for $job"
    fi
    created=$((created + 1))
  done <<EOF
$(failed_jobs)
EOF
  echo "report done: $created created, $skipped skipped (already open)"
}
main
