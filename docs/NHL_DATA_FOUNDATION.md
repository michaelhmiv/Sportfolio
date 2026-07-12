# NHL data foundation

Sportfolio uses the NHL's unauthenticated, official JSON Web API directly from the Express server. It requires **no API key, browser proxy, Python runtime, sidecar, NHL EDGE endpoint, or `nhl-api-py` dependency**.

## Sources

- `https://api-web.nhle.com/v1/standings-season` — official seasons
- `/standings/now` — team discovery
- `/roster/{teamAbbrev}/{season}` — roster sync
- `/schedule/{date}` — schedule/reconciliation
- `/score/{date}` — five-minute live game state refresh
- `/gamecenter/{gameId}/boxscore` — player box scores

The provider applies a 10-second timeout, bounded retries only for transient failures (`408`, `429`, selected 5xx/network failures), 15-second in-process caching, and single-flight request coalescing. A failure leaves last-known-good database records intact.

## Operations

| Job                   | Cadence (America/New_York)      | Purpose                                                                                          |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `nhl_roster_sync`     | daily 04:20                     | Teams/active rosters; only a complete validated team roster can deactivate players for that team |
| `nhl_schedule_sync`   | hourly at :50                   | Yesterday through next 7 days; safe when no games exist                                          |
| `nhl_live_stats_sync` | every five minutes at :04, :09… | Scores, live box scores, final reconciliation                                                    |

Use the existing admin job trigger with one of the job names above. Existing `job_execution_logs` contains result counts and failures.

## Identity, seasons, and time

Provider IDs are collision-safe: players are `nhl_<NHL player id>` and games are `nhl_<NHL game id>`. The existing generic schema therefore needs **no migration**. NHL season selection comes from official `standings-season` metadata; it chooses an active season or the most recently completed official season in the offseason, rather than deriving a year pair. Game dates are formatted in `America/New_York`, so a late-night UTC timestamp cannot move a game to the wrong Sportfolio day.

## Stat and scoring behavior

Skater JSON fields: goals, assists, points, plus/minus, penalty minutes, hits, power-play goals, shots, faceoff percentage, time on ice, blocked shots, shifts, giveaways, takeaways.

Goalie JSON fields: saves, shots against, goals against, save percentage, time on ice, starter and decision. DraftKings NHL Classic points are calculated deterministically: skaters use goals (8.5), assists (5), shots (1.5), blocks (1.3), short-handed points (2), shootout goals (1.5), hat-trick (3), and 3+ point (3) bonuses; goalies use wins (6), saves (.7), goals allowed (-3.5), shutouts (4), overtime loss (2), and 35-save (3) bonuses.

Core scoring comes from the box score. **This is the settlement-eligible simplified Sportfolio NHL scoring model, not a claim of full DraftKings NHL Classic equivalence.** Short-handed points and shootout goals are intentionally excluded rather than guessed and are recorded as `scoringEnrichment.status: "not_included"`. Boost and share payouts therefore use the documented box-score-only fantasy total. A shutout additionally needs explicit final/starter evidence, not just zero goals against.

Roster syncing is two phase: all team rosters are fetched and validated first, then a global player map is upserted, then only players absent from every successful roster may be deactivated. A failed, empty, or malformed team response cannot deactivate last-known-good players. The live job fetches both yesterday and today, deduplicates official game IDs, and includes persisted in-progress/recent completed games in a bounded two-day lookback so a post-midnight final is reconciled.

## Read-only verification

```sql
select sport, count(*) from players group by sport order by sport;
select sport, status, count(*) from daily_games group by sport, status order by sport, status;
select sport, season, count(*) from player_game_stats group by sport, season order by sport, season;
select * from daily_games where sport = 'NHL' order by date desc limit 25;
select * from player_game_stats where sport = 'NHL' order by created_at desc limit 25;
```

NHL public product activation is intentionally not part of this foundation branch. Disable ingestion by disabling these three scheduled jobs through the existing job controls; public activation is controlled separately in the stacked product branch.
