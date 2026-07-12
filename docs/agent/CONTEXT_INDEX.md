# CONTEXT_INDEX

Last reviewed: 2026-07-12

This file is the fast-start index for coding agents. Load this layer first, then load only the vertical slice needed for the task.

## Read Order

1. `AGENTS.md`
2. `CLAUDE.md`
3. `AGENT_GUIDE.md`
4. `docs/agent/CONTEXT_BUDGET.md`
5. `docs/agent/REFACTOR_QUEUE.md` (when touching high-friction files)
6. `docs/refactor/JULY_2026_AUDIT.md` (when planning structural work)
7. `docs/wiki/agent/product-mechanics.md`
8. `docs/wiki/agent/api-map.md`
9. `docs/wiki/agent/data-model-economy.md`
10. `docs/wiki/agent/runbooks.md`
11. `package.json` scripts

## Ownership Map

- Runtime entrypoint: `server/index.ts`
- API shell and mixed domain endpoints: `server/routes.ts`
- Route modules already extracted: `server/routes/*`
- Data/service layer: `server/storage.ts` and `server/storage/*`
- Economics math core: `server/amm/pool.ts`
- Job registry and scheduler lifecycle: `server/jobs/job-registry.ts`, `server/jobs/scheduler.ts`
- Shared job result/progress contracts: `server/jobs/types.ts`, `server/lib/admin-stream.ts`
- Job implementations: remaining modules under `server/jobs/*`
- Agent/Hermes runtime: `server/agent/*`, `server/mcp/*`, `server/hermes-sidecar.ts`
- Shared DB schema and shared contracts: `shared/schema.ts` and `shared/*`
- Frontend routes and page flows: `client/src/pages/*`
- Frontend reusable UI and domain components: `client/src/components/*`, `client/src/features/*`
- Mobile/Capacitor wrapper and native projects: `mobile/*`, `capacitor.config.ts`

## High-Risk and High-Friction Files

- `server/routes.ts`
  - Risk: mixed domain ownership, many auth/economy/admin surfaces.
  - Treatment: keep behavior stable; continue extracting route groups behind the same API contract.
- `server/storage.ts`
  - Risk: many writers touching balances/holdings/locks/payouts.
  - Treatment: extract only cohesive pure helpers or clear repository slices.
- `server/agent/operations-planner.ts`
  - Risk: large parser + planner path that stages gameplay actions.
  - Treatment: extract pure parser/normalizer helpers first; keep planner contract and tests intact.
- `shared/schema.ts`
  - Risk: canonical Drizzle schema/types and insert schemas are tightly coupled.
  - Treatment: defer structural split unless migration/import behavior is fully characterized.
- `server/amm/pool.ts`
  - Risk: AMM and LP math invariants.
  - Treatment: add/expand characterization tests before any structural refactor.
- `client/src/components/game-command-center-modal.tsx`
  - Risk: multi-sport transport, derived state, mutations, and rendering are co-located.
  - Treatment: establish shared transport contracts/query keys before extracting selectors, hooks, or panels.

Queue reference: `docs/agent/REFACTOR_QUEUE.md` (safest-to-riskiest execution order).

## Task-to-Entry Points

- Frontend/page behavior: `client/src/pages/*`, then related `client/src/components/*` and `client/src/lib/*`.
- Backend/API behavior: `server/routes.ts`, relevant `server/routes/*`, and `server/index.ts` registration.
- Database/schema behavior: `shared/schema.ts`, `migrations/*`, `server/db.ts`.
- Economics behavior (AMM/LP/boost/scout/power/locks): `server/amm/pool.ts`, `server/storage.ts`, `server/jobs/*`, `docs/wiki/agent/runbooks.md`.
- Scheduler behavior: `server/jobs/job-registry.ts` for names/schedules/handlers/admin visibility, `server/jobs/scheduler.ts` for lifecycle/locking/logging, and `server/jobs/scheduler.test.ts` for compatibility characterization.
- Mobile/Capacitor behavior: `mobile/android/*`, `mobile/ios/*`, `client/src/lib/native-*`, `client/src/lib/mobile-push.ts`.
- Agent/Hermes behavior: `server/agent/*`, `server/mcp/*`, `docs/wiki/agent/current-surface.md`, `docs/wiki/agent/runtime-model.md`.

## Validation Commands

- Backend/API/frontend code paths:
  - `npm run check`
  - `npm run lint`
  - `npm run test:run`
  - `npm run format:check`
  - `npm run build`
- Economics, schema, lock/power/boost/scout sensitive changes:
  - baseline commands above
  - `npm run invariants:check` (recommended)
- Docs and orientation/context changes:
  - `npm run docs:check`
  - `npm run docs:build`
  - `npm run context:audit`
- Formatting-sensitive edits:
  - `npm run format:check`
- Optional deeper diagnostics:
  - `npm run code:dead`
  - `npm run code:dup`
  - `npm run agent:debug`

## Default Context Exclusions (For Broad Ingestion)

- `node_modules/`
- `dist/`
- `tmp/`
- `coverage/`
- `test-results/`
- `playwright-report/`
- `.git/`
- `.claude/` (local worktree snapshots)
- `vendor/`
- `attached_assets/`
- `mobile/ios/App/build/`
- `mobile/ios/App/Pods/`
- `mobile/android/app/build/`
- `mobile/android/.gradle/`
- `mobile/android/local.properties`
- `mobile/android/app/src/main/assets/public/assets/` (generated web bundles)
- `mobile/ios/App/App/public/assets/` (generated web bundles)
- `package-lock.json` unless dependency resolution is the task
- `.env*` except `.env.example`
- Binary/image/archive files unless directly needed
- `docs/wiki/changelog/` unless historical docs behavior is the task
- `docs/archive/` unless historical implementation status is the task

Use `npm run context:audit` to refresh these estimates and exclusion choices.
