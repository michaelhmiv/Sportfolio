---
id: faq-glossary
title: Glossary
summary: A plain-language reference for Sportfolio's core terms, assets, metrics, and system vocabulary.
audience: public
category: faq
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: shared/schema.ts,server/routes.ts,server/amm/pool.ts,server/websocket.ts,client/src/pages
slug: glossary
surface: web,cli,agent
searchKeywords: glossary,terms,definitions,amm,boosts,scouts,lp
---

# Core money and asset terms

## SB / Balance

Your liquid virtual cash balance. This is what you spend on buys, boosts, LP adds, and other supported actions.

## Player Share

A tradeable unit of exposure to a specific player inside Sportfolio's economy.

## Premium Share

A separate asset type tied to premium-access flows. It is not the same as a player share.

## Community Share

An asset consumed when creating a community boost.

# Market terms

## AMM

Automated market maker. Sportfolio uses AMM pools so users trade against liquidity instead of waiting for another user to match an order.

## Player Pool

The AMM pool for one player, containing player-share reserve and SB reserve.

## Slippage

The difference between the displayed spot price and the average execution price caused by your order moving the pool.

## TVL

Total value locked. In practice, a shorthand for how much value sits in a pool and how deep its liquidity is.

## Market Cap

A market-size signal used in Sportfolio's analytics and listings. It is a relative sizing metric, not a promise of liquidity.

## Volume

Recent trading activity, usually used as a signal for how active a player's market has been.

## Buy Pressure / Sentiment

A directional flow signal derived from recent trading behavior.

## Value Index

A relative-value style metric used to compare players beyond raw price alone.

# Liquidity terms

## LP

Liquidity provider. A user who contributes assets to an AMM pool instead of only taking directional market exposure.

## LP Shares

The ownership units that represent your stake in a pool after adding liquidity.

## Zap

A convenience flow that helps add liquidity from one side instead of manually preparing both sides yourself.

# Scout terms

## Scout

An assignable unit that earns player shares over time.

## Scout-Minutes

The time-weighted basis used to determine your share of hourly scout distribution on a player.

## Shares Mined

The practical user-facing idea of shares earned through the scout system over time.

# Multiplier and boost terms

## Share Multiplier

The strength value carried by a single share.

## Multiplier

The effective-share value contributed by a stacked share or holding row.

## Stack Shares

The conversion flow that burns unlocked raw shares in exchange for a stronger stacked-share multiplier.

## Daily Boost

A one-share, slot-based mechanic that burns one eligible share at lock and settles a payout after the player's game completes.

## Boost Slot Tier

The base multiplier for a daily boost slot. Current tiers are `5x`, `4x`, `3x`, and `2x`.

## Community Boost

A player-and-day-specific boost created by spending a community share. Each one adds `+1` to the effective multiplier for matching daily boosts.

## Lock

A temporary state that marks cash or shares as reserved so they cannot be spent again in another flow.

# Competition terms

## Leaderboard

A public ranking surface that compares users across selected performance metrics.

# Data and operations terms

## Digest

A summarized news feed tailored for an authenticated user.

## Thread

A persisted conversation for the agent, used to keep continuity across messages.

## Confirm

The explicit user action that applies a staged agent plan.

## Cancel

The explicit user action that discards a staged agent plan without applying it.

## WebSocket Event

A real-time server push used to keep pages fresh without waiting for manual refresh.

# One-line mental model

If you want one summary sentence:

Sportfolio is a multi-sport player-share market where you accumulate inventory, refine it into multiplier strength, deploy it into slate-based mechanics, and manage the whole loop through live market, analytics, and agent surfaces.
