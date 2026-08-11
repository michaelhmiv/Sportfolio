---
id: gameplay-player-earnings
title: Player Earnings
summary: How Singles earn a share of each player's capped performance pool.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-08-11
changeTriggers: server/economy/config.ts,server/economy/math.ts,server/economy/repository.ts,server/jobs/snapshot-share-payouts.ts,server/jobs/settle-share-payouts.ts
slug: player-earnings
surface: web,cli
searchKeywords: earnings,eps,singles,payouts,player performance,sb
---

# Player Earnings

Every eligible Single can earn virtual SB when its player performs in an eligible real-world game.

Sportfolio does **not** create more base SB just because more shares exist. Each player/game creates one capped base earnings pool from that player's normalized fantasy performance, and the eligible Singles divide that pool.

```text
game EPS = player game earnings pool / eligible Singles at game lock
user payout = eligible Singles held at game lock × game EPS
```

If a player creates a 500 SB pool and 1,000 eligible Singles exist, game EPS is 0.50 SB. If 100,000 Singles exist, the same performance still creates 500 SB; EPS becomes 0.005 SB.

That means scouting and trading can change ownership and dilution, but they cannot make the base monetary faucet grow by themselves.

## Record time

Eligibility is snapshotted when the real-world game begins. Shares acquired after the game starts do not earn that game's distribution.

Singles committed to a Daily Boost are still included in the normal base snapshot before they are burned, so they receive their ordinary 1x game earnings plus any separate Boost bonus.

## Performance risk

Only positive fantasy production creates a base pool. Negative fantasy totals are floored at zero rather than charging users. Missed games, injuries, poor performances, and inactive players naturally reduce future earnings because they generate less or no fantasy production.

## Related guides

- [How Earnings Are Normalized](/wiki/gameplay/earnings-normalization)
- [Regular Season and Playoffs](/wiki/gameplay/regular-season-and-playoffs)
- [Daily Boosts](/wiki/gameplay/daily-boosts)
- [Scouting and Share Supply](/wiki/gameplay/scouting-and-share-supply)
