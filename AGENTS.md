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
- Core economics: `server/amm/pool.ts`, `shared/vesting-utils.ts`
- Background jobs: `server/jobs/`
- Auth runtime: `server/auth/`

## Retired architecture

Do not reintroduce or depend on:

- Supabase runtime/auth/configuration;
- Hermes or Sportfolio product-agent runtime;
- SMS/Telnyx login or linking;
- a standalone MLB MCP/sidecar service;
- BallDontLie as a Sportfolio runtime provider;
- `AUTH_PROVIDER`, Supabase fallback switches, `MLB_MCP_*`, `HERMES_*`, `TELNYX_*`, `SMS_LINK_*`, or managed-user-agent runtime variables.

Historical migrations may mention retired systems because they record actual database lineage. Do not treat historical migration text as current architecture.

## Product-critical mechanics

1. **AMM/LP invariants**
   - Constant-product pools (`x * y = k`) power instant trading.
   - Preserve current fee/burn behavior unless an explicit economics change is approved.
2. **Scout distribution**
   - Hourly distribution is proportional to scout-minutes.
3. **Vesting accrual**
   - Accrual uses elapsed time plus residual milliseconds with hard caps.
4. **Boost lifecycle**
   - Boosts lock/burn shares at the applicable game boundary and settle from eligible gameplay results.
   - Preserve sport-specific eligibility gates, including display-only/non-gameplay states where configured.

## Stacked shares

Stacked-share multiplier state is separate from regular tradeable holdings.

- `holdings` stores regular asset quantity/cost basis.
- `player_multipliers` stores the canonical non-tradeable stacked-share multiplier state.
- `player_multiplier_events` is the immutable stacking/burn ledger.
- Available regular shares are `holdings.quantity - holdings_locks.lockedQuantity`.
- Stacking and boost flows must not consume locked shares.
- Daily boost assignment uses the existing one-share-per-slot contract and snapshots the selected multiplier.

For stacked-share changes, validate the holdings multiplier state, stack-shares route, boost eligibility, and boost assignment paths together.

## Auth and access

- Better Auth web sessions are secure HttpOnly sessions.
- Native auth uses the Better Auth-backed handoff/session flow.
- ChatGPT/MCP authorization uses the OAuth Provider/JWKS path and canonical Sportfolio identity mapping.
- `DEV_BYPASS_AUTH` is local-development only and must never be enabled in a deployed environment.
- Never weaken authentication, staged-write confirmation, authorization scopes, or account ownership checks without explicit product intent.

## Working rules

- Use existing patterns before introducing abstractions or dependencies.
- Keep changes targeted and remove obsolete paths instead of layering new compatibility shims over retired systems.
- Never expose secrets, tokens, private user data, raw provider payloads, or internal error stacks.
- Preserve market, portfolio, scouting, boost, collection, payout, and identity invariants when changing data ingestion.
- Do not create new public tools when an existing compact/unified capability can satisfy the use case.

## Validation before completion

Run the relevant subset and expand to the full release gate for cross-cutting changes:

```bash
npm run check
npm run lint
npm run test:run
npm run format:check
npm run build
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
