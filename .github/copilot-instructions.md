# Sportfolio Copilot Instructions

Use these constraints when generating code or suggestions for this repository.

## Current architecture

- React/TanStack Query/Wouter frontend; Express/TypeScript server.
- Railway PostgreSQL + Drizzle ORM.
- Better Auth is the only authentication provider; Resend delivers passwordless magic links.
- Sports integrations are behind the neutral adapter/provider layers under `server/sports/` and related ingestion modules.
- MLB uses MLB StatsAPI plus Baseball Savant enrichment; NHL uses the existing NHL web API client; NASCAR uses the current schedule/live integration; NFL uses ESPN plus nflverse.
- Do not reintroduce Supabase runtime/auth, BallDontLie, Hermes/agent runtime, SMS/Telnyx auth, a standalone MLB MCP service, or retired provider-selection/fallback variables.

## Product mechanics that must remain reconciled

- AMM uses constant-product logic (`x * y = k`) with current fee/burn behavior.
- Scout rewards are time-weighted by scout-minutes.
- Vesting accrual depends on elapsed time plus residual milliseconds with caps.
- Boosts preserve their sport-specific eligibility, locking/burn, snapshot, and settlement semantics.
- Regular holdings and stacked-share multiplier state are separate. `holdings` does not contain a `power` or `powerLevel` column; stacked multiplier state lives in `player_multipliers` and its event ledger.
- Locked regular shares must not be consumed by stacking or boost flows.

## Source-of-truth code

- Sports contracts/registry: `server/sports/`
- API routes: `server/routes.ts`, `server/routes/`
- Auth: `server/auth/`
- Public MCP/capability policy: `server/mcp/`
- Domain schema: `shared/schema.ts`
- AMM internals: `server/amm/pool.ts`
- Background jobs: `server/jobs/`

## Auth and security

- Preserve Better Auth web/native/OAuth validation and canonical identity mapping.
- Keep existing protected-route, ownership, scope, admin, and staged-write confirmation checks intact.
- `DEV_BYPASS_AUTH` is local-development only.
- Never expose secrets, tokens, private user data, or credentials in code, logs, tests, or output.

## Workflow expectations

Prefer minimal targeted changes using existing patterns. Remove obsolete paths rather than adding compatibility shims around retired architecture.

Before shipping, run the relevant checks:

```bash
npm run check
npm run lint
npm run test:run
npm run format:check
npm run retired-runtime:audit
```

For auth/MCP/public-capability changes, also run the applicable Plugin Readiness/governance/MCP checks and require Security Audit to pass.

## Deployment

GitHub `main` is the code source of truth. Let Railway deploy from GitHub. Production and beta should run the same tested commit; beta intentionally shares the production database and must keep scheduled jobs disabled.
