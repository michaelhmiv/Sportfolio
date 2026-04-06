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

# The agent runs as an operator, not an owner

The agent can inspect, explain, and prepare. The server still owns truth.

That is the key runtime boundary:

- the agent can reason about your account
- the agent can stage a supported action
- the server validates and executes the real mutation

This keeps language-model flexibility without handing the model direct authority over the economy.

## Threads and conversation state

Agent conversations are organized into threads.

A thread exists so the system can keep:

- recent message history
- staged-plan context
- research references
- continuity across turns

That is why the agent can handle follow-up questions more cleanly than a stateless one-shot command.

## Continuity brief

Hermes also receives a server-owned continuity brief on each run.

This brief is meant to stop the fresh-start problem. It summarizes:

- recent actions Hermes already applied
- pending staged work that still needs confirmation or clarification
- active strategies and their next scheduled evaluations
- recent evidence updates attached to the thread
- saved schedules or blocked loops that still matter

The important design choice is that this is not freeform model memory. It is a product-owned runtime summary assembled from real Sportfolio state.

## Per-user memory

The agent stores durable memory per user to improve continuity over time.

In practical terms, this allows it to remember patterns such as:

- recurring preferences
- prior account discussions
- useful prior context from the same user

The intended scope is user-local, Sportfolio-specific, and not global.

## How a normal turn is handled

A typical turn follows this sequence:

1. Hermes receives the message.
2. The model decides whether to reply directly, read from a tool, run hosted research, or stage a supported action.
3. If an action is staged, the system presents a plan instead of immediately applying it.
4. A separate confirm step is required before execution.

This is why a conversational request can turn into an executable plan without collapsing the safety model.

## Tool tiers and MCP precedence

Hermes does not use one giant always-on tool universe anymore.

The runtime is intentionally tiered:

- general chat gets the smallest useful Sportfolio surface first
- strategy turns can add schedule and strategy-specific tools
- advanced internals stay out of the normal default allowlist

MCP follows the same product boundary:

- native Sportfolio tools are the canonical source for account and gameplay state
- the built-in MLB MCP bridge is bounded enrichment
- user-connected external MCP sources are optional enrichment

That keeps Hermes from treating every attached data source as a competing source of truth.

## Research turns

For time-sensitive questions, the agent can use hosted research.

That means:

- the server performs the search
- the model receives summarized structured results
- cited sources can be attached to the answer

This is different from giving the model a free browser. It keeps query policy and source collection server-controlled.

## Action turns

When a request could change account state, the agent does not treat I mentioned it as I approved it.

The action flow is:

- interpret the intent
- build a supported plan
- show the plan
- wait for an explicit confirm
- re-check live state
- execute if still valid

If account conditions changed in the meantime, execution can still fail safely.

## Confirm and cancel

Two commands matter in the staged-plan model:

- confirm: apply the pending plan
- cancel: discard the pending plan

This gives you a clean way to use the agent for analysis and planning without accidentally applying every draft idea.

## Runtime skills

The Hermes runtime can create constrained reusable skills, but the important boundary is unchanged:

- skills are macros over approved tools
- skills do not create new backend powers
- skills do not bypass confirmation
- skills do not widen the normal user-facing runtime surface

This allows the agent to become more reusable without silently widening what it is allowed to do.

## Schedules and advisory behavior

The agent can also participate in scheduled advisory behavior.

The design goal is advisory continuity:

- scheduled runs can generate guidance
- scheduled runs do not auto-confirm risky portfolio actions
- scheduled runs use the same continuity brief as manual chat, so Hermes can reason from what already happened instead of starting over

The product keeps a strict line between remind me what matters and move my money for me.

The active primary contract is centered on the web Agent surface and saved strategy runs. CLI remains a secondary access path. Legacy SMS infrastructure is not part of the primary Hermes contract.

## Live strategies

Strategies are a separate saved-mandate layer on top of Hermes.

In practical terms:

- a strategy stores the user's mandate, rule sheet, and guardrails
- Hermes still decides what to do on each run
- the server still enforces the allowed action envelope
- each strategy run sees prior applied actions, pending work, and fresh evidence through the continuity brief
- Hermes never handles payments, Whop checkout, add-cash flows, or any other external purchase action
- strategy runs are audited with runtime transport metadata so the product can prove whether Hermes ran locally or through the configured sidecar

Today the live auto-execution surface is intentionally narrow and only covers the approved strategy-safe action subset.

## What good agent usage looks like

Use the agent when you want:

- a read across several product surfaces at once
- a mechanics explanation in plain language
- current-news research with citations
- a structured plan before you commit

Use the direct UI when you already know exactly what you want and do not need discussion.

## What the runtime model protects against

This design protects against several common failures:

- accidental one-message execution
- the model acting on stale account assumptions
- hidden expansion of tool access
- explanation drift between docs and the agent

The point is not to make the agent weaker. The point is to make it useful without making the economy unsafe.
