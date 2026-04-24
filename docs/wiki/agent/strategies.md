---
id: agent-strategies
title: Saved Strategies
summary: How saved strategies work in Sportfolio — what they can automate, how mandates and guardrails are set, and what stays outside their scope.
audience: public
category: agent
status: published
owner: product-engineering
lastReviewedAt: 2026-04-23
changeTriggers: server/agent/schedules.ts,server/agent/hermes-orchestrator.ts,client/src/features/agent,shared/schema.ts
slug: strategies
surface: web,agent
searchKeywords: strategies,saved strategies,scheduled,automation,mandate,guardrails,advisory,auto-execute
---

# Saved Strategies

Saved strategies are a recurring-advisory layer on top of the Sportfolio Agent. They let Hermes check in on your account on a schedule and take approved actions without you needing to manually trigger each one.

> ⚠️ **Strategies are not an autonomous trading bot.** They operate within strict guardrails, follow your defined mandate, and can only execute the pre-approved strategy-safe action subset.

---

## What a Strategy Is

A strategy stores:

- **Your mandate** — the goal and rules you set
- **A rule sheet** — specific conditions and preferences
- **Guardrails** — the boundaries Hermes must stay within
- **A schedule** — when the strategy runs (daily, pre-game, etc.)

On each run, Hermes wakes up, reads the continuity brief (recent actions, pending work, fresh evidence), reasons within your mandate, and either takes approved actions or generates a summary for your review.

---

## What Strategies Can Automate

The strategy-safe action subset is intentionally narrow. Strategies can auto-execute:

- Scout reallocations within defined parameters
- Watchlist adds and removes based on your criteria
- Pre-approved informational actions (e.g., "flag any player on my watchlist with injury news")

Strategies can stage (but not auto-execute without confirmation):

- Trades above threshold amounts
- Boost assignments
- LP changes

---

## What Strategies Cannot Do

- ❌ Automatically confirm trades without explicit approval
- ❌ Handle billing, payments, or premium purchases
- ❌ Act outside the defined guardrails
- ❌ Bypass the server's confirmation requirements for risky actions

---

## The Continuity Brief

Every strategy run begins with a server-assembled continuity brief that gives Hermes:

- What it did on previous runs
- What's pending or awaiting confirmation
- Fresh evidence (news, market moves, slate changes)
- Any blocked loops or recurring issues

This prevents strategies from starting fresh each time and repeating decisions that already happened.

---

## Audit Trail

Every strategy run is logged with:

- What actions were taken or staged
- The runtime metadata (whether Hermes ran locally or through a configured sidecar)
- Timestamp and outcome

This lets you verify what happened and holds the system accountable.

---

## Advisory vs. Execution

The product maintains a clear line:

| Mode               | What it does                                                        |
| ------------------ | ------------------------------------------------------------------- |
| **Advisory**       | Generates guidance, surfaces relevant info, flags decisions for you |
| **Auto-execution** | Runs only pre-approved, strategy-safe actions                       |
| **Staged actions** | Prepares a plan for your explicit confirmation                      |

Strategies can operate in all three modes, but the boundary between them is defined by your mandate and guardrails.

---

## The Right Mental Model

Think of a saved strategy as:

- A standing instruction you've given to a knowledgeable assistant
- Within defined guardrails
- That checks in on your behalf
- And escalates anything outside its scope to you

It's not "set it and forget it" — it's "delegate the routine, escalate the edge cases."

---

## Next Steps

- [Agent Runtime Model](/wiki/agent/runtime-model) — how the agent processes strategy runs (continuity brief, tool tiers, audit trail)
- [Sportfolio Agent](/wiki/features/agent-operator) — the full agent capability overview
- [User Action Surface](/wiki/features/user-action-surface) — which actions are available for strategies to use
