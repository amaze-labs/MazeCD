#!/usr/bin/env bash
# Decides the next semantic version from the conventional commits since the
# last tag. Breaking -> major, feat -> minor, EVERYTHING else -> patch.
set -euo pipefail

last="$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' 2>/dev/null || true)"

if [ -z "$last" ]; then
  echo "version=v0.1.0"
  exit 0
fi

log="$(git log --format='%s%n%b' "${last}..HEAD")"
if [ -z "${log//[[:space:]]/}" ]; then
  # Nothing new since the last tag: re-running a workflow must not publish again.
  echo "version=${last}"
  echo "skip=true"
  exit 0
fi

version="${last#v}"
major="${version%%.*}"
rest="${version#*.}"
minor="${rest%%.*}"
patch="${rest#*.}"

if grep -qE '^[a-zA-Z]+(\([^)]*\))?!:' <<<"$log" || grep -qE '^BREAKING[ -]CHANGE' <<<"$log"; then
  major=$((major + 1)); minor=0; patch=0
elif grep -qE '^feat(\([^)]*\))?:' <<<"$log"; then
  minor=$((minor + 1)); patch=0
else
  patch=$((patch + 1))
fi

echo "version=v${major}.${minor}.${patch}"
echo "skip=false"
