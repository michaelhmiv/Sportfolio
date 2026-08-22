# AGENTS.md

Operational guidance for coding agents working in this repository.

## Session start

1. Review open issues and the latest `main` state before changing code.
2. Read `CLAUDE.md`, `docs/architecture-module-ownership.md`, and the task-specific handbook/runbook.
3. Treat GitHub `main` as the code source of truth and Railway as the deployment runtime.
4. For non-trivial work, define the implementation and validation plan before editing, but do not block execution on unnecessary approval checkpoints.

## Current architecture

- Product: Sportfolio, a multi-sport player-share market with AMM trading, LP participation, scouts, boosts, collections, and ChatGPT/MCP surfaces.
- Frontend: React + TanStack Query + Wouter.
- Server: Express + TypeScript.
- Database: Railway PostgreSQL + Drizzle ORM.
- Authentication: Better Auth only, backed by Railway PostgreSQL. Resend sends passwordless magic links. Password login and social login are not supported.
- OAuth/MCP: same-origin Better Auth OAuth Provider; production issuer is `https://www.sportfolio.market/api/auth/better` and canonical MCP resource is `https://www.sportfolio.market/mcp/plugin`.
- Real-time: WebSocket (`/ws`).
- Production code branch: `main`. Beta must run the same tested commit and differs only by environment configuration.

## Sports data sources

Use the existing neutral sports adapter registry and provider modules. Do not create standalone per-sport Railway services or provider-native public MCP surfaces.

- MLB: MLB StatsAPI for roster/schedule/game/stat data; Baseball Savant for expected-stat profiles.
- NHL: existing credential-free NHL web API client.
- NASCAR: existing schedule/live-feed integration and canonical series normalization.
- NFL: ESPN for current/live data and nflverse for canonical identity/historical data.

Before adding or changing a provider path, inspect the existing adapter, ingestion jobs, persisted-data behavior, and contract tests. Prefer persisted Sportfolio data for product surfaces where the existing architecture does so. Never silently invent missing provider values.

Primary source-of-truth code:

- Sports contracts/registry: `server/sports/`
- API surface: `server/routes.ts`, `server/routes/`
- MCP/public capability policy: `server/mcp/`
- Domain model: `shared/schema.ts`
- Core economics: `server/amm/pool.ts`, `server/economy/`, `server/boosts/`
- Background jobs: `server/jobs/`
- Auth runtime: `server/auth/`

## Architecture boundaries

Use only the current runtime and provider architecture represented by active source code, package scripts, and maintained operations documentation. Do not restore removed auth providers, retired product runtimes, legacy messaging/linking flows, dedicated per-sport sidecars, or fallback configuration from historical commits or migrations.

Historical migrations may mention removed systems because they record actual database lineage. Do not treat historical migration text as current architecture.

## Product-critical mechanics

1. **AMM/LP invariants**
   - Constant-product pools (`x * y = k`) power instant trading.
   - Preserve current fee/burn behavior unless an explicit economics change is approved.
2. **Scout distribution**
   - Hourly distribution is proportional to scout-minutes.
3. **Vesting accrual**
   - Accrual uses elapsed time plus residual milliseconds with hard caps.
4. **Economy V2 holdings**
   - Player holdings are Singles. There is no separate player stacking or power state in the current economy.
   - Available player inventory is derived from the owned holding minus active share locks/reservations.
   - Do not add compatibility fields, routes, tools, tables, or calculations for retired player-share multiplier mechanics.
5. **Daily Boost lifecycle**
   - Daily Boosts commit a direct quantity of Singles to one of the configured boost slots.
   - The selected Singles are reserved before the game and burn at the applicable game boundary according to the current Boost settlement flow.
   - Preserve sport-specific eligibility gates, game-start checks, share reservation rules, and payout behavior.

## Auth and access

- Better Auth web sessions are secure HttpOnly sessions.
- Native auth uses the Better Auth-backed handoff/session flow.
- ChatGPT/MCP authorization uses the OAuth Provider/JWKS path and canonical Sportfolio identity mapping.
- `DEV_BYPASS_AUTH` is local-development only and must never be enabled in a deployed environment.
- Never weaken authentication, staged-write confirmation, authorization scopes, or account ownership checks without explicit product intent.

## Working rules

- Use existing patterns before introducing abstractions or dependencies.
- Keep changes targeted and remove obsolete paths instead of layering new compatibility shims over retired systems.
- Treat configured Daily Boost slot multipliers as current mechanics; do not confuse them with retired player-share stacking or share-multiplier state.
- Keep maintained tests, fixtures, and UI inventories aligned to current product contracts; do not preserve retired fields or surfaces solely to satisfy stale assertions.
- Never expose secrets, tokens, private user data, raw provider payloads, or internal error stacks.
- Preserve market, portfolio, scouting, boost, collection, payout, and identity invariants when changing data ingestion.
- Do not create new public tools when an existing compact/unified capability can satisfy the use case.
- Remove completed one-shot implementation scripts, generated reports, temporary task contracts, and tracked cache/debug artifacts once they are no longer operational inputs.

## Validation before completion

Run the relevant subset and expand to the full release gate for cross-cutting changes:

```bash
npm run check
npm run lint
npm run test:run
npm run format:check
npm run build
npm run code:dead
npm run public-tools:audit
npm run governance:capabilities
npm run retired-runtime:audit
```

Auth/MCP/plugin changes must also pass Plugin Readiness and Security Audit. Do not suppress or broadly skip failing tests to force a merge.

## Deployment safety

- GitHub is the deployment source of truth.
- Push/merge code through GitHub, then let Railway deploy the tracked branch.
- Production and beta should run the same tested commit.
- Beta shares the production database intentionally and must keep scheduled jobs disabled.
- Never run destructive database rehearsals against the shared production database.
- Compare Railway deployment SHA and startup diagnostics against the intended GitHub commit before declaring a rollout complete.

## Git safety

Before committing or merging, inspect the diff and confirm no credentials, secret values, generated junk, or unrelated dependency drift is included.
