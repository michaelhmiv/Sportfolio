---
id: cli-command-reference
title: CLI Command Reference
summary: End-to-end setup, command syntax, JSON automation mode, and troubleshooting for the Sportfolio CLI.
audience: public
category: cli
status: published
owner: product-engineering
lastReviewedAt: 2026-03-12
changeTriggers: package.json,packages/sportfolio-cli/src/index.mjs,packages/sportfolio-cli/src/http.mjs,server/routes/cli.ts,client/src/components/cli-access-card.tsx
slug: command-reference
surface: web,cli,agent
searchKeywords: cli commands,quickstart,token,json,automation,troubleshooting
---

# CLI Command Reference

Full syntax, examples, and troubleshooting for the Sportfolio CLI.

---

## Quickstart

The CLI package is currently repo-local. From the project root:

```bash
npm run cli -- --help
```

Create an API token at **Profile → CLI Access**, then authenticate:

```bash
# Production
npm run cli -- auth login --token <your-token> --base-url https://www.sportfolio.market

# Local development
npm run cli -- auth login --token <your-token> --base-url http://127.0.0.1:5000
```

---

## All Commands

```bash
# ── Auth ──────────────────────────────────────────────────
npm run cli -- auth login --token <token> [--base-url <url>]
npm run cli -- auth whoami
npm run cli -- auth logout

# ── Docs ──────────────────────────────────────────────────
npm run cli -- docs list
npm run cli -- docs search <query>
npm run cli -- docs open <section>/<slug>

# ── Portfolio ─────────────────────────────────────────────
npm run cli -- portfolio summary

# ── Agent ─────────────────────────────────────────────────
npm run cli -- agent threads
npm run cli -- agent ask "<prompt>" [--thread <threadId>]
npm run cli -- agent confirm <threadId> [--pending-bundle <bundleId>]
npm run cli -- agent cancel <threadId> [--pending-bundle <bundleId>]

# ── Staged Actions (require explicit confirm) ──────────────
npm run cli -- actions buy <player-name-or-id> --dollars <amount> [--thread <threadId>]
npm run cli -- actions sell <player-name-or-id> --shares <amount> [--thread <threadId>]
npm run cli -- actions watchlist add <player-name-or-id> [--thread <threadId>]
npm run cli -- actions watchlist remove <player-name-or-id> [--thread <threadId>]
npm run cli -- actions community-boost <player-name> [--timing today|tomorrow] [--thread <threadId>]

# ── Shared Public Capability Surface ──────────────────────
npm run cli -- tools list
npm run cli -- tools catalog
npm run cli -- tools schema <tool-name>
npm run cli -- tools call <tool-name> [--args-json '{"key":"value"}']
npm run cli -- prompts list
npm run cli -- prompts render <prompt-name> [--args-json '{"key":"value"}']
npm run cli -- resources list
npm run cli -- resources read <uri>
```

---

## JSON Mode

Add `--json` to any command for machine-readable output:

```bash
npm run cli -- --json auth whoami
npm run cli -- --json agent ask "what is my available cash?"
npm run cli -- --json portfolio summary
npm run cli -- --json tools catalog
npm run cli -- --json tools schema stage_market_buy
npm run cli -- --json tools call get_account_profile
```

JSON mode is useful for scripting, piping output to `jq`, or building automation workflows.

---

## Shared Tool Surface

The CLI is the canonical automation adapter over Sportfolio's resolved public capability catalog. Use MCP only when a host client specifically requires the Model Context Protocol.

| Command                 | What it does                                                                  |
| ----------------------- | ----------------------------------------------------------------------------- |
| `tools list`            | Human-readable tool list with execution model/risk/confirmation hints         |
| `tools catalog`         | Full resolved catalog: static Sportfolio tools + dynamic MLB tools when live  |
| `tools schema <name>`   | Inspect one tool's inputs, execution model, provider, and confirmation needs  |
| `tools call <name>`     | Execute a read, immediate write, staged write, finalizer, or dynamic MLB tool |
| `prompts render <name>` | Expand a shared starter prompt                                                |
| `resources read <uri>`  | Read a public resource (e.g., `sportfolio://docs/index`)                      |

Tool output exposes four execution models:

| Model             | Meaning                                                        |
| ----------------- | -------------------------------------------------------------- |
| `read`            | No write side effects                                          |
| `immediate_write` | Executes immediately; treat as a direct account/product change |
| `staged_write`    | Creates a pending bundle that requires confirm/cancel          |
| `finalizer`       | Confirms or cancels a pending staged bundle                    |

---

## Troubleshooting

| Error                              | Fix                                                      |
| ---------------------------------- | -------------------------------------------------------- |
| `Not logged in`                    | Run `auth login` with a valid API token                  |
| `Network error contacting ...`     | Verify `--base-url` and that the server is reachable     |
| `Agent is currently processing...` | Retry after a few seconds                                |
| Community boost not resolving      | Use full player names (e.g., `Nikola Jokic` not `jokic`) |

---

## Next Steps

- [CLI Overview](/wiki/cli/overview) — when to use CLI vs. MCP
- [User Action Surface](/wiki/features/user-action-surface) — full capability map
- [MCP Compatibility Endpoint](/wiki/getting-started/mcp-access) — protocol adapter for external MCP clients
