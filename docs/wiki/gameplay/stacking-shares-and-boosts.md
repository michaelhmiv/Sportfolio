---
id: gameplay-stacking-shares-boosts
title: Stacking Shares and Boosts
summary: A full explanation of stacking shares, multipliers, boost slots, community boosts, and the exact inventory rules behind them.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: client/src/pages/boosts.tsx,server/routes.ts,server/jobs/lock-boost-shares.ts,server/jobs/settle-boosts.ts,server/jobs/settle-community-boosts.ts,server/storage.ts,shared/schema.ts
slug: stacking-shares-and-boosts
surface: web,cli,agent
searchKeywords: stack shares,stacked shares,multiplier,boosts,daily boosts,community boosts
---

# Why Multipliers Matter

Stacking Shares is the quality layer on top of a player share.

Two users can each own one share of the same player and still have very different boost value if one of those shares carries a higher multiplier.

In Sportfolio terms:

- **stacked share** = the single non-tradeable share created by stacking
- **multiplier** = the earning and boost strength of that stacked share
- **effective shares** = the economic weight counted for value and payout math

For a one-share boost slot, the stacked share's multiplier is what matters most.

## Stack Shares: converting quantity into quality

Stack Shares turns regular shares into one stacked share with a multiplier.

Current rules:

- minimum `4` regular shares
- even counts only
- `N` regular shares become `1` stacked share at `N/2` multiplier

Example:

- `10` regular shares -> `1` stacked share at `5x`
- portfolio value and payout weight now count that position as `5` effective shares
- the other `5` effective shares are burned as the cost of stacking

Stacking is a tradeoff, not a bonus button. You sacrifice share count to keep fewer, stronger units.

## The daily boost slots

Each day, the boost system gives you four slot tiers:

- `5x`
- `4x`
- `3x`
- `2x`

Each slot takes exactly one share.

That rule is important. You are choosing the single most valuable share to burn in each slot, not combining multiple shares inside the slot itself.

## Eligibility rules

A share is only boost-eligible if it is actually available.

That means:

- the share is in your holdings
- it is not locked somewhere else
- the player has a relevant game window
- the slot has not already been filled by another share

When both regular and stacked inventory exist for the same player, the system prefers the highest-multiplier eligible share.

## Lock and burn lifecycle

Boosts have a real lifecycle:

1. You assign a share to a slot before lock.
2. At game start, the boost transitions to locked.
3. The assigned share is burned.
4. After the game completes and stats are available, the boost settles.

The burn happens at lock, not after you see the result. That is why boost assignment is a real commitment.

## How payout is calculated

The core payout logic is:

`payout = max(0, multiplier * fantasyPoints * effectiveMultiplier)`

Where:

- `multiplier` is the stored value of the single burned share
- `fantasyPoints` comes from the player's real-game output
- `effectiveMultiplier = slotTier + communityBoostCount`

The `max(0, ...)` floor matters. Bad or empty fantasy output cannot create a negative payout.

## Community boosts

Community boosts change the multiplier environment for a player on a given day.

To create one:

- you spend one community share
- the boost is recorded for that specific player and day

Each community boost adds `+1` to the multiplier for matching daily boosts on that player and date.

Important constraint:

- only one active community boost can exist per player per day

Community boosts do not replace your own daily boost. They increase the value of using that player in your own plan.

## Cross-sport behavior

The boosts surface is multi-sport, but the exact mix of eligible players depends on the slate and the page controls.

In practice:

- daily boosts aggregate across supported sports
- the main community-boost picker is centered on the primary ball-sport surfaces
- settlement still follows each player's actual game lifecycle

## The biggest strategic tradeoffs

Every boost decision asks the same question:

"Is burning this exact share in this exact slot better than holding or selling it?"

The answer depends on:

- the player's expected fantasy output
- the multiplier of the share you would burn
- whether a community boost is active
- the opportunity cost of losing that inventory
- whether another player fits that slot better

## Common mistakes

- burning a top-stacked share without noticing a better slot target
- stacking too aggressively and ending up with too little flexible inventory
- forgetting that locked shares are no longer reusable
- treating community boosts as free value instead of as inventory-consuming commitments

## The right mental model

Think of stacking as refined inventory.

Trading and scouting help you accumulate.
Stack Shares upgrades the quality of what you accumulated.
Daily boosts are where you deliberately spend that quality for a game-window payout.
