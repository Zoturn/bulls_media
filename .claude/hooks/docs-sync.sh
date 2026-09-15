#!/usr/bin/env bash
# PostToolUse(Bash): after `openspec archive`, verify the documentation still matches the repo.
#
# Archiving folds a change's deltas into openspec/specs/ and is the moment documentation drifts:
# a rule gets orphaned, a link rots, a generated spec keeps its placeholder. Report it now, while
# the change is still fresh, rather than discovering it during review.
#
# The README section list is not a style preference — it is the assignment's own deliverable list.
# A missing section is a lost mark, so the check encodes the brief rather than a house convention.
set -u

# Builtin read rather than `payload=$(cat)`, and a raw-string filter before any parsing: the hook
# matcher can only match the tool name, so this runs on every Bash call and almost none of them
# are an archive. An unrelated command should cost no subprocess at all.
IFS= read -r -d '' payload || true

case "$payload" in
  *'openspec archive'*) ;;
  *) exit 0 ;;
esac

json_field() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$payload" | jq -r "$1 // empty"
  else
    printf '%s' "$payload" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write($2||'')}catch(e){}})"
  fi
}

command_text=$(json_field '.tool_input.command' '(j.tool_input&&j.tool_input.command)')
case "$command_text" in
  *"openspec archive --help"*|*"openspec archive -h"*) exit 0 ;;
  *"openspec archive"*) ;;
  *) exit 0 ;;
esac

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0

report=""
add() { report="$report"$'\n'"- $1"; }

# 1. The specs the archive just rewrote must still validate.
if [ -x node_modules/.bin/openspec ]; then
  if ! out=$(./node_modules/.bin/openspec validate --all --strict 2>&1); then
    add "\`npm run spec:validate\` fails: $(printf '%s' "$out" | tail -10)"
  fi
fi

if [ -f CLAUDE.md ]; then
  # 2. Every rule path referenced from CLAUDE.md must resolve.
  misses=$(mktemp)
  grep -oE '[A-Za-z0-9_./-]*\.claude/rules/[A-Za-z0-9_-]+\.md' CLAUDE.md | sort -u | while read -r p; do
    [ -f "$p" ] || printf '%s\n' "$p" >>"$misses"
  done
  while read -r m; do
    [ -n "$m" ] && add "CLAUDE.md links \`$m\`, which does not exist."
  done <"$misses"
  rm -f "$misses"

  # 3. CLAUDE.md stays an index, not a manual.
  lines=$(wc -l <CLAUDE.md | tr -d ' ')
  if [ "$lines" -gt 120 ]; then
    add "CLAUDE.md is $lines lines. It should carry orientation and a rule index only — move detail into a rule."
  fi
  if grep -qE '^[[:space:]]*```(ts|tsx|js|prisma|sql)' CLAUDE.md; then
    add "CLAUDE.md contains code examples. Examples belong in a rule, not in a CLAUDE.md."
  fi

  # 4. A rule nobody indexes is a rule nobody loads.
  for rule in .claude/rules/*.md; do
    [ -f "$rule" ] || continue
    name=$(basename "$rule")
    grep -q "$name" CLAUDE.md || add "\`$name\` is not listed in the CLAUDE.md rule index."
  done
fi

# 5. Generated specs must not keep the archiver's placeholder Purpose.
if [ -d openspec/specs ]; then
  stubs=$(mktemp)
  grep -rl 'TBD -' openspec/specs 2>/dev/null >"$stubs"
  while read -r s; do
    [ -n "$s" ] && add "\`$s\` still has the generated \`TBD\` Purpose. Write the real purpose now."
  done <"$stubs"
  rm -f "$stubs"
fi

# 6. The README must carry every section the assignment asks for by name.
if [ -f README.md ]; then
  check_section() {
    grep -qiE "^#+ .*$1" README.md || add "README.md has no \"$2\" heading — the assignment lists it as a deliverable."
  }
  check_section "Problem"        "Problem statement"
  check_section "Scope"          "Scope and non-scope"
  check_section "Business case"  "Business cases covered"
  check_section "Architecture"   "Architecture overview"
  check_section "Setup"          "Setup instructions"
  check_section "(Test|Verif)"   "How to test/verify"
  check_section "Example"        "Example inputs/outputs"
  check_section "(Trade-off|Limitation)" "Trade-offs and limitations"
  check_section "Next steps"     "Next steps"
  check_section "Real-world"     "Real-world usage"
fi

[ -n "$report" ] || exit 0

message="Documentation check after archive — resolve each of these now, not later:$report"

if command -v jq >/dev/null 2>&1; then
  jq -nc --arg m "$message" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$m}}'
else
  node -e 'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:process.argv[1]}}))' "$message"
fi
exit 0
