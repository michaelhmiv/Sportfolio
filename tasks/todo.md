- [x] 2026-02-12: Profile admin and scheduler hot paths tied to prod DB pressure
- [x] 2026-02-12: Replace `/api/admin/stats` full-table fetches with aggregate count queries
- [x] 2026-02-12: Add short TTL cache for `/api/admin/stats` and invalidate on admin-triggered job/backfill completion
- [x] 2026-02-12: Add scheduler overlap guard so the same job cannot run concurrently
- [x] 2026-02-12: Stagger high-frequency cron jobs and lower non-critical refresh frequencies
- [x] 2026-02-12: Reduce admin page polling cadence (faster only while jobs/backfill are running)

- [ ] Rename Marketplace to Player Pools (canonical route `/pools`, redirect legacy `/marketplace`)
- [ ] Fix AMM trade panel to use authenticated requests in production (buy + sell)
- [ ] Add Player Pool contribution UI on player page (add/remove liquidity + zap shares-only)
- [ ] Implement zap backend endpoints (quote + execute) with atomic transaction
- [ ] Update copy/links/docs so Marketplace vs Pools is not confusing
- [ ] Verify: typecheck, tests, and manual smoke flows (trade, add/remove LP, zap)

- [ ] Fix 24h volume accuracy: compute rolling 24h shares volume from `trades` and stop roster sync from clobbering market fields

## 2026-02-20 Dashboard Listing Redesign

- [x] Add `liveEarned` to game and race insights payloads for authenticated users
- [x] Update dashboard insight types for `liveEarned`/`earningsStatus`
- [x] Align team sport card layout columns (`Market`, `Away`, `Home`, `Progress`, `Live Earned`)
- [x] Align NASCAR row layout columns and keep race-specific metadata
- [x] Sort dashboard sections by date for live/upcoming/final groupings
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## Notes

- Keep `/marketplace` working as a legacy alias to avoid breaking old links.
- Premium share trading removed; future trading returns via pools.

## 2026-02-20 Live Market Status Enrichment

- [x] Add live market status enrichment for NBA/NFL/MLB in `/api/games/insights` (inning/quarter/clock)
- [x] Extend game insight types with optional `liveMarketStatus`
- [x] Render sport-specific live market status in dashboard market column (replace generic `LIVE`)

## 2026-02-20 PR Review Follow-ups

- [x] Scope live-earned power alias matching by sport to avoid cross-league ID collisions
- [x] Restore SQL-level season filtering in `getBatchPlayerSeasonStatsFromLogs` to avoid full historical scans
- [x] Validate via `npm run check`, `npm run lint`, and `npm run test:run`

## 2026-02-20 MLB Away Team Shows TBD on Dashboard

- [x] Investigate MLB away-team field mapping from BallDontLie to `daily_games`
- [x] Add compatibility parsing for both `visitor_team` and `away_team` payload shapes
- [x] Update MLB schedule/stats sync paths to use compatibility helpers
- [x] Add regression tests for away-team/away-score fallback behavior
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`

## 2026-02-20 Pricing Integrity Hardening

- [x] Identify remaining API paths that still fallback to placeholder `players.currentPrice`
- [x] Remove placeholder-price fallback in top-market-cap and market-activity enrichment paths
- [x] Update market scanner sourcing to require pool-backed pricing (or real trade price)
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`
