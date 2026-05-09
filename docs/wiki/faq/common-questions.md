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

# Common Questions

---

## Trading and Markets

**How does trading work?**
Players trade in AMM-backed pools. On initialized pools, you receive a live quote and buy or sell directly against pool liquidity - no waiting for another user.

**What is slippage?**
Slippage is the gap between the displayed spot price and your actual average execution price. It happens because your order moves the pool. Larger orders in thinner pools = more slippage.

**Can I trade any player in any sport?**
Any player with an active pool can be traded. Not every player on every roster has a pool - check Player Pools or search for the specific player.

---

## Scouts

**Do scouts give free shares?**
Scouts distribute shares over time based on time-weighted participation (scout-minutes). They're a long-horizon accumulation tool, not a guaranteed short-term edge.

**What happens if I don't log in for a day?**
Scout assignments for accounts inactive more than 24 hours are automatically cleared. Your accumulated shares stay - only the active assignment is removed.

**How many scouts can I have?**
Standard accounts: 5. Premium accounts: 10.

---

## Shares and Stacking

**What is the difference between a raw share and a stacked share?**
A raw share has a 1x multiplier and is tradeable. A stacked share has a multiplier above 1x and is not tradeable - it's held as boost-ready inventory.

**Does stacking create free value?**
No. Stacking converts unlocked raw shares into a higher multiplier. You are trading quantity for quality, not minting a gain. Minimum 4 shares, even count, `N` shares -> `N/2` multiplier.

**Can I sell stacked shares?**
No. Stacked shares are non-tradeable. Only raw shares can be sold in the AMM.

---

## Boosts

**Do boosts consume my portfolio shares?**
Yes. A daily boost burns one eligible share after the boost locks. That share permanently leaves your inventory.

**When does the burn happen?**
At game start (lock time) - not after you see the result. Boost assignment is a real, irreversible commitment.

**What if the player has a bad game?**
The payout formula uses `max(0, ...)` - bad fantasy output means you earn nothing, but you can't go negative.

**Can I use the same player in multiple boost slots?**
Only if you have separate eligible shares for each slot. Each slot burns exactly one share.

---

## Liquidity Providing (LP)

**What is LP?**
LP (liquidity providing) means adding both shares and SB to a player pool. You earn a portion of trading fees in exchange for providing that liquidity.

**How is LP different from holding shares?**
Holding = directional bet on price. LP = market-making exposure to both sides of a pool. LP earns fees; shares earn from price appreciation.

**Where do I see my LP positions?**
Portfolio -> Liquidity tab.

---

## The Agent

**Can the agent execute actions on its own?**
No. The agent stages supported actions, but you must confirm before any state changes are applied.

**Can the agent research current news?**
Yes. The server performs hosted web research and returns structured results with citations.

**What channels does the agent support?**
The active contract is the web Agent page and the CLI. Legacy SMS infrastructure exists but is not part of the primary contract.

---

## Account and Features

**Which sports does Sportfolio cover?**
NBA, NFL, MLB, and NASCAR, plus an `ALL` browsing mode. Coverage depth varies by sport - NBA, NFL, and MLB have the fullest surfaces.

**What is premium for?**
Premium expands scout capacity from 5 to 10 and unlocks premium access features. It's an account-level upgrade, not a separate game mode.

**Are premium shares normal player shares?**
No. Premium shares are a separate asset type used to redeem premium access. Don't treat them like player holdings.

**Is vesting still part of the game?**
No. Legacy vesting code exists in the repo for compatibility, but vesting is retired and not part of the active product loop.

**Do locked shares count as available?**
No. Locked shares are visible in your account state but can't be spent until the lock clears. Available = quantity minus lockedQuantity.

---

## Where to Start

> Tip: If the full product feels overwhelming, start here:

1. [Getting Started](/wiki/getting-started/overview) - the core loop in plain language
2. [Platform Tour](/wiki/getting-started/platform-tour) - page-by-page walkthrough
3. [Player Pools](/wiki/gameplay/player-pools) - how trading works
4. [Glossary](/wiki/faq/glossary) - exact definitions for Sportfolio terms
