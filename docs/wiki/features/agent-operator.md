---
id: feature-agent-operator
title: Sportfolio Agent
summary: What the agent can do today, how hosted research works, and where confirmation is required.
audience: public
category: features
status: published
owner: product-engineering
lastReviewedAt: 2026-03-02
changeTriggers: server/agent,client/src/pages/agent.tsx,server/routes.ts
slug: agent-operator
surface: web,cli,agent
searchKeywords: agent,operator,confirmation,brave search,byok
---

# Thin operator model

The Sportfolio agent is an operating partner, not an autonomous trader. It can analyze, explain, research current information, and stage supported actions. Mutations still require explicit confirmation.

# Canonical knowledge source

The same canonical wiki docs that users read are also used to ground the agent's product and mechanics explanations. When Sportfolio behavior changes, the goal is to update the canonical wiki source once and let both the wiki and the agent inherit that change.

# What it can do well

- review your setup across multiple supported account surfaces
- explain mechanics and tradeoffs
- stage supported operational actions
- use hosted web research for current-news questions
- support both managed models and BYOK model runtimes

# What still requires care

- not every UI action is exposed through the agent yet
- external news can inform decisions, but it does not execute actions by itself
- actions that affect balances, shares, boosts, or vesting remain confirmation-gated

# How hosted research works

When you ask for current news or time-sensitive information, the server can query hosted Brave search, summarize relevant sources, and attach citations. The model sees structured research output rather than unrestricted browsing.

# CLI support

The same server-owned agent logic can also be reached through the Sportfolio CLI using an API token.
