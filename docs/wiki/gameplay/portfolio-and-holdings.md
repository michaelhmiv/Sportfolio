---
id: gameplay-portfolio-holdings
title: Portfolio and Holdings
summary: How to read Singles, Stack Power, LP exposure, and availability in your portfolio.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-05-31
changeTriggers: client/src/pages/portfolio.tsx,server/routes.ts,server/storage.ts,shared/schema.ts
slug: portfolio-and-holdings
surface: web
searchKeywords: portfolio,holdings,singles,stack power,lp,locks,premium,community shares
---

# Portfolio and Holdings

Your portfolio is the source of truth for account state: cash, player inventory, LP, premium/community assets, and activity history.

## Core Asset Types

| Asset             | Description                                  |
| ----------------- | -------------------------------------------- |
| Cash balance (SB) | Liquid spending power                        |
| Player holdings   | Singles plus optional Stack Power per player |
| LP positions      | Ownership in AMM liquidity pools             |
| Premium shares    | Redeem for premium access windows            |
| Community shares  | Spend to create community boosts             |
| Activity history  | Audit trail of state changes                 |

## Singles + One Stack Model

For each player, holdings are modeled as:

- Singles: tradeable raw shares (power 1 each)
- Stack: one non-tradeable power record (if stacked)

When you stack again, power is added to the same stack record. You do not create multiple stack lots for the same player in normal gameplay.

## Mobile Holdings Row

On mobile, each player row is compact and action-focused:

- line 1: player + current value
- line 2: team/position + P&L
- line 3: `Singles X · Stack Yp · <Ready|Need X|Add ready>`

Tap the row to open details and actions (Trade, Boost, Pool, Stack, View).

## Availability and Locks

Locked shares cannot be reused until unlocked.

```
available Singles = quantity - lockedQuantity
```

This check applies to stacking and boost assignment flows.

## Why Stack Power Matters

Stack power is the high-impact inventory used first for boost assignment when available.

Regular Singles stay flexible for:

- trading
- LP flows
- future stack adds

## Activity Feed

Use activity history to explain state changes:

- market trades
- scout distributions
- stack conversions
- boost locks/burns/payouts
- LP adds/removes/fees

## Next Steps

- [Player Pools](/wiki/gameplay/player-pools)
- [Scouts and Rewards](/wiki/gameplay/scouts-and-rewards)
- [Stacking and Boosts](/wiki/gameplay/stacking-shares-and-boosts)
- [Liquidity Providing](/wiki/gameplay/liquidity-providing)
