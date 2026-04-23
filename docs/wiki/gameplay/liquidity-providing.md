---
id: gameplay-liquidity-providing
title: Liquidity Providing
summary: How LP positions work in Sportfolio, including pool mechanics, fee accrual, zap adds, and when LP makes sense versus directional holding.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-04-23
changeTriggers: server/routes/lp.ts,server/amm/pool.ts,client/src/pages/player.tsx,client/src/pages/portfolio.tsx,shared/schema.ts
slug: liquidity-providing
surface: web,cli,agent
searchKeywords: lp,liquidity,pool,fees,zap,add liquidity,remove liquidity,lp shares,impermanent loss
---

# Liquidity Providing

Instead of only holding player shares directionally, you can add liquidity to a player's AMM pool. In return, you earn a portion of every trade that runs through that pool.

> 💡 **LP is market-making, not a directional bet.** You're not betting the player's price goes up — you're betting the player's pool stays active and generates trading fees.

---

## How LP Works

When you add liquidity to a player pool:
1. You contribute both **player shares** and **SB** to the pool
2. You receive **LP shares** representing your ownership percentage
3. Every trade through that pool generates a 1% pool fee
4. Your LP shares entitle you to a proportional cut of those fees

### The Fee Math

Every trade has a 2% total fee:
- **1% pool fee** — accrues to LP holders proportionally
- **1% burn fee** — permanently removed from supply

The more trading volume a pool generates, the more your LP position earns.

---

## Adding Liquidity

You have three ways to add liquidity to a player pool:

### Standard Add
Provide explicit amounts of both player shares and SB. You control both sides of the contribution.

### Optimal Add
Set a maximum for shares and/or SB. The system calculates the optimal ratio based on current pool state and uses up to your specified maximums.

### Single-Sided Zap
Add liquidity from just one side — either shares only or SB only. The system handles the rebalancing internally. Useful when you only have one asset readily available.

---

## Removing Liquidity

When you remove LP:
- Your LP shares are burned
- You receive back player shares and SB proportional to your pool ownership at that moment
- The exact amounts depend on the pool's current state (which may differ from when you added)

---

## LP vs. Holding Shares

| | Holding shares | LP position |
|---|---|---|
| Exposure type | Directional — benefits if price rises | Both sides — earns from trading volume |
| Revenue source | Price appreciation | Trading fees |
| Inventory type | Player shares (tradeable) | LP shares (non-tradeable) |
| Risk type | Price risk | Pool composition risk |
| Where tracked | Portfolio → Holdings | Portfolio → Liquidity |

---

## What Drives LP Returns

LP positions earn more when:
- **Trading volume is high** — more trades = more fees
- **Your ownership percentage is significant** — larger stake = larger fee cut
- **The pool stays active** — idle pools earn nothing

LP positions are less attractive when:
- **Volume dries up** — fees stop accumulating
- **You need the underlying shares** — LP locks your shares into the pool

---

## Pool Composition Risk

When the pool ratio shifts significantly (e.g., the player's price drops a lot), withdrawing liquidity may return a different mix of shares and SB than you put in. This is sometimes called impermanent loss in other AMM contexts.

> ⚠️ **LP is not a savings account.** Pool composition can shift during your position. Understand the pool dynamics before committing significant capital.

---

## Tracking Your LP Positions

All LP positions are visible in **Portfolio → Liquidity tab.** Each position shows:
- The player pool you're providing for
- Your LP share count and ownership percentage
- Current estimated position value
- Fees earned to date

---

## When LP Makes Sense

LP tends to work best when you:
- Believe a player's market will stay actively traded regardless of price direction
- Want to earn passive fee income rather than speculate on one-way price moves
- Have spare shares and SB you're comfortable committing for a period
- Are comfortable with pool composition shifting during your position

---

## Next Steps

- [Player Pools](/wiki/gameplay/player-pools) — how AMM trading and pricing work
- [Portfolio and Holdings](/wiki/gameplay/portfolio-and-holdings) — where your LP positions appear
- [Glossary](/wiki/faq/glossary) — definitions for LP shares, zap, TVL, and pool fee
