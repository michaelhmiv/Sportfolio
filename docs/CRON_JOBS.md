# Cron Job Runbook

This document describes the scheduled jobs active during the MLB/NASCAR-only migration.
Jobs run in Eastern Time (ET). The scheduler is initialized in `server/jobs/scheduler.ts`.

## Active Job Schedule

| Job Name                       | Schedule                           | Purpose                                                                          |
| ------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------- |
| `scout_distribution`           | Every hour (`:00`)                 | Distribute scout shares based on Scout-Minute ratio                              |
| `news_fetch`                   | Every hour (`:00`)                 | Fetches sports news from Perplexity                                              |
| `discord_hourly_market_digest` | Every hour (`:00`)                 | Publish market digest to Discord                                                 |
| `discord_news_post`            | Every hour (`:05`)                 | Publish newly fetched news to Discord                                            |
| `bot_engine`                   | Dev: every min; prod: every 15 min | Runs Hermes bot scouting/trading/liquidity strategies                            |
| `stats_sync_live`              | Every 5 min (`:04`)                | Live stats for MLB (via public MLB StatsAPI)                                     |
| `mlb_roster_sync`              | Daily 4:15 AM                      | Syncs MLB player roster via StatsAPI                                             |
| `mlb_schedule_sync`            | Hourly (`:50`)                     | Syncs MLB game schedules/scores via StatsAPI                                     |
| `nascar_roster_sync`           | Daily 3:30 AM                      | Syncs NASCAR driver rosters                                                      |
| `nascar_active_roster_sync`    | Daily 4:00 AM                      | Syncs active drivers from race entry lists                                       |
| `nascar_schedule_sync`         | Daily 3:45 AM                      | Syncs NASCAR race schedule                                                       |
| `nascar_stats_sync`            | Hourly (`:20`)                     | Syncs completed race results                                                     |
| `nascar_live_sync`             | Every 5 min                        | Syncs live race data during events                                               |
| Various core jobs...           | Various                            | Lock/settle boosts, share payouts, notification signals, collections, milestones |

## Disabled Jobs (MLB/NASCAR-Only Migration)

NBA, NFL, and injury sync jobs have been removed from the codebase
during the MLB/NASCAR-only migration. They can be restored from git
history if NBA/NFL support is re-enabled in the future.

## Manual Job Execution

Jobs can be triggered via the admin panel or CLI.

### Via CLI

```bash
# MLB StatsAPI-based sync
npx tsx -e "
import 'dotenv/config';
import { syncMLBRoster } from './server/jobs/sync-mlb-roster';
syncMLBRoster().then((r) => console.log('Result:', r));
"

# MLB StatsAPI live stats
npx tsx -e "
import 'dotenv/config';
import { syncMLBStats } from './server/jobs/sync-mlb-stats';
syncMLBStats().then((r) => console.log('Result:', r));
"

# Unified live stats (MLB only)
npx tsx -e "
import 'dotenv/config';
import { syncAllLiveStats } from './server/jobs/sync-all-live-stats';
syncAllLiveStats().then((r) => console.log('Result:', r));
"

# NASCAR syncs
npx tsx -e "
import 'dotenv/config';
import { syncNascarRoster } from './server/jobs/sync-nascar-roster';
syncNascarRoster().then((r) => console.log('Result:', r));
"
```

## Job Dependencies

```text
mlb_roster_sync (4:15 AM) ─────────────────────┐
mlb_schedule_sync (hourly) ──> stats_sync_live (every 5 min)
                                                │
nascar_roster_sync (3:30 AM) ───────────────────┤
  -> nascar_active_roster_sync (4:00 AM)        │
     -> nascar_schedule_sync (3:45 AM)          │
        -> nascar_stats_sync (hourly)           │
           -> nascar_live_sync (every 5 min)    │
                                                │
All stats syncs feed into:
  -> scout_distribution (hourly)
  -> lock_boost_shares (every 5 min)
  -> settle_boosts (every 10 min)
  -> notification_signals (every 15 min)
```

## Monitoring

### Check Job Logs

```sql
SELECT job_name, status, started_at, completed_at, error_message
FROM job_execution_logs
ORDER BY started_at DESC
LIMIT 20;
```

```sql
SELECT job_name, error_message, started_at
FROM job_execution_logs
WHERE status = 'failed' AND started_at > NOW() - INTERVAL '24 hours';
```

### Debug Output

Jobs log to console with prefixes such as:

- `[MLB Roster Sync]`
- `[MLB Schedule Sync]`
- `[MLB Stats Sync]`
- `[live_stats_sync]`
- `[NASCAR Roster Sync]`
- `[NASCAR Stats Sync]`

## Troubleshooting

### MLB scores not updating

1. The MLB StatsAPI is a public API requiring no key — verify network connectivity to `statsapi.mlb.com`.
2. Check `[MLB Schedule Sync]` logs for game fetch counts.
3. Check `[MLB Stats Sync]` for boxscore fetch results.
4. Manually trigger `syncMLBStats` and inspect output.

### Job not running

1. Check if the job is enabled in `scheduler.ts`.
2. Verify the cron expression.
3. Check for overlapping job locks.

### Job failing silently

1. Check the `job_execution_logs` table.
2. Review console logs for error messages.
3. Manually trigger the job and inspect output.
