# Holding reservation advisory lock repair

`reserveShares` and `creditScoutDistribution` derive the same signed 32-bit key pair from their existing `holdingReservationDomain(userId, playerId, sport)` identity in Node.js and call PostgreSQL's built-in `pg_advisory_xact_lock(integer, integer)` overload. Transaction scope, holding identity, distribution keys, and claim idempotency remain unchanged. Unrelated advisory-lock domains are intentionally untouched.

Before enabling scheduled jobs, run `node scripts/verify-holding-reservation-lock.mjs` while `RUN_SCHEDULED_JOBS=false`. It acquires the exact overload in a transaction and rolls back without application writes. On any regression, disable scheduled jobs and revert the repair.
