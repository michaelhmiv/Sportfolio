---
id: gameplay-portfolio-holdings
title: Portfolio and Holdings
summary: How to read your account, understand holdings rows, track LP positions, and interpret what can and cannot be spent.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: client/src/pages/portfolio.tsx,server/routes.ts,server/storage.ts,shared/schema.ts
slug: portfolio-and-holdings
surface: web,agent
searchKeywords: portfolio,holdings,balance,lp,locks,premium,community shares
---

# Portfolio and Holdings

Your portfolio is the full state of your account's economy — not just a player list.

It tracks everything: cash, shares, LP positions, premium inventory, community shares, and a complete activity history.

---

## What Your Portfolio Contains

| Asset | Description |
|---|---|
| **Cash balance (SB)** | Liquid spending power |
| **Player holdings** | Raw tradeable shares per player |
| **Stacked shares** | Non-tradeable, high-multiplier positions |
| **LP positions** | Ownership in AMM liquidity pools |
| **Premium shares** | Activate premium access windows |
| **Community shares** | Spend to create community boosts |
| **Activity history** | Complete audit trail of state changes |

---

## Why a Player Can Appear Twice

One player can show up as two separate rows in your holdings: one for raw shares (1× multiplier) and one for stacked shares (2× or higher).

This is intentional. The system tracks them separately because boost and stack-shares flows consume different inventory types.

---

## Multipliers and Effective Shares

Two terms you'll see repeatedly:

**Multiplier** — the strength of a single stacked share (e.g., 5×)

**Effective shares** — the economic contribution of a position to value and payout math

**Example:**
- `quantity = 5, multiplier = 1×` → 5 effective shares (normal raw position)
- `quantity = 1, multiplier = 5×` → 5 effective shares (one stacked share from stacking 10 raw)

Same effective shares, very different boost utility. The stacked share wins every time for a single boost slot.

---

## Available vs. Locked Inventory

> ⚠️ **Locked shares cannot be spent.** Always check availability before stacking or assigning a boost.

```
available shares = quantity - lockedQuantity
```

Shares get locked when:
- A boost is active or pending
- Another protected flow has reserved them

Locked shares remain in your account state — they're just temporarily off-limits.

---

## The Holdings Tab

Use the Holdings tab to answer: *"What do I own and how is it performing?"*

It shows:
- Cash balance, portfolio value, and net worth
- Realized and unrealized P&L
- Position size and quality (raw vs. stacked) per player
- How concentrated you are by player and sport
- Cost basis and accounting details

---

## The Liquidity Tab

Use the Liquidity tab to answer: *"How much capital am I deploying as an LP?"*

It shows:
- Each LP position and its pool
- Your ownership percentage
- Current position value
- Fees earned to date

LP positions are market-making exposure, not directional bets. They earn from trading fees rather than share price movement.

---

## Premium and Community Inventory

**Premium shares** — redeemed to activate premium access. Not tradeable, not the same as player shares.

**Community shares** — spent when you create a community boost. Each community boost costs exactly one community share.

Both compete for your attention and balance even though they're not standard player positions.

---

## Activity Feed

The activity feed is your account timeline. Common categories:

| Category | What it covers |
|---|---|
| **Market** | Buys, sells, and market actions |
| **Scout** | Hourly share rewards and scout changes |
| **Boosts** | Burns, locks, payout outcomes |
| **LP** | Pool adds, removes, fee accrual |

Use the feed when a balance or holding changed and you want to know why.

---

## What Can Change Your Portfolio

Your portfolio can move because of:
- AMM buys and sells
- LP adds and removals
- Scout distributions (every hour)
- Daily boost burns and payouts
- Game-performance share payouts (stacked positions)
- Community boost creation
- Premium share redemption

The portfolio is the best place to see the combined effect of all Sportfolio systems.

---

## Next Steps

- [Player Pools](/wiki/gameplay/player-pools) — how to trade
- [Scouts and Rewards](/wiki/gameplay/scouts-and-rewards) — how inventory builds passively
- [Stacking and Boosts](/wiki/gameplay/stacking-shares-and-boosts) — how to upgrade inventory quality
- [Liquidity Providing](/wiki/gameplay/liquidity-providing) — LP positions explained
