---
id: getting-started-mcp-access
title: MCP Access
summary: How to connect to Sportfolio's public authenticated MCP endpoint, what the public capability surface includes, and what stays out of scope.
audience: public
category: getting-started
status: published
owner: product-engineering
lastReviewedAt: 2026-03-12
changeTriggers: server/routes/mcp.ts,server/mcp/public-tool-registry.ts,server/api-token-auth.ts,scripts/mcp-smoke.ts
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

## What the public surface includes

The public MCP surface includes the shared authenticated Sportfolio capability catalog plus a read-only MLB extension when the internal MLB data service is available.

Included today:

- reads across account, portfolio, holdings, players, pools, boosts, scouts, watchlists, schedules, docs, news, agent settings, SMS settings, and thread state
- read-only `mlb_mcp__*` tools that proxy the internal MLB MCP service through Sportfolio authentication when that service is enabled and reachable
- public docs/resources including `sportfolio://docs/index`, `sportfolio://capabilities`, `sportfolio://action-surface`, and `sportfolio://tool-catalog`
- public prompts including `review_setup`, `review_idle_cash`, `find_boost_candidates`, and `stage_trade`
- immediate account actions including token management, username/profile-image updates, SMS link/settings actions, agent profile/BYOK updates, and premium redeem
- confirmation-gated gameplay staging for market trades, LP actions, stack shares, daily boosts, community boosts, scout assignments, and thread confirm/cancel flows

The discovery resources are live rather than purely static:

- `sportfolio://capabilities` includes the shared capability inventory plus dynamic-provider availability metadata
- `sportfolio://action-surface` summarizes the tool/action surface with confirmation/read-only hints
- `sportfolio://tool-catalog` provides the richest tool metadata for agents, including live dynamic MLB tools, example prompts, and input-field summaries when available

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
