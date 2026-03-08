---
id: getting-started-platform-tour
title: Platform Tour
summary: A complete walkthrough of the main Sportfolio pages, what each one is for, and how the site fits together.
audience: public
category: getting-started
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: client/src/App.tsx,client/src/components/app-sidebar.tsx,client/src/pages/dashboard.tsx,client/src/pages/marketplace.tsx,client/src/pages/portfolio.tsx,client/src/pages/boosts.tsx
slug: platform-tour
surface: web,agent
searchKeywords: site map,platform tour,navigation,pages,features
---

# Main navigation

Sportfolio's primary navigation is built around the pages most users touch every day:

- Dashboard
- Player Pools
- Analytics
- Wiki
- Boosts
- Portfolio
- Premium
- Agent
- News

Additional routes such as leaderboards, watchlists, profiles, and player detail pages are linked contextually from those core surfaces.

## Dashboard

The dashboard is the public front door. It is designed to be useful before login and richer after login.

On the dashboard you can:

- switch between supported sports
- move across nearby dates
- review upcoming, live, or recently completed game windows
- inspect market activity and featured names
- open deeper game detail and command-center views
- see balance, portfolio value, rankings, and boost status when authenticated

Because the dashboard is public, it doubles as the landing page for non-authenticated visitors and as the daily control room for active users.

## Player Pools

The Player Pools page is the market browser.

It combines:

- sortable player lists
- sport filters
- search, team, and position filters
- watchlist filtering
- market activity tabs
- scanners for momentum, market-cap leaders, and other high-signal names

Use this page when you want breadth: which players are active, which pools are moving, and where you may want to drill into a single player.

## Player pages

A player page is the detailed execution surface for one athlete.

It is where you inspect:

- current market price and recent price change
- stats and recent games
- AMM buy and sell flows
- LP position details
- boost relevance
- your account-specific context for that player

Player pages are authenticated because they include your own portfolio context and execution controls.

## Portfolio

Portfolio is your account ledger view.

It is split between:

- **Holdings**: player-share inventory, P&L, cost basis, stacked-share multiplier state, and account-level totals
- **Liquidity**: LP positions, fee accrual, and pool ownership exposure

It also contains portfolio history, asset breakdowns, and recent account activity so you can understand not only what you own, but how you got there.

## Boosts

Boosts is where inventory quality becomes active strategy.

This surface handles:

- stacking raw shares into multiplier inventory
- assigning daily boosts
- tracking which boost slots are open, locked, or settled
- creating community boosts
- monitoring live and historical boost payouts

If you treat the market as accumulation and the Boosts page as deployment, the product will make more sense.

## Analytics

Analytics is the macro market view.

It focuses on:

- market health over time
- sport-by-sport breakdowns
- player comparisons
- share issuance and burn trends
- economy snapshots

This page is useful when you want to understand the shape of the overall ecosystem instead of only one position.

## News and Watchlists

The News Hub is the narrative layer around the market. It combines:

- general breaking sports stories
- source links
- a user-specific digest when signed in

Watchlists are your custom tracking layer. They let you create named lists and attach players you want to monitor without trading them yet.

Together, these pages help you organize attention before you allocate capital.

## Premium, profiles, and access utilities

- **Premium**: buy premium shares and redeem them for premium access.
- **User profile**: public-facing user identity and personal account controls.
- **SMS link**: secure account-link flow for the SMS agent.
- **Wiki**: the canonical documentation hub you are reading now.

These pages are support systems around the core economy rather than separate game loops.

## Agent and cross-channel access

The Agent page is the main in-app assistant interface. It can:

- answer product questions
- review your setup
- use hosted research for current news
- stage supported economic actions that you explicitly confirm

The same product knowledge also powers:

- the SMS agent after account linking
- the Sportfolio CLI through API tokens

## Real-time behavior

Sportfolio uses live updates heavily. You will see:

- refreshed portfolio data after trades and settlements
- live game and payout movement
- notification badges
- ceremony overlays for scout and boost milestones
- market activity refresh without manual reloads

That means many pages are not static reports. They are operational surfaces that react as the economy and game data change.
