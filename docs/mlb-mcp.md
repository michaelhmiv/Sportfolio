# MLB data provider

Sportfolio exposes a stable semantic MLB tool catalog through its authenticated MCP endpoint. MLB data now runs in-process inside the Sportfolio service; there is no separate MLB MCP service and no MLB-provider Railway service to configure.

## Public tools

The public catalog is static and contains these tools:

- `search_mlb_players`
- `get_mlb_batting_leaders`
- `get_mlb_pitching_leaders`
- `get_mlb_player_stats`
- `get_mlb_player_splits`
- `get_mlb_team_leaders`
- `get_mlb_games`
- `get_mlb_game_details`
- `get_mlb_probable_pitchers`
- `get_mlb_standings`
- `get_mlb_roster`
- `get_mlb_statcast_profile`

The catalog is intentionally stable. Internal provider implementation changes do not add or remove public tools.

## Data sources

Core MLB roster, schedule, game, standings, and statistics data comes directly from MLB StatsAPI. Expected-stat profiles used by `get_mlb_statcast_profile` come directly from Baseball Savant's CSV leaderboard endpoint.

Both sources are called from the Sportfolio application process. No `MLB_MCP_*` environment variables, internal Railway hostname, bearer token, or sidecar service is required.

## Failure behavior

The native adapter applies bounded timeouts, a response-size limit, one transient retry, and circuit breaking. Public tool names remain stable during upstream outages and calls return structured provider errors rather than disappearing from discovery.

## Validation

Run:

```bash
npm run mcp:smoke
npm run public-tools:audit
npm run retired-runtime:audit
```
