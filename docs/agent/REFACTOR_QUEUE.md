# REFACTOR_QUEUE

Last reviewed: 2026-06-01

Purpose: define an incremental, conservative sequence for reducing large-file friction without changing gameplay economics, auth behavior, schema semantics, payments, or deployment behavior.

## Scope Rules

- Keep each PR scoped to one vertical slice.
- Preserve existing route contracts, auth middleware, and shared types unless explicitly documented as internal and unused.
- Do not refactor AMM/LP math, boost settlement math, scout distribution math, lock semantics, or power semantics without characterization tests in place first.
- Prefer extraction of pure helpers and route-group registration functions over behavior edits.

## Current High-Friction Files

| File                                 | Approx lines | Risk        | Primary reason                                       |
| ------------------------------------ | -----------: | ----------- | ---------------------------------------------------- |
| `server/routes.ts`                   |       ~10.8k | high        | Mixed API ownership and auth/economy/admin surfaces  |
| `server/storage.ts`                  |        ~7.1k | high        | Many write paths for balances/holdings/locks/payouts |
| `server/agent/operations-planner.ts` |        ~6.1k | medium-high | Parser + planner logic with staged-action contracts  |
| `shared/schema.ts`                   |        ~3.7k | very high   | Canonical Drizzle schema/types and insert contracts  |
| `server/amm/pool.ts`                 |        ~2.3k | critical    | AMM/LP invariants and fee math                       |

## Recommended Next PRs (Safest to Riskiest)

1. `server/routes.ts` extraction of non-economic route groups
   - Target: move stable utility/public routes (for example SEO/docs/static-like endpoints) into `server/routes/*` modules.
   - Keep `registerRoutes(app)` as canonical composition shell.
   - Do not alter middleware/auth assignments or route paths.
   - Validation: `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`.

2. `server/agent/operations-planner.ts` pure helper extraction
   - Target: extract parser/normalizer helpers that have no side effects.
   - Keep planner I/O contract unchanged.
   - Expand/lock characterization tests in `server/agent/operations-planner.test.ts` before moving logic.
   - Validation: baseline commands plus targeted planner tests.

3. `server/storage.ts` read-first modularization
   - Target: move cohesive read/query helpers first; defer write-path motion until explicit call-site coverage exists.
   - Do not alter transaction boundaries, lock checks, or balance/holding mutations.
   - Validation: baseline commands plus any affected storage tests.

4. `shared/schema.ts` split feasibility study (documentation/test prep only)
   - Target: inventory import graph and migration/runtime coupling before any split.
   - Do not perform structural split until Drizzle import order and migration tooling behavior are characterized.
   - Validation: `npm run check`, `npm run lint`, `npm run test:run`, and schema-related smoke checks.

5. `server/amm/pool.ts` characterization-first hardening
   - Target: broaden pool characterization tests (buy/sell/liquidity/zap/fee accounting edge paths).
   - Defer any math refactor until tests capture current behavior.
   - Validation: baseline commands plus focused AMM/LP test matrix and `npm run invariants:check`.

## Stop Conditions (Do Not Proceed Without User Signoff)

- Any change that modifies payout amounts, pricing curves, fees, lock behavior, or boost/scout settlement semantics.
- Any change that modifies auth gates on existing endpoints.
- Any change that modifies deployment flow assumptions (GitHub -> Railway).
- Any schema move that risks migration or runtime drift.

## Working Contract

When executing items in this queue, update:

- `docs/agent/CONTEXT_INDEX.md`
- `docs/agent/REPO_MAP.md`
- `docs/agent/CONTEXT_BUDGET.md`
- `docs/agent/REFACTOR_QUEUE.md`

If the module boundary, ownership map, validation expectations, or risk profile changes, document it in the same PR.
