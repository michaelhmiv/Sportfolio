# Sportfolio LLM Context

## Product Summary

Sportfolio is a sports-focused market game where users:

- trade player shares through AMM pools,
- assign scouts that distribute shares over time,
- use boost and leaderboard systems tied to real game outcomes.

## Canonical Routes

- `/` dashboard and market overview
- `/pools` player pool discovery and trading
- `/leaderboards` user rankings
- `/blog` and `/blog/:slug` educational/news content
- `/how-it-works` rules and mechanics

## Public API for Retrieval

Use only:

- `/api/public/market-summary` for top market snapshots
- `/api/public/blog` for published blog index
- `/feed.xml` for RSS updates
- `/feed.json` for JSON feed updates

Do not use admin or user-authenticated endpoints.

## Policy

- Respect `robots.txt` directives.
- Use canonical URL forms and avoid duplicate hostnames.
- Treat game/market values as time-sensitive; prefer fresh data from public endpoints.
