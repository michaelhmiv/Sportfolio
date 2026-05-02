---
id: agent-task-definitions
title: Agent Task Definitions
summary: Minimal task contracts for autonomous PLAN → IMPLEMENT → BUILD → TEST → FIX loops with quality gates.
audience: public
category: agent
status: published
owner: product-engineering
lastReviewedAt: 2026-05-02
changeTriggers: AGENTS.md,CLAUDE.md
slug: task-definitions
surface: agent
searchKeywords: tasks,plan,implement,build,test,fix,quality gates,checklist
---

# Agent Task Definitions

Minimal task contracts for autonomous PLAN → IMPLEMENT → BUILD → TEST → FIX loops.

## 1) `repo-orient`

Purpose: fast project orientation before edits.

Inputs:

- repository root

Required steps:

1. Read `AGENTS.md`, `CLAUDE.md`, `AGENT_GUIDE.md`.
2. Identify touched domains (`client/`, `server/`, `shared/`, `docs/`).
3. Confirm relevant runbook/docs for economic changes.

Definition of done:

- Agent can state impacted modules and required validation commands.

## 2) `change-validate`

Purpose: deterministic local validation after code changes.

Command contract (in order):

1. `npm run check`
2. `npm run lint`
3. `npm run test:run`
4. `npm run format:check` (if formatting-sensitive change)

Definition of done:

- All required commands succeed, or failure is explicitly reported with cause.

## 3) `debug-loop`

Purpose: capture actionable failure context for automatic follow-up.

Primary command:

- `npm run agent:debug`

Artifacts:

- `tmp/agent-debug/latest.json`
- `tmp/agent-debug/latest.md`

Definition of done:

- Failure/success is written with per-step command, exit code, duration, and stderr/stdout snippets.

## 4) `self-improve-loop`

Purpose: generate deterministic next actions from latest debug artifact.

Primary command:

- `npm run agent:improve`

Definition of done:

- Produces concise next actions for the first failed step (or confirms loop is healthy).

## 5) `repo-health-smoke`

Purpose: lightweight readiness check for CI/local agent runs.

Primary command:

- `npm run qa:smoke`

Definition of done:

- check/lint/test/openapi checks complete successfully.
