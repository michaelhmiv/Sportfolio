# Cron Job Runbook

This document describes the scheduled jobs that are still active and how to run them manually.

## Job Schedule Overview

Jobs run in Eastern Time (ET). The scheduler is initialized in `server/jobs/scheduler.ts`.

| Job Name            | Schedule                              | Purpose                                               |
| ------------------- | ------------------------------------- | ----------------------------------------------------- |
| `bot_engine`        | Dev: every minute; prod: every 15 min | Runs Hermes bot scouting/trading/liquidity strategies |
| `vesting_accrual`   | Every 5 min (`:04`)                   | Accrues vesting shares for users                      |
| `news_fetch`        | Every hour (`:00`)                    | Fetches sports news from Perplexity                   |
| `roster_sync`       | Daily 5:30 AM                         | Syncs NBA player roster                               |
| `schedule_sync`     | Every hour (`:05`)                    | Syncs NBA game schedules                              |
| `stats_sync`        | Every hour (`:10`)                    | Syncs NBA game stats for completed games              |
| `stats_sync_live`   | Every 5 min                           | Unified live stats for supported live sports          |
| `daily_snapshot`    | Daily 1:30 AM                         | Creates daily market and rank snapshots               |
| `weekly_roundup`    | Monday 6:00 AM                        | Generates weekly performance summaries                |
| `nfl_roster_sync`   | Daily 4:30 AM                         | Syncs NFL players from Ball Don't Lie                 |
| `nfl_schedule_sync` | Daily 6:45 AM                         | Syncs NFL game schedules                              |

## Manual Job Execution

Jobs can be triggered via the admin panel or CLI.

`bot_engine` uses `BOT_ENGINE_SCHEDULE` if set. Without an override, development runs it every minute and production keeps the 15-minute cadence.

### Via CLI

```bash
npx tsx -e "
import 'dotenv/config';
import { syncNFLSchedule } from './server/jobs/sync-nfl-schedule';
syncNFLSchedule().then((r) => console.log('Result:', r));
"
```

### Common Jobs to Trigger

```bash
# NFL schedule updates
npx tsx -e "import 'dotenv/config'; import { syncNFLSchedule } from './server/jobs/sync-nfl-schedule'; syncNFLSchedule().then(console.log);"

# Unified live stats
npx tsx -e "import 'dotenv/config'; import { syncAllLiveStats } from './server/jobs/sync-all-live-stats'; syncAllLiveStats().then(console.log);"

# Daily snapshot
npx tsx -e "import 'dotenv/config'; import { dailySnapshot } from './server/jobs/daily-snapshot'; dailySnapshot().then(console.log);"
```

## Job Dependencies

```text
nfl_roster_sync (4:30 AM)
  -> nfl_schedule_sync (6:45 AM)
     -> stats_sync_live (every 5 min)

roster_sync (5:30 AM)
  -> schedule_sync (hourly)
     -> stats_sync_live (every 5 min)
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

- `[stats_sync_live]`
- `[NFL Stats Sync]`
- `[NFL Schedule Sync]`

## Troubleshooting

### Job not running

1. Check if the job is enabled in `scheduler.ts`.
2. Verify the cron expression.
3. Check for overlapping job locks.

### Job failing silently

1. Check the `job_execution_logs` table.
2. Review console logs for error messages.
3. Manually trigger the job and inspect output.

### NFL scores not updating

1. Trigger `nfl_schedule_sync` first.
2. Then trigger `stats_sync_live`.
3. Check debug logs for game status breakdown.
