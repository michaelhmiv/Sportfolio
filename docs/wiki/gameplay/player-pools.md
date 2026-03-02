---
id: gameplay-player-pools
title: Player Pools
summary: How AMM trading, pricing, and liquidity work in Sportfolio player markets.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-03-02
changeTriggers: server/routes/amm.ts,server/amm/pool.ts,shared/schema.ts
slug: player-pools
surface: web,cli,agent
searchKeywords: amm,pools,buy,sell,liquidity,quotes
---

# AMM-backed trading

Player pools use an automated market maker. You buy from or sell into the pool instantly instead of waiting on another user to take the other side.

# Prices move with flow

When users buy more of a player, the price moves up. When users sell into the pool, the price moves down. Quotes are path-dependent, so larger orders move price more than smaller orders.

# What matters before you buy

- current quote
- slippage on your order size
- your available cash after the trade
- how concentrated your portfolio becomes

# What matters before you sell

- available shares after lock checks
- whether you are giving up boost-ready or powered inventory
- whether the sale reduces or increases risk

# Liquidity provider context

Some users provide liquidity instead of only directional trading. LP positions are a different exposure than a normal buy because you are warehousing both sides of the pool and earning fees over time.

# Practical advice

Use smaller entries when price discovery is active. If you are reacting to news, check the quote, then decide whether you want immediate execution or to wait for the market to settle.
