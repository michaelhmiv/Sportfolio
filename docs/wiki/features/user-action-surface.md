---
id: feature-user-action-surface
title: User Action Surface
summary: A practical map of the primary user action surface across web, CLI, and public MCP, including which flows are immediate versus confirmation-gated.
audience: public
category: features
status: published
owner: product-engineering
lastReviewedAt: 2026-04-02
changeTriggers: client/src/App.tsx,client/src/components/app-sidebar.tsx,server/routes.ts,server/routes/amm.ts,server/routes/lp.ts,server/routes/cli.ts,server/routes/mcp.ts,server/mcp/public-tool-registry.ts
slug: user-action-surface
surface: web,cli,agent
searchKeywords: capabilities,actions,feature map,web,cli,mcp,agent
---

# Why this exists

Users and agents both need one clear source of truth for what actions are actually available right now.

This page lists current user-facing capabilities by surface and clarifies what is read-only, immediately executable, or confirmation-gated.

# Web App Actions

## Market and Liquidity

- browse player pools and prices (`/pools`)
- preview AMM quotes
- execute buy and sell trades
- add and remove LP liquidity and inspect LP history

## Portfolio and Inventory

- view holdings, net worth, and activity
- manage watchlists
- view and manage scouts
- stack eligible shares into multiplier inventory

## Boost and Slate Flows

- view daily boost eligibility
- assign and remove daily boost slots
- view community boost eligibility and create community boosts when eligible inventory exists

## Account and Access

- update profile username and profile image
- generate and revoke CLI API tokens
- manage agent profile settings

# CLI Actions

The CLI uses the same backend rules as web. It does not bypass confirmation requirements.

## Shared Surface

- docs browse, search, and open
- account, profile, token, and agent-setting reads and actions
- account summary and holdings snapshot
- agent thread listing and conversational reads
- full shared tool access through `tools list` and `tools call`
- prompt and resource access through `prompts ...` and `resources ...`

## Confirmation-Gated Actions

- buy and sell staging
- LP staging
- boost staging
- scout assignment staging
- community boost staging

Gameplay mutations that are confirmation-gated on the server remain confirmation-gated in CLI. Immediate account and settings actions stay immediate.

For exact syntax, read [CLI Command Reference](/wiki/cli/command-reference).

# MCP Actions

The public MCP server also uses user-scoped API tokens, but it is designed for MCP-aware clients rather than direct shell commands.

## Included in the Shared Public Surface

- gameplay and account reads across portfolio, players, pools, boosts, scouts, watchlists, schedules, docs, news, account profile, and agent settings
- public docs resources and prompts
- immediate account and settings actions like token management, username and profile-image updates, agent profile updates, watchlist CRUD, schedule CRUD, and premium redeem
- confirmation-gated staging for market trades, LP flows, stack shares, daily boosts, community boosts, scout assignments, and pending action confirm and cancel

Public `/mcp` is the external product capability server. It is separate from Hermes's internal built-in or user-connected MCP enrichment sources.

## Excluded from the Shared Public Surface

- billing, funding, checkout, and external purchase flows
- admin and internal-only routes

For connection details, read [MCP Access](/wiki/getting-started/mcp-access).

# Legacy SMS Note

Legacy SMS concierge and linking flows may still exist in the product, but they are not part of the active primary Hermes contract.

# Confirmation Model

- reads and explanations: immediate
- potential state changes: staged first, explicit confirm required
- cancel is always available for staged bundles before execution

# Known Practical Constraints

- agent requests can be temporarily busy when another analysis is already running for the same account
- community boost staging resolves best with full player names
- some advanced market operations remain easier in the web UI because of richer context panels

# Related Docs

- [Platform Tour](/wiki/getting-started/platform-tour)
- [Sportfolio Agent](/wiki/features/agent-operator)
- [Sportfolio CLI](/wiki/cli/overview)
- [MCP Access](/wiki/getting-started/mcp-access)
