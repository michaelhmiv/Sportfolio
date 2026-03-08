---
id: getting-started-mcp-access
title: MCP Access
summary: How to connect to Sportfolio's public authenticated MCP endpoint, what it exposes today, and what stays out of scope for MCP v1.
audience: public
category: getting-started
status: published
owner: product-engineering
lastReviewedAt: 2026-03-08
changeTriggers: server/routes/mcp.ts,server/mcp/public-tool-registry.ts,server/mcp/gameplay-capability-matrix.ts,server/api-token-auth.ts,scripts/mcp-smoke.ts
slug: mcp-access
surface: web,cli,agent
searchKeywords: mcp,model context protocol,streamable http,bearer token,api token,external access,endpoint
---

# MCP access

Sportfolio exposes a public authenticated Model Context Protocol endpoint at `/mcp`.

This is the protocol-facing external surface for MCP-compatible clients. It is separate from the internal Hermes sidecar routes.

## Endpoint and transport

- production endpoint: `https://www.sportfolio.market/mcp`
- local development endpoint: `http://127.0.0.1:5000/mcp`
- transport: Streamable HTTP
- normal MCP traffic goes through `POST /mcp`

## Authentication

MCP uses the same user-scoped API tokens used by the Sportfolio CLI.

Send your token as:

```text
Authorization: Bearer <your-token>
```

That keeps MCP inside the same account boundary as the web app and CLI. It is not an admin or shared back door.

## What MCP v1 includes

The current public MCP surface is gameplay-focused.

Included today:

- reads across portfolio, holdings, players, pools, boosts, scouts, watchlists, schedules, docs, news, and thread state
- public docs resources including `sportfolio://docs/index`, `sportfolio://capabilities`, and `sportfolio://action-surface`
- public prompts including `review_setup`, `review_idle_cash`, `find_boost_candidates`, and `stage_trade`
- confirmation-gated gameplay staging for market trades, LP actions, stack shares, daily boosts, community boosts, watchlists, scout assignments, schedules, and thread confirm/cancel flows

## Safety model

MCP does not make the agent autonomous.

- reads are immediate
- staged actions still require explicit confirmation
- confirm and cancel operate on pending action bundles instead of bypassing server validation

## What MCP v1 excludes

The public MCP server is not full site parity.

Excluded today:

- billing, funding, checkout, premium purchase, and premium redeem flows
- account bootstrap and token-management flows
- SMS linking and SMS settings
- profile identity edits such as username and profile image
- agent profile and BYOK settings
- admin and internal-only routes

## When to use MCP vs CLI

- use MCP if you are wiring Sportfolio into an MCP-aware client or tool runner
- use the CLI if you want the simplest terminal workflow without MCP client setup

For direct shell usage, read [CLI and External Access](/wiki/cli/overview) and [CLI Command Reference](/wiki/cli/command-reference).
