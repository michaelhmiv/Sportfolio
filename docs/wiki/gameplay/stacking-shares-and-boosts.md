---
id: gameplay-stacking-shares-boosts
title: Stacking Shares and Boosts
summary: How Singles convert into one Stack with Power, and how boost slots consume that inventory.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-05-31
changeTriggers: client/src/pages/boosts.tsx,client/src/pages/portfolio.tsx,server/routes.ts,server/jobs/lock-boost-shares.ts,server/jobs/settle-boosts.ts,server/jobs/settle-community-boosts.ts,server/storage.ts,shared/schema.ts
slug: stacking-shares-and-boosts
surface: web,cli
searchKeywords: stack shares,singles,stack power,boosts,daily boosts,community boosts
---

# Stacking Shares and Boosts

Sportfolio boost gameplay has two linked parts:

1. Build inventory with Singles and Stack Power.
2. Spend one eligible share per boost slot before lock.

## Stack Shares: Singles -> Stack Power

For each player, your holdings model is:

- many tradeable Singles (power 1 each)
- one non-tradeable Stack with Power (if you have stacked before)

Stacking never creates multiple stack records for one player. Re-stacking adds power to the existing stack.

Current stacking rules:

- minimum 4 Singles
- input must be even
- `N` Singles -> `+N/2` Stack Power
- the other `N/2` Singles are burned as the conversion cost

Example:

- stack 10 Singles
- you add +5 Stack Power
- 5 Singles are burned

This is a quality-for-quantity tradeoff, not free value creation.

## Locked Shares and Availability

Stacking only uses unlocked Singles.

```
available Singles = quantity - lockedQuantity
```

If shares are locked by another flow (for example a boost lock), they cannot be stacked until unlocked.

## Daily Boosts

Daily boosts have four slot tiers: 5x, 4x, 3x, 2x.

Each slot burns exactly one share source at lock time:

- if stack power exists, stack is preferred first
- otherwise one regular Single is used

The burn is irreversible once lock is reached.

## Payout Math

Daily boost payout:

```
payout = max(0, sharePower * fantasyPoints * effectiveMultiplier)
```

Where:

- `sharePower` is the stored power of the burned share source
- `effectiveMultiplier = slotTier + communityBoostCount`

Community boosts add `+1` effective multiplier for that player/date.

## Game-Performance Payouts

Separate from daily boost settlement, game-performance payout snapshots use stack power only:

- stack power is eligible
- regular Singles are not earning units for this path

## Quick Checklist

Before stacking or boosting, confirm:

- you have enough unlocked Singles
- you are comfortable burning quantity for stack quality
- you are assigning the right player to the right slot tier
- you understand lock time is the point of no return

## Next Steps

- [Scouts and Rewards](/wiki/gameplay/scouts-and-rewards)
- [Portfolio and Holdings](/wiki/gameplay/portfolio-and-holdings)
- [Sports and Slates](/wiki/gameplay/sports-and-slates)
