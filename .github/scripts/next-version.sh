#!/usr/bin/env bash
# Decides the next semantic version from the conventional commits since the
# last tag. Breaking -> major, feat -> minor, EVERYTHING else -> patch.
# Tags are bare semver: 0.1.0, 1.2.3, ... (no "v" prefix).
set -euo pipefail

last="$(git describe --tags --abbrev=0 --match '[0-9]*.[0-9]*.[0-9]*' 2>/dev/null || true)"

if [ -z "$last" ]; then
  echo "version=0.1.0"
  echo "skip=false"
  exit 0
fi

if ! [[ "$last" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: latest tag '${last}' is not a plain X.Y.Z semantic version; refusing to guess the next release" >&2
  exit 1
fi

if [ "$(git rev-list --count "${last}..HEAD")" -eq 0 ]; then
  # Nothing new since the last tag: re-running a workflow must not publish again.
  echo "version=${last}"
  echo "skip=true"
  exit 0
fi

major_bump=false
minor_bump=false

# Decide per commit, not over the whole concatenated log: a commit's own
# subject decides feat/breaking, its own body decides BREAKING CHANGE, so a
# chore commit that quotes another commit's "feat:" line in its body can't
# leak a minor bump. NUL-separated records so multi-line bodies survive.
while IFS= read -r -d '' commit; do
  subject="${commit%%$'\n'*}"
  body="${commit#*$'\n'}"

  if grep -qE '^[a-zA-Z]+(\([^)]*\))?!:' <<<"$subject" || grep -qE '^BREAKING[ -]CHANGE' <<<"$body"; then
    major_bump=true
    break # nothing outranks a breaking change
  elif grep -qE '^feat(\([^)]*\))?:' <<<"$subject"; then
    minor_bump=true
  fi
done < <(git log --format='%s%n%b%x00' "${last}..HEAD")

major="${last%%.*}"
rest="${last#*.}"
minor="${rest%%.*}"
patch="${rest#*.}"

# 10# forces base-10 so a zero-padded component (e.g. "08") is never
# misread as an invalid octal literal by the arithmetic below.
if [ "$major_bump" = true ]; then
  major=$((10#$major + 1)); minor=0; patch=0
elif [ "$minor_bump" = true ]; then
  minor=$((10#$minor + 1)); patch=0
else
  patch=$((10#$patch + 1))
fi

echo "version=${major}.${minor}.${patch}"
echo "skip=false"
