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
surface: web
searchKeywords: dashboard,analytics,news,watchlists,premium,notifications,realtime
---

# Platform Systems

Beyond core trading, scouting, and boosting, Sportfolio includes several platform-level features that help you stay informed and make better decisions.

---

## Dashboard Intelligence

The dashboard is your daily operating view — not just a welcome page.

**What it combines:**

- Live or upcoming slate context and game windows
- Market activity and scanner widgets
- Date navigation (look back and forward around nearby slates)
- Sport selector
- Balance, rankings, and boost status for logged-in users

> 💡 The dashboard is public. You can use it to assess market context without logging in.

---

## Market Scanners and Activity Feeds

Discovery widgets help you find movement without checking every player manually:

- Recent trade activity feed
- Top risers (price movers)
- Top market-cap names
- Pool-size leaders
- Market pulse indicators

These are attention tools — they help you decide where to look, not what to buy.

---

## News Hub

The News Hub adds narrative context to your market decisions.

**Features:**

- General sports news with source links
- Recency context for each story
- A personalized digest for authenticated users (based on holdings and watchlists)

An injury report or lineup announcement can shift a player's market value significantly. The news hub is where you find those signals.

See [Watchlists and News](/wiki/features/watchlists-and-news) for full details.

---

## Watchlists

Watchlists let you track players before you own them (or without owning them at all).

**You can:**

- Create multiple named watchlists
- Rename or delete them
- Add and remove players
- Filter the Player Pools view to show only watchlisted names

Watchlists are useful for building a shortlist, monitoring conviction names across sports, or separating "interested" from "invested."

See [Watchlists and News](/wiki/features/watchlists-and-news) for full details.

---

## Analytics

Analytics is the macro view of the whole market ecosystem.

**Focus areas:**

- Market health over time
- Time-series price and activity charts
- Share issuance and burn trends
- Player-to-player comparisons
- Sport-level breakdowns
- Economy snapshots

Use Analytics when your question is about the overall market shape, not a single trade decision.

See [Analytics](/wiki/features/analytics) for full details.

---

## Premium Access

Premium is an account-level entitlement, not a separate game mode.

**Primary benefits:**

- Scout capacity increases from 5 to 10
- Access to premium-only windows and features

**How it works:**

- Buy premium shares on the Premium page
- Redeem them to activate a premium access window
- Premium shares are a separate asset type — not player shares

See [Premium](/wiki/features/premium) for full details.

---

## Profiles and Social Proof

Public user profiles and leaderboards create a visible social layer:

- Inspect anyone's public identity and recent performance
- Compare rankings across metrics
- See who's performing well and what they're holding

Profiles make account outcomes visible and competitive.

---

## Real-Time Updates

Sportfolio is a live product. Updates are WebSocket-driven and happen automatically:

| Event               | What updates        |
| ------------------- | ------------------- |
| Trade or settlement | Portfolio refreshes |
| Scout distribution  | Holdings update     |
| Boost settlement    | Payout appears      |
| Whale activity      | Alert pushed        |
| Trending players    | Badges update       |

You should treat most pages as live operational surfaces, not static reports.

---

## Cross-Surface Access

The same Sportfolio account and economy are accessible from:

- **Web app** — primary experience
- **Mobile** — responsive, bottom-nav optimized
- **CLI** — terminal access via API token
- **MCP** — protocol access for external clients

See [How to Access Sportfolio](/wiki/getting-started/access) for setup details.

---

## Next Steps

- [Analytics](/wiki/features/analytics) — macro market analysis
- [Watchlists and News](/wiki/features/watchlists-and-news) — player tracking and news digest
- [Premium](/wiki/features/premium) — expand scout capacity and unlock premium features
