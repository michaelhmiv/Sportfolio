---
id: gameplay-regular-season-playoffs
title: Regular Season and Playoffs
summary: Why Sportfolio treats the postseason as a separate, more concentrated earning season.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-08-11
changeTriggers: server/economy/config.ts,server/economy/repository.ts
slug: regular-season-and-playoffs
surface: web,cli
searchKeywords: playoffs,postseason,regular season,earnings,nfl,mlb,nhl,nascar
---

# Regular Season and Playoffs

Sportfolio treats the regular season and postseason as separate economic phases.

- Benchmark regular season: **10,000 SB** of base player earnings.
- Benchmark postseason: **10,000 SB** of base player earnings.

The postseason target is intentionally not reduced just because there are fewer games. Playoff qualification is not guaranteed, elimination can end the opportunity immediately, and each remaining game matters more.

Postseason payouts therefore use separate historical postseason fantasy-point benchmarks. Because the benchmark production is concentrated into far fewer games, a strong playoff performance can create a much larger player earnings pool than the same raw fantasy-point total during the regular season.

This is especially visible in football: a major NFL playoff performance can be an unusually large Sportfolio earnings event. Players whose teams miss the playoffs receive no postseason earning opportunities; players on deep runs can create a second substantial earning season.

That also gives the market a real sports-driven reason to care about playoff probability. Clinching a berth preserves access to the postseason earning phase, advancing preserves future opportunities, and elimination ends them.

Preseason and exhibition games do not generate player earnings or Daily Boost payouts.

## Related guides

- [Player Earnings](/wiki/gameplay/player-earnings)
- [How Earnings Are Normalized](/wiki/gameplay/earnings-normalization)
- [Daily Boosts](/wiki/gameplay/daily-boosts)
