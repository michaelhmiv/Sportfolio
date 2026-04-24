---
id: getting-started-mcp-access
title: MCP Access
summary: How to connect to Sportfolio's public authenticated MCP endpoint, how it relates to Hermes, and what stays inside or outside the public MCP surface.
audience: public
category: getting-started
status: published
owner: product-engineering
lastReviewedAt: 2026-04-02
changeTriggers: server/routes/mcp.ts,server/mcp/public-tool-registry.ts,server/api-token-auth.ts,scripts/mcp-smoke.ts
slug: mcp-access
surface: web,cli,agent
searchKeywords: mcp,model context protocol,streamable http,bearer token,api token,external access,endpoint,hermes
---

# MCP Access

Sportfolio exposes a public authenticated [Model Context Protocol](https://modelcontextprotocol.io) endpoint at `/mcp`.

This is the protocol-facing surface for MCP-compatible clients (like Claude Desktop, Cursor, or custom tool runners). It is separate from the CLI and separate from Hermes's internal routing.

---

## Endpoint and Auth

|                | Value                                |
| -------------- | ------------------------------------ |
| **Production** | `https://www.sportfolio.market/mcp`  |
| **Local dev**  | `http://127.0.0.1:5000/mcp`          |
| **Transport**  | Streamable HTTP (`POST /mcp`)        |
| **Auth**       | Bearer token (same API token as CLI) |

```
Authorization: Bearer <your-token>
```

Create your token at **Profile → CLI Access**.

---

## What MCP Includes

The public MCP surface gives you access to the same shared capability catalog as the CLI, plus a read-only MLB extension when that service is available.

**Included:**

- Account, portfolio, holdings, pools, boosts, scouts, watchlists, schedules, news, and docs reads
- Public resources: `sportfolio://docs/index`, `sportfolio://capabilities`, `sportfolio://action-surface`, `sportfolio://tool-catalog`
- Starter prompts: `review_setup`, `review_idle_cash`, `find_boost_candidates`, `stage_trade`
- Immediate account actions: profile updates, token management, watchlist CRUD, schedule CRUD, premium redeem
- Staged gameplay actions: trades, LP flows, stack shares, daily boosts, community boosts, scout assignments — all confirmation-gated
- Read-only `mlb_mcp__*` tools when the internal MLB service is reachable

**Not included:**

- Billing, funding, checkout, and purchase flows
- Admin and internal-only routes

---

## How MCP Fits Into Hermes

Sportfolio uses three distinct MCP roles internally:

1. **Public `/mcp`** — the external authenticated surface you're reading about here
2. **Built-in MLB bridge** — bounded enrichment Hermes can use internally
3. **User-connected external MCP** — optional per-user sources Hermes can pull from

> ℹ️ Native Sportfolio tools are always the canonical source for account and gameplay state. MCP sources are enrichment, not a second source of truth.

---

## Safety Model

MCP does not make the agent autonomous:

- Reads are immediate
- State-changing actions are staged first — execution requires an explicit confirm step
- Confirm and cancel operate on pending action bundles

---

## Discovery Resources

Three resources provide live capability metadata for MCP clients:

| Resource                      | What it returns                                        |
| ----------------------------- | ------------------------------------------------------ |
| `sportfolio://capabilities`   | Capability inventory + dynamic provider availability   |
| `sportfolio://action-surface` | Summary of tools with confirmation and read-only hints |
| `sportfolio://tool-catalog`   | Full tool metadata, example prompts, and MLB tool list |

---

## When to Use MCP vs CLI

| Use MCP when...                                  | Use CLI when...                                        |
| ------------------------------------------------ | ------------------------------------------------------ |
| Connecting to an MCP-aware client or tool runner | You want direct shell access without a protocol client |
| Building external integrations                   | You want the simplest terminal workflow                |

---

## Next Steps

- [CLI and External Access](/wiki/cli/overview) — direct shell access via API token
- [CLI Command Reference](/wiki/cli/command-reference) — full command syntax
- [User Action Surface](/wiki/features/user-action-surface) — complete capability map across web, CLI, and MCP
