#!/usr/bin/env bash
# Records that /simplify and /code-review:code-review have been run over the currently staged
# tree, satisfying the gate in pre-commit-review.sh for that exact content.
#
# Not a hook — a command run deliberately, after the reviews and after re-staging whatever they
# changed. Keeping it separate from the gate is the point: the gate can only ever observe the
# marker, never write it, so nothing about a commit can mark its own review as done.
set -eu

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "Not a git repository." >&2
  exit 1
}
cd "$root"

if git diff --cached --quiet; then
  echo "Nothing is staged, so there is nothing to mark as reviewed. Stage the change first." >&2
  exit 1
fi

tree=$(git write-tree)
marker="$root/.claude/.review-state"

mkdir -p "$(dirname "$marker")"
touch "$marker"

if grep -qx "$tree" "$marker" 2>/dev/null; then
  echo "Staged tree $tree was already marked as reviewed."
  exit 0
fi

printf '%s\n' "$tree" >>"$marker"

# Keep only the most recent entries; the file is a short-lived scratch record, not history.
tail -50 "$marker" >"$marker.tmp" && mv "$marker.tmp" "$marker"

echo "Marked staged tree $tree as reviewed. The commit gate will now allow this exact content."
