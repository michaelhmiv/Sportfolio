---
id: gameplay-scouts-rewards
title: Scouts and Share Rewards
summary: How scouts work, how hourly share distribution is calculated, and how to use them as a steady accumulation engine.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: client/src/components/scout-widget.tsx,client/src/components/scout-dashboard-modal.tsx,server/routes.ts,server/jobs/scout-distribution.ts,shared/schema.ts
slug: scouts-and-rewards
surface: web,cli,agent
searchKeywords: scouts,share rewards,free shares,scout minutes,hourly distribution
---

# What scouts are

Scouts are assignable units that earn player shares over time. They are the main passive accumulation loop in the live Sportfolio product.

You are not placing a one-time vote. You are allocating a time-based resource.

## Capacity by account type

Scout capacity is tied to account tier:

- standard users can assign up to `5` scouts
- premium users can assign up to `10` scouts

That means premium expands accumulation bandwidth, but the underlying distribution logic stays the same.

## How rewards are calculated

Scout distributions run hourly.

The critical concept is **scout-minutes**.

The system rewards time-weighted participation, not simply whether you assigned a scout at some point.

The core payout formula is:

`sharesEarned = floor((60 * userScoutMinutes / globalScoutMinutes) * 100) / 100`

In plain English:

- the more of the hour your scouts spend on a player, the larger your claim
- your share of the reward depends on your portion of all scout-minutes on that player
- rewards are rounded down to two decimals

## Why time weighting matters

The system records scout history. That means changing scouts is not just a toggle in the current moment. It affects the time-weighted record that feeds the next distribution.

If you move late:

- you may have less effective time on the new player than you think
- you may have already surrendered a large share of the hour on the old player

Scouts reward persistence and timing, not only conviction.

## Inactivity cleanup

Active scout assignments are not permanent if the account goes idle for too long.

The system can clear active assignments for users inactive for more than 24 hours. That keeps abandoned allocations from permanently farming shares without user participation.

## What a strong scout setup looks like

Strong scout usage is usually:

- focused on a few conviction names
- reviewed when news or slates change
- aligned with your broader market plan
- concentrated enough that the resulting rewards are meaningful

The most common weak setup is spraying scouts across too many players and learning nothing from the outcome.

## How scouts fit into the bigger economy

Scouts do not directly mint cash. They mint player-share inventory.

That inventory can then become:

- a hold
- a future sale
- material for stack shares
- inventory for a daily boost

So scouts are best understood as the upstream supply engine for the rest of your account.

## Practical habits

- Revisit scouts when your convictions change, not just when you are bored.
- Concentrate on names where you actually want more inventory.
- Do not forget the hourly cadence. Last-minute changes can materially alter results.
- Use scouts to build positions gradually instead of chasing every trade through the AMM.

## What scouts are not

Scouts are not:

- guaranteed profit
- instant cash
- a replacement for active trading

They are a slow, compounding inventory tool. The users who treat them that way usually get more value out of them.
