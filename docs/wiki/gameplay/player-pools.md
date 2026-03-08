---
id: gameplay-player-pools
title: Player Pools
summary: A detailed guide to AMM trading, pricing, liquidity, and the signals that matter in Sportfolio player markets.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: server/routes/amm.ts,server/routes/lp.ts,server/amm/pool.ts,client/src/pages/marketplace.tsx,client/src/pages/player.tsx,shared/schema.ts
slug: player-pools
surface: web,cli,agent
searchKeywords: amm,pools,buy,sell,liquidity,quotes,slippage,lp
---

# What a player pool is

Every tradeable player sits in an automated market maker (AMM) pool. You do not wait for another user to place the opposite order. You trade directly against pooled liquidity.

That has three important consequences:

- execution is immediate
- price moves as your order moves the pool
- liquidity depth matters as much as the displayed spot price

## The pricing model

Sportfolio's AMM uses a constant-product model:

`x * y = k`

- `x` is player-share reserve in the pool
- `y` is Sportfolio Bucks in the pool
- the implied spot price is `y / x`

When users buy shares:

- the pool gives up shares
- the pool receives more SB
- the share price rises

When users sell shares:

- the pool receives shares
- the pool gives up SB
- the share price falls

Larger orders move the price more than smaller orders. That is why quotes are path-dependent and why size discipline matters.

## Fees and slippage

Current AMM trading logic applies a 2% total trade fee:

- `1%` pool fee that benefits LP economics
- `1%` burn fee

Before execution, the API can quote the trade and enforce slippage bounds. In practice, you should think about:

- how much your order will move the pool
- whether the quoted average execution price is still acceptable
- whether urgency is worth the extra price impact

Sell flows use whole-share quantities. Buy flows use SB amount.

## What the market screens show you

The Player Pools and player-detail surfaces expose more than just price. Common market signals include:

- **price**: current share price
- **24h change**: recent percentage move
- **volume**: recent trading activity
- **market cap**: aggregate notional value signal
- **TVL / pool size**: depth of liquidity
- **buy pressure / sentiment**: directional flow signal
- **value index**: a composite relative-value signal
- **fantasy output metrics**: context for why the market may care

These are not guarantees. They are context clues for whether a move looks crowded, quiet, expensive, or potentially underpriced.

## Buying shares

Use buying when you want direct exposure to a player's future market value and downstream utility.

A buy decision should usually check:

- current quote and expected slippage
- how much cash remains after the trade
- whether you are over-concentrating in one player, team, or sport
- whether you may want to keep cash for boosts, liquidity adds, or a later dip

Buying is the simplest way to gain inventory for future trades, boosts, or stack shares paths.

## Selling shares

Selling realizes liquidity and reduces exposure, but the real cost is not always obvious.

Before you sell, check:

- available shares after lock checks
- whether the shares are raw or powered
- whether the player is relevant for an imminent boost window
- whether you are selling into a weak pool and paying avoidable slippage

The highest-cost sale is often the one that quietly removes your best boost-ready inventory.

## Liquidity provider exposure

You can also become a liquidity provider instead of only a directional trader.

LP flows include:

- adding liquidity
- optimal add flows
- single-sided zap adds
- removing liquidity

An LP position is different from owning normal shares:

- you are exposed to both sides of the pool
- your ownership is represented as LP shares
- fee value accrues through pool fee growth and position snapshots

LP is for users who want to warehouse liquidity and collect fee exposure, not only speculate on one-way price movement.

## Practical risk checks

Healthy habits in player pools:

- size up slowly in thin pools
- re-check quotes when news breaks
- separate "I like this player" from "this trade still prices well"
- decide whether the position is for holding, boosting, LP, or a short-term reaction
- remember that immediate execution is convenient, but convenience has a cost when the pool is shallow

## What player pools are not

Player pools are not:

- an order book with resting bids and asks
- a guaranteed low-slippage environment
- a promise that fantasy performance and market price always move together

They are instant, transparent liquidity surfaces. Use them accordingly.
