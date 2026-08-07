---
id: changelog-2026-03-02-knowledge-hub
title: Knowledge Hub and CLI Foundation
summary: Sportfolio now has a canonical wiki surface, docs APIs, and a token-auth CLI foundation.
audience: public
category: changelog
status: published
owner: product-engineering
lastReviewedAt: 2026-03-02
changeTriggers: client/src/App.tsx,server/routes.ts,shared/schema.ts
slug: 2026-03-02-knowledge-hub
surface: web,cli
searchKeywords: changelog,wiki,docs,cli,api tokens
---

# This release adds

- an in-app wiki surface
- canonical markdown docs under `docs/wiki`
- public docs index, article, and search APIs
- user API tokens for CLI access
- a first user-facing Sportfolio CLI package

# What this means

Sportfolio now has a single versioned place to document mechanics, platform changes, and operator workflows. It also has a stable base for scripted usage outside the browser.

# Current surface note

The current application surface keeps the wiki and CLI contracts aligned with the semantic sports catalog, neutral gameplay transactions, and the reviewed OAuth/MCP capability registry.
