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
searchKeywords: glossary,terms,definitions,amm,singles,boosts,scouts,lp
---

# Glossary

## Money and Assets

**SB (Sportfolio Bucks) / Balance**
Your liquid virtual game currency. All cash balances, market prices, portfolio values, liquidity values, fees, and payouts are denominated in SB.

**Single**
The current player ownership asset. Singles are tradeable player shares and are the shares used directly by Daily Boosts.

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

## Boost Terms

**Daily Boost**
A one-game action that commits Singles directly to a boost slot. The committed Singles are permanently burned once a valid game begins, while settlement adds the incremental bonus above ordinary 1x base earnings.

**Boost Slot Tier**
Current slot tiers: 2x, 3x, 5x, 7x, and 10x.

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

Sportfolio is a sports player-share game where you accumulate and trade Singles, deploy direct-share Daily Boosts around slates, and manage the loop through live portfolio and market surfaces.
