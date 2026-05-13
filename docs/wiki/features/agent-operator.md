---
id: feature-agent-operator
title: Sportfolio Agent
summary: The full user-facing contract for Hermes in Sportfolio: what it reads well, what it can stage, how strategies fit, and where the safety boundaries stay.
audience: public
category: features
status: published
owner: product-engineering
lastReviewedAt: 2026-05-12
changeTriggers: server/agent,client/src/features/agent,client/src/pages/agent.tsx,server/routes.ts,server/jobs/scheduler.ts
slug: agent-operator
surface: web,cli,agent
searchKeywords: agent,operator,confirmation,hermes,threads,strategies,mcp
---

# Sportfolio Agent

The Sportfolio Agent (powered by Hermes) is your in-app product operator. It can review your account, explain mechanics, research current news, and stage gameplay actions through a conversational interface.

> Manual chat and CLI turns are staged first and need explicit confirm. Saved live strategies can auto-execute an allowlisted gameplay subset inside guardrails. Payments, checkout, purchases, and community boost creation are excluded from auto-runs.

---

## What It Does Well

| Task                 | Example prompt                                    |
| -------------------- | ------------------------------------------------- |
| Review your setup    | "Review my portfolio and tell me what stands out" |
| Explain mechanics    | "How does stacking work?"                         |
| Read account data    | "What's my available cash?"                       |
| Discuss strategy     | "Should I boost or hold this player tonight?"     |
| Research news        | "Any injury updates on [player]?"                 |
| Stage an action      | "Buy $25 of [player]"                             |
| Run a saved strategy | Automatic via saved schedule                      |

The more specific the question, the better the response.

---

## Supported Staged Actions (Manual Chat and CLI)

These actions are prepared first and only applied after your explicit confirm in manual chat and CLI:

- Player-pool buys and sells
- LP add, remove, and zap flows
- Stack shares
- Daily boost assign and remove
- Scout reallocations
- Watchlist add and remove
- Community boost creation

---

## How a Typical Manual Turn Works

```
You send a message
  -> Agent decides: reply / read tool / research / stage action
  -> If action: plan is shown
  -> You confirm (or cancel)
  -> Server validates and executes
```

The server re-validates at execution time, so stale plans fail safely if account state changed between stage and confirm.

---

## Threads and Continuity

Conversations are organized into threads. Each thread maintains:

- Recent message history
- Staged-plan context
- Research references

The agent also has per-user memory for patterns and preferences. This memory is user-local and Sportfolio-specific.

---

## Research Capability

When you ask about current news, injuries, or time-sensitive information:

- The server performs hosted web research
- The model receives structured results (not open browser access)
- Responses include citations when research is used

---

## Saved Strategies

Strategies let the agent operate on a recurring schedule with your defined mandate.

**What saved live strategies can auto-execute:**

- Player-pool buys and sells
- LP add, remove, and zap flows
- Stack shares and multiplier flows
- Scout reallocations
- Daily boost assign and remove
- Watchlist add and remove

**What strategies can also do:**

- Wake on a saved schedule
- Reason from continuity state (prior applied actions, pending work, fresh evidence)
- Stage follow-up actions when clarification is needed

**What strategies cannot auto-run:**

- Billing, payments, checkout, or other external purchase flows
- Premium-share and premium-access purchase flows
- Community boost creation
- Actions outside their defined guardrails

---

## Channels

The active agent contract runs on:

1. **Web Agent page** - primary manual conversational surface
2. **Saved strategy runs** - recurring automated strategy surface
3. **Sportfolio CLI** - secondary shell-based access
4. **Public MCP** - protocol access for external clients

> Legacy SMS infrastructure exists in the product but is not part of the active primary Hermes contract.

---

## What the Agent Is Not

- Not a general-purpose personal assistant
- Not an unbounded autonomous execution bot
- Not a replacement for all UI flows
- Not a way to bypass auth, locks, or economic constraints
- Not a source of truth that overrides backend validation

---

## Best Practices

High-quality prompts are specific:

- "Review my setup"
- "What should I do with my idle balance?"
- "Which of my holdings matter most tonight?"
- "Buy $25 of Nikola Jokic"

---

## Next Steps

- [Agent Runtime Model](/wiki/agent/runtime-model) - deeper explanation of threads, memory, tool tiers, and strategies
- [CLI and External Access](/wiki/cli/overview) - use the agent from a terminal
- [MCP Access](/wiki/getting-started/mcp-access) - connect an MCP client to Sportfolio
