# PostgreSQL migration runbook

This runbook moves the application-owned `public` schema. Supabase Auth remains in Supabase and is not dumped or restored.

## Safety contract

- Set `RUN_SCHEDULED_JOBS=false` on every non-authoritative deployment.
- Set `MAINTENANCE_MODE=true` before the final dump. This blocks every non-safe `/api` method with HTTP 503 while keeping health checks and reads available.
- `/api/health` reports `maintenanceMode` and `writesBlocked`.
- Never point source and target variables at the same database.
- `restore` is destructive: it uses `pg_restore --clean --if-exists` inside one transaction.
- `restore` refuses a target with existing `public` tables unless `ALLOW_NONEMPTY_TARGET=true`. Only use that override for a disposable rehearsal database.
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

Keep the artifact directory private. The custom dump contains production data.

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
   - `manifest.json` — artifact paths and removal count.

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
   - invalid target foreign keys;
   - any target RLS policy or row-security-enabled table;
   - any target `public` function referencing `auth.*`.

5. Apply repository migrations that landed after the dump, update the application `DATABASE_URL`, deploy, and exercise auth plus read/write gameplay contracts.
6. Only after successful live verification, set `MAINTENANCE_MODE=false` and enable `RUN_SCHEDULED_JOBS=true` on exactly one authoritative deployment.

## Rollback

If verification or live smoke tests fail, keep writes blocked, restore the old `DATABASE_URL`, redeploy, verify the original database health, and then clear maintenance mode. Do not allow writes to both databases during rollback.
