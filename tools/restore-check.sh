#!/usr/bin/env bash
# Restore drill: loads a backup into a scratch database and checks it against the source.
#   SOURCE_URL=postgres://…/brewhaven SCRATCH_URL=postgres://…/brewhaven_restore tools/restore-check.sh backups/brewhaven-….dump
# SCRATCH_URL must point at an empty database you can throw away; it is wiped first.
# Compares row counts of the tables that hold money and orders, and the latest order time.
# Exits non-zero if anything differs. Rows written to the source after the backup will differ;
# run it right after a backup, or against a quiet copy.
set -euo pipefail
dump="${1:?Pass the .dump file to restore}"
: "${SCRATCH_URL:?Set SCRATCH_URL to an empty scratch database}"
: "${SOURCE_URL:?Set SOURCE_URL to the database the backup came from}"
if [ "$SCRATCH_URL" = "$SOURCE_URL" ]; then echo "SCRATCH_URL must not be the source database" >&2; exit 2; fi

psql "$SCRATCH_URL" -q -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"
started=$(date +%s)
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$SCRATCH_URL" "$dump"
echo "Restored in $(( $(date +%s) - started ))s"

query="select 'tenants', count(*)::text from tenants
union all select 'outlets', count(*)::text from outlets
union all select 'orders', count(*)::text from orders
union all select 'order_lines', count(*)::text from order_lines
union all select 'payments', count(*)::text from payments
union all select 'refunds', count(*)::text from refunds
union all select 'shift_closes', count(*)::text from shift_closes
union all select 'audit_log', count(*)::text from audit_log
union all select 'captured_paise', coalesce(sum(amount_paise),0)::text from payments where status = 'CAPTURED'
union all select 'latest_order', coalesce(max(created_at)::text, '-') from orders
union all select 'migrations', count(*)::text from drizzle.__drizzle_migrations"
diff <(psql "$SOURCE_URL" -At -F ' ' -c "$query") <(psql "$SCRATCH_URL" -At -F ' ' -c "$query") > /tmp/restore-diff.$$ && ok=1 || ok=0
psql "$SCRATCH_URL" -At -F ' ' -c "$query" | sed 's/^/  /'
if [ "$ok" = 1 ]; then echo "PASS: restored copy matches the source"; rm -f /tmp/restore-diff.$$; else echo "FAIL: differences (source < > restored):"; cat /tmp/restore-diff.$$; rm -f /tmp/restore-diff.$$; exit 1; fi
