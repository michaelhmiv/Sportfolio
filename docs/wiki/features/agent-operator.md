---
id: feature-agent-operator
title: Sportfolio Agent
summary: The full user-facing contract for Hermes in Sportfolio: what it reads well, what it can stage, how strategies fit, and where the safety boundaries stay.
audience: public
category: features
status: published
owner: product-engineering
lastReviewedAt: 2026-04-02
changeTriggers: server/agent,client/src/features/agent,client/src/pages/agent.tsx,server/routes.ts,server/jobs/scheduler.ts
slug: agent-operator
surface: web,cli,agent
searchKeywords: agent,operator,confirmation,hermes,threads,strategies,mcp
---

# What the Sportfolio agent is

The Sportfolio agent is a Hermes-backed product operator. It is designed to help you understand Sportfolio state, review your account, read current context, and stage supported gameplay actions.

It is not a general personal assistant or an autonomous trader.

Sportfolio still owns the real business rules, validation, and state changes. The agent helps orchestrate, explain, and prepare; it does not bypass server-owned protections.

## Hermes-first runtime model

Normal agent turns now route through Hermes first. In practice that means:

- the model can answer directly
- the model can decide to use supported read or research tools
- the model can stage a supported action plan
- risky state changes still wait for your confirmation
- native Sportfolio tools stay the source of truth for account and gameplay state
- built-in or user-connected MCP sources are used only as enrichment when native tools do not already answer the question

This is a model-first operator flow, not a hardcoded chatbot with a single canned response path.

## What it can do well

The strongest current use cases are:

- reviewing your setup
- explaining mechanics, holdings, boosts, scouts, and slate tradeoffs
- reading across supported account and market surfaces
- discussing whether you should buy, sell, LP, boost, condense, or wait
- identifying what lineups, games, stats, or news matter to your current holdings
- staging supported actions for explicit confirmation
- running saved strategies inside approved guardrails
- researching current injuries, news, and other time-sensitive context when needed

## Supported staged actions

The current staged mutation surface includes:

- player-pool buys and sells
- LP add, remove, and zap flows
- stack shares and stack-shares flows
- daily boost assign and remove
- watchlist add and remove
- scout reallocations
- community boost creation

These actions are prepared first. They are only applied after a clear confirm step.

## Saved strategies

Saved strategies are the recurring layer on top of normal chat.

They let Hermes:

- wake on a saved schedule or trigger
- reason from the same continuity state as manual chat
- auto-execute only the approved strategy-safe gameplay subset

They do not turn Hermes into an unrestricted automation bot.

## Confirmation, cancel, and safety

The agent does not directly apply risky economic actions on its own.

Important rules:

- state-changing actions are staged first
- you confirm before execution
- you can cancel a staged plan instead of applying it
- the server re-validates the request when execution actually happens

This matters because account state can change between plan and confirm.

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

The active primary Hermes contract is centered on:

- the web Agent page
- saved strategy runs inside the web product
- the Sportfolio CLI as a secondary access path

Legacy SMS infrastructure may still exist in the product, but it is not part of the primary Hermes contract.

## What it does not do

The current agent should not be treated as:

- a general personal assistant
- an autonomous execution bot
- a replacement for all site UI paths
- a source of truth that overrides the backend
- a way to bypass auth, locks, or economic constraints

## Best ways to use it

High-quality prompts are concrete:

- `review my setup`
- `what should i do with my idle balance?`
- `which of my holdings matter most tonight?`
- `should i use this player in a boost or just hold?`
- `buy $25 of <player>`
- `research the latest injury news on <player>`

The more specific the goal, the better the agent can decide whether to explain, read, research, or stage an action.

## Canonical knowledge source

The same wiki you are reading is also part of the canonical knowledge base the agent uses for product explanations. That keeps user docs and agent guidance aligned instead of maintaining separate, drifting copies.

For a deeper operational explanation, read [Agent Runtime Model](/wiki/agent/runtime-model). For how public `/mcp` relates to Hermes, read [MCP Access](/wiki/getting-started/mcp-access).
