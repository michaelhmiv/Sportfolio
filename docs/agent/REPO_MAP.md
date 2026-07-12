# REPO_MAP

Last reviewed: 2026-07-12

This is a navigability map for fast subsystem targeting.

## Top-Level Directories

- `client/`: React app (Wouter pages, TanStack Query, shared UI components).
- `server/`: Express API, jobs, AMM/LP logic, Hermes runtime, MCP surfaces.
- `shared/`: Drizzle schema plus shared TypeScript contracts/utilities.
- `mobile/`: Capacitor native projects (`android/`, `ios/`) and release assets.
- `scripts/`: operational scripts (validation, audit, migration helpers, mobile/release tooling).
- `migrations/`: SQL migration history and metadata snapshots.
- `docs/`: wiki, architecture docs, ADRs, security notes, agent context docs.
- `packages/`: auxiliary packages (`sportfolio-cli`, `sportfoliobot`).
- `tests/`: Playwright E2E coverage.

## Backend Modules

- API registration and mixed domain handlers: `server/routes.ts`.
- Extracted route groups: `server/routes/*` (AMM, LP, docs, MCP, Discord, notifications, mobile routes).
- Data/service facade: `server/storage.ts` and helpers in `server/storage/*`.
- AMM/LP math and execution: `server/amm/pool.ts`.
- Canonical job metadata and result adapters: `server/jobs/job-registry.ts`.
- Scheduler lifecycle, overlap protection, and execution logging: `server/jobs/scheduler.ts`.
- Shared job contracts: `server/jobs/types.ts`; job implementations: remaining modules under `server/jobs/*`.
- Agent/Hermes runtime: `server/agent/*`.
- MCP inventory and public tool surfaces: `server/mcp/*`.

## Frontend Modules

- App shell + routing: `client/src/App.tsx`.
- Route pages: `client/src/pages/*`.
- Reusable components: `client/src/components/*`.
- Agent UI feature area: `client/src/features/agent/*`.
- Runtime/service helpers: `client/src/lib/*` and hooks in `client/src/hooks/*`.

## Shared Schema and Type Ownership

- Canonical schema and inserts/types: `shared/schema.ts`.
- Economic/shared helpers: `shared/vesting-utils.ts`, `shared/game-status.ts`, `shared/market-activity.ts`, `shared/activity-feed.ts`.
- Any schema or shared-type contract change should audit route/storage/job write paths in the same PR.

## Mobile and Capacitor Ownership

- Capacitor app config: `capacitor.config.ts`, `capacitor.config.test.ts`.
- Android native wrapper: `mobile/android/*`.
- iOS native wrapper: `mobile/ios/*`.
- Generated web assets under native trees are build artifacts and should be excluded from default agent context.

## Scripts and Tooling Ownership

- Quality and diagnostics: `check`, `lint`, `test:run`, `format:check`, `code:dead`, `code:dup`, `invariants:check`, `agent:debug`.
- Docs pipeline: `docs:check`, `docs:build`, `docs:governance`.
- Context sizing: `context:audit` (`scripts/context-audit.mjs`).
- Mobile/release tooling: `mobile:*`, `android:*`, `play:*` scripts.

## Docs and Wiki Ownership

- Gameplay/economy/API guardrails: `docs/wiki/agent/*`.
- Public/internal wiki topics: `docs/wiki/{gameplay,features,getting-started,cli,faq,internal}`.
- Architecture decisions: `docs/adr/*`.
- Agent orientation layer for coding workflows: `docs/agent/*`.
- Evidence-backed structural program: `docs/refactor/JULY_2026_AUDIT.md`.
- Historical, non-canonical status snapshots: `docs/archive/*`.

## Dangerous Cross-Cutting Areas

- Economics state transitions crossing routes + storage + jobs:
  - AMM/LP (`server/amm/pool.ts`, `server/routes/amm.ts`, `server/routes/lp.ts`)
  - Boost/scout/payout flows (`server/routes.ts`, `server/jobs/*`, `server/storage.ts`)
  - Power/lock semantics (`shared/schema.ts`, `server/storage.ts`, route assignment/condense flows)
- Auth boundaries and admin surfaces:
  - middleware assignment in routes (`isAuthenticated`, `optionalAuth`, `adminAuth`)
- Hermes staged actions and execution validation:
  - `server/agent/*` + `server/mcp/*`.

## Known Large Files and Responsibilities

- `server/routes.ts`: primary API registration and many domain endpoints.
- `server/storage.ts`: broad data access layer with many economic writers.
- `server/agent/operations-planner.ts`: natural-language parsing and staged-action planning.
- `shared/schema.ts`: canonical schema and shared insert/type definitions.
- `server/amm/pool.ts`: AMM/LP math and execution paths.
- `client/src/components/game-command-center-modal.tsx`: large UI surface for multi-sport game context.
- `server/jobs/scheduler.ts` is intentionally a small lifecycle orchestrator; job names, schedules, handlers, and admin visibility belong in `server/jobs/job-registry.ts`, not parallel scheduler maps.

## Refactor Sequence Reference

- Use `docs/agent/REFACTOR_QUEUE.md` before touching any high-friction file listed above.
- The queue is ordered from safest to riskiest and includes extraction boundaries, prerequisite tests, and stop conditions.
