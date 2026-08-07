# Retired Product Database Cleanup

This is a controlled production maintenance procedure. The application refactor must be running successfully in beta and production before the migration is executed. Beta and production share the production database, so the migration is run exactly once.

## Preconditions

1. Deploy the replacement application code to beta while all old tables still exist.
2. Verify beta authentication, portfolio, market, scouting, boosts, watchlists, collections, OAuth, CLI, MCP, and all 12 semantic MLB tools.
3. Deploy the same commit to production and repeat read-only smoke tests.
4. Confirm logs show no reads or writes against the tables listed in migration `0065`.
5. Create and verify a restorable production database backup.

## Inventory

Before execution, capture row counts for every table listed in the migration. Preserve the output with the deployment record. Export any records that have a legal or operational retention requirement.

## Execution

Run `migrations/0065_drop_retired_product_surfaces.sql` manually through the approved production migration process. Do not attach it to ordinary application startup or beta deployment. The migration drops tables explicitly in dependency order and intentionally does not use a broad `CASCADE`.

## Verification

After execution:

- Confirm every listed table is absent.
- Confirm no surviving foreign key references an absent table.
- Run application type/schema validation.
- Re-run beta and production smoke tests.
- Verify MCP discovery, semantic MLB calls, and a controlled confirmation-gated gameplay transaction.
- Review application and database error logs.

## Rollback

Application rollback is safe before the table-drop migration. After the migration, restoring the old application requires restoring the database backup or recreating the dropped schema and data. Do not roll back only the application after table removal.
