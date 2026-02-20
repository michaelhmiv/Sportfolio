# Lessons Learned

## 2026-02-09

- Before deep debugging/investigation, sync to the latest upstream (`origin/main`) and eliminate local noise:
  - `git status -sb` to check for uncommitted changes.
  - `git stash push -u` if needed.
  - Merge/rebase `origin/main` into the working branch so fixes target current code.

## 2026-02-20

- For Supabase CLI project targeting in this repo, treat `SUPABASE_URL` as the source-of-truth variable (not `DATABASE_URL`).
- On dashboard market rows, do not keep generic `LIVE` labels when provider game-state text is available; show sport-specific progress (MLB inning, NBA/NFL quarter+clock).
- Dashboard already has a global date context; game-row secondary market text should prioritize game-specific time/progress over repeating the date.
