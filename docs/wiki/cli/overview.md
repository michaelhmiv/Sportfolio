---
id: cli-overview
title: CLI and External Access
summary: How to use the Sportfolio CLI for documentation, shared public tools, and account actions.
audience: public
category: cli
status: published
owner: product-engineering
lastReviewedAt: 2026-08-06
changeTriggers: packages/sportfolio-cli,server/routes/cli.ts,server/api-token-auth.ts,server/routes/mcp.ts
slug: overview
surface: web,cli
searchKeywords: cli,api token,terminal,auth,actions,docs,mcp,external access,model context protocol
---

# CLI and External Access

The Sportfolio CLI provides terminal-native access to account data, documentation, and the same public capability catalog used by MCP.

Every tool reports an execution model: `read`, `immediate_write`, `staged_write`, or `finalizer`. Staged gameplay actions require explicit confirmation.

## Authentication

Create a user-scoped token in **Profile → CLI Access**, then authenticate:

```bash
sportfolio auth login --token <your-token>
node packages/sportfolio-cli/bin/sportfolio.mjs auth login --token <your-token>
npm run cli -- auth login --token <your-token> --base-url http://127.0.0.1:5000
```

## Command families

| Family      | Purpose                                        |
| ----------- | ---------------------------------------------- |
| `docs`      | Browse, search, and open handbook articles     |
| `portfolio` | Read account and holdings summaries            |
| `actions`   | Stage supported gameplay changes               |
| `tools`     | Inspect and call the public capability catalog |
| `prompts`   | List and render starter prompts                |
| `resources` | Read public resources                          |

Use `actions` or `tools` for confirmation-gated gameplay flows. Confirmation and cancellation use the returned transaction ID.

## CLI and MCP

The CLI and MCP endpoint are adapters over one public catalog. Use the CLI for terminal automation and `/mcp` when a host specifically requires Model Context Protocol.

## Token safety

Create one token per device or automation, revoke unused tokens, never store tokens in shell history, and use HTTPS outside localhost.
