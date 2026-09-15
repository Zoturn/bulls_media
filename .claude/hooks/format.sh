#!/usr/bin/env bash
# PostToolUse(Write|Edit): format the file that was just written with the project's own Prettier.
#
# Single-app repo, so there is one node_modules at the root. Exits 0 silently when Prettier is not
# installed, which keeps a fresh clone with no `npm install` working.
set -u

read_path() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.tool_response.filePath // .tool_input.file_path // empty'
  else
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_response&&j.tool_response.filePath)||(j.tool_input&&j.tool_input.file_path)||"")}catch(e){}})'
  fi
}

file=$(read_path)
[ -n "$file" ] || exit 0

file=${file//\\//}          # Windows paths arrive backslash-separated
[ -f "$file" ] || exit 0

root=${CLAUDE_PROJECT_DIR:-.}
root=${root//\\//}
[ -x "$root/node_modules/.bin/prettier" ] || exit 0

cd "$root" || exit 0
./node_modules/.bin/prettier --write --ignore-unknown "$file" >/dev/null 2>&1
exit 0
