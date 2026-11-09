#!/usr/bin/env bash
# Takes a full logical backup of the Brew Haven database.
#   DATABASE_URL=postgres://… tools/backup.sh [output-dir]
# Writes brewhaven-YYYYMMDD-HHMMSS.dump (pg_dump custom format, compressed) and prints its path.
# Neon also keeps point-in-time history; this file is the copy that lives outside Neon.
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to the database to back up}"
out_dir="${1:-backups}"
mkdir -p "$out_dir"
file="$out_dir/brewhaven-$(date -u +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --compress=9 --no-owner --no-privileges --file="$file" "$DATABASE_URL"
pg_restore --list "$file" >/dev/null # fails if the file is unreadable
echo "$file"
