---
id: feature-watchlists-and-news
title: Watchlists and News
summary: How to use watchlists to track players without owning them, and how the News Hub connects breaking sports news to your market decisions.
audience: public
category: features
status: published
owner: product-engineering
lastReviewedAt: 2026-04-23
changeTriggers: client/src/pages/watchlists.tsx,client/src/pages/news.tsx,server/routes.ts,server/storage.ts,shared/schema.ts
slug: watchlists-and-news
surface: web,agent
searchKeywords: watchlist,news,digest,tracking,player list,alerts,injury,breaking news
---

# Watchlists and News

These two features work together to help you track players and stay informed — without requiring you to own every position you care about.

---

## Watchlists

A watchlist is a named list of players you want to monitor. You don't need to own them to add them.

### What You Can Do

- Create multiple named watchlists (e.g., "Tonight's slate", "Injury watch")
- Rename or delete watchlists
- Add and remove players from any list
- Filter the Player Pools view to show only watchlisted names

### When to Use Watchlists

**Before buying** — Build a shortlist before committing cash. Track candidates until the timing is right.

**Cross-sport monitoring** — Follow players across NBA, NFL, MLB, and NASCAR in one organized view without buying all of them.

**Separating interest from conviction** — "I'm watching this player" is different from "I've bought this player." Watchlists make that distinction explicit.

**Pre-boost research** — Keep a shortlist of potential boost candidates during the week so you're not scrambling at lock time.

### Managing Watchlists

Access watchlists from the main navigation or from any player's detail page. You can add a player directly from their page — no need to go through a separate watchlist management flow.

The agent can also manage watchlists for you:

```
"Add [player] to my watchlist"
"Remove [player] from my watchlist"
```

---

## News Hub

The News Hub is the narrative layer around the market. It's where breaking sports information becomes decision-relevant context.

### What It Includes

- **General sports news** — breaking stories from across supported leagues
- **Source links** — click through to the original reporting
- **Recency context** — see how fresh each story is
- **Personalized digest** (authenticated users) — a curated feed based on your holdings and watchlists

### Why News Matters in Sportfolio

Market prices respond to information. An injury report, lineup change, or trade news can shift a player's value significantly before the broader market reacts.

Using the News Hub alongside your portfolio gives you:
- Context for why a price might be moving
- Early signals for players worth adding to your watchlist
- Timing cues for boost deployment (don't boost an injured player)

### The Digest

When logged in, the News Hub generates a personalized digest focused on:
- Players you currently hold
- Players on your watchlists

This surfaces the stories most relevant to your account rather than making you sift through all news manually.

> 💡 **Check the digest before assigning boosts.** A last-minute injury or scratch in the news can be the difference between a payout and a wasted slot.

---

## Agent Integration

Both watchlists and news are accessible through the agent:

```
"What's the latest news on my holdings?"
"Add [player] to my watchlist"
"Are there any injury updates relevant to tonight's boosts?"
```

The agent uses your watchlist context and can pull current news as part of its research capability.

---

## Next Steps

- [Stacking and Boosts](/wiki/gameplay/stacking-shares-and-boosts) — use news to inform boost decisions
- [Player Pools](/wiki/gameplay/player-pools) — trade based on news signals
- [Sportfolio Agent](/wiki/features/agent-operator) — ask the agent to research news for you
