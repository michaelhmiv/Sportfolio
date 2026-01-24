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
Sportfolio - A sports trading platform with real-time game scores, player stocks, and contests.

## Key Patterns
- API migration: MySportsFeeds -> BallDontLie (NBA)
- Database: PostgreSQL with Drizzle ORM
- Frontend: React with TanStack Query
