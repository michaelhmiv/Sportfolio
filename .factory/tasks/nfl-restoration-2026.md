# Task: Restore NFL as a first-class Sportfolio sport using ESPN + nflverse

Implement the complete NFL restoration described below. This is a production-oriented change. Work within the repository's existing unified sports architecture and existing Railway/Postgres application; do not create a separate NFL service, separate MCP server, or new deployment topology.

## Product decisions (locked)

1. NFL preseason is display-only. Preseason schedules, scores, game state, and stats may be ingested/displayed, but preseason must not affect gameplay payouts/boost performance/market-performance mechanics.
2. Tradeable NFL positions are only: QB, RB, WR, TE, K. Do not add DEF/team-defense stocks and do not add IDP.
3. Use conventional full-PPR fantasy scoring initially:
   - 1 point / 25 passing yards
   - +4 passing TD
   - -2 interception
   - 1 point / 10 rushing yards
   - +6 rushing TD
   - +1 reception
   - 1 point / 10 receiving yards
   - +6 receiving TD
   - -2 fumble lost
   - kicking: +1 PAT, +3 FG 0-39, +4 FG 40-49, +5 FG 50+
   Keep scoring constants centralized/configurable and independently unit-tested.
4. Live NFL polling cadence is every 5 minutes. Do not add sub-5-minute polling.
5. Legacy NFL data should be wiped/rebuilt cleanly. Do not preserve legacy Ball Don't Lie NFL identity assumptions.
6. Historical backfill starts with the 2024 NFL season and includes 2024 regular/postseason, 2025 regular/postseason, and 2026-current data. Preseason can be present for display/stat history but is not gameplay-eligible.
7. DO NOT seed an NFL market price. Historical/current stats must never create an opening market, AMM pool, bot quote, fake trade, fair-value quote, or lastTradePrice. User activity creates the market. A newly imported NFL player may have currentPrice=0 per schema and lastTradePrice=null, but UI/API semantics must treat that as "no market yet", not a $0 market quote.
8. Expose NFL to ChatGPT/plugin/MCP immediately through the existing unified provider-neutral sports/scouting/market surfaces. Do not add a pile of nfl_* tools.

## Existing architecture to preserve

- `server/sports/contracts.ts` and `server/sports/adapter-registry.ts` are the neutral internal sports contracts.
- `server/sports/default-registry.ts` currently registers MLB/NHL/NASCAR.
- Existing public unified sports tools intentionally avoid provider-specific tool sprawl.
- Existing per-game stat persistence uses `player_game_stats`, with sport-specific details in `statsJson` and a normalized `fantasyPoints` value.
- Existing scheduler/job registry provides locking, job telemetry, manual triggers, and cron definitions.
- MLB/NHL/NASCAR behavior must remain unchanged except for safe generalization where necessary.
- Do not modify `.github/workflows/**`.

## Data-provider architecture

Use two upstreams only for this task:

### ESPN (current/live provider)
Use unauthenticated ESPN JSON endpoints behind a single NFL provider client with explicit timeouts, bounded retry behavior, schema/shape validation, and defensive normalization.

Useful endpoint families:
- Scoreboard: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`
  - date: `?dates=YYYYMMDD`
  - season/week filters as needed (`seasontype=1|2|3`, `week=N`)
- Teams: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams`
- Team roster: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{TEAM_ID}/roster`
- Game summary/boxscore: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={EVENT_ID}`

Treat ESPN as undocumented/unstable: fail closed, preserve last good persisted state, and never zero/erase values because the upstream is unavailable or malformed.

### nflverse (historical + identity provider)
Use GitHub-release CSVs; do not add a Python/R runtime.

Player identity dataset:
`https://github.com/nflverse/nflverse-data/releases/download/players/players.csv`

Weekly player stats dataset:
`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{YEAR}.csv`

Use nflverse `gsis_id` as the canonical NFL identity where available. Use ESPN ID as a provider reference/crosswalk, not the canonical Sportfolio player identity. Canonical Sportfolio IDs should be stable and clearly NFL-scoped, preferably `nfl_<GSIS_ID>` (for example `nfl_00-0033873`). Reuse the repository's existing provider-identity/alias abstractions rather than inventing a parallel identity system.

