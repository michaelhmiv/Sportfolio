---
id: changelog-2026-05-12-interface-contract-refresh
title: Agent, CLI, and MCP Contract Refresh
summary: Wiki contract refresh that aligns agent autonomy language, corrects CLI helper docs, and moves MCP inventory claims to live catalog resources.
audience: public
category: changelog
status: published
owner: product-engineering
lastReviewedAt: 2026-05-12
changeTriggers: docs/wiki/agent/current-surface.md,docs/wiki/getting-started/mcp-access.md,docs/wiki/features/user-action-surface.md,packages/sportfolio-cli/src/index.mjs,server/routes/mcp.ts,server/mcp/public-tool-registry.ts
slug: 2026-05-12-interface-contract-refresh
surface: web,cli,agent
searchKeywords: changelog,agent contract,cli docs,mcp catalog,session lifecycle,wiki drift
---

# This release updates

- agent execution wording across wiki pages to match live behavior on May 12, 2026
- CLI docs drift (`docs list` naming and `actions` helper boundaries)
- MCP docs with explicit initialize/session lifecycle and request-header expectations
- MCP reference style from hand-maintained exhaustive tables to catalog-backed hybrid docs (`sportfolio://tool-catalog`)
- buy/sell wording correction in Player Pools guidance
- runbook drift policy requiring CLI and MCP spot-checks before publishing capability docs

# What this means

The wiki now distinguishes manual confirmation boundaries from saved live strategy auto-execution boundaries in a consistent way, while reducing future drift risk by anchoring exhaustive MCP inventory claims to machine-readable resources.
