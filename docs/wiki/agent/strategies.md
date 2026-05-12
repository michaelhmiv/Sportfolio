---
id: agent-strategies
title: Saved Strategies
summary: How saved strategies work in Sportfolio - what they can automate, how mandates and guardrails are set, and what stays outside their scope.
audience: public
category: agent
status: published
owner: product-engineering
lastReviewedAt: 2026-05-12
changeTriggers: server/agent/schedules.ts,server/agent/hermes-orchestrator.ts,client/src/features/agent,shared/schema.ts
slug: strategies
surface: web,agent
searchKeywords: strategies,saved strategies,scheduled,automation,mandate,guardrails,advisory,auto-execute
---

# Saved Strategies

Saved strategies are a recurring layer on top of the Sportfolio Agent. They let Hermes check your account on schedule and auto-execute an allowlisted gameplay subset within saved guardrails.

> Strategies are not unbounded autonomy. They are constrained by mandate, guardrails, and fixed exclusion rules.

---

## What a Strategy Stores

A strategy stores:

- **Mandate** - goal and rules you set
- **Rule sheet** - specific conditions and preferences
- **Guardrails** - boundaries Hermes must stay inside
- **Schedule** - when the strategy runs

On each run, Hermes reads continuity state (recent actions, pending work, fresh evidence), reasons within the mandate, then either auto-executes allowlisted actions or stages follow-up work when clarification is needed.

---

## What Strategies Can Auto-Execute

Saved live strategies can auto-execute:

- Player-pool buys and sells
- LP add, remove, and zap flows
- Stack shares and multiplier flows
- Scout reallocations
- Daily boost assign and remove
- Watchlist add and remove

---

## What Strategies Cannot Auto-Run

- Billing, payments, checkout, or other external purchase flows
- Premium-share and premium-access purchase flows
- Community boost creation
- Actions outside saved guardrails

---

## Manual vs Strategy Boundary

| Context                   | Execution model                                        |
| ------------------------- | ------------------------------------------------------ |
| Manual chat and CLI turns | Stage first, then explicit `confirm` or `cancel`       |
| Saved live strategy runs  | Allowlisted actions may auto-execute within guardrails |

---

## Continuity Brief

Every strategy run begins with a server-assembled continuity brief that includes:

- Prior applied actions
- Pending or blocked work
- Fresh evidence (news, market moves, slate changes)
- Active strategy state

This keeps runs stateful and reduces repeated decisions.

---

## Audit Trail

Every strategy run is logged with:

- Actions taken or staged
- Runtime transport metadata
- Timestamp and outcome

---

## The Right Mental Model

Think of a saved strategy as a standing instruction set:

- Delegate routine portfolio management loops
- Keep explicit guardrails
- Escalate excluded or out-of-policy actions back to manual confirmation

---

## Next Steps

- [Agent Runtime Model](/wiki/agent/runtime-model) - continuity, tool tiers, and audit semantics
- [Sportfolio Agent](/wiki/features/agent-operator) - full capability overview
- [User Action Surface](/wiki/features/user-action-surface) - actions by interface