Implement an RFC4180-safe CSV parser in-repo or use an already-installed dependency if one exists; do not add a heavyweight parquet/R/Python stack just for this.

## Required implementation

### A. Canonical sport/config activation

- Add `nfl` to the server unified sports schema/contracts.
- Add NFL to the default sports adapter registry.
- Add NFL to enabled client/shared sport configuration.
- NFL positions presented as market-eligible: QB/RB/WR/TE/K.
- Set the NFL provider descriptor to the new ESPN+nflverse implementation rather than `none`.
- Fix current NFL season logic. The current month heuristic incorrectly treats August 2026 as the 2025 season. Prefer provider-derived season metadata/context. If a fallback is necessary, July-December => current year, January-June => prior year.

### B. New NFL provider module

Create a cohesive `server/nfl/` (or repository-consistent equivalent) implementation with:
- ESPN client/types/normalization
- nflverse client/types/CSV loading
- identity helpers/crosswalks
- scoring helper
- season-type helpers

Keep source-specific payloads behind the provider boundary. Public/runtime consumers should receive normalized Sportfolio structures.

### C. NFL unified adapter

Implement `server/sports/nfl-adapter.ts` (or equivalent) supporting as many neutral capabilities as the data makes reliable:
- `searchAthletes`
- `getAthlete`
- `getTeams`
- `getSchedule`
- `getStats`
- `getLiveState`

Normalize IDs, game status, team IDs, dates, provenance/freshness metadata, and provider errors consistently with MLB/NHL/NASCAR semantics. NFL live state should represent quarter/clock cleanly using the existing LiveState contract; extend neutral phase/progress enums only if necessary and without breaking other sports.

### D. NFL roster sync

Add a roster sync job that:
- Uses ESPN current team/roster information, reconciled through nflverse identity mappings.
- Imports/updates only QB/RB/WR/TE/K as active market-eligible NFL players.
- Handles trades/team changes and inactive/free-agent status safely.
- Never creates player pools, trades, prices, holdings, or seeded market activity.
- Preserves stable canonical GSIS-based IDs across ESPN changes.
- Logs unresolved identity mappings clearly without fabricating IDs unless there is a safe temporary strategy that can later reconcile deterministically.

### E. NFL schedule sync

Add schedule ingestion for preseason/regular/postseason with explicit season type. Reuse `dailyGames` and existing dedupe/status safeguards. If the existing schema lacks a safe way to preserve NFL season type, add the smallest compatible schema/migration needed and update inserts/types/tests accordingly.

Preseason must be explicitly distinguishable from regular/postseason; do not infer gameplay eligibility from dates alone.

### F. NFL live/final stats sync

Add a 5-minute NFL live stats job.

Efficiency requirements:
- First fetch scoreboard/current game list.
- If no relevant games, stop after the minimal request(s).
- Only fetch detailed game summary/boxscore for in-progress games and recently-final games needing final reconciliation.
- Do not repeatedly crawl every roster/player.
- Persist current live state and per-player stats to the existing normalized game/stat tables.
- Retry/reconcile recent finals until the final boxscore is complete, similar in spirit to the NHL final reconciliation behavior.
- An ESPN failure must retain persisted values and mark/degrade freshness rather than regress a completed game.

Store NFL fields in `statsJson` (passing/rushing/receiving/kicking/fumble fields, liveState, seasonType/provider context) while populating existing common columns and `fantasyPoints` appropriately.

### G. nflverse historical backfill/sync

Add a historical sync path using nflverse weekly player stats for 2024 through current season.
- Backfill 2024 regular + postseason.
- Backfill 2025 regular + postseason.
- Load 2026 current data as it becomes available.
- Map to canonical GSIS player IDs and existing ESPN game/player identities where possible.
- Upsert idempotently.
- Historical rows are analytics/stat history only and must not seed prices/markets.
- Add a daily/overnight nflverse refresh job for current-season finalized/stat-correction data, with bounded network calls.

