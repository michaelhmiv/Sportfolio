# API Integration Guide

This document describes the external APIs used by Sportfolio for sports data.

## Overview

| API          | Sport  | Data Provided           | Auth Required |
| ------------ | ------ | ----------------------- | ------------- |
| MLB StatsAPI | MLB    | Roster, Schedule, Stats | No            |
| NASCAR API   | NASCAR | Roster, Schedule, Stats | Internal      |

> **Migration Note (July 2026):** NBA and NFL data ingestion is disabled during the
> MLB/NASCAR-only migration. The Ball Don't Lie API (previously used for MLB, NBA, and NFL)
> is no longer consumed for MLB data. NBA and NFL integrations remain in the codebase
> but are disabled at the scheduler level (`enabled: false` in `scheduler.ts`).

---

## MLB StatsAPI (Public, No Auth)

**Base URL:** `https://statsapi.mlb.com/api/v1`
**Auth:** None (publicly accessible)
**Rate Limit:** No documented limit; a courtesy 200ms inter-request delay is applied.

### Why MLB StatsAPI?

The official MLB StatsAPI replaces the Ball Don't Lie MLB API because:

- No API key required (public endpoint)
- Official, authoritative data source
- Richer boxscore data per player (batting + pitching stats per game)
- Canonical MLBAM IDs map directly to Sportfolio's `mlb_<MLBAM_ID>` identity

### Endpoints Used

| Endpoint                                 | Purpose                 | Used By                |
| ---------------------------------------- | ----------------------- | ---------------------- |
| `/api/v1/sports/1/players?season={year}` | Fetch all MLB players   | `sync-mlb-roster.ts`   |
| `/api/v1/teams/{teamId}/roster`          | Team-level roster       | `sync-mlb-roster.ts`   |
| `/api/v1/schedule`                       | Fetch game schedules    | `sync-mlb-schedule.ts` |
| `/api/v1/game/{gamePk}/boxscore`         | Fetch player game stats | `sync-mlb-stats.ts`    |
| `/api/v1/game/{gamePk}/linescore`        | Current game state      | `sync-mlb-stats.ts`    |

### Client

Implemented in `server/mlb-statsapi.ts`:

- `fetchAllPlayers(season)` — All MLB players for a season
- `fetchTeams(season)` — All MLB teams
- `fetchTeamRoster(teamId, season)` — Roster for a specific team
- `fetchSchedule(options)` — Game schedule with date/team filters
- `fetchGamesByDate(date)` — Games for a specific date
- `fetchGamesByDateRange(start, end)` — Games across a date range
- `fetchBoxscore(gamePk)` — Boxscore with per-player stats
- `fetchLinescore(gamePk)` — Current game state
- `fetchPlayer(playerId)` — Single player profile
- `calculateFantasyPoints(stats)` — Fantasy scoring from boxscore stats
- `normalizeGameStatus(game)` — Normalize status to scheduled/inprogress/completed/postponed
- `normalizePosition(abbreviation)` — Normalize MLB position to fantasy positions

### Identity

MLB players use MLBAM IDs (e.g., 660271 for Shohei Ohtani). The canonical Sportfolio
player ID format is `mlb_<MLBAM_ID>` (e.g., `mlb_660271`). This intentionally
replaces the previous Ball Don't Lie-derived MLB IDs during the clean sports data reset.

### Implementation Details

- No API key required — the MLB StatsAPI is a public endpoint
- A 200ms inter-request courtesy delay is applied to avoid hammering the API
- The `/api/v1/game/{gamePk}/boxscore` endpoint returns complete per-player batting,
  pitching, and fielding stats in a single call (no separate `/stats` endpoint needed)
- Player position is resolved from team roster data (preferred) or primaryPosition field

---

## NASCAR API

Internal API used for NASCAR data. See `server/nascar-api.ts` for implementation.

### Endpoints Used

| Endpoint | Purpose             | Used By                   |
| -------- | ------------------- | ------------------------- |
| Rosters  | Fetch drivers       | `sync-nascar-roster.ts`   |
| Schedule | Fetch race schedule | `sync-nascar-schedule.ts` |
| Results  | Fetch race results  | `sync-nascar-stats.ts`    |
| Live     | Live race data      | `sync-nascar-live.ts`     |

---

## Environment Variables

```bash
# No longer required for MLB (using public StatsAPI)

# Still required for MySportsFeeds (NBA legacy, currently disabled)
MYSPORTSFEEDS_API_KEY=your_mysportsfeeds_key
```

---

## Troubleshooting

### MLB StatsAPI "players not found"

- The `/api/v1/sports/1/players` endpoint is seasonal — it returns players for the
  specified season year. Ensure the correct `season` parameter is used.
- Players may be missing from the public endpoint if their team's roster hasn't been
  published for the current season (pre-spring training).

### MLB StatsAPI rate limiting

- The MLB StatsAPI has no documented rate limit, but a 200ms inter-request delay
  is applied as a courtesy. If you encounter 429 responses, increase
  `MIN_REQUEST_INTERVAL_MS` in `server/mlb-statsapi.ts`.
