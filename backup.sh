#!/bin/bash
# Automated PostgreSQL backup. Intended to run every 30 minutes via cron.
# Writes timestamped, gzipped dumps to ./backups and keeps the newest 96
# (~48 hours at a 30-minute cadence).

export PATH=/usr/local/bin:/usr/bin:/bin
cd "$(dirname "$0")" || exit 1

DB="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
if [ -z "$DB" ]; then
  echo "$(date -u) backup: no DATABASE_URL in .env" >&2
  exit 1
fi

DIR=backups
mkdir -p "$DIR"
FILE="$DIR/worldcup-$(date -u +%Y%m%d-%H%M%S).sql.gz"

if pg_dump "$DB" | gzip > "$FILE"; then
  # Drop a zero-byte file if the dump silently produced nothing.
  if [ ! -s "$FILE" ]; then rm -f "$FILE"; echo "$(date -u) backup: empty dump" >&2; exit 1; fi
  # Keep the newest 96 backups, delete the rest.
  ls -1t "$DIR"/worldcup-*.sql.gz 2>/dev/null | tail -n +97 | xargs -r rm -f
  echo "$(date -u) backup: ok -> $FILE ($(du -h "$FILE" | cut -f1))"
else
  rm -f "$FILE"
  echo "$(date -u) backup: pg_dump failed" >&2
  exit 1
fi