### H. One-time legacy NFL reset + production migration script

Create an explicit script/package command suitable for Railway pre-deploy, for example `npm run nfl:migrate-data`, that performs the one-time production data transition safely.

Requirements:
- Acquire an advisory lock to avoid concurrent execution.
- Be idempotent and have a durable completion guard/marker. It must be safe if invoked twice.
- Before mutation, log counts of legacy NFL players/games/stats/market artifacts.
- Delete legacy NFL data in FK-safe order. Clean NFL-specific market artifacts/aliases/stats/games/player rows as necessary while not touching MLB/NHL/NASCAR or unrelated users.
- Rebuild current NFL roster/identities and backfill 2024-present data.
- Verify no orphan NFL stat rows, duplicate canonical players, or identity collisions.
- Verify imported players still have no seeded market: no migration-created trade/pool/lastTradePrice.
- Mark the migration complete only after successful verification.
- If the task fails before completion, a retry should clean/rebuild deterministically.
- This script is intentionally for a one-time Railway pre-deploy run; do not run destructive cleanup automatically on every application startup.

Use an existing generic migration marker mechanism if one exists; otherwise create a tiny self-managed migration marker table from the script (`CREATE TABLE IF NOT EXISTS ...`) rather than introducing a large migration framework solely for this task.

### I. Scheduler/job registry

Register production jobs through the existing job registry/scheduler; do not create another scheduler.

Target behavior:
- `nfl_roster_sync`: daily, off-hours.
- `nfl_schedule_sync`: hourly.
- `nfl_live_stats_sync`: every 5 minutes.
- `nflverse_stats_sync`: daily/overnight for historical/current finalized corrections.

Preserve overlap/advisory-lock protection and job telemetry. Add manual trigger support consistent with other sports where useful.

### J. Preseason gameplay gating

Audit all game-based eligibility/payout/boost paths that can consume `dailyGames`/`playerGameStats` and ensure NFL preseason is display-only.

At minimum, preseason must NOT:
- trigger daily boost performance payouts,
- trigger share/gameplay payouts,
- count as regular/postseason performance for any gameplay rule,
- create or seed market activity.

It MAY:
- appear in schedule/slates,
- show live/final scores,
- show player stat lines/history with preseason labeling,
- be queryable through ChatGPT/plugin.

Add explicit regression tests proving this.

### K. Market creation / no-seeding guarantee

Audit stale bot valuation/market-making code. There is known legacy hard-coding around NBA/NFL in `server/bot/player-valuation.ts` or related files.

Required behavior for NFL:
- Do not seed an NFL pool/price/order/trade from stats.
- Do not use calculated fair value as an opening quote.
- Do not have bots bootstrap a player with no user-created market.
- Historical stats may support scouting/analytics only.
- Existing market behavior for MLB/NHL/NASCAR must not be unintentionally changed.

Remove stale NBA/NFL hard-coded assumptions where they are objectively obsolete, but avoid broad economic redesign outside this task. Add tests that an imported NFL player with stats remains unpriced/unseeded until real market activity exists.

### L. UI activation

Activate NFL anywhere the existing enabled-sport configuration drives UI:
- sport selector
- market/player discovery
- scouting/watchlists
- schedule/game views
- player detail/stats/recent games
- news filters where generic sport support already exists

Do not redesign core UI.

Requirements:
- Preseason games visibly label preseason where the surface can support it.
- A player with `lastTradePrice=null` / no actual pool must render as "No market yet" (or existing equivalent), NOT as a meaningful `$0.00` quote. Apply this carefully without breaking existing unpriced-player behavior.

### M. MCP/plugin/public capability activation

Expose NFL through the existing generic Sportfolio tools and unified sports capabilities. Update capability schema/tests/snapshots/documentation as required.

Do NOT add a dedicated NFL MCP server or a large set of `nfl_*` provider-native public tools.

Expected generic queries after deployment should work through existing surfaces, such as:
- NFL games today/Sunday
- search/find an NFL player
- player detail/stats/recent games
- scouting NFL players
- current NFL game state
- historical comparisons using persisted Sportfolio data

