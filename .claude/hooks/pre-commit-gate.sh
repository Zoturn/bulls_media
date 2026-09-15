#!/usr/bin/env bash
# PreToolUse(Bash): nothing is committed unreviewed, red, or carrying a secret.
#
# Three gates on `git commit`, cheapest first:
#
#   1. Review marker — /simplify and /code-review:code-review must have been run over exactly the
#      content now staged. A hook cannot invoke a skill (hooks are shell commands, skills are
#      invoked by the model), so this gates and instructs rather than running them itself. The
#      marker is the staged tree id from `git write-tree`, not a timestamp: apply one more fix and
#      the tree id changes, so the gate re-arms instead of waving through code nobody looked at.
#
#   2. Staged secret scan — secrets-guard.sh only sees Write and Edit, so a key written by a Bash
#      heredoc, a script, or another editor reaches the index unseen. This is the choke point every
#      commit passes through, so the same patterns are checked again here against what is staged.
#
#   3. Deterministic checks — typecheck, lint, Jest. Deliberately here rather than in a post-commit
#      hook: reporting a red suite after the commit still leaves a red commit in history, and the
#      next piece of work gets stacked on top of it.
#
# Gates 1 and 2 cost almost nothing, so they run before the minute of tsc/eslint/jest that a denied
# commit would waste. The checks stay sequential rather than concurrent, so a failure names one
# cause instead of interleaving three.
#
# Honest caveats:
#   - Gate 3 runs against the working tree, not a checkout of the staged tree. Stashing unstaged
#     work inside a commit hook risks losing it, which is a far worse failure than the narrow case
#     it would catch. Commit what you have tested.
#   - This fires only for commits made through Claude Code's Bash tool. It is a guard rail for this
#     workflow, not a substitute for a real git hook or a CI job, which is where the deterministic
#     checks belong for commits made any other way.
#
# Escape hatch: SKIP_REVIEW_GATE=1 git commit -m "..."
set -u

# Read stdin with the shell builtin rather than `payload=$(cat)`: this hook runs on EVERY Bash tool
# call, so the fork it saves is one per command, not one per commit.
IFS= read -r -d '' payload || true

# Cheap raw-string filter before anything is parsed. The hook matcher can only match the tool name,
# so the overwhelming majority of invocations are unrelated commands that should cost nothing.
case "$payload" in
  *'git commit'*) ;;
  *) exit 0 ;;
esac

# Matches a command that actually INVOKES git commit — at the start, or after a separator, or
# after an environment prefix — rather than one that merely mentions the words. Without this, any
# command echoing or grepping for "git commit" (including this project's own documentation and
# tests) is denied, which trains everyone to reach for the escape hatch.
is_commit_invocation() {
  printf '%s' "$1" | grep -qE '(^|[;&|(]|&&|\|\|)[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git[[:space:]]+commit([[:space:]]|$)'
}

json_field() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$payload" | jq -r "$1 // empty"
  else
    printf '%s' "$payload" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write($2||'')}catch(e){}})"
  fi
}

deny() {
  if command -v jq >/dev/null 2>&1; then
    jq -nc --arg r "$1" \
      '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  else
    node -e 'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:process.argv[1]}}))' "$1"
  fi
  exit 0
}

command_text=$(json_field '.tool_input.command' '(j.tool_input&&j.tool_input.command)')

case "$command_text" in
  *"git commit --help"*|*"git commit -h"*) exit 0 ;;
esac

is_commit_invocation "$command_text" || exit 0

case "$command_text" in
  *SKIP_REVIEW_GATE=1*) exit 0 ;;
esac

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0

# Nothing staged: let git print its own "nothing to commit" rather than a review nag.
git diff --cached --quiet && exit 0

tree=$(git write-tree 2>/dev/null) || exit 0
marker="$root/.claude/.review-state"

# ---- Gate 1: the review marker -------------------------------------------------------------
if ! { [ -f "$marker" ] && grep -qx "$tree" "$marker" 2>/dev/null; }; then
  deny "Commit gate 1 of 3 — review.

/simplify and /code-review:code-review have not been run over the staged tree ($tree).

Staged files:
$(git diff --cached --name-only | head -20)

Do this, in order, then retry the commit:
  1. Run the \`simplify\` skill over the staged change and apply what it finds.
  2. Run the \`code-review:code-review\` skill over the staged change and resolve the findings.
  3. Re-stage anything those two steps changed.
  4. Record the review:  .claude/hooks/mark-reviewed.sh
  5. Re-run the same git commit command.

Step 4 must come after the last edit — the marker is bound to the staged tree id, so re-staging re-arms the gate. For a genuinely trivial commit, prefix the command with SKIP_REVIEW_GATE=1 and say why."
fi

# ---- Gate 2: no secret in the staged diff ---------------------------------------------------
# Added lines only (^+), so an existing false positive elsewhere in a file cannot block every
# later commit that touches it.
staged_added=$(git diff --cached --no-color | grep '^+' | grep -v '^+++' || true)

secret_hit=""
if printf '%s' "$staged_added" | grep -qE 'sk-ant-[A-Za-z0-9_-]{16,}'; then
  secret_hit="an Anthropic key (sk-ant-…)"
elif printf '%s' "$staged_added" | grep -qE '\bsk-[A-Za-z0-9]{32,}'; then
  secret_hit="an OpenAI-style key (sk-…)"
fi

if [ -n "$secret_hit" ]; then
  deny "Commit gate 2 of 3 — secret detected.

The staged diff adds what looks like $secret_hit. This repository is published, and a key that is
pushed is disclosed: rewriting history does not undo that, only revoking the key does.

Find it with:  git diff --cached | grep -nE 'sk-ant-|sk-[A-Za-z0-9]{32,}'

Move the value into \`.env\` (git-ignored) and read it as \`process.env.ANTHROPIC_API_KEY\`. If this
is a fixture or a test vector rather than a live credential, rename it so it does not read as one."
fi

# ---- Gate 3: the deterministic checks -------------------------------------------------------
# A fresh clone with nothing installed has nothing to run; say so rather than failing the commit.
[ -d node_modules ] || exit 0
command -v npm >/dev/null 2>&1 || exit 0

# Docs- and spec-only commits do not need a typecheck. Matched per line with grep: a `case` glob
# over the whole newline-separated list would only ever test the last entry against a suffix
# pattern like `*.ts`, silently skipping the checks on most commits.
if ! git diff --cached --name-only |
  grep -qE '(\.tsx?$|^src/|^prisma/|^package\.json$|^tsconfig\.json$|^jest\.config\.js$)'; then
  exit 0
fi

run_check() {
  local label="$1" script="$2" out
  out=$(npm run --silent "$script" 2>&1) && return
  deny "Commit gate 3 of 3 — $label failed, so this commit is blocked.

Fix it and retry; do not commit around it, and do not stack further work on a red suite.

$(printf '%s' "$out" | tail -40)"
}

run_check "typecheck (next typegen && tsc --noEmit)" typecheck
run_check "lint (eslint)" lint
run_check "the Jest suite" test

exit 0
