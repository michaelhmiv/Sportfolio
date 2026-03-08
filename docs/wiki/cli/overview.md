---
id: cli-overview
title: CLI and External Access
summary: How to use the Sportfolio CLI for documentation, account reads, confirmation-gated agent workflows, and the current status of MCP-style external access.
audience: public
category: cli
status: published
owner: product-engineering
lastReviewedAt: 2026-03-07
changeTriggers: packages/sportfolio-cli,server/routes/cli.ts,server/api-token-auth.ts
slug: overview
surface: web,cli
searchKeywords: cli,api token,terminal,auth,actions,agent,docs,mcp,external access,model context protocol
---

# CLI and external access

The Sportfolio CLI gives you a terminal-native way to read docs, inspect your account, and use the agent without opening the web app.

## Authentication model

CLI access uses user-scoped API tokens. Create a token from your profile page, then authenticate from a terminal:

```bash
sportfolio auth login --token <your-token>
```

The token is user-specific, so the CLI inherits the same account boundary as the web app.

## Command families

- `docs list`, `docs search`, `docs open`
- `portfolio summary`
- `agent ask`, `agent threads`, `agent confirm`, `agent cancel`
- structured action staging through `actions ...` commands

In practice, the CLI is strongest when you want one of three things:

- fast documentation access
- quick account reads from a shell
- agent-assisted workflows without opening the browser

## Repo-local entrypoint

The CLI package in this repo is private right now. If you are using this repository directly, run the local entrypoint instead of waiting for a published package:

```bash
node packages/sportfolio-cli/bin/sportfolio.mjs auth login --token <your-token>
```

From there you can use the same `docs`, `agent`, `portfolio`, and `actions` command families.

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

If you need rich visual scanning, the web app remains the better primary surface. If you need fast, scriptable access, the CLI is the right tool.

## MCP status

The tracked Sportfolio repo does not currently document a first-party public MCP server, endpoint, or connection config.

So today:

- use the CLI for terminal and automation-friendly access
- use the web agent for account-aware chat inside the app
- use SMS after linking if you want a phone-based agent channel

Do not assume a public MCP endpoint exists until the tracked code and docs expose one directly.
