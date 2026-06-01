# AGENT_GUIDE.md

## Project Purpose

Sportfolio is a full-stack TypeScript sports trading platform combining:

- AMM-style player share trading,
- liquidity provider (LP) mechanics,
- fantasy-score-driven payout loops (scout distributions, boosts),
- and an increasingly large AI agent surface (Scout / Hermes) for user assistance and operations.

The product is implemented as a single Node/Express + React/Vite app with shared schema/types.

## High-Level Architecture

### Runtime Shape

- **Single server entrypoint:** `server/index.ts` bootstraps observability, auth/session middleware, API routes, WebSocket handling, and static/client serving in production.
- **Two service modes:** normal app mode vs Hermes sidecar mode (`SPORTFOLIO_SERVICE_ROLE=hermes-sidecar`).
- **Frontend:** React app in `client/src`, routed with Wouter, data fetched with TanStack Query.
- **Backend:** Express routes in `server/routes.ts` plus route modules under `server/routes/`.
- **Data layer:** Drizzle ORM over Postgres (`server/db.ts`) with schema in `shared/schema.ts`.
- **Realtime:** WebSocket events via `ws` for portfolio/trade/game updates.

### Major Module Boundaries

- `client/`: UI pages/components/hooks/providers.
- `server/routes.ts`: main API registration and many domain handlers.
- `server/routes/amm.ts`, `server/routes/lp.ts`: AMM + LP API surfaces.
- `server/storage.ts`: large persistence/service abstraction used by routes/jobs.
- `server/jobs/`: schedulers, game syncs, settlements, snapshots.
- `server/agent/`: Hermes/scout orchestration, planning, tools, memory, provider integration.
- `shared/schema.ts`: canonical DB schema and shared types.

## Core Economic/Domain Areas (Handle Carefully)

- AMM invariant (`x * y = k`) and fee split behavior.
- LP add/remove/zap accounting.
- Boost lock/burn/settlement lifecycle.
- Scout distribution proportionality and hourly jobs.
- Holdings `power`/`powerLevel` consistency.
- Lock semantics (`holdings_locks`, `balance_locks`) to prevent double spend.

## Build, Run, and Validation Commands

Run from repo root.

### Install

- `npm ci` (preferred deterministic install; lockfile present)
- `npm install` (acceptable for local development)

### Environment setup

- Copy env template: `cp .env.example .env`
- For local Postgres: `docker-compose -f docker-compose.dev.yml up -d`

### Run (development)

- `npm run dev`
  - Uses `scripts/dev-orchestrator.mjs` (app plus optional MCP helper flow)
  - `npm run dev:app` runs `tsx watch server/index.ts` directly.
  - In development, the server bootstraps Vite middleware from backend.

### Build (production artifacts)

- `npm run build`
  - Builds client via Vite into `dist/public`
  - Bundles server via esbuild into `dist/index.js`

### Run (production)

- `npm run start`

### Quality gates

- Type check: `npm run check`
- Lint: `npm run lint`
- Tests (single run): `npm run test:run`
- Tests (watch): `npm run test`
- Coverage: `npm run test:coverage`
- Format check: `npm run format:check`
- Text encoding check: `npm run text:check`

### Extra diagnostics

- Dead code scan: `npm run code:dead`
- Duplicate code scan: `npm run code:dup`
- E2E tests: `npm run e2e`

## Testing Stack and Feedback Loops

- **Unit/integration tests:** Vitest (server + client logic tests).
- **E2E tests:** Playwright under `tests/e2e/`.
- **Static analysis:** TypeScript + ESLint.
- **Formatting:** Prettier.
- **CI:** `.github/workflows/pr-ci.yml` runs check/lint/format/test and report-only checks.

Automated loop feasibility is good for syntax/type/test regressions because standard commands are present and CI codifies them.

## Coding Conventions and Working Patterns

- TypeScript strict mode is enabled (`tsconfig.json`).
- Aliases: `@` (client source), `@shared` (shared), `@assets`.
- Prefer existing patterns in large route/storage modules before introducing abstractions.
- Follow auth middleware conventions (`isAuthenticated`, `optionalAuth`, `adminAuth`).
- Avoid altering economics without validating runbooks in `docs/wiki/agent/runbooks.md`.

## Agent Readiness Notes

### Strengths

- Clear npm command surface for build/lint/test.
- Shared schema/types reduce contract drift.
- Existing tests across agent orchestration and critical services.
- CI pipeline captures baseline checks.

### Friction / Danger Zones

1. **Very large files** (hard for scoped edits and reasoning):
   - `server/routes.ts`, `server/storage.ts`, `server/agent/operations-planner.ts`, `shared/schema.ts`, `server/amm/pool.ts`.
2. **Cross-cutting economic logic** spread across routes, jobs, and storage.
3. **Mixed legacy + active mechanics** (e.g., retired vesting still present for compatibility).
4. **Large volume of one-off scripts** in `scripts/` with varying conventions.
5. **Broad environment/config surface** (many provider/API keys, optional sidecar modes).
6. **Monolithic backend route registration** can obscure ownership boundaries.

## Autonomous Improvement Loop

Use this minimal loop after any implementation attempt:

1. `npm run agent:debug`
   - Runs deterministic validation steps and writes artifacts to:
     - `tmp/agent-debug/latest.json`
     - `tmp/agent-debug/latest.md`
2. `npm run agent:improve`
   - Reads the latest debug artifact and prints deterministic next actions for the first failing step.
3. Apply fix and rerun `npm run agent:debug` until healthy.

## Recommended Agent Workflow

1. Read `AGENTS.md` and `CLAUDE.md` first.
2. Read orientation docs in `docs/agent/`:
   - `docs/agent/CONTEXT_INDEX.md`
   - `docs/agent/REPO_MAP.md`
   - `docs/agent/CONTEXT_BUDGET.md`
   - `docs/agent/REFACTOR_QUEUE.md` (safe-to-risk sequence for large-file cleanup)
3. For economics/API changes, read:
   - `docs/wiki/agent/product-mechanics.md`
   - `docs/wiki/agent/api-map.md`
   - `docs/wiki/agent/data-model-economy.md`
   - `docs/wiki/agent/runbooks.md`
4. Scope change to one vertical (route + storage + tests) at a time.
5. Run at minimum: `npm run check && npm run lint && npm run test:run`.
6. For risky changes, add targeted tests near touched modules.
7. Use `npm run context:audit` when deciding context exclusions or estimating repo token load.

## Quick Orientation Checklist for New Agents

- Inspect `package.json` scripts first.
- Identify whether change is in:
  - frontend (`client/`),
  - API route (`server/routes*`),
  - background job (`server/jobs/`),
  - agent subsystem (`server/agent/`), or
  - shared schema (`shared/schema.ts`).
- Confirm required env vars in `.env.example`.
- Verify no changes violate lock/power/economy invariants.
