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

## Notes

- Keep `/marketplace` working as a legacy alias to avoid breaking old links.
- Premium share trading removed; future trading returns via pools.
