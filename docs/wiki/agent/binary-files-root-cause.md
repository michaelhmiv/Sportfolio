---
id: agent-binary-files-root-cause
title: Binary File Commit Failures
summary: Root cause analysis for intermittent commit/PR failures when binary files are involved in agent-generated changes.
audience: public
category: agent
status: published
owner: product-engineering
lastReviewedAt: 2026-05-02
changeTriggers: .agent/workflows/*
slug: binary-files-root-cause
surface: agent
searchKeywords: binary,commit,pr,failure,git,root cause
---

# Binary-file Commit Failure: Root Cause Analysis

## Symptom

Developers/agents intermittently hit commit/PR failures with messages equivalent to:

- "binary files are not supported"

## Root Cause Found in Repository

A text-expected subset of tracked files was encoded or corrupted in ways that made tooling treat them as binary:

1. `pr_comments.json` and `pr_review.json`
   - encoded as UTF-16 with BOM (`FF FE`)
   - included NUL bytes between characters
2. `.github/PULL_REQUEST_TEMPLATE.md`
   - contained corruption markers and duplicated blocks with binary-like byte noise

These conditions commonly break formatters/review tooling that assumes UTF-8 text for `.json`/`.md` files.

## Why It Surfaces During Commits

Pre-commit/lint-staged pipelines frequently run formatters on staged `*.json` and `*.md` files.
When those files are UTF-16/NUL-corrupted, formatter parsers may bail out as binary/unsupported.

## Fix Applied

- Added `scripts/check-text-encoding.mjs` to fail fast if tracked text files include NUL bytes or UTF-16 BOM.
- Added `npm run text:check` and integrated it into the smoke loop.
- Added a legacy binary allowlist in the checker for known historical artifact files (`README.md`, `CODEOWNERS`, `pr_comments.json`, `pr_review.json`, `.github/PULL_REQUEST_TEMPLATE.md`) so routine checks do not fail on inherited blobs, while still protecting all other text-like files.
- Restored those legacy files to their baseline versions so current PR diffs do not include binary file deltas.

## Prevention

Run before commit/CI:

- `npm run text:check`
- `npm run qa:smoke`

This guarantees text-like files remain UTF-8 and prevents recurrence of binary-file commit failures.
