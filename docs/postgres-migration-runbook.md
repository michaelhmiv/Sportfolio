# PostgreSQL migration runbook (historical)

This runbook records the completed application-database cutover. It is retained for audit history and rollback context only; it is not an active deployment procedure. Better Auth and the Sportfolio application now use Railway PostgreSQL.

## Safety contract

- Set `RUN_SCHEDULED_JOBS=false` on every non-authoritative deployment. Jobs only start when this value is explicitly `true`.
- Set `MAINTENANCE_MODE=true` before the final dump. This globally blocks every non-safe HTTP method with HTTP 503, including `/api`, MCP, and internal routes, while keeping health checks and reads available. It also disables startup warmups, bot-profile writes, schedulers, and the account-deletion processor.
- `/api/health` reports `maintenanceMode` and `writesBlocked`.
- Never point source and target variables at the same database.
- `restore` is destructive: it uses `pg_restore --clean --if-exists` inside one transaction.
- `restore` requires both source and target URLs, refuses identical endpoints before touching the target, and verifies that the restore list is the RLS-filtered table of contents of the supplied dump.
- `restore` refuses a target with existing `public` relations, functions, or standalone types unless both `ALLOW_NONEMPTY_TARGET=true` and the target-specific `CONFIRM_NONEMPTY_TARGET` token printed by the failed command are supplied. Only use that override for a disposable rehearsal database; the token has the form `ERASE host:port/database`.
- `restore` refuses to start while another client connection is using the target. Stop every target-connected application, worker, console, and pool first, and keep them stopped until restore and verification finish. This idle-target check narrows the race window; maintenance mode and stopped deployments remain the primary write-exclusion controls.
- Artifact directories must be owned by the invoking user with mode `0700`. Every dump, restore list, manifest, and verification inventory must be an owned regular file (not a symlink) with mode `0600`; insecure pre-existing paths are rejected.
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

Create the artifact parent on a trusted local filesystem. The tooling creates the final directory as `0700` and files as `0600`, and rejects pre-existing paths with broader permissions, wrong ownership, or symlinks. The custom dump contains production data. Database credentials are passed to PostgreSQL tools through `PG*` environment variables rather than process arguments.

## Rehearsal and cutover sequence

1. Freeze writers and stop scheduled work.
2. Dump the source:

   ```bash
   npm run db:migration:dump
   ```

   The command writes:
   - `public.dump` — compressed custom-format archive;
   - `public.list` — complete archive table of contents;
   - `public.railway.list` — restore list with legacy source-provider RLS policy and row-security entries removed;
   - `manifest.json` — artifact paths, SHA-256 hashes, and removal count.

3. Restore into an empty disposable or final target:

   ```bash
   export DUMP_PATH="$MIGRATION_ARTIFACT_DIR/public.dump"
   export RESTORE_LIST_PATH="$MIGRATION_ARTIFACT_DIR/public.railway.list"
   npm run db:migration:restore
   ```

   If this is an intentionally nonempty disposable rehearsal target, first run the command without an override and copy its exact target-specific confirmation token, then rerun with both variables (example only):

   ```bash
   export ALLOW_NONEMPTY_TARGET=true
   export CONFIRM_NONEMPTY_TARGET='ERASE railway.example:5432/sportfolio'
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

Define and communicate the rollback window before cutover. Retain the immutable dump and the
legacy source database only for the documented historical rollback window.

If verification or live smoke tests fail:

1. Keep `MAINTENANCE_MODE=true` and set `RUN_SCHEDULED_JOBS=false` on **every** deployment. Stop all target schedulers/processors before changing any URL.
2. Confirm no deployment can write to either database. Inventory target-only writes made since cutover; reconcile them into the legacy source database or explicitly accept their loss before proceeding.
3. Switch every application deployment back to the archived source `DATABASE_URL` as one coordinated change and redeploy.
4. Verify source-database health, row/structural inventory, legacy authentication records, and representative read/write gameplay contracts while writes remain blocked.
5. Enable `RUN_SCHEDULED_JOBS=true` on exactly one authoritative deployment and verify advisory-lock ownership/job logs. Leave it false everywhere else.
6. Clear maintenance mode only after the original database and single scheduler owner are verified.

Never allow writes to both databases. After the rollback window expires and Railway is authoritative,
a reverse migration—not a blind URL swap—is required to restore the archived source system.
