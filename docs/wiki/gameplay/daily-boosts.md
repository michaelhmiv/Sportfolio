---
id: gameplay-daily-boosts
title: Daily Boosts
summary: How to sacrifice Singles for larger one-game earnings through 2x, 3x, 5x, 7x, and 10x Boost slots.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-08-11
changeTriggers: client/src/pages/boosts.tsx,server/boosts/assign-daily-boost.ts,server/jobs/lock-boost-shares.ts,server/jobs/settle-boosts.ts,server/economy/repository.ts
slug: daily-boosts
surface: web,cli
searchKeywords: daily boost,boosts,2x,3x,5x,7x,10x,burn shares,singles
---

# Daily Boosts

Daily Boosts are Sportfolio's active risk/reward layer. You can keep Singles for slow, durable player earnings, or commit some Singles to a one-game Boost for a larger payout.

There is no separate Stack Power asset. Boosts use Singles directly.

## Boost slots

Each daily Boost cycle has five slots:

- 2x
- 3x
- 5x
- 7x
- 10x

Choose a player, choose an available slot, and choose how many available Singles you are willing to sacrifice.

Before the game begins, committed shares are reserved so they cannot also be sold or used by another Boost. When a valid game begins, the committed Singles are permanently burned.

The burn remains even if the player performs poorly, leaves injured, crashes, or scores zero. If an event is officially cancelled before becoming a valid performance event, the commitment is cancelled/released instead of being burned.

## Earnings

Boosted Singles are included in the normal player-earnings record snapshot before they burn. They therefore receive their ordinary 1x game EPS just like other eligible Singles.

The Boost then adds only the incremental bonus:

```text
boost bonus = boosted Singles × game EPS × (effective multiplier - 1)
```

So 20 boosted Singles at 0.50 SB game EPS in a 5x slot have 10 SB of normal base earnings and 40 SB of extra Boost bonus, for 50 SB of total game economics. The 20 Singles are then gone permanently.

Community Boosts can add to the effective multiplier for the applicable player/date. Their effect is accounted as part of the Boost bonus rather than as a second duplicate payout.

## Strategy

The decision is intentionally simple:

- **Hold:** keep the asset, stay liquid, and collect normal earnings over future games.
- **Boost:** accelerate one game's earnings, but permanently sacrifice the shares.

The player choice, slot choice, and quantity at risk are the core daily strategy.

## Related guides

- [Player Earnings](/wiki/gameplay/player-earnings)
- [How Earnings Are Normalized](/wiki/gameplay/earnings-normalization)
- [Scouting and Share Supply](/wiki/gameplay/scouting-and-share-supply)
