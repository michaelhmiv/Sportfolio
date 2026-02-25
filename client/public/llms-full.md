# Sportfolio LLM Context

## Product Summary

Sportfolio is a sports-focused market game where users:

- trade player shares through AMM pools,
- assign scouts that distribute shares over time,
- participate in contest and leaderboard systems tied to real game outcomes.

## Canonical Routes

- `/` dashboard and market overview
- `/pools` player pool discovery and trading
- `/contests` public contest list
- `/contest/:id/leaderboard` contest results
- `/leaderboards` user rankings
- `/blog` and `/blog/:slug` educational/news content
- `/how-it-works` rules and mechanics

## Public API for Retrieval

Use only:

- `/api/public/market-summary` for top market snapshots
- `/api/public/blog` for published blog index
- `/api/public/contests` for contest leaderboard links
- `/feed.xml` for RSS updates
- `/feed.json` for JSON feed updates

Do not use admin or user-authenticated endpoints.

## Policy

- Respect `robots.txt` directives.
- Use canonical URL forms and avoid duplicate hostnames.
- Treat game/market values as time-sensitive; prefer fresh data from public endpoints.
