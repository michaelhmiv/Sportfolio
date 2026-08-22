---
id: gameplay-player-pools
title: Player Pools
summary: A detailed guide to AMM trading, pricing, liquidity, and the signals that matter in Sportfolio player markets.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-08-21
changeTriggers: server/routes/amm.ts,server/routes/lp.ts,server/amm/pool.ts,client/src/pages/marketplace.tsx,client/src/pages/player.tsx,shared/schema.ts
slug: player-pools
surface: web,cli
searchKeywords: amm,pools,buy,sell,liquidity,quotes,slippage,lp
---

# Player Pools

Player trading uses AMM (automated market maker) pools. If a player pool is initialized, you trade directly against pooled liquidity - there is no order book and no waiting for a matching bid.

If a player has no active pool yet, the first liquidity deposit bootstraps that market and sets its opening price.

> **Execution is instant once a pool is active.** The tradeoff is that your order moves the price. Larger orders = more price impact.

---

## How Pricing Works

Sportfolio uses a **constant-product model:**

```
x * y = k
```

- `x` = player-share reserve in the pool
- `y` = SB (Sportfolio Bucks) reserve in the pool
- implied spot price = `y / x`

**When you buy:**

- pool gives up shares, receives SB -> price rises

**When you sell:**

- pool receives shares, gives up SB -> price falls

This means price is path-dependent - the same player can quote differently based on your order size.

---

## Fees and Slippage

Every trade has a **2% total fee:**

| Fee         | Who benefits                     |
| ----------- | -------------------------------- |
| 1% pool fee | LP holders (liquidity providers) |
| 1% burn fee | Removed from supply              |

**Slippage** is the gap between the displayed spot price and your actual average execution price. Before you execute, the API gives you a quote with slippage bounds.

> Warning: Check your quote before confirming large trades. A thin pool can move significantly on a single order.

**Practical rules:**

- Size up slowly in thin pools
- Re-check quotes when news breaks
- Urgency has a cost in shallow markets

---

## What the Market Screens Show

On Player Pools and player detail pages, you'll see:

| Signal              | What it means                            |
| ------------------- | ---------------------------------------- |
| **Price**           | Current share price                      |
| **24h change**      | Recent percentage move                   |
| **Volume**          | Recent trading activity                  |
| **Market cap**      | Relative sizing metric                   |
| **TVL / pool size** | How deep the liquidity is                |
| **Buy pressure**    | Directional flow signal                  |
| **Value index**     | Composite relative-value metric          |
| **Fantasy metrics** | Context for why the market may be moving |

These are context signals, not guarantees.

---

## Buying Shares

Use buying when you want direct exposure to a player's future market value and downstream utility (scouts, boosts, LP).

Before buying, check:

- The current quote and expected slippage
- How much cash remains after the trade
- Whether you're over-concentrating in one player or sport
- Whether you might need that cash for a boost window later

**Buy flow:** uses SB amount (you specify how much to spend)  
**Sell flow:** uses share quantities

Buy and sell quantities support fractional shares down to `0.0001` shares. Quotes and execution
use the same four-decimal quantity, so a quote for less than one whole share is still a valid trade.

---

## Selling Shares

Before selling, check:

- Available shares after lock checks (locked shares can't be sold)
- Whether the shares are raw or stacked - only raw shares are tradeable
- Whether the player is relevant for an upcoming boost window
- Whether you're selling into a thin pool and eating avoidable slippage

> Warning: The highest-cost sale is often the one that quietly removes your best boost-ready inventory.

---

## Becoming a Liquidity Provider (LP)

Instead of only taking directional positions, you can add liquidity to a player pool and earn fees.

**LP basics:**

- You add both shares and SB to a pool
- You receive LP shares representing your pool ownership percentage
- Fee value accrues as trading activity generates pool fees

**LP flows available:**

- Standard add (explicit share + SB amounts)
- Optimal add (max constraints, system balances for you)
- Single-sided zap add (add from one side only)
- Remove liquidity

**LP vs. holding shares:**

- Holding = directional bet on one player
- LP = market-making exposure to both sides of a pool
- LP earns fees; holding earns from price appreciation

> Note: LP positions are visible in your Portfolio -> Liquidity tab.

For a full LP guide, see [Liquidity Providing](/wiki/gameplay/liquidity-providing).

---

## What Player Pools Are Not

Player pools are not:

- An order book with resting bids and asks
- A guaranteed low-slippage environment
- A direct reflection of fantasy performance

They are instant, transparent liquidity surfaces. Price reflects supply and demand in the pool - not always the same thing as athlete performance.

---

## Next Steps

- [Liquidity Providing](/wiki/gameplay/liquidity-providing) - LP mechanics in depth
- [Portfolio and Holdings](/wiki/gameplay/portfolio-and-holdings) - how your positions are tracked
- [Stacking and Boosts](/wiki/gameplay/stacking-shares-and-boosts) - what to do with the shares you accumulate
