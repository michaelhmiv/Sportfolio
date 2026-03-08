---
id: gameplay-sports-slates
title: Sports and Slates
summary: Which sports Sportfolio currently supports, where each one appears in the product, and how date-based slate logic works.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: client/src/lib/sport-context.tsx,client/src/pages/dashboard.tsx,client/src/pages/boosts.tsx,server/routes.ts,shared/schema.ts
slug: sports-and-slates
surface: web,agent
searchKeywords: sports,supported sports,nba,nfl,mlb,nascar,slates,dates
---

# The current supported sports

Sportfolio's shared sport model currently includes:

- NBA
- NFL
- MLB
- NASCAR
- ALL (an aggregate browsing mode rather than a separate sport)

Not every page exposes every sport in exactly the same way, so the important question is not just "which sports exist?" but "where does each sport appear?"

## The global sport selector

The app-level sport selector can drive broad market views across:

- Dashboard
- Player Pools
- some analytics and scanner surfaces

`ALL` is a convenience mode that lets you browse mixed-market views without manually switching between leagues.

## Where each sport is visible

At a high level:

- **NBA**: full market coverage, game context, boosts, analytics, and player surfaces
- **NFL**: full market coverage, live game context, boosts, analytics, and player surfaces
- **MLB**: full market coverage, live game context, boosts, analytics, and player surfaces
- **NASCAR**: supported in the shared sport model, market records, and race-oriented insight flows, with a narrower surface than the main ball sports in some pages

The result is a feature matrix, not a single yes-or-no switch.

## Sport coverage is not perfectly uniform

Some systems are broad and sport-agnostic:

- player holdings
- AMM pools
- scouts
- portfolio accounting
- market analytics

Other systems are more slate-specific and may expose a narrower visible set depending on the page:

- community boost pickers
- race-specific versus team-game-specific insights
- date-specific game windows and payout opportunities

That means "supported" can mean either:

- the sport exists in the data model and economy
- or the sport is currently front-and-center in a specific UI flow

Those are related, but not identical.

## How slate timing works

Sportfolio is highly date-sensitive.

The key time rules are:

- server scheduling runs on Eastern Time
- daily mechanics use ET day boundaries
- boosts and community boosts are assigned against a specific day
- dashboards let you look backward and forward around nearby slate windows

The practical lesson is that the same player can be:

- relevant today for a boost
- visible tomorrow for an upcoming game window
- and still tradable in the market either way

## Games, races, and live status

For team sports, the app tracks game windows such as:

- scheduled
- in progress
- completed
- postponed or similar non-standard states

For NASCAR, the equivalent live context is race-oriented rather than team-vs-team game flow.

This is why the dashboard and live-insight views may feel slightly different between NASCAR and the three main ball sports even though they share the same top-level selector.

## What "ALL" is good for

Use `ALL` when you want:

- the broadest market scan
- a cross-sport view of what is moving
- a faster way to spot unusual volume or price activity

Use a single sport when you want:

- cleaner comparison inside one league
- boost or trade decisions for one slate
- position or team filters that only make sense inside that league

## The practical way to think about sports in Sportfolio

Sportfolio is best understood as:

- one shared economy
- spread across multiple sports
- with some sport-specific surfaces layered on top

The core account systems stay the same. What changes by sport is the shape of the slate, the style of live context, and which UI tools are most useful on that day.
