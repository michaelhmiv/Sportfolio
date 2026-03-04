---
id: feature-agent-operator
title: Sportfolio Agent
summary: The full user-facing contract for the Sportfolio agent: what Hermes can read, what it can stage, how confirmation works, and where the boundaries are.
audience: public
category: features
status: published
owner: product-engineering
lastReviewedAt: 2026-03-04
changeTriggers: server/agent,client/src/features/agent,client/src/pages/agent.tsx,server/routes.ts,server/jobs/scheduler.ts
slug: agent-operator
surface: web,cli,agent
searchKeywords: agent,operator,confirmation,brave search,byok,hermes,threads
---

# What the Sportfolio agent is

The Sportfolio agent is a Hermes-backed operating partner. It is designed to help you understand the product, review your account, research current context, and stage supported actions.

It is **not** an autonomous trader.

Sportfolio still owns the real business rules, validation, and state changes. The agent helps orchestrate, explain, and prepare; it does not bypass server-owned protections.

## Hermes-first runtime model

Normal agent turns now route through Hermes first. In practice that means:

- the model can answer directly
- the model can decide to use supported read or research tools
- the model can stage a supported action plan
- risky state changes still wait for your confirmation

This is a model-first operator flow, not a hardcoded chatbot with a single canned response path.

## What it can do well

The strongest current use cases are:

- reviewing your setup
- explaining mechanics and tradeoffs
- reading across supported account surfaces
- discussing whether you should buy, sell, LP, boost, or wait
- staging supported actions for explicit confirmation
- researching current injuries, news, and other time-sensitive context

## Supported staged actions

The current staged mutation surface includes:

- player-pool buys and sells
- LP add, remove, and zap flows
- condense / power-up flows
- daily boost assign and remove
- watchlist add and remove
- scout reallocations
- community boost creation

These actions are prepared first. They are only applied after a clear confirm step.

## Confirmation, cancel, and safety

The agent does not directly apply risky economic actions on its own.

Important rules:

- state-changing actions are staged first
- you confirm before execution
- you can cancel a staged plan instead of applying it
- the server re-validates the request when execution actually happens

This matters because account state can change between "plan" and "confirm."

## Hosted research and citations

When you ask for current news or another time-sensitive topic, the agent can use hosted server-side research.

Today that means:

- the server performs the web research
- the model receives structured results rather than open browser control
- responses should include citations when research is used

This is how the agent can discuss current information without giving the model unrestricted browser access.

## Memory and continuity

The agent keeps per-user memory and conversation threads so that:

- your discussions have continuity
- prior context can be reused
- the same account's history can inform later turns

That memory is user-scoped. It is not meant to leak or blend across users.

## Channels

The same underlying agent logic can be reached through:

- the web Agent page
- the Sportfolio CLI
- the SMS channel after linking

The channel changes the interface. It does not remove the confirmation boundary.

## What it does not do

The current agent should not be treated as:

- an autonomous execution bot
- a replacement for all site UI paths
- a source of truth that overrides the backend
- a way to bypass auth, locks, or economic constraints

## Best ways to use it

High-quality prompts are concrete:

- `review my setup`
- `what should i do with my idle balance?`
- `should i use this player in a boost or just hold?`
- `buy $25 of <player>`
- `research the latest injury news on <player>`

The more specific the goal, the better the agent can decide whether to explain, read, research, or stage an action.

## Canonical knowledge source

The same wiki you are reading is also part of the canonical knowledge base the agent uses for product explanations. That keeps user docs and agent guidance aligned instead of maintaining separate, drifting copies.

For a deeper operational explanation, read [Agent Runtime Model](/wiki/agent/runtime-model).
