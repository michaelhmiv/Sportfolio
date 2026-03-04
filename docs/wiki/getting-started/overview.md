---
id: getting-started-overview
title: Getting Started
summary: A practical orientation to Sportfolio's economy, daily workflow, and the fastest path from a new account to confident decisions.
audience: public
category: getting-started
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: client/src/App.tsx,client/src/pages/dashboard.tsx,client/src/pages/marketplace.tsx,server/routes.ts,server/storage.ts
slug: overview
surface: web,cli,agent
searchKeywords: onboarding,start,balance,portfolio,first steps,overview,how sportfolio works
---

# What Sportfolio is

Sportfolio is a sports-market game built around player shares, live sports slates, and fantasy-driven payout loops. You are not only picking athletes you like. You are deciding how to allocate cash, where to warehouse exposure, when to convert inventory into power, and which live windows are worth attacking.

The core idea is simple:

- buy and sell player shares in live AMM pools
- passively accumulate more shares through scouts
- improve the quality of inventory by condensing into power
- deploy single-share daily boosts around game windows
- use leaderboards, news, and the agent to make better decisions

Sportfolio is now AMM-first. Legacy vesting code still exists in the repo for compatibility, but vesting is retired and should not be treated as part of the active product loop.

## Your starting resources

Every new account starts with virtual cash balance. From there, the main resources you manage are:

- **Cash balance (SB)**: your liquid spending power for buys, boost-related actions, LP adds, and other eligible actions.
- **Player shares**: your core inventory. These are the tradeable assets that move with the market.
- **Powered shares**: player shares with higher per-share strength, mainly important for boosts.
- **Premium shares**: redeemable inventory used to activate premium access windows.
- **Community shares**: consumable inventory used to create community boosts.

## The fastest path to a useful account

For most users, the best first session looks like this:

1. Pick a sport from the global sport selector so the dashboard and market views match what you care about.
2. Use the public dashboard to see what games and markets are active.
3. Buy a small basket of players you genuinely want to follow instead of over-diversifying immediately.
4. Assign scouts to a few conviction names and let them build share inventory over time.
5. Keep some cash unspent so you can react to news, price swings, or a better boost opportunity later in the day.
6. Before lock, review the Power page to see whether any holdings should be used in boosts.
7. If a slate looks attractive, decide whether your remaining cash should stay liquid for trading, be reserved for boosts, or be held for later news-driven entries.

## The daily Sportfolio rhythm

Most good Sportfolio habits repeat on a daily loop:

- **Open**: check the dashboard, active games, and any overnight news.
- **Build**: add or trim positions in player pools.
- **Accumulate**: keep scouts aligned with the names you still believe in.
- **Convert**: condense raw inventory if a higher-power share is more valuable than extra quantity.
- **Deploy**: assign daily boosts before the relevant games lock.
- **Compete**: use boosts and leaderboards as your short-cycle feedback loop.
- **Review**: check portfolio, activity, and leaderboards after settlement.

## What the main surfaces do

- **Dashboard**: the public front door for live market context, slate awareness, and quick account status when logged in.
- **Player Pools**: the main market browser for trading and spotting active names.
- **Player pages**: the detailed execution and research surface for one athlete.
- **Portfolio**: your holdings, liquidity positions, account metrics, and activity history.
- **Power**: condense, daily boosts, community boosts, and payout tracking.
- **News**: breaking stories plus a user-specific digest for authenticated users.
- **Agent**: Hermes-backed operator that can explain, review, research, and stage supported actions for confirmation.

## Where to go next

- Read [Platform Tour](/wiki/getting-started/platform-tour) for a feature-by-feature map of the site.
- Read [Player Pools](/wiki/gameplay/player-pools) to understand pricing, slippage, and liquidity.
- Read [Scouts and Share Rewards](/wiki/gameplay/scouts-and-rewards) to understand passive accumulation.
- Read [Power and Boosts](/wiki/gameplay/power-and-boosts) before burning valuable inventory.
- Read [Sports and Slates](/wiki/gameplay/sports-and-slates) to understand where each sport appears across the product.
- Read [Glossary](/wiki/faq/glossary) if you want the exact meaning of core Sportfolio terms.
