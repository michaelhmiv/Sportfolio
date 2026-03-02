# Product Mechanics (Agent Source of Truth)

This document explains the current gameplay/economic loops as implemented in code.

## Product Goals

Sportfolio combines:

1. Instant sports-player trading (AMM pools)
2. Passive share generation (scouts)
3. Competitive outcomes (daily boosts + community boosts)

Primary user outcome: grow portfolio value and cash balance through better player/game decisions.

## Time Model

- Server job schedules run in `America/New_York`.
- Game-day boundaries use ET helpers (`getETDayBoundaries`, `getGameDay`).
- Many daily mechanics (boosts, community boosts) are date-sensitive to ET day windows.

## Core Loops

## 1) AMM Trading Loop

Source: `server/amm/pool.ts`, `server/routes/amm.ts`

- Pool formula: `x * y = k`
  - `x`: player shares in pool
  - `y`: Sportfolio Bucks in pool
- Price: `y / x`
- Fee model in AMM code:
  - `1%` pool fee (LP benefit)
  - `1%` burn fee
  - `2%` total per trade
- Buy/sell are instant against pool liquidity.
- Slippage bounds are enforced by API (`min/max/default` in AMM routes).

Critical invariants:

- Do not break `k` conservation model.
- Keep fee accounting consistent with LP fee growth and trade records.

## 2) LP (Liquidity Provider) Loop

Source: `server/amm/pool.ts`, `server/routes/lp.ts`

- Users can:
  - add liquidity,
  - remove liquidity,
  - use "optimal" add,
  - use single-sided zap paths.
- LP positions are represented by LP shares (ownership of pool).
- Fee value accrues via pool fee growth and LP snapshots.

Critical invariants:

- LP shares minted/burned must align with pool state transitions.
- Position snapshots must remain consistent after any pool update.

## 3) Scout Loop

Source: `server/routes.ts` (`/api/scouts*`), `server/jobs/scout-distribution.ts`, `shared/schema.ts`

- Capacity:
  - standard user: up to `5` scouts
  - premium user: up to `10` scouts
- Distribution runs hourly.
- Share payout is proportional to scout-minute share of global scout-minutes for a player.
- Inactivity cleanup removes active assignments for users inactive >24h.

Formula (from query logic):

- `sharesEarned = floor((60 * userScoutMinutes / globalScoutMinutes) * 100) / 100`

Critical invariants:

- Keep time-weighted history logic intact (`scout_history`).
- Avoid direct assignment mutations that skip history updates.

## 4) Legacy Vesting (Retired)

Vesting code still exists in the repo for archival compatibility, but vesting is no longer part of the active gameplay loop or current agent scope.

If legacy vesting code must be touched, treat it as maintenance only and do not reintroduce it into active user flows without an explicit product decision.

## 5) Daily Boost Loop

Source: `server/routes.ts` (`/api/daily-boosts*`), `server/jobs/lock-boost-shares.ts`, `server/jobs/settle-boosts.ts`, `server/storage.ts`

- User has 4 slot tiers per day: `5x`, `4x`, `3x`, `2x`.
- Exactly 1 share per slot (single-share mechanic).
- At game start, boost transitions to locked and that share is burned.
- Settlement runs after game completion.

Payout logic:

- `effectiveMultiplier = slotTier + communityBoostCount`
- `payout = max(0, powerLevel * fantasyPoints * effectiveMultiplier)`

Critical invariants:

- Do not allow multi-share boost entries.
- Do not settle before game completion/stats availability.

## 6) Community Boost Loop

Source: `server/routes.ts` (`/api/community-boosts*`), `server/jobs/settle-community-boosts.ts`, `shared/schema.ts`

- Creating a community boost consumes one community share.
- Community boosts amplify daily boosts by adding `+1` multiplier for matching player/day.
- Community-boost settlement finalizes lifecycle state; payout effect is applied in daily boost settlement.

Critical invariants:

- Enforce one active community boost per player/day.
- Preserve relationship between community boost count and daily boost multiplier.

## Glossary

- **SB / Balance**: virtual cash (`users.balance`)
- **Player Share**: tradeable share in a player
- **Power**: per-share multiplier strength (used heavily in boost payouts)
- **Premium Share**: redeemable for premium access window
- **Community Share**: consumable to create a community boost
- **Boost Slot Tier**: base daily multiplier slot (`2/3/4/5`)
- **Scout-Minutes**: weighted scout assignment duration basis for hourly distribution

## Agent Notes

- If mechanics in UI copy conflict with backend behavior, backend route/job code is authoritative.
- Any change to formulas, burn/credit behavior, or caps requires runbook validation in `docs/agent/runbooks.md`.
