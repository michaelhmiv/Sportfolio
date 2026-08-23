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
surface: web
searchKeywords: sports,supported sports,nba,nfl,mlb,nascar,slates,dates
---

# Sports and Slates

Sportfolio supports multiple sports in one shared economy. The same account, cash balance, and portfolio mechanics apply across all of them — what changes is the shape of the slate and which UI tools are most relevant.

---

## Supported Sports

| Sport      | Coverage                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------- |
| **NBA**    | Full — trading, boosts, analytics, player surfaces                                           |
| **NFL**    | Full — trading, boosts, analytics, player surfaces                                           |
| **MLB**    | Full — trading, boosts, analytics, player surfaces                                           |
| **NASCAR** | Supported — markets, race-oriented insights; narrower surface than ball sports on some pages |
| **ALL**    | Aggregate browsing mode; not a separate sport                                                |

> ℹ️ "Supported" can mean the sport exists in the data model and economy, or that it's front-and-center in a specific UI. Those aren't always identical — check the specific page if you're unsure.

---

## The Global Sport Selector

The sport selector in the app header (and at the top of the dashboard) drives:

- Dashboard slate and game windows
- Player Pools listings
- Some analytics and scanner views

Use `ALL` for cross-sport browsing. Switch to a single sport when you need slate-specific context, like boost assignments or team-level filtering.

---

## Timing and Time Zones

Sportfolio's daily mechanics are **Eastern Time (ET) based:**

- Server job schedules run on ET
- Game-day boundaries use ET helpers
- Boosts and community boosts are assigned against a specific ET day

**Practical impact:**

- A player with a 10 PM ET game locks near game start ET
- The dashboard date navigator works in ET day windows
- The same player can be relevant today for a boost, visible tomorrow for an upcoming game, and still tradeable either way

---

## How Game Status Works

For team sports (NBA, NFL, MLB), the app tracks:

- Scheduled
- In progress
- Completed
- Postponed / non-standard

For NASCAR, live context is race-oriented rather than team-vs-team game flow. The dashboard and insight views may feel slightly different for NASCAR even though it shares the same sport selector.

---

## Using the ALL Mode

**Use `ALL` when you want:**

- The broadest market scan across all sports at once
- A cross-sport view of what's moving
- A faster way to spot unusual volume or price activity

**Use a single sport when you want:**

- Clean comparisons inside one league
- Boost or trade decisions tied to one specific slate
- Position or team filters that only make sense inside that league

---

## The Right Mental Model

Sportfolio is one economy with multiple sport overlays:

- Core systems (trading, scouting, Daily Boosts, LP) are sport-agnostic
- Boost eligibility, game windows, and live context are sport-specific
- The dashboard and boosts page adapt to whichever sport you're focused on

---

## Next Steps

- [Player Pools](/wiki/gameplay/player-pools) — trading within a sport's market
- [Daily Boosts](/wiki/gameplay/daily-boosts) — slate-timed direct-share deployment
- [Platform Tour](/wiki/getting-started/platform-tour) — full walkthrough of the dashboard and market views
