---
id: getting-started-overview
title: Getting Started
summary: Practical orientation to Sportfolio's core loop and first-session workflow.
audience: public
category: getting-started
status: published
owner: product-engineering
lastReviewedAt: 2026-05-31
changeTriggers: client/src/App.tsx,client/src/pages/dashboard.tsx,client/src/pages/marketplace.tsx,client/src/pages/portfolio.tsx,server/routes.ts,server/storage.ts
slug: overview
surface: web,cli,agent
searchKeywords: onboarding,start,balance,portfolio,first steps,overview
---

# What Sportfolio Is

Sportfolio is a sports market game built around player shares, live slates, and fantasy-driven payout loops.

You allocate cash, accumulate player inventory, convert some Singles into Stack Power, and deploy boosts around game windows.

## Your Resources

| Asset             | What it is                                       |
| ----------------- | ------------------------------------------------ |
| SB (cash balance) | Liquid spending power for trades, boosts, and LP |
| Player Singles    | Tradeable player shares                          |
| Stack Power       | Non-tradeable per-player power inventory         |
| Premium shares    | Redeemable for premium access windows            |
| Community shares  | Consumed to create community boosts              |

## Core Loop

```
Buy shares -> Assign scouts -> Build stack power -> Deploy boosts -> Review payouts
```

1. Trade: buy player Singles in AMM pools.
2. Accumulate: scouts earn more shares over time.
3. Convert: stack unlocked Singles when quality matters more than quantity.
4. Compete: assign daily boosts before lock.
5. Review: track portfolio and leaderboard impact.

## First Session Checklist

1. Pick a sport from the selector.
2. Scan Player Pools for price, volume, and game context.
3. Buy a small basket of players you have conviction on.
4. Assign scouts to those players.
5. Keep some cash for flexibility.
6. Before lock, review Boosts and assign slots intentionally.

## Daily Rhythm

- Open: check slate and news.
- Build: add or trim positions.
- Accumulate: adjust scout assignments.
- Convert: stack Singles when appropriate.
- Deploy: assign boosts before lock.
- Review: inspect activity feed and outcomes.

## Main Pages

| Page         | Purpose                                         |
| ------------ | ----------------------------------------------- |
| Dashboard    | Live context, market activity, account snapshot |
| Player Pools | Browse and trade                                |
| Player Page  | Deeper execution and research                   |
| Portfolio    | Holdings, stack status, LP, and activity        |
| Boosts       | Stacking, slot assignment, and payout tracking  |
| News         | Breaking stories and personalized digest        |
| Agent        | Explain mechanics and stage confirmed actions   |

Saved live strategies can auto-run only an allowlisted gameplay subset. Payment and checkout flows remain excluded from auto-runs.

## Where to Go Next

- [Platform Tour](/wiki/getting-started/platform-tour)
- [Player Pools](/wiki/gameplay/player-pools)
- [Scouts and Rewards](/wiki/gameplay/scouts-and-rewards)
- [Stacking and Boosts](/wiki/gameplay/stacking-shares-and-boosts)
- [Glossary](/wiki/faq/glossary)
