---
id: gameplay-portfolio-holdings
title: Portfolio and Holdings
summary: How to read Singles, liquidity positions, market value, availability, and player earnings.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-08-11
slug: portfolio-and-holdings
surface: web,cli
searchKeywords: portfolio,holdings,singles,liquidity,market value,availability
---

# Portfolio and Holdings

Your player inventory is measured in **Singles**. Singles are tradeable player shares and the ownership units used for player earnings.

For each player, the portfolio shows total Singles, how many are temporarily reserved, how many remain available, cost basis, current market price when a pool is priced, market value, and unrealized gain or loss.

Reserved Singles are still yours but cannot be sold or committed elsewhere until the reservation clears. A Daily Boost reserves the chosen quantity before game lock and permanently burns that quantity when the valid game begins.

Liquidity-provider positions are shown separately because they represent proportional claims on AMM pool reserves rather than additional player shares. Their value is included in portfolio value through the canonical LP valuation path.

Player market capitalization uses the liquid share supply and AMM pool inventory under Sportfolio's canonical valuation rules.

See also [Player Earnings](/wiki/gameplay/player-earnings), [Daily Boosts](/wiki/gameplay/daily-boosts), and [Scouting and Share Supply](/wiki/gameplay/scouting-and-share-supply).
