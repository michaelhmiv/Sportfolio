---
id: gameplay-earnings-normalization
title: How Earnings Are Normalized
summary: How Sportfolio makes comparable full seasons economically comparable across sports and positions.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-08-11
changeTriggers: server/economy/config.ts,server/economy/math.ts
slug: earnings-normalization
surface: web,cli
searchKeywords: normalization,benchmark,fantasy points,nfl,mlb,nhl,nascar,earnings
---

# How Earnings Are Normalized

Sportfolio uses one economic target for a benchmark-quality regular season: **10,000 SB**. A separate benchmark-quality postseason is also calibrated to **10,000 SB**.

The game does not divide 10,000 by the number of scheduled games. Instead, each materially different sport/position class has a versioned historical full-season fantasy-point benchmark.

```text
SB value per fantasy point = season earnings target / historical season FP benchmark
player game pool = positive game FP × SB value per fantasy point
```

This automatically makes an NFL game worth more per fantasy point than an MLB game when appropriate because an NFL player has far fewer opportunities to accumulate a full season of production.

Sportfolio currently calibrates distinct classes where scoring scales materially differ, including MLB hitters and pitchers, NFL positions, NHL skaters and goalies, and NASCAR national series.

The benchmarks are calibration data, not extra hidden payout knobs. The primary monetary settings remain the regular-season and postseason earnings targets.

A player can earn more or less than 10,000 SB over a phase. The target means a player who produces the benchmark amount of fantasy points would create about 10,000 SB of base player pools during that phase. Exceptional seasons can exceed it; injuries and weak seasons produce less.

Historical calibration can be rerun as scoring distributions evolve, but live payouts use the committed versioned benchmark configuration so rules do not drift from game to game.

## Related guides

- [Player Earnings](/wiki/gameplay/player-earnings)
- [Regular Season and Playoffs](/wiki/gameplay/regular-season-and-playoffs)
- [Daily Boosts](/wiki/gameplay/daily-boosts)
