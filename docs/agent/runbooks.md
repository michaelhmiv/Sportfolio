# Agent Runbooks (Safe Change Procedures)

Use this file for any change that affects formulas, balances, share supply, payouts, or job timing.

## Global Pre-Flight (All Non-Trivial Changes)

1. Read:
   - `docs/agent/product-mechanics.md`
   - `docs/agent/data-model-economy.md`
2. Identify impacted writers in:
   - `server/routes.ts`
   - `server/storage.ts`
   - `server/jobs/*`
3. Validate locally:
   - `npm run check`
   - `npm run lint`
   - `npm run test:run`
   - `npm run format:check`

If any validation fails, do not mark task complete until failures are explained/fixed.

## Runbook A: AMM Math / Fee / Slippage Changes

Primary files:

- `server/amm/pool.ts`
- `server/routes/amm.ts`
- `server/routes/lp.ts`

Checklist:

1. Preserve constant-product invariants and fee accounting paths.
2. Ensure buy/sell quote paths match execution math.
3. Re-check LP fee growth and position snapshots.
4. Confirm route validation still prevents invalid amounts/slippage.

Must-verify behaviors:

- Quote output directionality (`buy` increases price, `sell` decreases price).
- Buy and sell fees reconcile with pool and burn fee fields.
- LP add/remove and zap paths still produce valid ownership and outputs.

## Runbook B: Legacy Contest Code (Archived)

Contest code still exists in the repo, but contests are archived and not part of the active product or agent capability surface.

Do not expand contest behavior for the agent. If legacy contest code must be touched for maintenance, treat it as archival compatibility work only.

## Runbook C: Boost Eligibility / Payout Changes

Primary files:

- `server/routes.ts` (`/api/daily-boosts*`, `/api/community-boosts*`)
- `server/jobs/lock-boost-shares.ts`
- `server/jobs/settle-boosts.ts`
- `server/jobs/settle-community-boosts.ts`
- `server/storage.ts` (`lockBoostShares`, related methods)

Checklist:

1. Preserve one-share-per-slot rule unless explicitly changing product design.
2. Preserve lock-at-game-start lifecycle transition.
3. Preserve payout flooring at zero.
4. Keep community boost multiplier interaction (`slotTier + communityBoostCount`).

Must-verify behaviors:

- Cannot assign boost after game start.
- Locked boost burns exactly one share from correct holding row.
- Settlement waits for completed game + available stats.

## Runbook D: Vesting Accrual / Redeem Logic Changes

Primary files:

- `shared/vesting-utils.ts`
- `server/routes.ts` (`/api/vesting*`)
- `shared/schema.ts` (`vesting*` tables)

Checklist:

1. Preserve residual-millisecond accrual behavior.
2. Preserve cap rules (standard vs premium).
3. Preserve claim/redeem baseline resets to prevent phantom accrual.
4. Keep split distribution deterministic for remainders.

Must-verify behaviors:

- Accrual with no elapsed time does not mutate unexpectedly.
- Partial redeem updates remaining shares correctly.
- Claim/redeem emits expected portfolio/vesting websocket updates.

## Runbook E: Auth / Access Boundary Changes

Primary files:

- `server/supabaseAuth.ts`
- `server/routes.ts` (middleware assignment + `adminAuth`)

Checklist:

1. Keep protected financial/economic routes behind `isAuthenticated` or `adminAuth`.
2. Ensure optionalAuth routes do not leak privileged data.
3. Preserve dev bypass behavior only for development context.
4. Never log raw tokens/secrets.

## Validation Matrix by Change Type

| Change Type     | Required Checks                                                          |
| --------------- | ------------------------------------------------------------------------ |
| AMM/LP math     | unit tests touching pool math, quote-vs-execution sanity, lint/typecheck |
| Boost mechanics | assignment constraints, lock job behavior, payout formula reconciliation |
| Vesting logic   | accrual utility behavior, cap behavior, claim/redeem state updates       |
| Auth changes    | route protection audit + negative-path auth checks                       |

## Manual Smoke Scenarios (Recommended)

1. Buy/sell one player, verify portfolio and pool updates.
2. Assign scouts, trigger/await distribution window, verify new shares.
3. Create daily boost before game, verify lock + settle lifecycle.
4. Claim/redeem vesting shares and verify holdings + vesting reset behavior.

## Documentation Sync Rule

If you change any of these, update docs in the same PR:

- API route paths/contracts,
- formulas or payout rules,
- schema fields used by core loops,
- job schedules affecting game lifecycle.

## Canonical Knowledge Sync Rule

When user-facing product behavior, mechanics copy, or agent guidance changes:

1. Update the canonical article in `docs/wiki/*` first.
2. If that article should inform the agent directly, keep `agent` in its `surface` metadata.
3. Do not duplicate the same explainer copy in multiple prompts or pages unless there is a rendering-only reason.

The agent now reads a compact knowledge brief from wiki articles marked with `surface: agent`, so those docs are the shared source for both the public wiki and agent-facing product guidance.
