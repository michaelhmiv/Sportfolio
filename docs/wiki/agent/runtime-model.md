---
id: agent-runtime-model
title: Agent Runtime Model
summary: A deeper explanation of Hermes in Sportfolio: threads, continuity, staged plans, tool tiers, MCP precedence, and safety boundaries.
audience: public
category: agent
status: published
owner: product-engineering
lastReviewedAt: 2026-04-02
changeTriggers: server/agent/hermes-orchestrator.ts,server/agent/hermes-tools.ts,server/agent/memory.ts,server/agent/schedules.ts,client/src/features/agent
slug: runtime-model
surface: web,cli,agent
searchKeywords: agent runtime,threads,memory,confirm,cancel,research,schedules,mcp,strategies
---

# Agent Runtime Model

The Sportfolio agent (Hermes) is a model-first product operator — not a hardcoded chatbot. This page explains how it actually works under the hood.

> ℹ️ **Core principle:** The agent can inspect, explain, and prepare. The server owns truth and executes final state changes. This separation keeps flexibility without handing the model direct economic authority.

---

## How a Typical Turn Works

```
You send a message
  → Hermes decides: reply / read tool / research / stage action
  → If action: plan is shown, not applied
  → You review the plan
  → You confirm (or cancel)
  → Server re-validates live state
  → Execution runs (or fails safely if state changed)
```

The re-validation step matters. Account state can change between plan and confirm — the server catches that.

---

## Threads and Conversation State

Every agent conversation is organized into a thread. A thread stores:

- Recent message history
- Staged-plan context
- Research references
- Continuity across turns

This is why the agent can handle follow-up questions cleanly — it's not starting fresh on each message.

---

## Continuity Brief

At the start of each turn, Hermes receives a **server-owned continuity brief.** This is not free-form AI memory — it's a product-owned runtime summary assembled from real Sportfolio state.

The brief covers:

- Recent actions Hermes has already applied
- Pending staged work awaiting confirmation
- Active strategies and their next scheduled evaluations
- Recent evidence updates attached to the thread
- Saved schedules or blocked loops that still matter

---

## Per-User Memory

The agent stores durable memory per user to improve continuity over time. It can remember:

- Recurring preferences
- Prior account discussions
- Useful patterns from past interactions

This memory is **user-local and Sportfolio-specific.** It does not leak across users.

---

## Tool Tiers

Hermes doesn't use a single giant always-on tool universe. The runtime is tiered:

- **General chat** — smallest useful Sportfolio surface
- **Strategy turns** — can add schedule and strategy-specific tools
- **Advanced internals** — stay out of the default allowlist

**MCP follows the same boundary:**

- Native Sportfolio tools = canonical source for account and gameplay state
- Built-in MLB MCP bridge = bounded enrichment
- User-connected external MCP = optional enrichment

MCP sources are never a competing source of truth for account state.

---

## Research Turns

For time-sensitive questions (injuries, news, current events):

1. The server performs the search
2. The model receives structured results (not open browser access)
3. Citations are attached to the answer

This keeps query policy server-controlled while still enabling current-events reasoning.

---

## Confirm and Cancel

Two commands exist for the staged-plan model:

| Command   | Effect                                             |
| --------- | -------------------------------------------------- |
| `confirm` | Apply the pending plan                             |
| `cancel`  | Discard the pending plan without applying anything |

This means you can use the agent for planning and analysis without risking accidental execution.

---

## Runtime Skills

The Hermes runtime can create constrained reusable workflow macros (skills). The key boundaries:

- Skills are macros over approved tools — not new backend powers
- Skills don't bypass confirmation
- Skills don't expand the normal user-facing capability surface

Skills allow Hermes to become more reusable without silently expanding what it's allowed to do.

---

## Strategies and Scheduled Runs

Strategies are saved mandates that let Hermes operate on a recurring schedule.

**What strategies can do:**

- Wake on a saved schedule
- Reason from the continuity brief (prior actions, pending work, fresh evidence)
- Auto-execute the strategy-safe approved action subset

**What strategies cannot do:**

- Auto-confirm risky portfolio actions without explicit approval
- Handle payments, checkout, or external purchase flows
- Act outside their defined guardrails

Each strategy run is audited with runtime transport metadata — so the product can verify whether Hermes ran locally or through the configured sidecar.

---

## Advisory Boundary

The product maintains a strict line between:

- _"Remind me what matters"_ — allowed in scheduled advisory runs
- _"Move my money for me"_ — not allowed without explicit confirmation

---

## What This Design Protects Against

- Accidental one-message execution
- The model acting on stale account assumptions
- Hidden expansion of tool access
- Explanation drift between the wiki and the agent

> ℹ️ This wiki is the same knowledge base the agent uses. They stay in sync by design.

---

## Next Steps

- [Sportfolio Agent](/wiki/features/agent-operator) — user-facing overview of what the agent does
- [MCP Access](/wiki/getting-started/mcp-access) — how the public MCP surface relates to Hermes
- [User Action Surface](/wiki/features/user-action-surface) — full capability map
