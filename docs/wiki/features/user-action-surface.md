---
id: feature-user-action-surface
title: User Action Surface
summary: A practical map of the primary user action surface across web, CLI, and public MCP, including which flows are immediate versus confirmation-gated.
audience: public
category: features
status: published
owner: product-engineering
lastReviewedAt: 2026-05-12
changeTriggers: client/src/App.tsx,client/src/components/app-sidebar.tsx,server/routes.ts,server/routes/amm.ts,server/routes/lp.ts,server/routes/cli.ts,server/routes/mcp.ts,server/mcp/public-tool-registry.ts
slug: user-action-surface
surface: web,cli
searchKeywords: capabilities,actions,feature map,web,cli,mcp
---

# User Action Surface

A single reference for which actions are available, where they live, and how execution is gated.

> Manual chat and CLI turns: reads are immediate, mutating actions stage first and require explicit confirm. Saved live strategies: allowlisted gameplay actions may auto-execute inside guardrails. Payments, checkout, purchases, and community boost creation are excluded from auto-runs.

---

## Web App Actions

### Market and Liquidity

- Browse player pools and prices
- Preview AMM trade quotes
- Execute buy and sell trades
- Add and remove LP liquidity
- View LP history

### Portfolio and Inventory

- View holdings, net worth, and activity
- Manage watchlists
- View and manage scouts

### Boost and Slate Flows

- View daily boost eligibility
- Assign and remove daily boost slots
- View community boost eligibility
- Create community boosts (when eligible inventory exists)

### Account and Access

- Update profile username and avatar
- Generate and revoke CLI API tokens

---

## CLI Actions

The CLI follows the same backend rules as web and MCP.

### Immediate Commands

- `docs list`, `docs search`, `docs open`
- `auth whoami`, `auth logout`
- `portfolio summary`
- `tools list`, `tools call`
- `prompts list`, `prompts render`
- `resources list`, `resources read`

### Staged Helper Commands (Confirm Required)

- `actions buy` / `actions sell`
- `actions watchlist add` / `actions watchlist remove`
- `actions community-boost`

Command syntax authority: [CLI Command Reference](/wiki/cli/command-reference)

---

## MCP Actions

Public `/mcp` shares the same capability registry as CLI.

### Included

- Reads across portfolio, players, pools, boosts, scouts, watchlists, schedules, docs, news, and threads
- Immediate account actions (profile updates, token management, watchlist CRUD, schedule CRUD, premium redeem)
- Staged gameplay actions (trades, LP, boosts, scouts, community boosts)
- Confirm and cancel for pending bundles
- Public prompts and resources
- Static semantic MLB tools for players, leaders, games, standings, rosters, and Statcast profiles

### Excluded

- Billing, funding, checkout, and purchase flows
- Admin and internal-only routes

For exhaustive live inventory, read `sportfolio://tool-catalog` through MCP.

---

## Known Practical Constraints

- Community boost staging resolves best with full player names
- Some complex workflows are easier in web because the UI exposes richer context panels

---

## Next Steps

- [CLI Command Reference](/wiki/cli/command-reference) - full syntax
- [MCP Access](/wiki/getting-started/mcp-access) - session protocol and auth details
