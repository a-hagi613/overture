#!/bin/sh
set -eu

DATABASE="${DATABASE_PATH:-/data/app.sqlite}"
DATA_DIR="$(dirname "$DATABASE")"

# Run as root only for this: the Fly volume mount is root-owned, so fix its
# ownership for the unprivileged `app` user, then drop privileges and never
# return to root.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R app:app "$DATA_DIR"
  exec gosu app:app "$0" "$@"
fi

mkdir -p "$DATA_DIR"

if [ "${LITESTREAM_ENABLED:-true}" != "true" ]; then
  exec bun run /app/src/server/main.ts
fi

if [ "${LITESTREAM_RESTORE_ONLY:-false}" = "true" ]; then
  litestream restore -config /etc/litestream.yml "$DATABASE"
  exec bun run /app/src/server/main.ts
fi

exec litestream replicate -config /etc/litestream.yml -restore-if-db-not-exists -exec "bun run /app/src/server/main.ts"
