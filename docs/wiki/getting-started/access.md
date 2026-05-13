---
id: getting-started-access
title: How to Access Sportfolio
summary: The fastest way to reach Sportfolio from web, mobile, CLI, and public MCP, plus how those access paths differ.
audience: public
category: getting-started
status: published
owner: product-engineering
lastReviewedAt: 2026-05-12
changeTriggers: client/src/App.tsx,client/src/components/bottom-nav.tsx,client/src/components/cli-access-card.tsx,client/src/pages/wiki.tsx,packages/sportfolio-cli,server/routes/docs.ts,server/routes/mcp.ts
slug: access
surface: web,cli,agent
searchKeywords: access,how do i access sportfolio,mcp,model context protocol,cli,api token,agent,wiki,mobile
---

# How to Access Sportfolio

Sportfolio has four documented access paths:

| Path           | Best for                                                 |
| -------------- | -------------------------------------------------------- |
| **Web app**    | Primary experience with full UI and real-time updates    |
| **Mobile web** | Responsive touch-first use with bottom navigation        |
| **CLI**        | Terminal workflows, scripting, and fast docs/tool access |
| **MCP**        | Connecting Sportfolio to external MCP-aware clients      |

---

## Web and Mobile

The web app is the primary surface. It is fully responsive on mobile browsers.

**Mobile navigation:**

- Bottom bar for main pages (Agent, Portfolio, Boosts, and more)
- Top-bar help icon to `/wiki`

**Key starting points:**

- `/` - Dashboard
- `/wiki` - Documentation hub
- `/agent` - In-app assistant

---

## CLI Access

The CLI uses a user-scoped API token.

**Step 1** - Create a token in **Profile -> CLI Access**

**Step 2** - Authenticate:

```bash
sportfolio auth login --token <your-token>
```

Repo-local entrypoint:

```bash
node packages/sportfolio-cli/bin/sportfolio.mjs auth login --token <your-token>
```

Local development example:

```bash
npm run cli -- auth login --token <your-token> --base-url http://127.0.0.1:5000
```

**Main CLI command families:**

- `docs` - wiki navigation (`list`, `search`, `open`)
- `agent` - ask questions and confirm/cancel staged plans
- `portfolio` - account snapshot
- `actions` - helper staging commands only for `buy`, `sell`, `watchlist add/remove`, and `community-boost`
- `tools` - shared capability surface, including scout, daily-boost, LP, and other advanced flows

Manual CLI action turns are confirmation-gated. For full syntax and authoritative command details, see [CLI Command Reference](/wiki/cli/command-reference).

---

## MCP Access

Sportfolio exposes an authenticated MCP endpoint for external integrations.

- **Production:** `https://www.sportfolio.market/mcp`
- **Local dev:** `http://127.0.0.1:5000/mcp`
- **Auth:** `Authorization: Bearer <token>` (same token used by CLI)

Use MCP when integrating through an MCP-aware client instead of direct CLI usage.

MCP and CLI share the same public capability registry. Billing, funding, checkout, purchase flows, and internal-only routes are excluded.

See [MCP Access](/wiki/getting-started/mcp-access) for session lifecycle and protocol details.

---

## Token Safety

- Create one token per device or automation task
- Revoke unused tokens in **Profile -> CLI Access**
- Never commit tokens to source control or logs
- Use HTTPS outside localhost

---

## Next Steps

- [CLI Command Reference](/wiki/cli/command-reference) - full CLI syntax and examples
- [MCP Access](/wiki/getting-started/mcp-access) - endpoint contract and session semantics
- [Sportfolio Agent](/wiki/features/agent-operator) - manual chat vs saved strategy behavior
