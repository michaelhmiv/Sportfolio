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

# CLI and External Access

The Sportfolio CLI gives you terminal-native access to your account, docs, the agent, and the shared public tool surface. It's built for developers, power users, and anyone who prefers keyboard workflows over clicking through the UI.

> ℹ️ **The CLI doesn't bypass any safety rules.** Confirmation-gated actions are still staged first and require an explicit confirm step.

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
| `actions`   | Convenience commands for staged gameplay flows           |
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

Both CLI and MCP share the same public capability registry:

- `docs` commands read the same wiki as the web docs hub
- Account and settings actions follow the same auth rules
- Staged actions use the same confirm/cancel model

The difference is the interface:

- **Use CLI** when you want direct shell commands
- **Use MCP** when you're connecting through an MCP-aware client

---

## Token Safety

- Create one token per device or automation task
- Revoke unused tokens in **Profile → CLI Access**
- Never store tokens in plain shell history
- Always use HTTPS outside localhost

---

## Next Steps

- [CLI Command Reference](/wiki/cli/command-reference) — full command syntax, examples, JSON mode, and troubleshooting
- [MCP Access](/wiki/getting-started/mcp-access) — protocol access for MCP-aware clients
- [User Action Surface](/wiki/features/user-action-surface) — full capability map across web, CLI, and MCP
