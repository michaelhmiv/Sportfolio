---
id: getting-started-mcp-access
title: MCP Compatibility Endpoint
summary: How to connect to Sportfolio's authenticated MCP endpoint, including auth, session lifecycle, tools, and transaction safety.
audience: public
category: getting-started
status: published
owner: product-engineering
lastReviewedAt: 2026-08-06
changeTriggers: server/routes/mcp.ts,server/mcp/public-tool-registry.ts,server/api-token-auth.ts,scripts/mcp-smoke.ts
slug: mcp-access
surface: web,cli
searchKeywords: mcp,model context protocol,streamable http,bearer token,api token,external access,endpoint,session
---

# MCP Compatibility Endpoint

Use the authenticated Streamable HTTP endpoint at `/mcp` when a host client requires Model Context Protocol.

| Field             | Value                               |
| ----------------- | ----------------------------------- |
| Production        | `https://www.sportfolio.market/mcp` |
| Local development | `http://127.0.0.1:5000/mcp`         |
| Auth              | `Authorization: Bearer <api-token>` |

## Session lifecycle

1. Send JSON-RPC `initialize` without `mcp-session-id`.
2. Capture the `mcp-session-id` response header.
3. Include that session ID and bearer token on subsequent requests.
4. Send `Content-Type: application/json` and `Accept: application/json, text/event-stream`.

## Capability surface

The endpoint exposes native portfolio, market, scouting, boost, watchlist, collection, documentation, account, and liquidity tools plus a static 12-tool MLB catalog. The MLB tools remain listed during provider outages and return structured retryable errors when live data cannot be loaded.

Staged gameplay tools return a transaction ID. Use `confirm_gameplay_transaction` or `cancel_gameplay_transaction` to finalize the decision.

Billing, funding, checkout, purchases, and administrator-only operations are excluded.

## Resources

- `sportfolio://capabilities`
- `sportfolio://action-surface`
- `sportfolio://tool-catalog`

The catalog resource is exhaustive for the deployed version and does not depend on downstream provider health.
