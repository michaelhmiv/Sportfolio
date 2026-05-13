---
id: agent-mcp-tool-reference
title: MCP Tool Reference
summary: Curated high-signal reference for Sportfolio public MCP behavior: naming, confirmation semantics, payload structure, and truncation handling.
audience: public
category: agent
status: published
owner: product-engineering
lastReviewedAt: 2026-05-12
changeTriggers: server/mcp/public-tool-registry.ts,server/routes/mcp.ts
slug: mcp-tool-reference
surface: web,agent
searchKeywords: mcp,tools,catalog,truncation,structuredContent,confirmation,mlb
---

# MCP Tool Reference

This page is intentionally curated. It documents stable, high-signal MCP behavior and avoids hand-maintained exhaustive tool tables.

For exhaustive live inventory, use `sportfolio://tool-catalog` through MCP.

For endpoint/auth/session basics, see [MCP Access](/wiki/getting-started/mcp-access).

---

## Canonical Machine-Readable Resources

Treat these resources as source-of-truth for tooling and capability metadata:

| Resource                      | Purpose                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `sportfolio://capabilities`   | Included/excluded capability inventory + dynamic source status         |
| `sportfolio://action-surface` | Curated action metadata (`readOnly`, `confirmationModel`, `riskLevel`) |
| `sportfolio://tool-catalog`   | Exhaustive tool metadata, including dynamic providers                  |

---

## Tool Naming Reality

### Static Sportfolio tools

Static public tools use names like:

- `get_portfolio_summary`
- `stage_market_buy`
- `confirm_pending_action`

### Dynamic MLB tools

Dynamic MLB enrichment tools are registered at runtime and use `mlb_mcp__*` names, for example:

- `mlb_mcp__get_schedule`
- `mlb_mcp__get_statcast_batter_exitvelo_barrels`

If MLB provider availability changes, the dynamic subset can change. Always inspect `sportfolio://tool-catalog` instead of hardcoding a list.

---

## Confirmation Model Semantics

`confirmationModel` in action metadata is the canonical execution hint:

| Value                 | Meaning                                                                      |
| --------------------- | ---------------------------------------------------------------------------- |
| `immediate`           | Executes immediately (read tools and some account actions)                   |
| `staged_confirmation` | Creates pending bundle; requires explicit confirm                            |
| `finalizer`           | Resolves pending bundle (`confirm_pending_action` / `cancel_pending_action`) |

Manual chat and CLI flows rely on this staged model. Saved live strategies may auto-execute only their allowlisted subset within guardrails.

---

## `content` vs `structuredContent`

Tool results include both fields:

| Field               | Use                                          |
| ------------------- | -------------------------------------------- |
| `content`           | Human-readable summary text                  |
| `structuredContent` | Canonical payload for parsing and automation |

Parse `structuredContent` first.

```python
result = client.call_tool("search_players", {"query": "Alvarez"})
payload = result.get("structuredContent", {})
players = payload.get("results", [])
```

---

## Parameter and Payload Conventions

- Argument keys are camelCase
- Many action tools stage first and return pending bundle metadata
- Field names can differ from user phrasing (`playerId`, `amount`, `quantity`, `threadId`)

Use `inputFieldNames` in `sportfolio://tool-catalog` to avoid guessing argument keys.

---

## Truncation Patterns and Safer Querying

Some MLB/statcast responses are large and can be truncated by transport/content limits.

### Recommended pattern

- Prefer tools with pagination controls
- Request narrow slices (`start_row` / `end_row`, small date windows)
- Aggregate client-side

Example:

```python
client.call_tool("mlb_mcp__get_statcast_batter_exitvelo_barrels", {
  "year": 2026,
  "start_row": 0,
  "end_row": 25
})
```

When precision matters, run multiple small calls rather than one very large call.

---

## Legacy but Exposed Capability Notes

Some capabilities may remain exposed for compatibility (for example SMS settings/linking endpoints) even though they are not part of the active primary Hermes contract.

Use `sportfolio://capabilities` and product docs together:

- Capability visibility tells you what is callable
- Product contract docs tell you what is primary vs legacy

---

## Practical Workflow

1. Initialize MCP session and capture `mcp-session-id`
2. Read `sportfolio://tool-catalog`
3. Resolve tool name + `inputFieldNames`
4. Call read tools first
5. For staged actions, call stage tool then `confirm_pending_action` or `cancel_pending_action`

---

## Next Steps

- [MCP Access](/wiki/getting-started/mcp-access) - endpoint, auth, session lifecycle
- [User Action Surface](/wiki/features/user-action-surface) - cross-surface action map
- [CLI Command Reference](/wiki/cli/command-reference) - CLI syntax aligned to the same registry
