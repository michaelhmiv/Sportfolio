---
id: faq-glossary
title: Glossary
summary: A plain-language reference for Sportfolio's core terms, assets, metrics, and system vocabulary.
audience: public
category: faq
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: shared/schema.ts,server/routes.ts,server/amm/pool.ts,server/websocket.ts,client/src/pages
slug: glossary
surface: web,cli,agent
searchKeywords: glossary,terms,definitions,amm,boosts,scouts,lp
---

# Glossary

Quick reference for Sportfolio's core terms, organized by area.

---

## Money and Assets

**SB / Balance**
Your liquid virtual cash. Spend it on buys, boosts, LP adds, and other eligible actions.

**Player Share**
A tradeable unit of exposure to one player inside Sportfolio's economy.

**Stacked Share**
A non-tradeable share with a multiplier above 1×. Created by stacking raw shares. Used in boost slots and game-performance payouts.

**Premium Share**
A separate asset type tied to premium-access flows. Not the same as a player share — used to redeem premium access windows.

**Community Share**
An asset consumed when creating a community boost.

---

## Market Terms

**AMM (Automated Market Maker)**
Sportfolio's trading model. Users trade against pooled liquidity instead of waiting for matching orders from other users.

**Player Pool**
The AMM pool for one player — contains player-share reserve and SB reserve.

**Constant-Product Formula**
`x × y = k` — the pricing model. As shares are bought (x decreases), price rises. As shares are sold (x increases), price falls.

**Slippage**
The gap between the displayed spot price and your actual average execution price caused by your order moving the pool.

**TVL (Total Value Locked)**
How much value sits in a pool. Higher TVL = deeper liquidity = less slippage.

**Market Cap**
A relative sizing metric used in analytics and listings. Not a promise of liquidity.

**Volume**
Recent trading activity on a player's pool. A signal of how active the market has been.

**Buy Pressure / Sentiment**
A directional flow signal derived from recent trading behavior.

**Value Index**
A relative-value metric used to compare players beyond raw price.

---

## Liquidity Terms

**LP (Liquidity Provider)**
A user who contributes assets to an AMM pool, earning trading fees in return.

**LP Shares**
The ownership units representing your stake in a pool after adding liquidity.

**Zap**
A single-sided liquidity add. Lets you contribute from one asset type instead of manually preparing both sides.

**Pool Fee**
1% of each trade, distributed to LP holders.

**Burn Fee**
1% of each trade, permanently removed from supply.

---

## Scout Terms

**Scout**
An assignable unit that earns player shares over time on a per-hour basis.

**Scout-Minutes**
The time-weighted basis for hourly scout distribution. More of the hour assigned = larger share of the reward.

**Shares Mined**
The practical label for shares earned through the scout system over time.

---

## Multiplier and Boost Terms

**Multiplier**
The strength value carried by a share. Raw shares: 1×. Stacked shares: 2× or higher.

**Effective Shares**
The economic weight a position contributes to value and payout math. `quantity × multiplier`.

**Stack Shares**
The conversion flow that burns unlocked raw shares to create a stacked share with a higher multiplier.

**Daily Boost**
A one-share, slot-based mechanic that burns one eligible share at game lock and settles a payout after the player's game completes.

**Boost Slot Tier**
The base multiplier for a daily boost slot. Current tiers: 5×, 4×, 3×, 2×.

**Effective Multiplier**
The total multiplier applied to a boost payout. `slotTier + communityBoostCount`.

**Community Boost**
A player-and-day-specific boost created by spending one community share. Each one adds +1 to the effective multiplier for matching daily boosts on that player and date.

**Lock**
A temporary state marking shares as reserved. Locked shares can't be spent in another flow until the lock clears.

---

## Agent Terms

**Thread**
A persisted conversation for the agent. Keeps continuity and staged-plan context across messages.

**Confirm**
The explicit user action that applies a staged agent plan.

**Cancel**
The explicit user action that discards a staged plan without applying it.

**Staged Action**
An action plan prepared by the agent, shown for review before any state changes are made.

**Strategy**
A saved mandate that lets the agent operate on a recurring schedule within defined guardrails.

---

## Data and Operations

**Digest**
A personalized news summary for authenticated users, based on holdings and watchlists.

**Watchlist**
A custom named list of players you're tracking without necessarily owning.

**WebSocket Event**
A real-time server push that keeps pages live without manual refresh.

**Continuity Brief**
A server-owned runtime summary delivered to the agent each turn — covers prior actions, pending work, active strategies, and recent evidence.

---

## One-Line Summary

> Sportfolio is a multi-sport player-share market where you accumulate inventory, refine it into multiplier strength, deploy it into slate-based mechanics, and manage the whole loop through live market, analytics, and agent surfaces.
