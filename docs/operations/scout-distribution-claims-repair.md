# Scout distribution claim migration repair

Production logs showed every hourly scout distribution failing after the claim-first writer shipped. The repository contains migration `0053_scout_distribution_claims.sql`, but the Railway service has no automatic migration command.

The repair is intentionally two-deployment and fail-closed:

1. Deploy with `RUN_SCHEDULED_JOBS=false` and verify no scheduler starts.
2. Configure `node scripts/apply-scout-claims-migration.mjs` as the temporary Railway pre-deploy command.
3. Redeploy. The script acquires a transaction-scoped advisory lock, sets the migration safety GUC, applies migration 0053, and verifies the table plus unique event index.
4. Remove the temporary pre-deploy command, restore `RUN_SCHEDULED_JOBS=true`, and redeploy.
5. Verify the next scout distribution records successful claims without duplicate payouts.

The runner is idempotent. When the complete schema already exists, it verifies and exits without requiring scheduler quiescence. A partial table without the required unique index is treated as an error and is not modified automatically.
