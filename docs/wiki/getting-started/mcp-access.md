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

# MCP access

Sportfolio exposes a public authenticated Model Context Protocol endpoint at `/mcp`.

This is the protocol-facing external surface for MCP-compatible clients. It is separate from:

- Hermes runtime transport and sidecar routes
- the built-in MLB enrichment source Hermes can consume internally
- any user-connected external MCP sources that a user may attach inside Hermes

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

## How MCP fits into Hermes

Sportfolio uses three different MCP roles:

1. Public `/mcp`
   The external authenticated protocol surface for MCP-aware clients.
2. Built-in internal MCP
   The MLB bridge Hermes can use for bounded enrichment.
3. User-connected external MCP
   Optional per-user sources Hermes can call for outside context.

Hermes does not treat all three roles the same way. Native Sportfolio tools stay canonical for portfolio and gameplay state. MCP sources are enrichment, not a second source of truth.

## What the public surface includes

The public MCP surface includes the shared authenticated Sportfolio capability catalog plus a read-only MLB extension when the internal MLB data service is available.

Core included areas today:

- reads across account, portfolio, holdings, players, pools, boosts, scouts, watchlists, schedules, docs, news, and thread state
- read-only `mlb_mcp__*` tools that proxy the internal MLB MCP service through Sportfolio authentication when that service is enabled and reachable
- public docs and resources including `sportfolio://docs/index`, `sportfolio://capabilities`, `sportfolio://action-surface`, and `sportfolio://tool-catalog`
- public prompts including `review_setup`, `review_idle_cash`, `find_boost_candidates`, and `stage_trade`
- selected account and profile actions such as token management, profile updates, agent profile updates, watchlist CRUD, schedule CRUD, and premium redeem
- confirmation-gated gameplay staging for market trades, LP actions, stack shares, daily boosts, community boosts, scout assignments, and thread confirm and cancel flows

The discovery resources are live rather than purely static:

- `sportfolio://capabilities` includes the shared capability inventory plus dynamic-provider availability metadata
- `sportfolio://action-surface` summarizes the tool and action surface with confirmation and read-only hints
- `sportfolio://tool-catalog` provides the richest tool metadata for agents, including live dynamic MLB tools, example prompts, and input-field summaries when available

The public `/mcp` surface is a product capability server. It is not Hermes session-browsing server mode.

## Safety model

MCP does not make the agent autonomous.

- reads are immediate
- staged actions still require explicit confirmation
- confirm and cancel operate on pending action bundles instead of bypassing server validation

## What stays excluded

The public MCP server is not full site parity.

Excluded today:

- billing, funding, checkout, and external purchase flows
- admin and internal-only routes

## When to use MCP vs CLI

- use MCP if you are wiring Sportfolio into an MCP-aware client or tool runner
- use the CLI if you want the simplest terminal workflow without MCP client setup

For direct shell usage, read [CLI and External Access](/wiki/cli/overview) and [CLI Command Reference](/wiki/cli/command-reference).
