# MLB MCP

Sportfolio now keeps the MLB StatsAPI MCP server as a separate internal service boundary from Ball Don't Lie.

## Provider boundary

- Ball Don't Lie remains the canonical lane for Sportfolio's existing ingest/sync paths.
- The vendored MLB MCP provides game details (probable pitchers, lineups, Statcast, and other MLB-specific reads) as an optional display-only layer.
- App code should depend on Sportfolio-owned adapters and normalized payloads, not raw upstream MCP response shapes.

## Vendored source

- Location: `vendor/mlb-mcp`
- Upstream repo: `https://github.com/etweisberg/mlb-mcp`
- Snapshot commit: `7c55ebdeb4c2165c96c15750c01c8b3787afb66a`

## Local run

This repo does not require `uv` to run the vendored service locally.

1. Create a virtualenv:

   ```powershell
   python -m venv vendor\mlb-mcp\.venv
   ```

2. Install the vendored package:

   ```powershell
   vendor\mlb-mcp\.venv\Scripts\python -m pip install -e vendor\mlb-mcp
   ```

3. Start the local HTTP MCP server:

   ```powershell
   $env:PORT = "8081"
   vendor\mlb-mcp\.venv\Scripts\python -m mlb_stats_mcp.server --http
   ```

4. Start the main app. In development, Sportfolio now auto-detects the vendored MLB MCP on `http://127.0.0.1:8081/mcp` if no explicit MLB MCP env is set.

5. Only set env manually when you want to override or disable the default:

   ```powershell
   $env:HERMES_INTERNAL_MLB_MCP_URL = "http://127.0.0.1:8081/mcp"
   ```

   To disable MLB game details in dev on purpose:

   ```powershell
   $env:HERMES_INTERNAL_MLB_MCP_ENABLED = "false"
   ```

## Probe commands

Local MCP probe:

```powershell
npm run mlb-mcp:probe -- --url http://127.0.0.1:8081/mcp --date 2026-03-27 --team-id 147
```

Railway production smoke against the deployed `mlb-mcp` service:

```powershell
npm run mlb-mcp:probe:railway
```

The local probe intentionally checks the generic `get_stats` tool against:

- `schedule` with `hydrate=probablePitcher(note)`
- `game` with the resolved `gamePk`

It summarizes:

- probable pitchers returned from the schedule payload
- whether the `liveData.boxscore.teams.away/home.batters` paths are present
- mapped lineup names when batters are posted

## Validation rule

Do not treat local vendored success as sufficient. Any MLB MCP feature that is meant to ship against the Railway internal service should be validated against Railway before completion.

Current Railway validation path:

- Use `npm run mlb-mcp:probe:railway` to verify the deployed service still exposes and serves the core MCP tool surface (`get_schedule`, `get_stats`, and endpoint discovery).
- Use the local vendored Yankees probe to verify the exact `schedule` and `game` payload paths you plan to normalize into Sportfolio.
