# NFL Data Foundation

Sportfolio's NFL integration uses the existing application, Postgres database, scheduler, unified sports adapters, and generic public/MCP tools. There is no separate NFL service or NFL-specific MCP server.

## Provider split

- **ESPN (`site.api.espn.com`)** is the current/live source for teams, active rosters, schedules, scores, game state, and game summaries/box scores.
- **nflverse** is the canonical identity and historical-stat source. Sportfolio consumes the nflverse player crosswalk and weekly player-stat CSV releases directly from GitHub releases.

ESPN is an undocumented upstream. Every ESPN request is bounded by a timeout, has only a bounded retry for transient failures, and is normalized before it reaches Sportfolio persistence. An unavailable or malformed ESPN response must not zero or regress previously persisted game/stat state.

## Canonical player identity

NFL players use nflverse/GSIS identity as the Sportfolio canonical key:

```text
nfl_<GSIS_ID>
```

ESPN athlete IDs are provider aliases (`nfl_espn_<ESPN_ID>`), not canonical identities. This prevents a future ESPN schema/ID change from redefining Sportfolio's player identity.

Only these positions are imported as market-eligible players:

- QB
- RB
- WR
- TE
- K

Team defense and individual defensive-player stocks are intentionally excluded.

## Scoring

NFL performance currently uses conventional full-PPR fantasy scoring:

- 1 point per 25 passing yards
- 4 points per passing touchdown
- -2 per interception
- 1 point per 10 rushing yards
- 6 points per rushing touchdown
- 1 point per reception
- 1 point per 10 receiving yards
- 6 points per receiving touchdown
- -2 per lost fumble
- 1 point per made PAT
- 3 points per made field goal from 0-39 yards
- 4 points per made field goal from 40-49 yards
- 5 points per made field goal from 50+ yards

The constants live in `server/nfl/scoring.ts` and are tested independently.

Fantasy points are a performance statistic. **They are not an opening market valuation.** NFL ingestion/backfill must never seed a pool, quote, order, trade, `lastTradePrice`, or bot-created opening market. Users create the NFL market.

## Preseason semantics

Preseason is **display-only**:

- schedules and scores are visible;
- live game state is visible;
- player game statistics may be stored and displayed;
- preseason is excluded from share-payout snapshots/settlement and boost locking/settlement;
- preseason must not create market activity.

Regular season and postseason are gameplay-eligible.

## Scheduled jobs

NFL uses the existing `JobScheduler`/job registry:

| Job | Cadence | Purpose |
| --- | --- | --- |
| `nfl_live_stats_sync` | every 5 minutes | current scoreboard plus summaries only for live/recent-final games |
| `nfl_schedule_sync` | hourly | rolling schedule/status refresh |
| `nfl_roster_sync` | daily | current eligible-player roster + ESPN/GSIS reconciliation |
| `nflverse_stats_sync` | daily overnight | finalized/stat-correction refresh from nflverse |

The live job intentionally polls no faster than five minutes. The nflverse player identity crosswalk is cached in-process for six hours to avoid downloading it on each live cycle.

## One-time production rebuild

The production transition is intentionally explicit and must not run on every application startup.

Run:

```bash
npm run nfl:migrate-data
```

The command:

1. acquires a Postgres advisory lock;
2. creates/reads a durable operational-migration marker;
3. records legacy NFL player/game/stat/market counts;
4. removes legacy NFL data in a controlled rebuild;
5. imports canonical current roster identities;
6. imports the 2024, 2025, and current 2026 schedules;
7. backfills nflverse weekly player stats from 2024 forward;
8. verifies no orphan stats, invalid positions, seeded `lastTradePrice`, or migration-created NFL pools;
9. writes the completion marker only after verification succeeds.

A completed migration is a no-op on a subsequent invocation.

### Production verification

Deployment logs should include lines beginning with `[nfl_migration]`, including legacy inventory and final verification. A healthy final verification has:

- NFL players > 0
- NFL games > 0
- NFL player-game stats > 0
- `orphanStats = 0`
- `invalidPositions = 0`
- `seededLastTradePrices = 0`
- `seededPools = 0`

After deploy, verify that an imported NFL player can be searched/scouted and has historical stats but displays **No market yet** until a user-created market exists.

## Provider incident / quick disable

If ESPN changes schema or becomes unreliable:

1. Do not delete or zero persisted NFL data.
2. Disable the NFL API jobs in `server/jobs/job-registry.ts` (or deploy a small job-disable patch) while leaving historical data/query surfaces intact.
3. Review ESPN provider errors in application/job logs.
4. Update parser fixtures/tests before re-enabling jobs.

The adapter/provider layer is intentionally isolated so an ESPN change should not require changes to Sportfolio's public tool contracts, market schema, or deployment topology.
