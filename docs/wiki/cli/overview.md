---
id: cli-overview
title: Sportfolio CLI
summary: How to use the Sportfolio CLI for documentation, account reads, and confirmation-gated agent workflows from a terminal.
audience: public
category: cli
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: packages/sportfolio-cli,server/routes/cli.ts,server/api-token-auth.ts
slug: overview
surface: web,cli
searchKeywords: cli,api token,terminal,auth,actions,agent,docs
---

# What the CLI is for

The Sportfolio CLI gives you a terminal-native way to read docs, inspect your account, and use the agent without opening the web app.

## Authentication model

CLI access uses user-scoped API tokens. Create a token from your profile page, then authenticate from a terminal:

```bash
npm run cli -- auth login --token <your-token> --base-url https://www.sportfolio.market
```

The token is user-specific, so the CLI inherits the same account boundary as the web app.

If you are running against local development, use:

```bash
npm run cli -- auth login --token <your-token> --base-url http://127.0.0.1:5000
```

## What the current CLI supports

- `docs list`, `docs search`, `docs open`
- `portfolio summary`
- `agent ask`, `agent threads`, `agent confirm`, `agent cancel`
- structured action staging through `actions ...` commands

For exact syntax, examples, JSON mode, and troubleshooting, use [CLI Command Reference](/wiki/cli/command-reference).

In practice, the CLI is strongest when you want one of three things:

- fast documentation access
- quick account reads from a shell
- agent-assisted workflows without opening the browser

## Safety model

The CLI does not bypass confirmation-gated state changes. Mutating flows still stage a plan first, then require a confirm step.

That means the CLI is an interface layer, not a privileged back door.

## How the CLI relates to the rest of Sportfolio

The CLI uses the same canonical docs and the same server-owned business logic as the rest of the product.

So:

- docs commands read the same wiki content used by the web docs hub
- account reads follow the same auth rules as the web app
- agent commands use the same staged-plan and confirmation model

## Good operational hygiene

- use one token per device or automation task
- revoke tokens you no longer use
- avoid storing tokens in plain shell history
- prefer HTTPS endpoints outside localhost development

## Best use cases

The CLI is especially useful for:

- checking your portfolio from a workstation
- searching docs while you trade in another window
- using the agent in an operations-heavy or developer workflow

If you want one cross-surface map of web, CLI, and SMS capabilities, read [User Action Surface](/wiki/features/user-action-surface).

If you need rich visual scanning, the web app remains the better primary surface. If you need fast, scriptable access, the CLI is the right tool.
