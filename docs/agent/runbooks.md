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

## Runbook B: Boost Eligibility / Payout Changes

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

## Runbook C: Legacy Vesting Maintenance (Retired)

Vesting is retired and out of the active product and agent surface. These notes apply only if legacy vesting code must be touched for compatibility maintenance.

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

## Runbook D: Auth / Access Boundary Changes

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
| Legacy vesting  | accrual utility behavior, cap behavior, claim/redeem state updates       |
| Auth changes    | route protection audit + negative-path auth checks                       |

## Manual Smoke Scenarios (Recommended)

1. Buy/sell one player, verify portfolio and pool updates.
2. Assign scouts, trigger/await distribution window, verify new shares.
3. Create daily boost before game, verify lock + settle lifecycle.
4. If legacy vesting code was touched, verify claim/redeem state updates in a maintenance-only test path.

## Runbook E: Hermes Runtime / Agent Schedule Changes

Primary files:

- `server/agent/hermes-client.ts`
- `server/agent/hermes-orchestrator.ts`
- `server/hermes-sidecar.ts`
- `server/agent/hermes-tools.ts`
- `server/agent/memory.ts`
- `server/agent/schedules.ts`
- `server/jobs/scheduler.ts`

Checklist:

1. Keep Hermes as the primary orchestrator and PI as fallback-only.
2. Keep all risky portfolio mutations confirmation-gated.
3. Preserve strict per-user memory isolation and do not widen scope across users or channels.
4. Keep scheduled Hermes jobs advisory-only unless a separate explicit auto-execution policy is introduced.
5. Re-run the full validation stack after changing request/response contracts, tool names, or schedule defaults.

Must-verify behaviors:

- A normal `/agent` message resolves through Hermes without requiring the PI fallback path.
- External Hermes failures degrade to the in-process Hermes engine, then only to PI compatibility if needed.
- Scheduled advisory runs write assistant messages only and never auto-confirm or auto-apply economic actions.

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
