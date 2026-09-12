#!/usr/bin/env bash
# Order-independent regression tests for next-version.sh's per-commit bump
# scan. Each case builds a throwaway repo under mktemp, tags it, adds commits
# in a specific order, runs the real script, and asserts the emitted version.
# No framework: plain assert + exit 1 on first failure, per case cleanup.
set -euo pipefail

script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/next-version.sh"
fail=0

# run_case <expect_version> <tag> <commit message>...
run_case() {
  local expect="$1" tag="$2"
  shift 2
  local d
  d="$(mktemp -d)"
  (
    cd "$d"
    git init -q
    git config user.email t@t.com
    git config user.name t
    git commit --allow-empty -q -m "chore: root"
    git tag "$tag"
    for msg in "$@"; do
      git commit --allow-empty -q -m "$msg"
    done
    "$script"
  ) >"$d/out" 2>&1 || true
  local got
  got="$(grep '^version=' "$d/out" | cut -d= -f2 || true)"
  if [ "$got" = "$expect" ]; then
    echo "PASS: expected ${expect}, got ${got}"
  else
    echo "FAIL: expected ${expect}, got '${got}' -- full output:"
    cat "$d/out"
    fail=1
  fi
  rm -rf "$d"
}

echo "=== feat: followed by two later fix: commits -> minor (order-independent) ==="
run_case 1.1.0 1.0.0 "feat: a new thing" "fix: a small fix" "fix: another small fix"

echo "=== feat!: followed by later feat: and fix: -> major (order-independent) ==="
run_case 2.0.0 1.0.0 "feat!: breaking change" "feat: a new thing" "fix: a small fix"

echo "=== chore: newest with only chore:/docs: behind it -> patch ==="
run_case 1.0.1 1.0.0 "docs: update readme" "chore: tidy"

echo "=== chore: commit quoting 'feat:' in its body must NOT yield a minor ==="
run_case 1.0.1 1.0.0 "$(printf 'chore: squash merge\n\nThis includes:\nfeat: add a thing that was already released\nfix: something else')"

echo "=== reproduction: fix (newest) after feat (older) -> minor, not patch ==="
run_case 1.1.0 1.0.0 "feat: a new thing" "fix: a small fix"

echo "=== reproduction: feat (newest) alone -> minor ==="
run_case 1.1.0 1.0.0 "feat: another"

if [ "$fail" -eq 0 ]; then
  echo "ALL PASS"
else
  echo "SOME FAILED"
fi
exit "$fail"
