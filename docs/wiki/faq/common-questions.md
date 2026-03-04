---
id: faq-common-questions
title: Common Questions
summary: High-signal answers to the most common questions about Sportfolio's economy, sports coverage, features, and agent behavior.
audience: public
category: faq
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: client/src/App.tsx,client/src/pages/how-it-works.tsx,server/routes.ts,server/agent,shared/schema.ts
slug: common-questions
surface: web,cli,agent
searchKeywords: faq,questions,how it works,trading,agent,sports,premium,boosts
---

# How does trading work?

Players trade in AMM-backed pools. You receive a live quote, then buy or sell directly against pool liquidity.

## Do scouts give free shares?

Scouts distribute shares over time based on time-weighted participation. They are a long-horizon accumulation tool, not a guaranteed short-term edge.

## Do boosts consume my portfolio shares?

Yes. A daily boost burns one eligible share after the boost locks, so that share leaves your standing inventory.

## Does condense create free value?

No. Condense converts unlocked raw share quantity into higher per-share power. You are trading quantity for quality, not minting a free gain.

## What is the difference between a raw share and a powered share?

A raw share has `power = 1`. A powered share has `power > 1`. Powered shares matter most in the boost system because one boost slot burns exactly one share.

## Can the agent execute actions on its own?

No. The agent can stage supported actions, but you still confirm before state changes are applied.

## Can the agent research current news?

Yes. The server can use hosted web search for current information and cite sources in the response.

## Which sports does Sportfolio cover?

The shared sport model currently includes NBA, NFL, MLB, and NASCAR, plus an `ALL` browsing mode. Not every page exposes every sport identically, so the exact surface varies by feature.

## Is vesting still part of the live game?

No. Legacy vesting code remains in the repo for compatibility, but vesting is retired and not part of the active product loop.

## What is premium for?

Premium is an account-level entitlement layer. The main user-facing benefit today is higher scout capacity, plus related premium access behavior.

## Are premium shares normal player shares?

No. Premium shares are a separate asset type tied to premium access flows. They should not be treated like normal player holdings.

## What does the Power page actually do?

It is the deployment surface for power-related mechanics: condense, daily boosts, community boosts, and boost payout tracking.

## What do leaderboards measure?

Leaderboards rank users across multiple outcome categories such as net worth, cash balance, portfolio value, shares mined, and market-order activity.

## Do locked shares still count as available?

No. Locked shares remain in your account state, but they should not be treated as freely reusable inventory until the lock clears.

## Where should I start if the full product feels overwhelming?

Start with [Getting Started](/wiki/getting-started/overview), then read [Platform Tour](/wiki/getting-started/platform-tour), [Player Pools](/wiki/gameplay/player-pools), and [Glossary](/wiki/faq/glossary).
