# REFACTOR_QUEUE

Last reviewed: 2026-07-12

Purpose: define a conservative, evidence-backed sequence for reducing structural friction without changing gameplay economics, API/auth contracts, schema semantics, payments, scheduled operations, or deployment behavior. Detailed measurements and rationale live in `docs/refactor/JULY_2026_AUDIT.md`.

## Scope Rules

- Keep each PR scoped to one vertical slice.
- Preserve routes, response shapes, auth middleware, shared wire contracts, cron schedules, manual-trigger behavior, and persistence semantics unless a separately approved change explicitly says otherwise.
- Characterize current behavior before moving high-risk or compatibility-sensitive logic.
- Prefer leaf contracts, pure helpers, explicit registries, and route composition over broad rewrites.
- Do not combine scheduler, game-data, route/storage, AMM, or large frontend decomposition work in one PR.

## Active Foundation — Typed Job Registry

Branch: `refactor/job-registry-foundation`

- [x] Capture repository checks, tests, coverage, duplication, build output, and known tool failures before changes.
- [x] Audit the three scheduler inventories and record compatibility asymmetries.
- [x] Add characterization coverage for 33 scheduled jobs, 34 executable manual jobs, 34 advertised names, ordering, anomalies, and lifecycle behavior.
- [x] Move `JobResult` ownership to the leaf `server/jobs/types.ts` contract.
- [x] Define names, schedules, enabled flags, handlers, adapters, progress behavior, and admin visibility once in `server/jobs/job-registry.ts`.
- [x] Keep `server/jobs/scheduler.ts` focused on registration, lifecycle, overlap protection, execution logging, and startup warm-up.
- [ ] Complete post-change metrics, full validation, and independent parity/quality/security/integration review.

Compatibility behavior intentionally retained in this foundation:

- `backfill_market_snapshots` remains advertised but not executable.
- `nascar_active_roster_sync` remains scheduled and executable but unadvertised.
- `mlb_stats_sync` remains executable/advertised but unscheduled.
- Existing cron expressions, registration order, timezone, enabled flags, manual result adapters, and unknown-job error text remain unchanged.

Fixing those asymmetries is a separate behavior/product decision, not registry cleanup.

## Recommended Next PRs

### 1. Canonical game-data contracts and query keys

- Define shared MLB/NHL/NASCAR wire contracts and fixtures without exposing database row types.
- Introduce one query-key factory and fetch adapter for live/game stats.
- Preserve response payloads and the post-NHL fixes from PRs #251 and #252.
- Add regression coverage for status transitions, especially NHL postgame rendering.

### 2. Validation-tool hygiene

- Replace the obsolete `power` invariant with current stacked-share/multiplier assertions.
- Reconcile `/api/holdings/condense` with the OpenAPI contract.
- Exclude generated reports from duplication scans.
- Make Knip entry discovery independent of a live database URL before treating its output as deletion evidence.
- Keep these tooling repairs behavior-neutral and independently reviewable.

### 3. Game Command Center decomposition

- Establish shared transport/query contracts first.
- Extract pure derived-data selectors, then domain hooks, then bounded panels.
- Preserve the product hierarchy: score/state, earnings/exposure, lineups, injuries.
- Keep secondary scoring plays collapsed by default and visually verify desktop/mobile behavior.

### 4. Route composition by bounded domain

- Continue the existing router-factory pattern one low-coupling domain at a time.
- Pass dependencies explicitly and preserve middleware order, auth assignment, route paths, and response shapes.
- Do not start with holdings, AMM, payment, or settlement routes.

### 5. Operations Planner pure-helper extraction

- Lock parser messages and plan I/O with characterization tests.
- Extract side-effect-free normalization/parser helpers first.
- Preserve prompts, policy, staging, storage/tool execution, and user-visible responses.

### 6. Storage read-path modularization

- Add query-count and latency evidence before optimizing suspected repeated lookups.
- Extract cohesive read modules behind the existing `IStorage` facade.
- Defer write-path movement until transaction, locking, and balance/holding semantics have explicit coverage.

### 7. AMM characterization harness

- Add golden coverage for quote/execution, fees, precision, slippage, reserve constraints, liquidity, rollback, and empty-pool behavior.
- Do not alter formulas, transaction boundaries, or schema during characterization.
- Extract pure math from persistence only after generated results and tolerated numeric error are explicit.

### 8. Schema split feasibility study

- Generate an import/relation graph and test Drizzle migration/runtime initialization in a spike.
- Keep stable barrel exports and require identical generated SQL/schema snapshots.
- Do not perform a structural split until import order and migration tooling are proven safe.

## High-Friction Surfaces

| File                                                  | Risk        | Treatment                                                               |
| ----------------------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| `server/routes.ts`                                    | high        | Extract bounded route groups with auth/response characterization        |
| `server/storage.ts`                                   | high        | Read-first modules; preserve transaction and write semantics            |
| `server/agent/operations-planner.ts`                  | medium-high | Extract pure parser/normalizer seams under existing tests               |
| `client/src/components/game-command-center-modal.tsx` | medium-high | Contracts/query keys first; incremental hooks/panels with visual checks |
| `shared/schema.ts`                                    | very high   | Research and generated-artifact proof before structural movement        |
| `server/amm/pool.ts`                                  | critical    | Characterization first; no economics change in an extraction PR         |

## Stop Conditions — Require User Signoff

- Any change to payout amounts, pricing curves, fees, locks, stacking multipliers, boost/scout settlement, or transaction boundaries.
- Any change to auth gates, middleware order, existing routes, or response payloads.
- Any scheduler change to cadence, enabled state, timezone, startup behavior, overlap policy, trigger visibility, or execution semantics.
- Any deployment-flow, schema/migration, payment, or provider-policy change.
- Any attempt to treat historical status reports or unchecked legacy task entries as current requirements without verifying live code and product intent.

## Working Contract

When a module boundary, ownership map, validation expectation, or risk profile changes, update these in the same PR:

- `docs/agent/CONTEXT_INDEX.md`
- `docs/agent/REPO_MAP.md`
- `docs/agent/CONTEXT_BUDGET.md`
- `docs/agent/REFACTOR_QUEUE.md`

Use `docs/archive/*` only for provenance. Active implementation guidance belongs in `docs/agent/*`, `docs/wiki/agent/*`, source tests, and current audit/ADR documents.
