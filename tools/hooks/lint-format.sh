#!/usr/bin/env bash
set -euo pipefail

file=$(jq -r '.tool_input.file_path // empty')

if [ -z "$file" ] || [ ! -f "$file" ]; then
  exit 0
fi

case "$file" in
  *.ts | *.tsx | *.mts | *.cts | *.js | *.jsx | *.mjs | *.cjs)
    bunx oxlint --fix "$file" || true
    bunx oxfmt "$file" || true
    ;;
esac
