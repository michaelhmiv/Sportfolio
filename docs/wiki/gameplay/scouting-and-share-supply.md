---
id: gameplay-scouting-share-supply
title: Scouting and Share Supply
summary: How fixed per-player scouting issuance creates Singles and Daily Boosts permanently remove them.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-08-11
changeTriggers: server/jobs/scout-distribution.ts,server/boosts/assign-daily-boost.ts,server/economy/repository.ts
slug: scouting-and-share-supply
surface: web,cli
searchKeywords: scouting,share supply,singles,60 shares,hour,dilution,burn
---

# Scouting and Share Supply

Scouting creates new Singles at a fixed per-player rate. An actively scouted player distributes approximately **60 Singles per hour globally**, split among that player's active scouts.

Adding more scouts does not make that player issue more than the fixed hourly amount. More scouts divide the same issuance.

That gives every player a predictable maximum share-creation rate while the player remains active and scoutable.

## More shares dilute EPS

New Singles do not increase the amount of base SB that a player's real-world performance creates. The player/game earnings pool is fixed by normalized performance, so more eligible Singles divide the same pool and reduce earnings per share.

## Daily Boosts remove shares

Daily Boosts are the primary direct share sink. Users commit Singles to a one-game multiplier and those Singles are permanently burned when the valid game begins.

The long-run share supply therefore has a simple lifecycle:

```text
Scouting -> Singles created
Holding/trading -> Singles circulate
Daily Boost -> Singles permanently burned
```

## Related guides

- [Player Earnings](/wiki/gameplay/player-earnings)
- [Daily Boosts](/wiki/gameplay/daily-boosts)
- [Portfolio and Holdings](/wiki/gameplay/portfolio-and-holdings)
