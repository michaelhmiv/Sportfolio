---
id: feature-user-action-surface
title: User Action Surface
summary: A practical map of the primary user action surface across web, CLI, and public MCP, including which flows are immediate versus confirmation-gated.
audience: public
category: features
status: published
owner: product-engineering
lastReviewedAt: 2026-04-02
changeTriggers: client/src/App.tsx,client/src/components/app-sidebar.tsx,server/routes.ts,server/routes/amm.ts,server/routes/lp.ts,server/routes/cli.ts,server/routes/mcp.ts,server/mcp/public-tool-registry.ts
slug: user-action-surface
surface: web,cli,agent
searchKeywords: capabilities,actions,feature map,web,cli,mcp,agent
---

# User Action Surface

A single reference for what actions are available, which surface they live on, and whether they're immediate or confirmation-gated.

> ℹ️ **Confirmation model:** Reads and explanations are immediate. State-changing actions are staged first and require an explicit confirm step. Cancel is always available before execution.

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
- Stack eligible shares into multiplier inventory

### Boost and Slate Flows

- View daily boost eligibility
- Assign and remove daily boost slots
- View community boost eligibility
- Create community boosts (when eligible inventory exists)

### Account and Access

- Update profile username and avatar
- Generate and revoke CLI API tokens
- Manage agent profile settings

---

## CLI Actions

The CLI uses the same backend rules as the web. It does **not** bypass confirmation requirements.

### Immediate Actions

- `docs browse`, `search`, `open` — wiki navigation
- `auth whoami`, `logout` — auth status
- `portfolio summary` — account snapshot
- `agent threads` — view conversation history
- `tools list`, `tools call` — shared tool surface
- `prompts list`, `prompts render` — shared prompts
- `resources list`, `resources read` — shared resources

### Confirmation-Gated (staged first)

- `actions buy` / `actions sell` — trade staging
- `actions watchlist add` / `remove` — watchlist staging
- `actions community-boost` — community boost staging
- `agent confirm` / `agent cancel` — execute or discard a staged plan

For full syntax, see [CLI Command Reference](/wiki/cli/command-reference).

---

## MCP Actions

The public `/mcp` endpoint shares the same capability registry as the CLI, designed for MCP-aware clients.

### Included

- All reads across portfolio, players, pools, boosts, scouts, watchlists, schedules, docs, news, and threads
- Immediate account actions: profile updates, token management, watchlist CRUD, schedule CRUD, premium redeem
- Staged gameplay actions: trades, LP flows, stack shares, boosts, scouts, community boosts
- Confirm and cancel for pending action bundles
- Public docs resources and prompts

### Excluded

- Billing, funding, checkout, and external purchase flows
- Admin and internal-only routes

For connection details, see [MCP Access](/wiki/getting-started/mcp-access).

---

## Known Practical Constraints

- Agent requests can be temporarily busy if another analysis is already running for the same account — retry after a few seconds
- Community boost staging works best with full player names (e.g., `Nikola Jokic` not `jokic`)
- Some advanced market operations are easier in the web UI because of richer context panels

---

## Next Steps

- [Sportfolio Agent](/wiki/features/agent-operator) — what the agent can and can't do
- [CLI Command Reference](/wiki/cli/command-reference) — full CLI syntax
- [MCP Access](/wiki/getting-started/mcp-access) — MCP endpoint and auth
