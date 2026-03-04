---
id: feature-platform-systems
title: Platform Systems
summary: A feature catalog for Sportfolio's major non-core-loop tools including dashboard intelligence, news, analytics, watchlists, premium access, and real-time updates.
audience: public
category: features
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: client/src/pages/dashboard.tsx,client/src/pages/analytics.tsx,client/src/pages/news.tsx,client/src/pages/watchlists.tsx,client/src/pages/premium.tsx,server/websocket.ts
slug: platform-systems
surface: web,agent
searchKeywords: dashboard,analytics,news,watchlists,premium,notifications,realtime
---

# Dashboard intelligence

The dashboard is more than a welcome page. It is the site-wide operating view.

It combines:

- live or upcoming slate context
- market activity and scanners
- date navigation
- sport selection
- quick account status for authenticated users
- links into deeper game and player views

For many users, the dashboard is the place where "what is happening?" becomes "what should I do?"

## Player research surfaces

Outside the core trade widgets, Sportfolio gives you several ways to inspect context:

- player detail pages
- player stats
- recent games
- financial metrics
- live game detail and command-center flows

These tools exist so you can evaluate both the athlete and the market around that athlete, not only the last traded price.

## Market scanners and activity feeds

Sportfolio includes market-intelligence widgets that help you find movement without checking every player manually.

Common examples include:

- recent trade activity
- top risers
- top market-cap names
- pool-size leaders
- generalized market pulse indicators

These are discovery tools. They help you decide where to spend attention.

## News Hub

The News Hub gives Sportfolio a narrative layer around the market.

It includes:

- general sports stories
- headline briefings
- source links
- recency context
- a user-specific digest for authenticated users

The purpose is not only "read the news." It is "read the news in a form that can affect market and slate decisions."

## Watchlists

Watchlists are custom tracking lists for players you care about.

You can:

- create multiple named watchlists
- rename or delete them
- add players
- remove players
- use them as a filter in market browsing

Watchlists are useful when your conviction exists before your position, or when you want to monitor names across several sports without immediately buying.

## Analytics

Analytics is the macro observability layer for the market.

It focuses on:

- market health
- time-series movement
- share issuance and burn trends
- player-to-player comparisons
- sport-level breakdowns
- economy snapshots

Use it when you want to understand the shape of the whole ecosystem instead of a single trade.

## Premium access

The Premium page is the entitlement and purchase surface for premium access.

It covers:

- current premium status
- premium share inventory
- purchase history
- redemption into premium access windows

Premium primarily changes account utility, most notably by expanding scout capacity. It is an account-level feature, not a separate gameplay league.

## Profiles and social proof

User profile pages and leaderboards create the public-facing status layer of the platform.

They make it possible to:

- inspect public identity
- compare rankings
- see who is performing well
- turn account outcomes into a visible social signal

## Real-time updates and notifications

Sportfolio uses WebSocket-driven updates to keep the site live.

That powers:

- portfolio refresh after trades and settlements
- scout payout updates
- boost settlement updates
- whale alerts
- trending-player updates
- unread badges and freshness indicators

Many pages are designed around this real-time model, so they should be read as live operational surfaces rather than static reports.

## Mobile and cross-surface access

The product also supports:

- responsive web usage
- mobile wrappers
- SMS agent access after linking
- CLI access through API tokens

The exact controls differ by channel, but the goal is the same: keep the same account and economy accessible in multiple operating contexts.
