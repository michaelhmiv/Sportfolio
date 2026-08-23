---
id: getting-started-platform-tour
title: Platform Tour
summary: A complete walkthrough of the main Sportfolio pages, what each one is for, and how the site fits together.
audience: public
category: getting-started
status: published
owner: product-engineering
lastReviewedAt: 2026-05-12
changeTriggers: client/src/App.tsx,client/src/components/app-sidebar.tsx,client/src/pages/dashboard.tsx,client/src/pages/marketplace.tsx,client/src/pages/portfolio.tsx,client/src/pages/boosts.tsx
slug: platform-tour
surface: web
searchKeywords: site map,platform tour,navigation,pages,features
---

# Platform Tour

Sportfolio has a handful of core pages. This tour explains what each one is for and when to use it.

> 🗺️ **Navigation lives in the sidebar on desktop and the bottom bar on mobile.** The same pages are reachable from both.

---

## Dashboard

**The daily control room.** Works before login and gains more depth after.

On the dashboard you can:

- Switch between NBA, NFL, MLB, and NASCAR
- Browse upcoming, live, and recently completed game windows
- Scan market activity and featured player movements
- Open game-detail and command-center views
- See your balance, portfolio value, rank, and boost status (when logged in)

> 💡 The dashboard is also the public landing page — it gives visitors useful market context without requiring an account.

---

## Player Pools

**The market browser.** Use this to find, compare, and trade players.

Features:

- Sortable and filterable player lists
- Sport, team, and position filters
- Watchlist filtering to show only your tracked names
- Market activity tabs — top movers, volume leaders, market-cap rankings
- Scanner widgets for momentum and relative-value signals

Go here first when your question is: _"What is moving and where should I be looking?"_

---

## Player Pages

**The single-player execution and research surface.**

Each player page shows:

- Current price and recent change
- Stats and recent game logs
- Buy and sell controls
- LP position details
- Your holdings and account-specific context

> ⚠️ Player pages require login because they show your portfolio context and execution controls.

---

## Portfolio

**Your account ledger.** Everything you own and how it's performing.

The Portfolio page has two tabs:

**Holdings tab**

- Cash balance and net worth
- Realized and unrealized P&L
- Each player-share position and its available/reserved quantity
- Activity history

**Liquidity tab**

- Your LP positions across player pools
- Pool ownership percentage
- Fees earned to date

Also see: [Portfolio and Holdings](/wiki/gameplay/portfolio-and-holdings) for deeper detail.

---

## Boosts

**Where inventory quality becomes competitive strategy.**

- Assign direct-share Daily Boost slots (2×, 3×, 5×, 7×, and 10×)
- Track which slots are open, locked, or settled
- Create community boosts
- View live and historical boost payouts

> 💡 Think of the market as accumulation and Boosts as deployment. You build inventory everywhere else; here you spend it.

Also see: [Daily Boosts](/wiki/gameplay/daily-boosts) for full mechanics.

---

## Analytics

**The macro market view.** Step back from individual players and see the whole ecosystem.

Analytics covers:

- Market health over time
- Share issuance and burn trends
- Sport-by-sport breakdowns
- Player comparisons
- Economy snapshots

Use this when your question is: _"What's the overall state of the market?"_

---

## News

**The narrative layer around the market.**

- General breaking sports news
- Source links and recency context
- A personalized digest when signed in (based on your holdings and watchlists)

News informs trading decisions. An injury report or lineup change can materially affect a player's market value.

---

## Watchlists

**Your custom player-tracking layer.**

Create named lists of players you want to monitor without immediately buying them. Useful when:

- You have conviction but no position yet
- You want to track multiple sports in one filtered view
- You're building a shortlist before a slate

Also see: [Watchlists and News](/wiki/features/watchlists-and-news) for full details.

---

## Premium

**Account-level entitlements.**

Premium expands your scout capacity (from 5 to 10 scouts) and unlocks premium access windows. This page shows:

- Your current premium status
- Premium share inventory
- Purchase history
- Redemption controls

Also see: [Premium](/wiki/features/premium) for what premium actually includes.

---

## Wiki

**The canonical product handbook.** You're reading it now.

The wiki lives in-app at `/wiki`. It covers:

- Getting started
- Gameplay mechanics
- Feature guides
- CLI and MCP access
- FAQs and the glossary

---

## Real-time Behavior

Sportfolio is a live product. Many pages update automatically:

- Portfolio refreshes after trades and settlements
- Scout payouts appear without a manual refresh
- Boost settlements push live results
- Whale alerts and trending-player signals update in the background
- Notification badges stay current across tabs

---

## Next Steps

- [Player Pools](/wiki/gameplay/player-pools) — how AMM trading and pricing work
- [Scouts and Rewards](/wiki/gameplay/scouts-and-rewards) — passive share accumulation
- [Daily Boosts](/wiki/gameplay/daily-boosts) — direct-share slots and payout mechanics
- [How to Access Sportfolio](/wiki/getting-started/access) — web, mobile, CLI, and MCP
