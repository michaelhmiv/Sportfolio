---
id: feature-user-action-surface
title: User Action Surface
summary: A practical map of what users can currently do across web, CLI, and SMS, including which flows are read-only versus confirmation-gated.
audience: public
category: features
status: published
owner: product-engineering
lastReviewedAt: 2026-03-08
changeTriggers: client/src/App.tsx,client/src/components/app-sidebar.tsx,server/routes.ts,server/routes/amm.ts,server/routes/lp.ts,server/routes/cli.ts,server/routes/mcp.ts,server/routes/sms.ts,server/mcp/public-tool-registry.ts
slug: user-action-surface
surface: web,cli,agent
searchKeywords: capabilities,actions,feature map,web,cli,sms,agent
---

# Why this exists

Users and agents both need one clear source of truth for what actions are actually available right now.

This page lists current user-facing capabilities by surface and clarifies what is read-only, immediately executable, or confirmation-gated.

# Web App Actions

## Market and Liquidity

- browse player pools and prices (`/pools`)
- preview AMM quotes
- execute buy/sell trades
- add/remove LP liquidity and inspect LP history

## Portfolio and Inventory

- view holdings, net worth, and activity
- manage watchlists (create/update/delete lists, add/remove players)
- view and manage scouts
- stack eligible shares into multiplier inventory

## Boost and Slate Flows

- view daily boost eligibility
- assign/remove daily boost slots
- view community boost eligibility and create community boosts (when eligible inventory exists)

## Account and Access

- update profile username and profile image
- generate/revoke CLI API tokens
- start and manage SMS account linking

# CLI Actions

The CLI uses the same backend rules as web. It does not bypass confirmation requirements.

## Reads

- docs browse/search/open
- account summary and holdings snapshot
- agent thread listing and conversational reads

## Confirmation-Gated Actions

- buy/sell staging
- watchlist add/remove staging
- vesting claim staging
- community boost staging

All mutation-like CLI actions stage a plan first. You confirm or cancel explicitly.

For exact syntax, read [CLI Command Reference](/wiki/cli/command-reference).

# MCP Actions

The public MCP server also uses user-scoped API tokens, but it is designed for MCP-aware clients rather than direct shell commands.

## Included in MCP v1

- gameplay and account reads across portfolio, players, pools, boosts, scouts, watchlists, schedules, docs, news, and thread state
- public docs resources and prompts
- confirmation-gated staging for market trades, LP flows, stack shares, daily boosts, community boosts, watchlists, scout assignments, schedules, and pending action confirm/cancel

## Excluded from MCP v1

- billing, funding, checkout, and premium purchase/redeem flows
- bootstrap and token-management flows
- SMS linking and SMS settings
- profile identity edits
- agent settings and BYOK configuration
- admin and internal-only routes

For connection details, read [MCP Access](/wiki/getting-started/mcp-access).

# SMS Actions

- unlinked numbers: general concierge chat and product guidance
- linked numbers: account-aware reads and supported confirmation-gated in-game actions
- billing, premium purchase, and checkout flows remain web-only

# Confirmation Model (All Surfaces)

- Reads and explanations: immediate
- Potential state changes: staged first, explicit confirm required
- Cancel is always available for staged bundles before execution

# Known Practical Constraints

- Agent requests can be temporarily busy when another analysis is already running for the same account; retry shortly.
- Community boost staging resolves best with full player names.
- Some advanced market operations remain easiest in web UI due richer context panels.

# Related Docs

- [Platform Tour](/wiki/getting-started/platform-tour)
- [Sportfolio Agent](/wiki/features/agent-operator)
- [Sportfolio CLI](/wiki/cli/overview)
- [SMS Agent](/wiki/features/sms-agent)
