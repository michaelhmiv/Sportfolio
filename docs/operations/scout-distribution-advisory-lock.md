# Scout distribution advisory lock repair

Production PostgreSQL rejected the database-side `hashtextextended` helper used to derive a transaction advisory-lock key. The writer now hashes the canonical claim event key in Node.js and calls PostgreSQL's built-in two-integer `pg_advisory_xact_lock(integer, integer)` overload.

Before restoring scheduled jobs, run `node scripts/verify-scout-distribution-lock.mjs` with `RUN_SCHEDULED_JOBS=false`. The verifier starts a transaction, acquires the same lock overload with a synthetic key, and rolls back without inserting claims or changing balances.

Rollback: disable scheduled jobs, revert this commit, and keep the scheduler disabled until an alternative portable lock is validated.
