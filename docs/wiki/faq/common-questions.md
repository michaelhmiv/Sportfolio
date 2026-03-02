---
id: faq-common-questions
title: Common Questions
summary: High-signal answers to the most common product and gameplay questions.
audience: public
category: faq
status: published
owner: product-engineering
lastReviewedAt: 2026-03-02
changeTriggers: client/src/pages/how-it-works.tsx,server/routes.ts,server/agent
slug: common-questions
surface: web,cli,agent
searchKeywords: faq,questions,how it works,contests,trading,agent
---

# How does trading work?

Players trade in AMM-backed pools. You receive a live quote, then buy or sell directly against pool liquidity.

# Do scouts give free shares?

Scouts distribute shares over time based on time-weighted participation. They are a long-horizon accumulation tool, not a guaranteed short-term edge.

# Do contests consume my portfolio shares?

No. Contest entries are separate from your standing player-share inventory.

# Can the agent execute actions on its own?

No. The agent can stage supported actions, but you still confirm before state changes are applied.

# Can the agent research current news?

Yes. The server can use hosted web search for current information and cite sources in the response.
