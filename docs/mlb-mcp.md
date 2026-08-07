# MLB MCP Provider

Sportfolio exposes a stable semantic MLB tool catalog through its authenticated MCP endpoint while using a separate MLB MCP service as an internal data provider.

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

Provider discovery validates internal compatibility only. It never adds or removes public tools.

## Configuration

```dotenv
MLB_MCP_ENABLED=true
MLB_MCP_URL=http://mlb-mcp.railway.internal:8080/mcp
MLB_MCP_TIMEOUT_MS=12000
MLB_MCP_HEALTH_CACHE_MS=60000
MLB_MCP_AUTH_BEARER=
```

Local development can use `http://127.0.0.1:8081/mcp`.

## Failure behavior

The tools remain discoverable when the provider is unavailable. Calls return a structured, retryable provider error instead of a missing-tool response. The provider adapter applies bounded timeouts, a response-size limit, one transient retry, health caching, circuit breaking, and credential redaction.

## Validation

Run:

```bash
npm run mcp:smoke
npm run public-tools:audit
npm run retired-surfaces:audit
```
