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

# Sportfolio Agent

The Sportfolio Agent (powered by Hermes) is your in-app product operator. It can review your account, explain mechanics, research current news, and stage gameplay actions — all through a conversational interface.

> ℹ️ **The agent does not execute on its own.** It stages a plan. You confirm before anything changes.

---

## What It Does Well

| Task | Example prompt |
|---|---|
| Review your setup | `"Review my portfolio and tell me what stands out"` |
| Explain mechanics | `"How does stacking work?"` |
| Read account data | `"What's my available cash?"` |
| Discuss strategy | `"Should I boost or hold this player tonight?"` |
| Research news | `"Any injury updates on [player]?"` |
| Stage an action | `"Buy $25 of [player]"` |
| Run a saved strategy | Automatic via saved schedule |

The more specific the question, the better the response.

---

## Supported Staged Actions

These actions are prepared first and only applied after your explicit confirm:

- Player-pool buys and sells
- LP add, remove, and zap flows
- Stack shares
- Daily boost assign and remove
- Scout reallocations
- Watchlist add and remove
- Community boost creation

---

## How a Typical Turn Works

```
You send a message
  → Agent decides: reply / read tool / research / stage action
  → If action: plan is shown
  → You confirm (or cancel)
  → Server validates and executes
```

The server re-validates the request at execution time, so stale plans can fail safely if your account state changed between plan and confirm.

---

## Threads and Continuity

Conversations are organized into threads. Each thread maintains:
- Recent message history
- Staged-plan context
- Research references

The agent also has per-user memory for patterns and preferences. This memory is user-local and Sportfolio-specific — it won't leak between accounts.

---

## Research Capability

When you ask about current news, injuries, or time-sensitive information:
- The server performs hosted web research
- The model receives structured results (not open browser access)
- Responses include citations when research is used

---

## Saved Strategies

Strategies let the agent operate on a recurring schedule with your defined mandate.

**What strategies can do:**
- Wake on a saved schedule
- Reason from continuity state (prior applied actions, pending work, fresh evidence)
- Auto-execute a narrow, pre-approved action subset

**What strategies cannot do:**
- Automatically confirm risky portfolio actions without explicit approval
- Access billing, payments, or purchase flows
- Act outside their defined guardrails

---

## Channels

The active agent contract runs on:
1. **Web Agent page** — primary conversational surface
2. **Saved strategy runs** — recurring automated advisory
3. **Sportfolio CLI** — secondary shell-based access

> ℹ️ Legacy SMS infrastructure exists in the product but is not part of the active primary Hermes contract.

---

## What the Agent Is Not

- ❌ A general-purpose personal assistant
- ❌ An autonomous execution bot
- ❌ A replacement for all UI flows
- ❌ A way to bypass auth, locks, or economic constraints
- ❌ A source of truth that overrides the backend

---

## Best Practices

**High-quality prompts are specific:**
- `"Review my setup"` → good
- `"What should I do with my idle balance?"` → good
- `"Which of my holdings matter most tonight?"` → good
- `"Buy $25 of Nikola Jokic"` → good
- `"What's the market like?"` → too vague

---

## Next Steps

- [Agent Runtime Model](/wiki/agent/runtime-model) — deeper explanation of threads, memory, tool tiers, and strategies
- [CLI and External Access](/wiki/cli/overview) — use the agent from a terminal
- [MCP Access](/wiki/getting-started/mcp-access) — connect an MCP client to Sportfolio
