# Workspace Isolation Policy

This repository is intentionally isolated from OpenClaw agent workspace code.

## Canonical path

- `/home/exedev/repos/sportfolio-isolated`

## Rules

1. Only Sportfolio code and docs belong in this repo.
2. Do **not** run development, tests, commits, or pushes for Sportfolio from `/home/exedev/clawd`.
3. Do **not** copy `skills/`, agent runtime files, or unrelated tooling into this repo.
4. Before commit/push, verify isolation:
   - `git status --short`
   - `git ls-files | grep -E '^(skills|memory|\.openclaw|\.clawdhub)/'` (should return nothing)

## Branch workflow

- Work on feature branches (e.g. `server-optimizations`)
- Open PRs to `main`
- Avoid direct pushes to `main` unless explicitly approved

## Notes

This file exists to prevent cross-contamination between assistant workspace files and Sportfolio production code.
