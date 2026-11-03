#!/bin/sh
set -e

DB_PATH="${DATABASE_PATH:-/app/data/monitor.db}"
case "$DB_PATH" in
  /*) ;;
  *) DB_PATH="/app/$DB_PATH" ;;
esac
DATA_DIR="$(dirname "$DB_PATH")"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

exec "$@"
