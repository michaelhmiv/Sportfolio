# PostgreSQL migration runbook

This runbook moves the application-owned `public` schema. Supabase Auth remains in Supabase and is not dumped or restored.

## Safety contract

- Set `RUN_SCHEDULED_JOBS=false` on every non-authoritative deployment. Jobs only start when this value is explicitly `true`.
- Set `MAINTENANCE_MODE=true` before the final dump. This globally blocks every non-safe HTTP method with HTTP 503, including `/api`, MCP, and internal routes, while keeping health checks and reads available. It also disables startup warmups, bot-profile writes, schedulers, and the account-deletion processor.
- `/api/health` reports `maintenanceMode` and `writesBlocked`.
- Never point source and target variables at the same database.
- `restore` is destructive: it uses `pg_restore --clean --if-exists` inside one transaction.
- `restore` requires both source and target URLs, refuses identical endpoints before touching the target, and verifies that the restore list is the RLS-filtered table of contents of the supplied dump.
- `restore` refuses a target with existing `public` relations, functions, or standalone types unless `ALLOW_NONEMPTY_TARGET=true`. Only use that override for a disposable rehearsal database.
- Use PostgreSQL client tools at least as new as the source server. Set the explicit binary variables when the system defaults are older.

## Required environment

```bash
export SOURCE_DATABASE_URL='postgresql://...'
export TARGET_DATABASE_URL='postgresql://...'
export MIGRATION_ARTIFACT_DIR='/secure/path/sportfolio-migration-YYYYMMDDTHHMMSSZ'

# Required on hosts whose default pg_dump/pg_restore are older than PostgreSQL 17:
export PG_DUMP_BIN='/usr/lib/postgresql/17/bin/pg_dump'
export PG_RESTORE_BIN='/usr/lib/postgresql/17/bin/pg_restore'
# Optional if psql is not on PATH:
export PSQL_BIN='/usr/lib/postgresql/17/bin/psql'
```

Keep the artifact directory private. The custom dump contains production data. Database credentials are passed to PostgreSQL tools through `PG*` environment variables rather than process arguments.

## Rehearsal and cutover sequence

1. Freeze writers and stop scheduled work.
2. Dump the source:

   ```bash
   npm run db:migration:dump
   ```

   The command writes:
   - `public.dump` — compressed custom-format archive;
   - `public.list` — complete archive table of contents;
   - `public.railway.list` — restore list with Supabase RLS policy and row-security entries removed;
   - `manifest.json` — artifact paths, SHA-256 hashes, and removal count.

3. Restore into an empty disposable or final target:

   ```bash
   export DUMP_PATH="$MIGRATION_ARTIFACT_DIR/public.dump"
   export RESTORE_LIST_PATH="$MIGRATION_ARTIFACT_DIR/public.railway.list"
   npm run db:migration:restore
   ```

4. Verify source/target parity:

   ```bash
   npm run db:migration:verify
   ```

   Verification fails on:
   - any table row-count mismatch;
   - table/view/function/trigger count mismatch;
   - missing or changed columns, constraints, indexes, sequences, views, functions, triggers, or relation properties;
   - invalid target foreign keys;
   - any target RLS policy or row-security-enabled table;
   - any target `public` function referencing `auth.*`.

5. Apply repository migrations that landed after the dump, update the application `DATABASE_URL`, deploy, and exercise auth plus read/write gameplay contracts.
6. Only after successful live verification, set `MAINTENANCE_MODE=false` and enable `RUN_SCHEDULED_JOBS=true` on exactly one authoritative deployment.

## Rollback

Define and communicate the rollback window before cutover. Retain the immutable dump and keep the Supabase database available throughout that window.

If verification or live smoke tests fail:

1. Keep `MAINTENANCE_MODE=true` and set `RUN_SCHEDULED_JOBS=false` on **every** deployment. Stop all target schedulers/processors before changing any URL.
2. Confirm no deployment can write to either database. Inventory target-only writes made since cutover; reconcile them into Supabase or explicitly accept their loss before proceeding.
3. Switch every application deployment back to the Supabase `DATABASE_URL` as one coordinated change and redeploy.
4. Verify Supabase health, row/structural inventory, Supabase Auth, and representative read/write gameplay contracts while writes remain blocked.
5. Enable `RUN_SCHEDULED_JOBS=true` on exactly one authoritative deployment and verify advisory-lock ownership/job logs. Leave it false everywhere else.
6. Clear maintenance mode only after the original database and single scheduler owner are verified.

Never allow writes to both databases. After the rollback window expires and Railway is authoritative, a reverse migration—not a blind URL swap—is required to return to Supabase.
