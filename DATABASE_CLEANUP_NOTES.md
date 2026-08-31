# Database Cleanup Report (2026-01-25)

Deleted 369 orphaned NBA game records with IDs 152xxx (from Jan 22).
These were duplicates created when balldontlie API changed its ID scheme.

Kept 99 new NBA records with IDs 184xxx (fetched Jan 25).
These have correct game IDs, scores, and player stats.

Jan 25 NBA games now showing correctly:

- DET 139 - 116 SAC (completed)
- MIN 19 - 24 GSW (inprogress)
- 6 other scheduled games

NFL playoff fix already committed (dates[] instead of weeks[]).

## Production economy note (2026-08-31)

PR #471 fixes PostgreSQL parameter typing in payout settlement and direct-share Daily Boost economy event metadata. This repair is code-only and does not require rerunning the retired/destructive Economy V2 migration.
