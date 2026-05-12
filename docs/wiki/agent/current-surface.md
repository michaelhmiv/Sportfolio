---
id: agent-current-surface
title: Agent Current Surface
summary: The stable Hermes contract for testing and curation: tool tiers, MCP roles, staged mutations, autonomous strategy scope.
audience: public
category: agent
status: published
owner: product-engineering
lastReviewedAt: 2026-05-12
changeTriggers: server/agent/hermes-orchestrator.ts,server/agent/hermes-tools.ts,server/mcp/public-tool-registry.ts
slug: current-surface
surface: agent
searchKeywords: hermes,contract,tools,mcp,strategies,autonomous,confirmation,memory
---

# Agent Current Surface (Hermes Runtime Milestone)

This document defines the current Hermes contract that is considered stable enough for testing and curation.

## Operating Model

- Hermes is Sportfolio's product-native operator, not a broad personal assistant.
- Sportfolio-native Hermes tools are the canonical source for account, portfolio, market, boost, scout, watchlist, and strategy state.
- Built-in and user-connected MCP sources remain available, but only as enrichment after native Sportfolio context is established.
- The normal Hermes path is an in-repo orchestration flow with model-first tool selection, deterministic plan tools, hosted research, and server-owned validation.
- When `HERMES_AGENT_URL` is configured, the main app treats the Hermes sidecar as the required runtime path and records transport and correlation metadata for every turn instead of silently rerouting locally.
- Sportfolio business logic, validation, and execution remain server-owned and deterministic.
- Manual chat and CLI mutations remain confirmation-gated. Saved live strategies may auto-execute only the approved on-platform gameplay action set inside saved guardrails.
- Hosted web research is server-side and provider-agnostic, using Brave Search when configured.
- Durable per-user memory and continuity state are stored in the Sportfolio database and injected into turns before reasoning.
- Active users are auto-seeded with a default daily in-app advisory schedule, and the main cron scheduler runs due Hermes advisory jobs without auto-executing risky actions.

## Tool Surface

- General chat now defaults to the smallest useful product surface:
  - core reads and scans
  - staged gameplay previews
  - confirm and cancel
  - hosted research when needed
- Strategy turns can add a narrow strategy-specific expansion:
  - saved-strategy reads and execution context
  - schedule tools when the user is explicitly working with schedules
  - optional MCP enrichment when the request or strategy genuinely calls for it
- Advanced and internal-only capabilities remain in the repo, but they are no longer part of the normal default user-facing allowlist.
- Runtime skills stay enabled, but only as constrained reusable patterns over the approved Sportfolio surface.

## MCP Roles

- Sportfolio public `/mcp` is the external authenticated protocol surface for MCP-aware clients.
- The built-in MLB MCP bridge is an internal Hermes enrichment source.
- User-added external MCP sources are optional per-user enrichment sources.
- Hermes precedence is:
  - native Sportfolio tools first
  - built-in MLB enrichment second
  - user-added external MCP only when explicitly needed

## Current UI Surface

- The in-app `Agents` tab is split into `Chat` and `Strategies`.
- `Chat` is the general Hermes workspace for one-off portfolio help, current-context questions, and confirmation-gated action staging.
- `Strategies` is the primary recurring-workflow workspace with saved slots, dedicated strategy chats, overview and rules views, and continuity-driven run history.
- Hermes responses may include approved native `uiBlocks` such as `goal_strip`, `pending_decision`, `strategy_draft`, `strategy_status`, `rules_summary`, and `run_summary`.
- The web client renders those blocks with the app-owned terminal and trading design system. Hermes does not control arbitrary layout or executable UI.

## Supported Advisory Coverage

Hermes is strongest at:

- reviewing the current setup
- explaining portfolio, holdings, boosts, scouts, and slate relevance
- reading idle balance and deployable-capital context
- comparing gameplay options such as buy vs LP or boost vs hold
- identifying holdings, lineups, games, or stats that matter to the current account
- using hosted research for current news or injury context when the ask is time-sensitive

## Supported Staged Mutations (Manual Chat and CLI)

Hermes can stage, for confirmation, during manual chat and CLI turns:

- scout reallocations
- player-pool buys and sells
- LP add, remove, and zap flows
- stack-shares and multiplier flows
- daily boost assign and remove
- watchlist add and remove
- community boost creation

These are staged first and only execute after an explicit confirm action from the user.

## Autonomous Strategy Scope

Saved live strategies may run without per-action confirmation, but only inside their saved guardrails.

Current autonomous scope includes:

- player-pool buys and sells
- LP add, remove, and zap flows
- stack shares and multiplier flows
- scout reallocations
- daily boost assign and remove
- watchlist add and remove

Explicit exclusions remain:

- external purchases and checkout flows
- premium-share and premium-access flows
- community boost creation

Broad goals are interpreted as portfolio-management mandates rather than literal single-trade instructions. The runtime should prefer paced and diversified execution over repeatedly buying one name when several names satisfy the mandate.

## Continuous Operator State

- Hermes should not behave like a fresh assistant on every wake.
- Every runtime turn carries a continuity brief assembled from server-owned state, including:
  - recent applied strategy actions
  - pending action bundles
  - live or blocked strategies
  - saved advisory schedules
  - recent evidence updates attached to the active thread
- The continuity brief is advisory context only. Sportfolio still owns execution validation and the final action boundary.

## Active Channels

- Primary: web `/agent` manual chat and saved strategy runs.
- Secondary: CLI access to the same shared product contract.
- Legacy or non-primary: SMS infrastructure may still exist in the codebase, but it is not part of the active primary Hermes contract.

## What Is Explicitly Not Supported

- generalized multi-domain assistant behavior
- autonomous execution without saved strategy guardrails
- LLM-authored economic planning as the source of truth
- admin or destructive operational flows
- guaranteed coverage for every website path a human can perform

## Runtime Skills

- Hermes may create user-scoped runtime skills over existing approved tools after it resolves a reusable workflow.
- These skills do not add any new backend capabilities or bypass confirmation.
- Shared or global skill reuse requires admin approval before promotion.

## Testing Prompts

Use these prompts as the baseline manual test set:

- `review my setup`
- `clean up my portfolio`
- `what should i do with my idle balance?`
- `who should get my community boost today?`
- `what can you do?`
- `buy $25 of <player>`
- `put <player> in my 2x boost slot today`
- `add <player> to my watchlist`
- `research the latest injury news on <player>`

## Smoke Harness

There is a lightweight internal smoke script at:

- `scripts/agent-smoke.ts`

Recommended usage:

```bash
npx tsx scripts/agent-smoke.ts --user <userId>
npx tsx scripts/agent-smoke.ts --user <userId> --include-action-plans
npx tsx scripts/agent-smoke.ts --user <userId> --include-action-plans --live-research
```

The script exercises internal agent modules directly, prints JSON, and does not confirm or execute economic mutations.
