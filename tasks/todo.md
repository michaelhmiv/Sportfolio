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

## 2026-02-20 MLB Live Inning/Score/Stats Contract Fix

- [x] Diagnose MLB Market tab live-status/score regressions and trace provider contract drift
- [x] Update MLB API adapters for `STATUS_*` normalization and modern score/stat payload fields
- [x] Patch MLB schedule/stats sync jobs to map current BallDontLie game + team shapes
- [x] Fix `/api/games/insights` live enrichment to surface inning/status/score reliably for MLB
- [x] Fix `/api/games/:gameId/live-stats` MLB mapping for modern stats rows (`game_id`, `team_name`)
- [x] Add dashboard guardrail to avoid false `LIVE` when backend has no live evidence
- [x] Surface live-stats fetch errors in game command center modal
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-20 PR #70 Review + Pool Seeding Follow-up

- [x] Review PR #70 comments and isolate the scanner SQL type mismatch in `getFinancialMarketScanners`
- [x] Fix scanner query typing so `COALESCE` uses compatible SQL types at runtime
- [x] Ensure pool seeding also repairs active players with unseeded/legacy pool liquidity state
- [x] Expose repaired count in admin seed response and UI messaging
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-20 PR #70 Latest Review Comment

- [x] Exclude non-positive AMM spot prices from `/api/players/spotlight/top-market-cap`
- [ ] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-20 Signup Reliability + Onboarding UX

- [x] Add shared email normalization/validation utility for auth inputs
- [x] Harden `useAuth` signup/login flows with normalized email and mapped auth error messaging
- [x] Add signup verification follow-up UX (resend verification + sign-in return path)
- [x] Refresh onboarding modal content and styling to match Sportfolio aesthetic and gameplay priorities
- [x] Align onboarding missions terminology with updated onboarding concepts
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-20 Signup + Onboarding Follow-through

- [x] Add Playwright coverage for signup normalization/verification resend and onboarding CTA navigation
- [x] Add auth telemetry ingestion endpoint and metrics counters for signup/login outcome codes
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`
- [x] Validate targeted e2e via `npx playwright test tests/e2e/auth-onboarding.spec.ts`

## 2026-02-21 API Health Checker + Admin Monitoring

- [x] Add reusable server-side API health checker (DB ping, critical job freshness, route smoke checks)
- [x] Add scheduled daily `api_health_check` job and manual trigger support in scheduler
- [x] Expose admin API health endpoints (`GET /api/admin/api-health`, `POST /api/admin/api-health/run`)
- [x] Add API health monitor card in admin dashboard with per-check status and run history
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-21 Dashboard Sport Filter Tab Audit + Fix

- [x] Audit dashboard sport tab/filter state transitions for NASCAR lock-in and disappearing tabs
- [x] Ensure dashboard always fetches complete game-sport set for the selected date
- [x] Render stable sport tabs (`ALL`, `NBA`, `NFL`, `MLB`, `NASCAR`) regardless of current filtered payload
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-21 PR #74 Review Follow-up (Dashboard Sport Tabs)

- [x] Attempt to fetch PR #74 inline comments and audit prior fix scope
- [x] Keep dashboard sport tabs visible during loading and NASCAR mode
- [x] Align dashboard tab source with canonical `SPORTS` config to prevent drift
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-21 PR #74 Inline Comment Resolution (Boost Context Regression)

- [x] Pull PR #74 inline comments using provided classic PAT
- [x] Restore sport-aligned `/api/games/insights` requests to preserve boost/eligibility context
- [x] Keep stable dashboard sport tabs independent from payload-derived sport lists
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`
