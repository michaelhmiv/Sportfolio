---
id: faq-glossary
title: Glossary
summary: Plain-language definitions for Sportfolio gameplay and economy terms.
audience: public
category: faq
status: published
owner: product-engineering
lastReviewedAt: 2026-05-31
changeTriggers: shared/schema.ts,server/routes.ts,server/amm/pool.ts,server/websocket.ts,client/src/pages
slug: glossary
surface: web,cli
searchKeywords: glossary,terms,definitions,amm,boosts,scouts,lp
---

# Glossary

## Money and Assets

**SB / Balance**
Your liquid virtual cash.

**Single (Raw Share)**
A tradeable player share with power 1.

**Premium Share**
A separate asset used to redeem premium access windows.

**Community Share**
An asset consumed when creating a community boost.

## Market Terms

**AMM (Automated Market Maker)**
Pool-based trading model for instant fills.

**Player Pool**
The AMM pool for one player.

**Constant-Product Formula**
`x * y = k` pricing model used by the pool.

**Slippage**
Difference between quoted spot and average fill.

**TVL (Total Value Locked)**
Total value currently in a pool.

**Daily Boost**
One-slot action that commits a direct quantity of Singles, burns them at game lock, and settles after the game.

**Boost Slot Tier**
Base slot tier values: 2x, 3x, 5x, 7x, and 10x.

**Effective Multiplier**
`slotTier + communityBoostCount`.

**Community Boost**
Player/date boost that adds `+1` effective multiplier to matching daily boosts.

**Lock**
Temporary reservation state that prevents spending the same inventory twice.

## Scout Terms

**Scout**
Assignable unit that earns player shares over time.

**Scout-Minutes**
Time-weighted measure used for hourly share distribution.

## One-Line Summary

Sportfolio is a sports player-share game where you accumulate Singles, trade through AMM markets, deploy direct-share Daily Boosts around slates, and manage the loop through live portfolio and market surfaces.
