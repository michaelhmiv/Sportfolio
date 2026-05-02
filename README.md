# Sportfolio

Sportfolio is a multi-sport player-share market with AMM trading, LP participation, scouts, power/boost mechanics, and a Hermes-backed operator across web, CLI, and SMS.

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

Default development URL: `http://127.0.0.1:5000`

## Worktree + GitHub Flow

Use this loop for isolated feature work and fast PR feedback:

```bash
# Create a branch worktree at .claude/worktrees/<name>
npm run worktree:new -- market-card-refresh

# Jump into that worktree and develop
cd .claude/worktrees/market-card-refresh
npm run dev

# Check PR + CI status from any branch
npm run gh:pr:status
```

Helper scripts:

- `npm run worktree:new -- <name>`: create a new worktree + branch (`codex/<name>`) from `origin/main`
- `npm run worktree:list`: list active worktrees
- `npm run worktree:close -- <name>`: remove a worktree under `.claude/worktrees` safely (supports `--force` and `--delete-branch`)
- `npm run worktree:prune`: prune stale worktree metadata
- `npm run gh:pr:status`: show current branch PR and check status
- `npm run gh:pr:create -- --base main --head <branch>`: create PR from current branch
- `npm run gh:pr:checks -- <pr-number> --watch`: stream check updates

## Validation Commands

```bash
npm run check
npm run lint
npm run test:run
npm run format:check
```

## CLI Quickstart

1. Open your profile in the web app and create a token in **CLI Access**.
2. Authenticate from this repo:

```bash
npm run cli -- auth login --token <your-token> --base-url https://www.sportfolio.market
```

3. Try core commands:

```bash
npm run cli -- auth whoami
npm run cli -- docs search "power boosts"
npm run cli -- portfolio summary
npm run cli -- agent ask "review my setup"
```

For full syntax and troubleshooting:

- `/wiki/cli/command-reference`
- `/wiki/features/user-action-surface`

## Common Scripts

- `npm run dev` - start development server and auto-start local MLB MCP sidecar if the vendored venv is available
- `npm run dev:app` - start only the development app server
- `npm run dev:mcp` - start only the local MLB MCP sidecar
- `npm run build` - build client + server
- `npm run start` - run production build
- `npm run cli -- <args>` - run Sportfolio CLI from repo
- `npm run docs:build` - regenerate docs manifest
- `npm run docs:check` - validate docs metadata
- `npm run cli:smoke` - run CLI smoke harness
- `npm run e2e` - run Playwright tests

## Project Structure

- `client/` - React frontend
- `server/` - Express API + jobs
- `shared/` - shared types and schema
- `packages/sportfolio-cli/` - CLI package
- `docs/wiki/` - canonical user/internal docs
- `tests/e2e/` - Playwright end-to-end tests

## Tech Stack

- React + TanStack Query + Wouter
- Express + TypeScript
- PostgreSQL + Drizzle ORM
- Supabase auth
- WebSocket real-time updates

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

See [`mobile/README.md`](mobile/README.md) for the full iOS/Android runbook, environment routing presets, and Xcode build steps.

## License

MIT
