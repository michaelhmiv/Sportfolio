---
id: cli-overview
title: CLI and External Access
summary: How to use the Sportfolio CLI for documentation, shared public tool access, account actions, and its relationship to public MCP and Hermes.
audience: public
category: cli
status: published
owner: product-engineering
lastReviewedAt: 2026-05-12
changeTriggers: packages/sportfolio-cli,server/routes/cli.ts,server/api-token-auth.ts,server/routes/mcp.ts
slug: overview
surface: web,cli
searchKeywords: cli,api token,terminal,auth,actions,agent,docs,mcp,external access,model context protocol,hermes
---

# CLI and External Access

The Sportfolio CLI is the canonical automation interface for agents, scripts, developers, and power users. It gives terminal-native access to your account, docs, the agent, and the resolved public capability catalog.

MCP remains available as a compatibility endpoint for MCP-native clients, but most automation should start with the CLI.

> ℹ️ **The CLI does not bypass safety metadata.** Every tool reports its execution model: `read`, `immediate_write`, `staged_write`, or `finalizer`. Staged gameplay actions require an explicit confirm step; some account/settings actions are immediate writes and should be treated as direct changes.

---

## Authentication

CLI access uses a user-scoped API token. Create one in **Profile → CLI Access**, then authenticate:

```bash
# Published package (when available)
sportfolio auth login --token <your-token>

# Repo-local entrypoint
node packages/sportfolio-cli/bin/sportfolio.mjs auth login --token <your-token>

# Against local dev server
npm run cli -- auth login --token <your-token> --base-url http://127.0.0.1:5000

# Against production
npm run cli -- auth login --token <your-token> --base-url https://www.sportfolio.market
```

The token is user-specific — the CLI inherits the same account boundary as the web app.

---

## Command Families

| Family      | What it does                                             |
| ----------- | -------------------------------------------------------- |
| `docs`      | Browse, search, and open wiki articles                   |
| `portfolio` | Account summary and holdings snapshot                    |
| `agent`     | Ask questions, view threads, confirm/cancel staged plans |
| `actions`   | Helper staging for buy/sell/watchlist/community-boost    |
| `tools`     | Call the shared public capability surface directly       |
| `prompts`   | List and render shared starter prompts                   |
| `resources` | Read shared public resources                             |

For full syntax and examples, see [CLI Command Reference](/wiki/cli/command-reference).

---

## Best Use Cases

The CLI is especially useful for:

- **Checking your portfolio** from a workstation or server
- **Searching docs** while trading in another window
- **Scripting account checks** as part of a workflow
- **Using the agent** in developer-heavy or operations-heavy contexts
- **Running shared tools** directly without a protocol client

---

## How CLI Relates to MCP

Sportfolio has one automation contract: the resolved public capability catalog. The CLI is the primary adapter over that catalog; MCP is a compatibility adapter for clients that specifically require Model Context Protocol.

| Surface                    | Use it when                                        | Notes                                                           |
| -------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| Web app                    | You want the normal product UI                     | Token creation remains web-session-only                         |
| CLI                        | You are an agent, script, developer, or power user | Canonical automation path; exposes catalog/schema/call commands |
| MCP compatibility endpoint | Your host client requires MCP                      | Same catalog, plus MCP session/resource semantics               |

For scout, daily-boost, LP, and advanced staged flows, use `agent`, `actions`, or `tools` commands.

---

## Token Safety

- Create one token per device or automation task
- Revoke unused tokens in **Profile → CLI Access**
- Never store tokens in plain shell history
- Always use HTTPS outside localhost

---

## Next Steps

- [CLI Command Reference](/wiki/cli/command-reference) — full command syntax, examples, JSON mode, and troubleshooting
- [MCP Compatibility Endpoint](/wiki/getting-started/mcp-access) — protocol adapter for MCP-aware clients
- [User Action Surface](/wiki/features/user-action-surface) — full capability map across web, CLI, and MCP
