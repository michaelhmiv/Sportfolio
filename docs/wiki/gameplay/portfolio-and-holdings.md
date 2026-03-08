---
id: gameplay-portfolio-holdings
title: Portfolio and Holdings
summary: How to read your account, understand holdings rows, track LP positions, and interpret what can and cannot be spent.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: client/src/pages/portfolio.tsx,server/routes.ts,server/storage.ts,shared/schema.ts
slug: portfolio-and-holdings
surface: web,agent
searchKeywords: portfolio,holdings,balance,lp,locks,premium,community shares
---

# What your portfolio actually contains

Your portfolio is not just a list of player positions. It is the full state of your account's economy.

The main pieces are:

- **cash balance**: liquid SB you can spend
- **player holdings**: tradeable player shares
- **stacked shares**: non-tradeable player-share inventory with higher multiplier strength
- **LP positions**: ownership in AMM pools
- **premium shares**: redeemable premium inventory
- **community shares**: inventory that can be consumed for community boosts
- **activity history**: the audit trail of how your state changed

## Why one player can appear more than once

Sportfolio can store separate regular-share inventory and stacked-share multiplier state for the same player.

That is intentional. A single player may appear as:

- a regular holding row with `1x` multiplier
- one stacked-share multiplier state with multiplier above `1x`

This matters because boost and stack shares flows need to know which exact inventory is being consumed.

## Multiplier inside holdings

Two terms show up repeatedly:

- **multiplier**: the strength of a single stacked share
- **effective shares**: the economic share count a position contributes to value and holder payouts

Example:

- `quantity = 5`, `multiplier = 1x` means five normal shares and `5` effective shares
- `quantity = 1`, `multiplier = 4x` means one stacked share and `4` effective shares

Multiplier strength affects boost payouts directly, so the quality of a row can matter more than raw share count.

## Available versus locked inventory

Not every share shown in your portfolio is always spendable.

The practical availability rule is:

`available shares = quantity - lockedQuantity`

Shares can be unavailable because they are reserved for an in-flight mechanic such as:

- a pending or active boost
- another protected flow that uses holding locks

Good rule: if a share is locked, do not mentally count it twice.

## What the holdings tab is for

The holdings side of the Portfolio page is where you assess:

- cash balance
- portfolio value
- net worth
- realized and unrealized P&L
- the size and quality of each position
- how concentrated you are by player and sport

This is the right view when your question is, "What do I own and how well is it working?"

## What the liquidity tab is for

The liquidity side tracks LP positions rather than direct shares.

It is where you review:

- pool ownership percentage
- current position value
- fees earned to date
- which player pools are consuming your capital

If the holdings tab measures directional bets, the liquidity tab measures market-making exposure.

## Premium and community inventory

Portfolio also surfaces non-player assets:

- **premium shares** are used to activate premium access windows
- **community shares** are spent when you create community boosts

These asset types matter because they compete with other uses of your balance and attention, even though they are not normal player trades.

## Activity feed

Your activity feed is the account timeline. It helps you reconstruct what happened.

Common categories include:

- **market**: buys, sells, and other market actions
- **scout**: hourly share rewards and scout-related changes
- **boosts**: boost-related burns, locks, and payout outcomes

Use the feed when a balance or holding changed and you want to know why.

## Stack Shares from the portfolio perspective

Stack Shares is easier to understand when you think about it as an inventory rewrite:

- it debits unlocked regular shares
- it increases the multiplier strength of retained inventory
- it lowers raw count and raises per-share quality

You are not "creating free value." You are converting quantity into higher-impact inventory.

## Cost basis and accounting

Sportfolio tracks basis and row-level accounting so that P&L and holdings stay coherent after:

- trades
- scout distributions
- stack shares operations
- LP mutations
- boost burns and settlements

That is why you should prefer official flows over mental shortcuts. The system is maintaining more accounting state than a simple share counter.

## What can change your portfolio

Your portfolio can move because of:

- AMM buys and sells
- LP adds and removals
- scout distributions
- daily boost burns and payouts
- community boost creation
- premium share redemption

That is why the portfolio is the best place to judge the combined effect of all Sportfolio systems, not just trading.
