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
- When provider payload contracts differ from cached DB rows, hydrate game teams/status/scores from provider snapshots in insights responses to avoid stale placeholders like `TBD`.

## 2026-02-25

- When users ask to execute all planned SEO phases, complete implementation and verification in the repo, then clearly separate code-complete status from production-deployed status (including exact failing public checks when deploy lag exists).

## 2026-02-28

- When adding a managed AI provider, confirm the exact vendor contract first (base URL, auth header shape, and model-selection rules) instead of defaulting to the last OpenAI-compatible assumptions.
- Chutes reaching the model endpoint is not enough for structured agent output; for reliable JSON responses, enable JSON mode explicitly with `response_format` on the managed request path.
- After changing provider adapters, validate provider-specific response behavior too (for example MiniMax `reasoning_split` / `<think>` handling), not just compile-time correctness and mocked config tests.
- When a new UI depends on newly added tables, add an idempotent startup schema guard and explicit frontend error/retry states so an unapplied migration does not present as a vague loading screen.
- When cloning an upstream framework repo locally for reference, immediately isolate it from this app's test and formatting discovery (`vitest` / `prettier`) so the local reference copy does not become part of Sportfolio's validation surface.
- When migrating to a framework dependency, replace the old runtime path instead of layering another adapter stack beside it; keep one canonical execution layer and test that layer directly.
- When moving onto an agent framework, migrating only the provider transport is incomplete; also move the planning loop onto the framework's native tool-call path instead of keeping a JSON-only prompt/parser seam.
- When a tool call is mandatory, prompt instructions are not enough; set provider-level `toolChoice` and capture failed-turn traces so plain-text model replies do not become opaque agent errors.
- When external provider access is blocked or risky, add and run a local mock-provider smoke test that exercises the real `pi-ai` + `pi-agent-core` request path before claiming provider work is verified.
- For high-confidence scouting commands (like direct current-slate target requests), do not force the user through a slow provider round-trip; use deterministic backend fast paths first, and treat the model as a secondary layer for ambiguous or conversational refinement.
- Provider timeouts should degrade into deterministic agent output, not user-facing errors; a fast fallback is better product behavior than waiting on slow reasoning models to format a perfect tool call.
- For agent semantic retrieval, keep the request path fast with a local embedding or lexical vector, then upgrade the stored index asynchronously with a stronger remote embedding model; do not put a second model round-trip on the user-facing chat latency path.
- When tuning agent chat quality, follow the frontier vendors' prompt guidance: keep stable instructions up front, use explicit structured sections/examples, and give tools a precise contract instead of relying on vague prompt text.
- Discussion-mode scout answers must never tell the user to "confirm" unless a pending plan actually exists; if the conversation is still advisory, tell the user to give a direct instruction first.
- For deterministic agent parsers, live-smoke the exact natural phrasings users will type (`"zap $10 into..."`, `"what do you think about putting..."`) because narrow regexes can silently fall through into unrelated agent paths even when the core action support exists.
- When a user clarifies that a new idea is backlog-only, record it in `tasks/todo.md` and continue the active implementation instead of pivoting the working scope.
- When extending agent execution into economic mechanics like condense/power, verify the live route and storage contract first; repo docs and old assumptions can drift, and the planner must follow the actual product behavior.
- For stateful chat flows, reuse the existing persisted message metadata before adding a new table; a structured clarification payload on the assistant turn is enough to unblock short follow-up replies without creating a second thread-state system.
- When an agent mutation already exists as a route flow with non-trivial state math (like vesting accrual), share that calculation path between planning and execution; duplicating “approximate” claim logic in the planner creates staging plans that can drift from what confirmation actually applies.
- When evolving persisted agent bundle payloads, keep bundle readers backward-compatible with older payload shapes so existing pending plans and history continue to render while the new workflow format rolls out.
- When a user wants external web research inside the in-app agent, keep the search provider hosted and server-controlled so managed and BYOK models share the same tool contract and query policy.
- When PI is only the runtime/tool-call substrate, stop at a thin-PI testable milestone instead of layering a framework-shaped architecture over deterministic product logic before real user testing.
- When the same mechanics or capability explanation is needed in both the product UI and the agent, make `docs/wiki` the canonical source and feed the agent from wiki articles marked with `surface: agent` instead of duplicating prompt copy in multiple places.
- When the user says a legacy mechanic is no longer part of the live product (for example vesting), remove it from the active agent surface and schedules first instead of expanding tooling around a deprecated path.
- When adding new Hermes-backed persistence like agent schedules, bootstrap the minimal schema on first tool use as well as via migrations so the sidecar and local smokes do not fail on an environment that has not applied the latest migration yet.