### N. Legacy cleanup

Remove obsolete NFL/Ball Don't Lie implementation code/comments/config references that are no longer used by any runtime path. Do not remove an environment variable in code if another active integration truly needs it; prove usage first.

Update documentation that currently says NFL ingestion is disabled or provider is `none`.

Do not resurrect retired Hermes/agent/SMS functionality; do not broaden this task into those systems.

## Resilience / telemetry

- All upstream fetches need timeouts and clear provider-specific errors.
- Use bounded retry only where safe; avoid retry storms.
- Preserve last-good persisted values on provider outage/malformed payload.
- Attach provider/freshness metadata through existing contracts.
- Log request counts / records processed / errors through existing job result telemetry.
- Avoid logging secrets or full huge payloads.

## Tests / acceptance gates

Add/adjust tests for all of the following:

### Provider parsing
- scoreboard parsing
- roster parsing
- boxscore/summary parsing
- malformed ESPN payload
- ESPN timeout/error/429 behavior
- duplicate events
- postponed/cancelled game where applicable
- overtime/final status
- final reconciliation

### Identity
- GSIS canonical ID
- ESPN -> GSIS crosswalk
- duplicate/same-name players
- team change
- missing crosswalk behavior
- no duplicate canonical NFL players

### Scoring
- QB passing
- dual-threat QB
- RB
- WR
- TE
- K field-goal distance tiers
- interception/fumble negatives
- full-PPR receptions

### Season semantics
- August 2026 resolves to 2026 season context
- January 2027 resolves to 2026 season context
- preseason/regular/postseason are distinct

### Market semantics
- imported NFL player has no seeded lastTradePrice
- historical backfill does not create a price/pool/trade
- live stats do not create a price/pool/trade
- bot market-making does not bootstrap a marketless NFL player
- actual existing user market actions remain supported

### Preseason semantics
- preseason appears in schedule/live data
- preseason stats can display
- preseason is excluded from gameplay payout/boost eligibility

### MCP/unified sports
- NFL is advertised/supported by generic unified sports capability surfaces
- athlete search/detail
- slate
- live state
- no provider-specific NFL public-tool explosion

### Regression
- MLB adapter/tests unchanged in behavior
- NHL adapter/tests unchanged in behavior
- NASCAR adapter/tests unchanged in behavior
- public tool governance/audit still passes

Run the appropriate repository checks, including at minimum:
- targeted NFL/new tests
- `npm run check`
- `npm run test:run` (or the largest practical deterministic test suite if the full suite has known unrelated failures; document any unrelated pre-existing failures)
- `npm run public-tools:audit`
- `npm run governance:capabilities` if capability snapshots are impacted
- `npm run retired-surfaces:audit`

Fix failures caused by this task. Do not paper over tests with broad skips.

## Documentation / operator notes

Add a concise implementation/runbook doc covering:
- ESPN = current/live source
- nflverse = identity/historical source
- canonical GSIS identity
- 5-minute live cadence
- full-PPR scoring
- preseason display-only semantics
- no market seeding
- one-time `npm run nfl:migrate-data` production migration
- how to verify migration counts/identity/orphans/no-seeded-market after deploy
- how to disable NFL jobs quickly if ESPN changes schema

## Definition of done

The PR is complete only when:
1. NFL is a first-class enabled unified sport.
2. ESPN provides current schedule/live/boxscore/roster ingestion.
3. nflverse provides canonical identity + 2024-present historical stats.
4. QB/RB/WR/TE/K are the only imported tradeable player positions.
5. Preseason is visible but gameplay-ineligible.
6. Live sync runs every 5 minutes with bounded calls.
7. NFL stats use conventional full-PPR scoring.
8. Legacy NFL data can be wiped/rebuilt safely through the one-time migration command.
9. No imported/backfilled NFL player receives a seeded price/market.
10. NFL is available through existing generic Sportfolio/MCP surfaces without a separate NFL MCP/service.
11. Required tests/checks pass and MLB/NHL/NASCAR regressions are avoided.
