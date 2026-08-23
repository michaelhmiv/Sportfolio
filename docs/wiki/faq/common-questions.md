---
id: faq-common-questions
title: Common Questions
summary: High-signal answers to common questions about Sportfolio mechanics and surfaces.
audience: public
category: faq
status: published
owner: product-engineering
lastReviewedAt: 2026-05-31
changeTriggers: client/src/App.tsx,client/src/pages/how-it-works.tsx,client/src/pages/portfolio.tsx,server/routes.ts,server/storage.ts,shared/schema.ts
slug: common-questions
surface: web,cli
searchKeywords: faq,questions,trading,boosts,premium
---

# Common Questions

## Trading and Markets

**How does trading work?**
Sportfolio uses AMM-backed player pools. You trade against pool liquidity, so execution is immediate when a pool is active.

**What is slippage?**
Slippage is the gap between quoted spot and average fill price. Bigger orders in thinner pools usually slip more.

**Can I trade any player in any sport?**
Only players with active pools are tradeable.

## Scouts

**Do scouts give free shares?**
Scouts distribute shares over time based on scout-minutes (time weighted).

**How many scouts can I have?**
Standard: 5. Premium: 10.

## Boosts

**Do boosts consume my shares?**
Yes. One eligible share source is burned per slot at lock.

**When does burn happen?**
At game lock/start, not after results.

**Can I use the same player in multiple slots?**
Only if you have separate eligible inventory for each slot.

**What inventory can a Daily Boost use?**
Daily Boosts use the available Singles you choose. Reserved Singles cannot be committed again until their existing reservation clears.

## Liquidity Providing (LP)

**What is LP?**
LP means adding share and SB liquidity to player pools and earning a portion of pool fees.

**Where do I view LP positions?**
Portfolio -> Liquidity tab.

## Account and Features

**Which sports are supported?**
NBA, NFL, MLB, NASCAR, plus ALL browsing mode.

**Are premium shares player shares?**
No. Premium shares are separate inventory for premium redemption.

**Do locked shares count as available?**
No. `available = quantity - lockedQuantity`.

## Where to Start

1. [Getting Started](/wiki/getting-started/overview)
2. [Platform Tour](/wiki/getting-started/platform-tour)
3. [Player Pools](/wiki/gameplay/player-pools)
4. [Glossary](/wiki/faq/glossary)
