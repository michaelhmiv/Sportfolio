---
id: getting-started-access
title: How to Access Sportfolio
summary: The fastest way to reach Sportfolio from web, mobile, CLI, and public MCP, plus how those access paths differ.
audience: public
category: getting-started
status: published
owner: product-engineering
lastReviewedAt: 2026-04-02
changeTriggers: client/src/App.tsx,client/src/components/bottom-nav.tsx,client/src/components/cli-access-card.tsx,client/src/pages/wiki.tsx,packages/sportfolio-cli,server/routes/docs.ts,server/routes/mcp.ts
slug: access
surface: web,cli,agent
searchKeywords: access,how do i access sportfolio,mcp,model context protocol,cli,api token,agent,wiki,mobile
---

# How to Access Sportfolio

Sportfolio has four documented access paths:

| Path        | Best for                                            |
| ----------- | --------------------------------------------------- |
| **Web app** | The primary experience — full UI, real-time updates |
| **Mobile**  | Responsive web; bottom nav optimized for touch      |
| **CLI**     | Terminal workflows, scripting, fast doc lookup      |
| **MCP**     | Connecting Sportfolio to external MCP-aware clients |

---

## Web and Mobile

The web app is the primary surface. It works on all modern browsers and is fully responsive on mobile.

**Mobile navigation:**

- Bottom bar for main pages (Agent, Portfolio, Boosts, etc.)
- Top-bar help icon links directly to the wiki

**Key starting points:**

- `/` — Dashboard (public, no login required)
- `/wiki` — This handbook
- `/agent` — In-app assistant

---

## CLI Access

The CLI lets you use Sportfolio from a terminal using a user-scoped API token.

**Step 1** — Create a token in your profile: **Profile → CLI Access**

**Step 2** — Authenticate:

```bash
sportfolio auth login --token <your-token>
```

Or, if you're running from the repository directly:

```bash
node packages/sportfolio-cli/bin/sportfolio.mjs auth login --token <your-token>
```

For local development:

```bash
npm run cli -- auth login --token <your-token> --base-url http://127.0.0.1:5000
```

**Main CLI command families:**

- `docs` — search and browse the wiki
- `agent` — ask questions, stage confirmed actions
- `portfolio` — account summary
- `actions` — staged gameplay actions (buy, sell, boost, scout)

> ℹ️ The CLI uses the same confirmation rules as the web app. Mutating actions are staged first and require an explicit confirm.

Also see: [CLI Command Reference](/wiki/cli/command-reference)

---

## MCP Access

Sportfolio exposes an authenticated MCP endpoint for external tool integrations.

- **Production:** `https://www.sportfolio.market/mcp`
- **Local dev:** `http://127.0.0.1:5000/mcp`
- **Auth:** Same user API token as CLI, sent as `Authorization: Bearer <token>`

Use MCP when you're wiring Sportfolio into an MCP-aware client (like Claude Desktop or another tool runner), rather than using the CLI directly.

> ℹ️ MCP and CLI share the same public capability registry. Billing, purchase flows, and internal-only routes are excluded from both.

Also see: [MCP Access](/wiki/getting-started/mcp-access)

---

## Token Safety

- Create one token per device or automation task
- Revoke tokens you no longer use (Profile → CLI Access)
- Never commit tokens to source code or shell history
- Always use HTTPS endpoints outside localhost

---

## Next Steps

- [CLI Command Reference](/wiki/cli/command-reference) — full command syntax and examples
- [MCP Access](/wiki/getting-started/mcp-access) — MCP endpoint contract and surface details
- [Sportfolio Agent](/wiki/features/agent-operator) — in-app assistant overview
