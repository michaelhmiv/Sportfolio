# Lessons Learned

## 2026-02-09

- Before deep debugging/investigation, sync to the latest upstream (`origin/main`) and eliminate local noise:
  - `git status -sb` to check for uncommitted changes.
  - `git stash push -u` if needed.
  - Merge/rebase `origin/main` into the working branch so fixes target current code.

