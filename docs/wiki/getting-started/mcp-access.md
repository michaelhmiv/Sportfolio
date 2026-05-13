---
id: getting-started-mcp-access
title: MCP Access
summary: How to connect to Sportfolio's public authenticated MCP endpoint, including auth, session lifecycle, and capability boundaries.
audience: public
category: getting-started
status: published
owner: product-engineering
lastReviewedAt: 2026-05-12
changeTriggers: server/routes/mcp.ts,server/mcp/public-tool-registry.ts,server/api-token-auth.ts,scripts/mcp-smoke.ts
slug: mcp-access
surface: web,cli,agent
searchKeywords: mcp,model context protocol,streamable http,bearer token,api token,external access,endpoint,hermes,session
---

# MCP Access

Sportfolio exposes a public authenticated [Model Context Protocol](https://modelcontextprotocol.io) endpoint at `/mcp`.

This is the protocol-facing surface for MCP-compatible clients. It is separate from CLI UX and separate from Hermes internal routing.

---

## Endpoint and Auth

| Field      | Value                               |
| ---------- | ----------------------------------- |
| Production | `https://www.sportfolio.market/mcp` |
| Local dev  | `http://127.0.0.1:5000/mcp`         |
| Transport  | Streamable HTTP                     |
| Auth       | `Authorization: Bearer <api-token>` |

Create tokens in **Profile -> CLI Access**.

---

## Required Session Lifecycle

Sportfolio MCP requires an initialize-first session flow.

1. `POST /mcp` with JSON-RPC `initialize` and bearer auth, **without** `mcp-session-id`.
2. Capture the `mcp-session-id` response header.
3. Send that `mcp-session-id` on all subsequent `POST /mcp` calls (`tools/list`, `tools/call`, `resources/list`, `resources/read`, etc.).
4. Keep bearer auth on every request.

### Error behavior to expect

- Non-initialize `POST /mcp` without a valid session id returns `400`.
- Unknown or cross-user session id returns `404`.
- `GET /mcp` and `DELETE /mcp` without `mcp-session-id` return method/session errors.

---

## Request Header Expectations

For broad MCP client compatibility, send:

- `Authorization: Bearer <token>`
- `Content-Type: application/json` on JSON-RPC POSTs
- `Accept: application/json, text/event-stream`

The server supports Streamable HTTP semantics, so clients should tolerate both JSON and SSE-style responses where applicable.

---

## Public Capability Surface

MCP shares the same public registry as CLI.

### Included

- Reads across account, portfolio, holdings, pools, boosts, scouts, watchlists, schedules, docs, and threads
- Immediate account actions (profile updates, token management, watchlist CRUD, schedule CRUD, premium redeem)
- Staged gameplay actions (trades, LP flows, stack shares, daily boosts, scouts, community boosts)
- Confirm and cancel for pending bundles
- Public prompts and resources
- Dynamic MLB enrichment tools when available, named with `mlb_mcp__*`

Some compatibility-era tools (for example SMS settings/linking) may still be callable in the public surface, but they are legacy and not part of the primary Hermes contract.

### Excluded

- Billing, funding, checkout, and purchase flows
- Admin and internal-only routes

For exhaustive live inventory, read `sportfolio://tool-catalog` through MCP.

---

## How MCP Fits Into Hermes

Hermes has three MCP roles:

1. Public `/mcp` (external authenticated protocol surface)
2. Built-in MLB bridge (internal bounded enrichment)
3. User-connected external MCP sources (optional enrichment)

Native Sportfolio tools remain canonical for account and gameplay state.

---

## Safety Model

- Manual chat and CLI mutations stage first and require explicit confirm
- Saved live strategies may auto-execute only the allowlisted gameplay subset in guardrails
- Strategy auto-run exclusions include payments, checkout, purchases, and community boost creation

---

## Discovery Resources

| Resource                      | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `sportfolio://capabilities`   | Capability inventory + dynamic-source availability |
| `sportfolio://action-surface` | Curated action metadata and confirmation hints     |
| `sportfolio://tool-catalog`   | Exhaustive live tool metadata (static + dynamic)   |

---

## Next Steps

- [MCP Tool Reference](/wiki/agent/mcp-tool-reference) - curated protocol behavior and high-signal usage notes
- [CLI and External Access](/wiki/cli/overview) - direct terminal path
- [CLI Command Reference](/wiki/cli/command-reference) - command syntax authority
- [User Action Surface](/wiki/features/user-action-surface) - capability map across surfaces
