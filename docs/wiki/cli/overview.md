---
id: cli-overview
title: CLI and External Access
summary: How to use the Sportfolio CLI for documentation, shared public tool access, account actions, and its relationship to public MCP and Hermes.
audience: public
category: cli
status: published
owner: product-engineering
lastReviewedAt: 2026-04-02
changeTriggers: packages/sportfolio-cli,server/routes/cli.ts,server/api-token-auth.ts,server/routes/mcp.ts
slug: overview
surface: web,cli
searchKeywords: cli,api token,terminal,auth,actions,agent,docs,mcp,external access,model context protocol,hermes
---

# CLI and external access

The Sportfolio CLI gives you a terminal-native way to read docs, inspect your account, use the agent, and call the same shared public tool surface exposed through MCP.

## Authentication model

CLI access uses user-scoped API tokens. Create a token from your profile page, then authenticate from a terminal:

```bash
npm run cli -- auth login --token <your-token> --base-url https://www.sportfolio.market
```

The token is user-specific, so the CLI inherits the same account boundary as the web app.

## Command families

If you are running against local development, use:

```bash
npm run cli -- auth login --token <your-token> --base-url http://127.0.0.1:5000
```

- `docs list`, `docs search`, `docs open`
- `portfolio summary`
- `agent ask`, `agent threads`, `agent confirm`, `agent cancel`
- `actions ...` convenience commands for common staged flows
- `tools list`, `tools call`
- `prompts list`, `prompts render`
- `resources list`, `resources read`

For exact syntax, examples, JSON mode, and troubleshooting, use [CLI Command Reference](/wiki/cli/command-reference).

In practice, the CLI is strongest when you want:

- fast documentation access
- direct shell access to the shared public capability catalog
- agent-assisted workflows without opening the browser

## Repo-local entrypoint

The CLI package in this repo is private right now. If you are using this repository directly, run the local entrypoint instead of waiting for a published package:

```bash
node packages/sportfolio-cli/bin/sportfolio.mjs auth login --token <your-token>
```

From there you can use the same `docs`, `agent`, `portfolio`, `actions`, `tools`, `prompts`, and `resources` command families.

## Safety model

The CLI does not bypass confirmation-gated state changes. Mutating flows still stage a plan first, then require a confirm step.

That means the CLI is an interface layer over the same server-owned capability catalog, not a privileged back door.

## How the CLI relates to the rest of Sportfolio

The CLI uses the same canonical docs and the same server-owned business logic as the rest of the product.

So:

- docs commands read the same wiki content used by the web docs hub
- account and settings actions follow the same auth rules as the web app
- MCP and CLI share one public capability registry for tools, prompts, and resources
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

If you want one cross-surface map of web, CLI, and MCP capabilities, read [User Action Surface](/wiki/features/user-action-surface).

If you need rich visual scanning, the web app remains the better primary surface. If you need fast, scriptable access, the CLI is the right tool.

## MCP status

Sportfolio now exposes a public authenticated MCP endpoint at `/mcp`.

That means terminal-friendly access now has two public paths:

- use the CLI when you want the simplest shell workflow
- use MCP when you are connecting through an MCP-aware client
- use the web agent when you want the primary conversational surface instead of a protocol client

MCP uses the same user API tokens as the CLI and shares the same non-purchase public capability surface. Hermes may also consume built-in or user-connected MCP sources internally, but that is separate from the public `/mcp` server.

For the exact endpoint, auth model, and public MCP surface, read [MCP Access](/wiki/getting-started/mcp-access).
