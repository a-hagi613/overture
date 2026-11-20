#!/bin/sh
set -eu

DATABASE="${DATABASE_PATH:-/data/app.sqlite}"
mkdir -p "$(dirname "$DATABASE")"

if [ "${LITESTREAM_ENABLED:-true}" != "true" ]; then
  exec bun run /app/src/server/main.ts
fi

if [ "${LITESTREAM_RESTORE_ONLY:-false}" = "true" ]; then
  litestream restore -config /etc/litestream.yml "$DATABASE"
  exec bun run /app/src/server/main.ts
fi

exec litestream replicate -config /etc/litestream.yml -restore-if-db-not-exists -exec "bun run /app/src/server/main.ts"
