#!/bin/sh
set -eu

DATABASE="${DATABASE_PATH:-/data/app.sqlite}"
DATA_DIR="$(dirname "$DATABASE")"
# The catalog lives beside the application database and is never replicated (ADR 0036). It is rebuilt from the feeds,
# so a missing or deleted file is ordinary startup work, not a restore.
CATALOG="${CATALOG_DATABASE_PATH:-${DATA_DIR}/catalog.sqlite}"
OBJECTS="${OBJECT_STORE_ROOT:-${DATA_DIR}/objects}"
LITESTREAM_CONFIG="${LITESTREAM_CONFIG_PATH:-/etc/litestream.yml}"

# Run as root only for this: the Fly volume mount is root-owned, so fix its
# ownership for the unprivileged `app` user, then drop privileges and never
# return to root.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR" "$OBJECTS" "$(dirname "$CATALOG")"
  chown -R app:app "$DATA_DIR"
  exec gosu app:app "$0" "$@"
fi

mkdir -p "$DATA_DIR" "$OBJECTS" "$(dirname "$CATALOG")"

if [ "${VACUUM_ONLY:-false}" = "true" ]; then
  # Maintenance mode: compact the application database with neither Litestream
  # nor the Bun server holding the file. The workflow dry-runs first, then sets
  # this environment and restarts the machine; the app server is never started
  # while the file is being vacuumed.
  READY_FILE="${VACUUM_READY_FILE:-/tmp/vacuum-finished}"
  OUTPUT_FILE="${VACUUM_OUTPUT_FILE:-/tmp/vacuum-output.txt}"
  rm -f "$READY_FILE"
  echo "maintenance mode: compacting ${DATABASE}; the app server and Litestream stay stopped"
  status=0
  bun run /app/scripts/vacuum-app-db.ts "$DATABASE" --confirm > "$OUTPUT_FILE" 2>&1 || status=$?
  cat "$OUTPUT_FILE"
  printf '%s\n' "$status" > "$READY_FILE"
  echo "maintenance mode: vacuum finished with exit $status; holding the machine open"
  exec sleep "${VACUUM_KEEPALIVE_SECONDS:-1500}"
fi

if [ "${LITESTREAM_RESTORE_ONLY:-false}" = "true" ]; then
  # Restore drill mode: restore the replica, verify it read-only and exit.
  # The app server is never started, so no scheduler, worker, mail sender or
  # billing job can run against restored production data.
  DRILL_READY_FILE="${RESTORE_DRILL_READY_FILE:-/tmp/restore-drill-checked}"
  rm -f "$DRILL_READY_FILE"
  echo "restore drill mode: restoring the replica and running the read-only checks; the app server stays stopped"
  litestream restore -config "$LITESTREAM_CONFIG" "$DATABASE"
  bun run /app/scripts/check-restored-db.ts "$DATABASE"
  touch "$DRILL_READY_FILE"
  echo "restore drill mode: checks passed; holding the machine open for the drill driver"
  exec sleep "${RESTORE_DRILL_KEEPALIVE_SECONDS:-600}"
fi

if [ "${LITESTREAM_ENABLED:-true}" != "true" ]; then
  exec bun run /app/src/server/main.ts
fi

exec litestream replicate -config "$LITESTREAM_CONFIG" -restore-if-db-not-exists -exec "bun run /app/src/server/main.ts"
