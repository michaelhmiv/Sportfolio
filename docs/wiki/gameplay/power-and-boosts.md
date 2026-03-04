---
id: gameplay-power-boosts
title: Power and Boosts
summary: A full explanation of condense, power, boost slots, community boosts, and the exact inventory rules behind them.
audience: public
category: gameplay
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: client/src/pages/power.tsx,server/routes.ts,server/jobs/lock-boost-shares.ts,server/jobs/settle-boosts.ts,server/jobs/settle-community-boosts.ts,server/storage.ts,shared/schema.ts
slug: power-and-boosts
surface: web,cli,agent
searchKeywords: power,boosts,condense,daily boosts,community boosts,power level
---

# Why power matters

Power is the quality layer on top of a player share.

Two users can each own one share of the same player and still have very different boost value if one of those shares has more power.

In Sportfolio terms:

- **power** = the strength of a single share
- **powerLevel** = the effective strength used in payout math

For a one-share boost slot, the per-share power is what matters most.

## Condense: converting quantity into quality

Condense is the mechanic that turns regular shares into more powerful inventory.

Current rules:

- `sharesToCondense` must be at least `2`
- `sharesToCondense` must be divisible by `2`
- every `2` raw shares convert into `+1` power gained

The storage flow does three things:

- debits unlocked regular shares with `power = 1`
- creates or updates the powered row
- keeps `powerLevel` aligned with `quantity * power`

Condense is a tradeoff, not a bonus button. You sacrifice count to increase the impact of the shares you keep.

## The daily boost slots

Each day, the boost system gives you four slot tiers:

- `5x`
- `4x`
- `3x`
- `2x`

Each slot takes exactly one share.

That rule is important. You are choosing the single most valuable share to burn in each slot, not stacking multiple shares into one multiplier.

## Eligibility rules

A share is only boost-eligible if it is actually available.

That means:

- the share is in your holdings
- it is not locked somewhere else
- the player has a relevant game window
- the slot has not already been filled by another share

When multiple holding rows exist for the same player, the system prefers an eligible row that best fits the single-share mechanic, often favoring the highest-powered eligible share.

## Lock and burn lifecycle

Boosts have a real lifecycle:

1. You assign a share to a slot before lock.
2. At game start, the boost transitions to locked.
3. The assigned share is burned.
4. After the game completes and stats are available, the boost settles.

The burn happens at lock, not after you see the result. That is why boost assignment is a real commitment.

## How payout is calculated

The core payout logic is:

`payout = max(0, powerLevel * fantasyPoints * effectiveMultiplier)`

Where:

- `powerLevel` is the stored value of the single burned share
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

The power surface is multi-sport, but the exact mix of eligible players depends on the slate and the page controls.

In practice:

- daily boosts aggregate across supported sports
- the main community-boost picker is centered on the primary ball-sport surfaces
- settlement still follows each player's actual game lifecycle

## The biggest strategic tradeoffs

Every boost decision asks the same question:

"Is burning this exact share in this exact slot better than holding or selling it?"

The answer depends on:

- the player's expected fantasy output
- the power of the share you would burn
- whether a community boost is active
- the opportunity cost of losing that inventory
- whether another player fits that slot better

## Common mistakes

- burning a top-powered share without noticing a better slot target
- condensing too aggressively and ending up with too little flexible inventory
- forgetting that locked shares are no longer reusable
- treating community boosts as free value instead of as inventory-consuming commitments

## The right mental model

Think of power as refined inventory.

Trading and scouting help you accumulate.
Condense upgrades the quality of what you accumulated.
Daily boosts are where you deliberately spend that quality for a game-window payout.
