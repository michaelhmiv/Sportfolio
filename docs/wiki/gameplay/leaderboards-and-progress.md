---
id: gameplay-leaderboards-progress
title: Leaderboards and Progress
summary: What the public leaderboards measure, how to interpret live rank movement, and how public trader profiles fit into the leaderboard loop.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-03-07
changeTriggers: client/src/pages/leaderboards.tsx,client/src/pages/user-profile.tsx,server/routes.ts,server/storage.ts
slug: leaderboards-and-progress
surface: web,agent
searchKeywords: leaderboards,rankings,progress,net worth,cash balance,trading volume,user profile
---

# Leaderboards and Progress

Leaderboards are Sportfolio's public scoreboard. They show how accounts are performing across core economic metrics — not a separate game mode, but a summary layer over everything you're already doing.

---

## What Leaderboards Measure

You can rank users by multiple categories:

| Category                 | What it answers                                    |
| ------------------------ | -------------------------------------------------- |
| **Net Worth**            | Broadest snapshot — total account value            |
| **Cash Balance**         | How much liquid SB a user holds right now          |
| **Portfolio Value**      | How much value is tied up in held assets           |
| **Trading Volume (24h)** | Who has been most active in the market recently    |
| **Market Orders**        | Execution activity (not necessarily profitability) |

> ℹ️ No single category tells the whole story. A user with high volume might be churning badly. A user with high portfolio value might just have bought early and stopped.

---

## What a Rank Change Can Mean

A jump or drop in rank can come from many sources:

- A large price move in one of your held players
- A new trade or scout distribution
- Boost settlements and related burns or payouts
- **Another user moving faster than you** — even if your account improved

Rank is best used as context, not as your primary decision driver.

---

## Public Trader Profiles

Leaderboard entries link to public trader profile pages. Each profile shows:

- Current leaderboard standings
- Recent account trend
- Top public holdings
- Recent public market activity

Use profiles to understand what might be driving a rank — not just who is above or below you.

---

## How to Use Leaderboards Well

**Good uses:**

- Benchmark whether your strategy is compounding over time
- Spot whether your account is too conservative or over-exposed
- Compare your strengths against other users
- Sanity-check whether active effort is producing visible account progress

**Common traps to avoid:**

- Treating high activity rank as proof of skill
- Chasing short-term rank by making low-quality trades
- Assuming a cash-heavy account is automatically better than an invested one
- Confusing one good day with a durable strategy edge

---

## The Mental Model

Leaderboards are a scoreboard for the systems you already use:

```
Trading + Scouting + Stacking + Boost deployment → Leaderboard outcome
```

Sustained account quality produces better leaderboard results than isolated lucky trades.

---

## Next Steps

- [Portfolio and Holdings](/wiki/gameplay/portfolio-and-holdings) — the underlying account state driving your rank
- [Stacking and Boosts](/wiki/gameplay/stacking-shares-and-boosts) — the highest-leverage moves for rank improvement
- [Player Pools](/wiki/gameplay/player-pools) — trading activity that affects volume and value rankings
