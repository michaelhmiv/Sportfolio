# Finalize stale Economy V2 test contracts

Apply only the current Singles/Direct Daily Boost cleanup fixes already identified on PR #455. Do not change workflows or product semantics. The repository lifecycle finalizer will update stale tests/docs, run targeted tests, restore package.json, remove this task and itself, and commit the clean result.

This synchronization is intentionally against the current finalizer/wrapper head.

Retry uses the absolute GitHub Actions checkout path for npm lifecycle execution.
