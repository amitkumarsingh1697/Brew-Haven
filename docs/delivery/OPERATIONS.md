# Running Brew Haven in production

What to set up so problems are noticed quickly and data can be brought back.

## Health checks

| Endpoint | Meaning | Use it for |
|---|---|---|
| `GET /health` | The API is up and can reach the database | A quick manual check |
| `GET /health/ready` | Database answers, and the background worker has ticked in the last minute. Returns 503 with the reasons otherwise. Also reports background jobs waiting and jobs that gave up in the last day | Render's health check (`render.yaml`), and an uptime monitor |

Background jobs backing up (for example while WhatsApp is down) show in `/health/ready` but don't
make it fail, so the host doesn't restart a healthy API.

**Uptime monitor:** point a free monitor (UptimeRobot, Better Stack or similar) at
`https://<api>/health/ready` every 5 minutes, alerting the same chat channel as below.

## Alerts

Set `ALERT_WEBHOOK_URL` to an incoming-webhook URL for Slack, Google Chat or Discord. The API
posts there when:

- a request fails with a server error (the message includes a reference the staff see on screen,
  e.g. "quote ref Xk3_9aQ1", which matches the `reqId` in the logs);
- a background job (refund, customer message) gives up after 8 tries;
- a background worker pass fails.

The same problem is posted at most once every 10 minutes. Without the variable, alerts only go
to the logs. `APP_ENV` labels the alerts ("demo", "production").

Every response carries an `X-Request-Id` header with the same reference.

## Backups

1. **Neon point-in-time restore** (built in): restore the database to any moment within the
   plan's history window from the Neon console. Use this first for "we lost data this morning".
2. **Our own copy** outside Neon, so a problem with the Neon account can't take the data with it:

   ```sh
   DATABASE_URL=<neon url> tools/backup.sh /secure/backups
   ```

   Run it nightly from a machine the business controls (cron), and keep 30 days. The file
   contains customer names and phone numbers, so store it encrypted and with restricted access
   (DPDP Act). It is not uploaded anywhere by the script.

## Restore drill (monthly, and before go-live)

```sh
createdb brewhaven_restore
SOURCE_URL=<db the backup came from> SCRATCH_URL=postgres://…/brewhaven_restore \
  tools/restore-check.sh /secure/backups/brewhaven-YYYYMMDD-HHMMSS.dump
```

It restores into the scratch database and compares row counts for orders, payments, refunds,
day closes and the audit log, the captured total, the latest order time and the migration count.
It prints PASS or FAIL. Run it straight after a backup so the source hasn't moved on.

Last drill: 9 Nov 2026 on the dev database, PASS, restore took under a second.

## If something goes wrong

1. Check `/health/ready` to see which part is failing.
2. Search the Render logs for the reference from the alert or from the staff member's screen.
3. Money questions: the owner's Setup → Payment checks lists failed or stuck refunds and paid
   orders that weren't served.
4. To bring data back: Neon point-in-time restore to a new branch, check it, then switch
   `DATABASE_URL`. If Neon itself is the problem, restore the latest `tools/backup.sh` file into
   a new Postgres and switch to that.
