---
id: agent-runtime-model
title: Agent Runtime Model
summary: A deeper explanation of the Sportfolio agent's threads, memory, research, staged plans, confirmations, and safety boundaries.
audience: public
category: agent
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: server/agent/hermes-orchestrator.ts,server/agent/hermes-tools.ts,server/agent/memory.ts,server/agent/schedules.ts,client/src/features/agent
slug: runtime-model
surface: web,cli,agent
searchKeywords: agent runtime,threads,memory,confirm,cancel,research,schedules
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

## Per-user memory

The agent stores durable memory per user to improve continuity over time.

In practical terms, this allows it to remember patterns such as:

- recurring preferences
- prior account discussions
- useful prior context from the same user

The intended scope is user-local, not global.

## How a normal turn is handled

A typical turn follows this sequence:

1. Hermes receives the message.
2. The model decides whether to reply directly, read from a tool, run hosted research, or stage a supported action.
3. If an action is staged, the system presents a plan instead of immediately applying it.
4. A separate confirm step is required before execution.

This is why a conversational request can turn into an executable plan without collapsing the safety model.

## Research turns

For time-sensitive questions, the agent can use hosted research.

That means:

- the server performs the search
- the model receives summarized structured results
- cited sources can be attached to the answer

This is different from giving the model a free browser. It keeps query policy and source collection server-controlled.

## Action turns

When a request could change account state, the agent does not treat "I mentioned it" as "I approved it."

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

- **confirm**: apply the pending plan
- **cancel**: discard the pending plan

This gives you a clean way to use the agent for analysis and planning without accidentally applying every draft idea.

## Runtime skills

The Hermes runtime can create constrained reusable skills, but the important boundary is unchanged:

- skills are macros over approved tools
- skills do not create new backend powers
- skills do not bypass confirmation

This allows the agent to become more reusable without silently widening what it is allowed to do.

## Schedules and advisory behavior

The agent can also participate in scheduled advisory behavior.

The design goal is advisory continuity:

- scheduled runs can generate guidance
- scheduled runs do not auto-confirm risky portfolio actions

The product keeps a strict line between "remind me what matters" and "move my money for me."

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
