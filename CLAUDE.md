# CLAUDE.md

This file provides guidance to Claude Code when working with this codebase.

## Agent Guidelines

### GitHub Issues Check

At the start of each session, check open GitHub issues:

```bash
gh issue list --repo michaelhmiv/Sportfolio-Replit
```

Review issues before making changes to understand what needs fixing. Reference issue numbers in commits and code comments.

## Project Overview

Sportfolio - A sports trading platform with real-time game scores, player markets, scouts, boosts, and leaderboards.

## Key Patterns

- Primary sports data provider: BallDontLie across active sports surfaces
- Database: PostgreSQL with Drizzle ORM
- Frontend: React with TanStack Query

## Context Orientation

- Start with `docs/agent/CONTEXT_INDEX.md`, `docs/agent/REPO_MAP.md`, `docs/agent/CONTEXT_BUDGET.md`, and `docs/agent/REFACTOR_QUEUE.md`.
- Prefer loading one task-specific vertical slice instead of broad repo-wide ingestion.

## Workflow Orchestration

### 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy to keep main context window clean

- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop

- After ANY correction from the user: update 'tasks/lessons.md' with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness
- Treat GitHub as the deployment source of truth: push changes to GitHub first and let Railway deploy from the tracked branch rather than shipping local-only deploys

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests -> then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to 'tasks/todo.md' with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review to 'tasks/todo.md'
6. **Capture Lessons**: Update 'tasks/lessons.md' after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
