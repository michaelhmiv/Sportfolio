---
id: agent-runtime-model
title: Agent Runtime Model
summary: A deeper explanation of Hermes in Sportfolio: threads, continuity, staged plans, tool tiers, MCP precedence, and safety boundaries.
audience: public
category: agent
status: published
owner: product-engineering
lastReviewedAt: 2026-05-12
changeTriggers: server/agent/hermes-orchestrator.ts,server/agent/hermes-tools.ts,server/agent/memory.ts,server/agent/schedules.ts,client/src/features/agent
slug: runtime-model
surface: web,cli,agent
searchKeywords: agent runtime,threads,memory,confirm,cancel,research,schedules,mcp,strategies
---

# Agent Runtime Model

The Sportfolio agent (Hermes) is a model-first product operator, not a hardcoded chatbot. This page explains how it works under the hood.

> Core principle: Hermes can inspect, explain, and prepare actions. Server-side validation and execution remain the source of truth.

---

## Execution Modes

| Mode                     | Behavior                                                                       |
| ------------------------ | ------------------------------------------------------------------------------ |
| Manual chat and CLI      | Mutating actions are staged first, then require explicit `confirm` or `cancel` |
| Saved live strategy runs | Allowlisted gameplay actions may auto-execute inside saved guardrails          |

Strategy auto-execution exclusions are fixed: payments, checkout, purchases, premium purchase flows, and community boost creation.

---

## How a Typical Manual Turn Works

```
You send a message
  -> Hermes decides: reply / read tool / research / stage action
  -> If action: plan is shown, not applied
  -> You review the plan
  -> You confirm (or cancel)
  -> Server re-validates live state
  -> Execution runs (or fails safely if state changed)
```

The re-validation step matters because account state can change between stage and confirm.

---

## Threads and Conversation State

Every conversation is organized into a thread. A thread stores:

- Recent message history
- Staged-plan context
- Research references
- Continuity across turns

This is why follow-up questions can stay grounded in prior context.

---

## Continuity Brief

At the start of each turn, Hermes receives a server-owned continuity brief assembled from live Sportfolio state.

The brief covers:

- Recent actions already applied
- Pending staged work awaiting confirmation
- Active strategies and next evaluations
- Recent evidence updates attached to the thread
- Saved schedules or blocked loops that still matter

---

## Per-User Memory

The agent stores durable memory per user for continuity:

- Recurring preferences
- Prior account discussions
- Useful patterns from past interactions

Memory is user-local and Sportfolio-specific.

---

## Tool Tiers

Hermes does not run a single giant always-on tool set:

- **General chat** - smallest useful Sportfolio surface
- **Strategy turns** - adds schedule and strategy-specific tools
- **Advanced internals** - not part of the default user allowlist

MCP follows the same boundary:

- Native Sportfolio tools are canonical for account and gameplay state
- Built-in MLB MCP bridge is bounded enrichment
- User-connected external MCP is optional enrichment

---

## Research Turns

For time-sensitive asks (injuries, news, current events):

1. Server performs the search
2. Model receives structured results (not open browser access)
3. Citations are attached to the answer

---

## Confirm and Cancel

| Command   | Effect                            |
| --------- | --------------------------------- |
| `confirm` | Apply the pending manual bundle   |
| `cancel`  | Discard the pending manual bundle |

---

## Runtime Skills

Hermes can create constrained reusable workflow macros (skills):

- Skills are macros over approved tools, not new backend powers
- Skills do not bypass confirmation boundaries for manual turns
- Skills do not expand the public capability surface on their own

---

## Strategies and Scheduled Runs

Saved strategies are recurring mandates that can run on schedule.

**Saved live strategies may auto-execute:**

- Player-pool buys and sells
- LP add, remove, and zap flows
- Stack shares and multiplier flows
- Scout reallocations
- Daily boost assign and remove
- Watchlist add and remove

**Saved live strategies cannot auto-run:**

- Billing, payments, checkout, or purchase flows
- Premium-share and premium-access purchase flows
- Community boost creation
- Any action outside strategy guardrails

Each strategy run is audited with runtime metadata.

---

## What This Design Protects Against

- Accidental one-message manual execution
- Model actions based on stale account assumptions
- Hidden expansion of tool access
- Explanation drift between wiki and runtime behavior

This wiki is also used as agent knowledge context so behavior and documentation can stay aligned.

---

## Next Steps

- [Sportfolio Agent](/wiki/features/agent-operator) - user-facing overview
- [MCP Access](/wiki/getting-started/mcp-access) - how public MCP relates to Hermes
- [User Action Surface](/wiki/features/user-action-surface) - capability map
