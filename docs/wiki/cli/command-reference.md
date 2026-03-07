---
id: cli-command-reference
title: CLI Command Reference
summary: End-to-end setup, command syntax, JSON automation mode, and troubleshooting for the Sportfolio CLI.
audience: public
category: cli
status: published
owner: product-engineering
lastReviewedAt: 2026-03-07
changeTriggers: package.json,packages/sportfolio-cli/src/index.mjs,packages/sportfolio-cli/src/http.mjs,server/routes/cli.ts,client/src/components/cli-access-card.tsx
slug: command-reference
surface: web,cli,agent
searchKeywords: cli commands,quickstart,token,json,automation,troubleshooting
---

# Quickstart

The current CLI package is repo-local. From the project root, use:

```bash
npm run cli -- --help
```

Create a user API token in **Profile -> CLI Access**, then authenticate:

```bash
npm run cli -- auth login --token <your-token> --base-url https://www.sportfolio.market
```

For local development against a local server:

```bash
npm run cli -- auth login --token <your-token> --base-url http://127.0.0.1:5000
```

# Core Commands

```bash
# auth
npm run cli -- auth login --token <token> [--base-url <url>]
npm run cli -- auth whoami
npm run cli -- auth logout

# docs
npm run cli -- docs list
npm run cli -- docs search <query>
npm run cli -- docs open <section>/<slug>

# portfolio
npm run cli -- portfolio summary

# agent
npm run cli -- agent threads
npm run cli -- agent ask "<prompt>" [--thread <threadId>]
npm run cli -- agent confirm <threadId>
npm run cli -- agent cancel <threadId>

# staged actions (still require explicit confirm)
npm run cli -- actions buy <player-name-or-id> --dollars <amount> [--thread <threadId>]
npm run cli -- actions sell <player-name-or-id> --shares <amount> [--thread <threadId>]
npm run cli -- actions watchlist add <player-name-or-id> [--thread <threadId>]
npm run cli -- actions watchlist remove <player-name-or-id> [--thread <threadId>]
npm run cli -- actions vesting claim [--thread <threadId>]
npm run cli -- actions community-boost <player-name> [--timing today|tomorrow] [--thread <threadId>]
```

# JSON Mode

Add `--json` to get machine-readable output:

```bash
npm run cli -- --json auth whoami
npm run cli -- --json agent ask "what is my available cash?"
```

# Troubleshooting

- `Not logged in`: run `auth login` with a valid API token.
- `Network error contacting ...`: verify `--base-url` and that the target server is reachable.
- `Agent is currently processing another request...`: retry after a few seconds.
- Community boost staging is strict on identity resolution. Use full player names (for example `Nikola Jokic`) instead of short ids.

# Next Reads

- [CLI Overview](/wiki/cli/overview)
- [User Action Surface](/wiki/features/user-action-surface)
