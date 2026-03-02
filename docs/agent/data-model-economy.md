# Data Model & Economy Reference

Primary source: `shared/schema.ts`.

Use this when changing share supply, balances, boost settlement, or portfolio accounting.

## Core Entity Groups

## Identity & User State

- `users`
  - balance (`users.balance`)
  - premium flags (`isPremium`, `premiumExpiresAt`)
  - profile counters (`totalSharesVested`, `totalMarketOrders`, `totalTradesExecuted`)
- `sessions`

## Assets, Holdings, and Locks

- `players`
  - player metadata, price/volume/market cap, sport
- `holdings`
  - per-user asset quantity and basis
  - `assetType`: `player`, `premium`, `community` (used by feature flows)
  - `power` + `powerLevel` for boosted-power semantics
- `holdings_locks`
  - reserved shares for in-flight mechanics
- `balance_locks`
  - reserved cash for in-flight operations

## Trading & Liquidity

- `trades` (execution history)
- `player_pools` (AMM state)
- `lp_positions` (user LP ownership)
- `lp_transactions` (LP add/remove audit)

## Legacy Vesting (Retired) & Scouting

- `vesting`
- `vesting_splits`
- `vesting_claims`
- `vesting_presets`
- `scout_assignments`
- `scout_history`
- `scout_distributions`

The `vesting*` tables remain in the schema for legacy compatibility, but vesting is retired and out of the active product and current agent scope.

## Legacy Contests (Archived)

- `contests`
- `contest_entries`
- `contest_lineups`

These remain in the schema as legacy archived data and are out of the active product and agent scope.

## Boosts & Premium/Community Economy

- `daily_boosts`
- `boost_payouts`
- `community_boosts`
- `premium_checkout_sessions`
- `community_checkout_sessions`
- `whop_payments`

## Market/Observability Support

- `market_snapshots`
- `price_history`
- `job_execution_logs`

## Economy Mutation Matrix

| Event                  | Balance                              | Holdings                          | Pools                                     | Ledgers                        |
| ---------------------- | ------------------------------------ | --------------------------------- | ----------------------------------------- | ------------------------------ |
| AMM buy                | user balance decreases               | user player shares increase       | pool shares/playMoney change, fees accrue | trade + pool metrics           |
| AMM sell               | user balance increases (net of fees) | user player shares decrease       | pool shares/playMoney change, fees accrue | trade + pool metrics           |
| LP add                 | user balance/shares decrease         | user LP position increases        | pool reserves increase                    | `lp_transactions`              |
| LP remove              | user receives shares + balance value | user LP position decreases        | pool reserves decrease                    | `lp_transactions`              |
| Scout distribution     | no direct cash mint                  | player holdings increase          | no direct pool mutation                   | `scout_distributions`          |
| Daily boost lock       | none                                 | one selected share burned on lock | none                                      | daily boost status             |
| Daily boost settle     | user balance increases by payout     | none                              | none                                      | `boost_payouts` + boost status |
| Community boost create | community share consumed             | community holding decreases       | none                                      | community boost row            |

## Economic Invariants

1. **No double-spend of shares/cash**
   - respect lock tables and available-share checks.
2. **Cost basis integrity**
   - when updating holdings quantity, maintain consistent avg/total basis.
3. **Power consistency**
   - `powerLevel` must remain aligned with quantity/power semantics.
4. **Status-gated settlement**
   - boosts settle only after completion conditions are met.
5. **Idempotent settlement paths**
   - repeated job execution must not double credit users.

## High-Risk Fields (Handle with Care)

- `users.balance`
- `holdings.quantity`
- `holdings.powerLevel`
- `player_pools.shares`
- `player_pools.playMoney`
- `daily_boosts.status`
- `community_boosts.status`

## WebSocket Event Model

Reference: `server/websocket.ts`

Key event types used by economic/gameplay flows:

- `portfolio`, `trade`, `scout_payout`, `boost_settled`, `COMMUNITY_BOOST_SETTLED`, `whale_alert`.

Event emissions are used for UX freshness; they do not replace DB source-of-truth.

## Agent Checklist for Schema/Economy Changes

Before changing schema or economic logic:

1. Trace all writers for affected fields in `server/routes.ts`, `server/storage.ts`, and `server/jobs/*`.
2. Confirm lock semantics are still valid.
3. Confirm activity/ledger rows still reconcile with primary state.
4. Run validation commands from `docs/agent/runbooks.md`.
