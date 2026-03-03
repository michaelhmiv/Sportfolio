---
id: internal-agent-skills
title: Agent Skills Governance
summary: Internal reference for Hermes runtime skills and the admin approval boundary.
audience: internal
category: internal
status: published
owner: product-engineering
lastReviewedAt: 2026-03-03
changeTriggers: server/agent/hermes-orchestrator.ts,server/agent/skills.ts,server/routes.ts,shared/schema.ts
slug: agent-skills
surface: internal
searchKeywords: hermes,skills,agent,approval,review
---

# What a runtime skill is

A runtime skill is a reusable workflow macro over existing admin-approved tools.

It may include:

- trigger examples
- a tool sequence
- clarification checkpoints
- lightweight constraints

It may not:

- create new backend tools
- bypass auth or confirmation
- add new route access
- widen the user's capability surface

# Skill scopes

- `user`: automatically reusable only for the same user
- `global_candidate`: proposed for shared reuse, pending admin review
- `global_approved`: approved for shared reuse across users

# Approval rule

Hermes may automatically create or update user-scoped skills because they only reuse approved tools.

Hermes may also propose a global candidate, but that candidate must remain inert until an admin explicitly approves it through the admin agent skill review endpoints.

# Operational checklist

1. Keep the tool surface admin-owned and fixed.
2. Treat skills as macros, not code generation.
3. Review global candidates before promotion.
4. Reject any candidate that would encode private user context.
