# Sportfolio

Sportfolio is a multi-sport player-share market with AMM trading, LP participation, scouts, boosts, collections, and authenticated web/mobile/CLI/ChatGPT capabilities.

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

Default development URL: `http://127.0.0.1:5000`

Local development uses `DEV_DATABASE_URL`. Production uses Railway PostgreSQL through `DATABASE_URL`.

## Architecture at a glance

- React + TanStack Query + Wouter
- Express + TypeScript
- Railway PostgreSQL + Drizzle ORM
- Better Auth + Resend passwordless authentication
- WebSocket real-time updates
- Unified sports adapters for MLB, NHL, NASCAR, and NFL

Sports data sources:

- MLB StatsAPI, plus Baseball Savant expected-stat enrichment
- NHL credential-free web API integration
- NASCAR schedule/live-feed integration
- ESPN for current/live NFL data and nflverse for NFL identity/history

Sportfolio does not require Supabase, a standalone MLB MCP service, BallDontLie, Hermes/agent infrastructure, or SMS/Telnyx infrastructure.

## Worktree + GitHub flow

```bash
npm run worktree:new -- market-card-refresh
cd .claude/worktrees/market-card-refresh
npm run dev
npm run gh:pr:status
```

Helpers:

- `npm run worktree:new -- <name>` — create an isolated worktree/branch from `origin/main`
- `npm run worktree:list` — list active worktrees
- `npm run worktree:close -- <name>` — safely remove a worktree
- `npm run worktree:prune` — prune stale worktree metadata
- `npm run gh:pr:status` — show current branch PR/check status
- `npm run gh:pr:create -- --base main --head <branch>` — create a PR
- `npm run gh:pr:checks -- <pr-number> --watch` — stream PR checks

## Validation

```bash
npm run check
npm run lint
npm run test:run
npm run format:check
npm run build
```

For public capability/auth/plugin changes also run the applicable governance and MCP checks:

```bash
npm run public-tools:audit
npm run governance:capabilities
npm run retired-runtime:audit
npm run mcp:audit
npm run mcp:smoke
```

## CLI quickstart

1. Open your profile in the web app and create a token in **CLI Access**.
2. Authenticate:

```bash
npm run cli -- auth login --token <your-token> --base-url https://www.sportfolio.market
```

3. Try core commands:

```bash
npm run cli -- auth whoami
npm run cli -- docs search "power boosts"
npm run cli -- portfolio summary
npm run cli -- resources read sportfolio://capabilities
```

See `/wiki/cli/command-reference` and `/wiki/features/user-action-surface` for additional guidance.

## Common scripts

- `npm run dev` — start the development app server
- `npm run build` — build client and server
- `npm run start` — run the production build
- `npm run cli -- <args>` — run the Sportfolio CLI
- `npm run docs:build` — regenerate docs manifest
- `npm run docs:check` — validate docs metadata
- `npm run cli:smoke` — run CLI smoke harness
- `npm run e2e` — run Playwright end-to-end tests
- `npm run mobile:sync` — build/sync native projects

There is no local or Railway MLB MCP sidecar. MLB provider access is implemented inside the Sportfolio application process.

## Project structure

- `client/` — React frontend
- `server/` — Express API, auth, sports adapters, and jobs
- `shared/` — shared types and schema
- `packages/sportfolio-cli/` — CLI package
- `docs/wiki/` — canonical user/internal docs
- `tests/e2e/` — Playwright end-to-end tests

## Mobile

```bash
npm run mobile:sync
npm run mobile:sync:ios:dev
npm run mobile:sync:android:dev
npm run mobile:ios:doctor
npm run mobile:build:ios:ci
npm run mobile:ios
npm run mobile:android
```

See [`mobile/README.md`](mobile/README.md) for the iOS/Android runbook, environment routing presets, and build steps.

## Production and beta

`main` is the production code source of truth. Railway production tracks `main`; beta is kept on the same tested commit and uses environment-specific URLs/configuration. Beta intentionally shares the production database and keeps scheduled jobs disabled.

## License

Sportfolio is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). Noncommercial use is permitted only under those terms. Commercial use requires a separate written commercial license from the copyright holder; see [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md).

Because commercial use is restricted, Sportfolio is not distributed under an OSI-approved open-source license. Earlier versions that were validly received under earlier published terms are addressed in the historical-version notice in `COMMERCIAL_LICENSE.md`.

The source-code license does not grant rights in league or team marks, player images or likenesses, sports data, APIs, advertisements, or other third-party material. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [TRADEMARKS.md](TRADEMARKS.md).
