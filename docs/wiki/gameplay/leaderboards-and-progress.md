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

# What leaderboards are for

Leaderboards are Sportfolio's public scoreboards.

They are not a separate game mode. They are a summary layer that shows how accounts are performing across core economic metrics.

## What they commonly measure

The public Leaderboards page can rank users by metrics such as:

- net worth
- cash balance
- portfolio value
- rolling 24-hour trading volume
- market-order activity

Each category answers a different question.

## How to read the categories

- **Net Worth**: the broadest account snapshot. Good for overall standing.
- **Cash Balance**: how much liquid SB a user is holding right now.
- **Portfolio Value**: how much value is tied up in held assets.
- **Trading Volume (24h)**: who has been most active in the market recently.
- **Market Orders**: execution activity, not necessarily profitability.

No single category tells the whole story.

## What a rank change can mean

A jump or drop in rank can come from:

- a large market move in held players
- a new trade
- scout output accumulating over time
- boost settlements and related burns or payouts
- another user moving faster than you, even if your account improved

That is why rank is best used as context, not as your only decision tool.

## Public trader profiles

Leaderboard rows link into public trader status pages.

Those profile pages are designed to show:

- current leaderboard standing,
- recent account trend,
- top public holdings,
- recent public market activity.

Use them to understand what may be driving a rank, not just who is sitting above or below you.

## Healthy ways to use leaderboards

Use leaderboards to:

- benchmark whether your strategy is compounding over time
- spot whether your account is too conservative or too exposed
- compare your strengths against other users
- sanity-check whether active effort is turning into visible account progress

## Common mistakes

Avoid these traps:

- treating a high activity rank as proof of skill
- chasing short-term rank movement with low-quality trades
- assuming a cash-heavy account is automatically better than an invested one
- confusing one good day with a durable strategy edge

## The right mental model

Leaderboards are a scoreboard for the systems you already use:

- trading
- scouting
- power management
- boost deployment

They reward sustained account quality more than one isolated action.
