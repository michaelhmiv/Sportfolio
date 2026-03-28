# Sportfolio Vendor Note

- Upstream: `https://github.com/etweisberg/mlb-mcp`
- Snapshot commit: `7c55ebdeb4c2165c96c15750c01c8b3787afb66a`
- Purpose: keep the MLB StatsAPI MCP server under Sportfolio control for local development and stable internal integration work.

Keep product code behind Sportfolio-owned adapters. Do not couple app/UI contracts directly to raw upstream MCP payloads.
