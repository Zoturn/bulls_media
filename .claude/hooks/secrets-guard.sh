#!/usr/bin/env bash
# PreToolUse(Write|Edit): refuse to write a live API key into a file git tracks.
#
# This repository is published, and it talks to a paid API. A key committed here is disclosed the
# moment the repo goes public, and rewriting history does not un-disclose it — the only real
# remedy is revoking the key. That asymmetry is why this blocks rather than warns.
#
# Only .env and .env.local are allowed to hold a real key, and both are in .gitignore. Everything
# else — .env.example, source, tests, specs, README — gets a placeholder or reads process.env.
set -u

payload=$(cat)

json_field() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$payload" | jq -r "$1 // empty"
  else
    printf '%s' "$payload" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write($2||'')}catch(e){}})"
  fi
}

file=$(json_field '.tool_input.file_path' '(j.tool_input&&j.tool_input.file_path)')
[ -n "$file" ] || exit 0
file=${file//\\//}

# The two files that are allowed to hold a real secret, because .gitignore excludes both.
case "$file" in
  */.env|.env|*/.env.local|.env.local) exit 0 ;;
esac

content=$(json_field '.tool_input.content // .tool_input.new_string' '(j.tool_input&&(j.tool_input.content||j.tool_input.new_string))')
[ -n "$content" ] || exit 0

hit=""

# Anthropic and OpenAI issue prefixed keys, which is what makes them cheap to catch exactly.
if printf '%s' "$content" | grep -qE 'sk-ant-[A-Za-z0-9_-]{16,}'; then
  hit="an Anthropic key (sk-ant-…)"
elif printf '%s' "$content" | grep -qE '\bsk-[A-Za-z0-9]{32,}'; then
  hit="an OpenAI-style key (sk-…)"
# A secret-shaped assignment: long, high-entropy, and not one of the placeholders we write on
# purpose. Matched once and the matching lines kept, so the second test inspects only the value
# rather than repeating the whole assignment pattern to look for a different tail.
else
  assignments=$(printf '%s' "$content" |
    grep -oiE '(API_KEY|SECRET|TOKEN|PASSWORD)[[:space:]]*[=:][[:space:]]*["'"'"']?[A-Za-z0-9/+_.-]{8,}' || true)
  if [ -n "$assignments" ] &&
    printf '%s' "$assignments" | grep -qE '[A-Za-z0-9/+_-]{24,}' &&
    ! printf '%s' "$assignments" | grep -qiE '(your|placeholder|example|changeme|xxx|dummy|fake)'; then
    hit="a secret-shaped assignment"
  fi
fi

[ -n "$hit" ] || exit 0

reason="Refusing to write $hit into \`$file\`.

This repository is published and a disclosed key cannot be undisclosed — history rewriting does not help, only revoking the key does.

Put the real value in \`.env\` (git-ignored) and reference it from code as \`process.env.ANTHROPIC_API_KEY\`. In \`.env.example\`, committed source, tests and documentation, write a placeholder such as \`ANTHROPIC_API_KEY=your-key-here\` instead.

If this is a false positive — a fixture, a test vector, a hash — rename the value so it does not read as a live credential, or place it outside these files."

if command -v jq >/dev/null 2>&1; then
  jq -nc --arg r "$reason" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
else
  node -e 'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:process.argv[1]}}))' "$reason"
fi
exit 0
