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
surface: web,cli,agent
searchKeywords: capabilities,actions,feature map,web,cli,mcp,agent
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

## Agent Execution Modes

### Manual Chat and CLI Turns

- Mutating actions are staged first
- `confirm` and `cancel` are explicit
- Server re-validates state at execution

### Saved Live Strategy Runs

- Allowlisted actions may auto-execute in saved guardrails:
  - player-pool buys and sells
  - LP add, remove, and zap
  - stack shares
  - scout reallocations
  - daily boost assign and remove
  - watchlist add and remove
- Excluded from auto-runs:
  - payments, checkout, and purchase flows
  - premium purchase flows
  - community boost creation

---

## CLI Actions

The CLI follows the same backend rules as web and MCP.

### Immediate Commands

- `docs list`, `docs search`, `docs open`
- `auth whoami`, `auth logout`
- `portfolio summary`
- `agent threads`
- `tools list`, `tools call`
- `prompts list`, `prompts render`
- `resources list`, `resources read`

### Staged Helper Commands (Confirm Required)

- `actions buy` / `actions sell`
- `actions watchlist add` / `actions watchlist remove`
- `actions community-boost`
- `agent confirm` / `agent cancel`

For scout, daily-boost, LP, and other advanced flows, use `agent` or `tools` commands (same public capability surface, same confirmation semantics).

Command syntax authority: [CLI Command Reference](/wiki/cli/command-reference)

---

## MCP Actions

Public `/mcp` shares the same capability registry as CLI.

### Included

- Reads across portfolio, players, pools, boosts, scouts, watchlists, schedules, docs, news, and threads
- Immediate account actions (profile updates, token management, watchlist CRUD, schedule CRUD, premium redeem)
- Staged gameplay actions (trades, LP, stack shares, boosts, scouts, community boosts)
- Confirm and cancel for pending bundles
- Public prompts and resources
- Dynamic MLB enrichment tools when available (`mlb_mcp__*` names)

### Excluded

- Billing, funding, checkout, and purchase flows
- Admin and internal-only routes

For exhaustive live inventory, read `sportfolio://tool-catalog` through MCP.

---

## Known Practical Constraints

- Agent requests can be temporarily busy if another analysis is running for the same account
- Community boost staging resolves best with full player names
- Some complex workflows are easier in web because the UI exposes richer context panels

---

## Next Steps

- [Sportfolio Agent](/wiki/features/agent-operator) - agent boundaries and strategy behavior
- [CLI Command Reference](/wiki/cli/command-reference) - full syntax
- [MCP Access](/wiki/getting-started/mcp-access) - session protocol and auth details
