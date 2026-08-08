# CLAUDE.md

Repository guidance for coding assistants working on Sportfolio.

## Project overview

Sportfolio is a multi-sport player-share market with live sports data, AMM trading, LP participation, scouts, boosts, collections, web/mobile clients, CLI access, and ChatGPT/MCP capabilities.

Current core stack:

- React + TanStack Query + Wouter
- Express + TypeScript
- Railway PostgreSQL + Drizzle ORM
- Better Auth + Resend passwordless authentication
- Neutral sports adapters under `server/sports/`

Current sports sources are MLB StatsAPI/Baseball Savant, the NHL web API integration, NASCAR schedule/live feeds, and ESPN+nflverse for NFL. Do not use BallDontLie, Supabase, a standalone MLB MCP service, Hermes/agent infrastructure, SMS, or Telnyx as active Sportfolio architecture.

## Start with current state

At the beginning of a task:

1. Check current `main`, relevant open issues, and recent deployment state when the task affects production.
2. Read `AGENTS.md`, `docs/architecture-module-ownership.md`, and the task-specific domain/runbook documentation.
3. Prefer a narrow vertical slice over broad repository-wide rewrites.
4. Treat historical migrations and archived implementation notes as history, not current runtime guidance.

## Execution principles

- For non-trivial work, define the implementation and validation sequence before editing.
- Do not create unnecessary approval checkpoints when the requested scope is already clear.
- Find root causes instead of stacking temporary compatibility shims.
- Use existing abstractions and provider adapters before adding new services, tools, dependencies, or infrastructure.
- Keep public MCP capabilities compact and governed; do not expose raw provider endpoints.
- Preserve authentication, authorization, account ownership, staged-write confirmation, and economic invariants.
- Never log or commit secrets, tokens, private user data, or raw credentials.

## Authentication architecture

Better Auth is the only supported authentication provider. Resend sends one-time magic links. Web sessions are secure same-origin HttpOnly sessions; native sessions use the Better Auth-backed native handoff; ChatGPT/MCP uses the Better Auth OAuth Provider/JWKS flow.

Production:

- site: `https://www.sportfolio.market`
- OAuth issuer: `https://www.sportfolio.market/api/auth/better`
- MCP resource: `https://www.sportfolio.market/mcp/plugin`

Beta uses `https://beta.sportfolio.market` as its same-origin site/auth origin and intentionally shares the production database. Beta must not run scheduled jobs.

Do not reintroduce Supabase auth/runtime configuration, provider selection, Supabase fallback, a dedicated auth hostname, or password/social login.

## Sports architecture

Use `server/sports/` contracts and the default adapter registry. Preserve provider-specific details behind adapters and ingestion modules.

- MLB: MLB StatsAPI; Baseball Savant for expected-stat enrichment.
- NHL: existing credential-free NHL web API client.
- NASCAR: existing schedule/live-feed integration.
- NFL: ESPN current/live data + nflverse canonical identity/history.

Do not create separate per-sport Railway services or provider-native public MCP tool families. Do not silently coerce unknown provider states into valid data.

## Verification before done

Never mark work complete without proof. Use the relevant checks and expand to the full gate for cross-cutting work:

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

Auth, MCP, plugin, or public-capability changes must pass Plugin Readiness and Security Audit. Compare intended GitHub SHA with Railway deployment SHA and startup logs for production changes.

## Deployment rules

- GitHub `main` is the production code source of truth.
- Let Railway deploy from GitHub; do not ship local-only snapshots directly.
- Keep beta on the same tested commit as production unless a short-lived test branch is explicitly required.
- Never run destructive migration rehearsals against the shared production database.
- If a deploy fails, inspect Railway build/runtime logs, fix the root cause in code/config, and re-certify the resulting SHA.

## Code quality

- Prefer simple, targeted changes.
- Avoid unrelated dependency/version drift.
- Remove obsolete code and instructions when a migration is complete.
- Keep tests aligned with current product behavior; delete or rewrite tests that simulate retired architecture.
- Treat CI governance failures as defects, not obstacles to bypass.
