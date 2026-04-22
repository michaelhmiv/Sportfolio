## 2026-04-22 Worktree Helper + PR Merge Train

- [x] Add a safe `worktree:close` helper and wire docs/scripts for the full worktree lifecycle
- [x] Open a GitHub PR for the workflow toolkit changes
- [x] Triage open GitHub PRs excluding `#120`, run validation for merge candidates, and merge safe ones
- [x] Verify post-merge stability signals for GitHub CI and Railway-facing health checks

## 2026-04-08 PR #117 Review Comments + Merge Conflict Resolution

- [x] Pull PR #117 review-thread context and identify unresolved actionable comments
- [x] Merge `origin/main` into `chore/non-telegram-rollup` and resolve conflict files cleanly
- [x] Patch unresolved review comments for agent turn-stream auth and `PlayerName` click behavior
- [x] Run required validation (`npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`)
- [x] Commit and push the merge-resolution + comment fixes to PR #117 branch

Review:

- Resolved merge conflicts in `client/src/components/game-command-center-modal.tsx`, `docs/mlb-mcp.md`, and `server/agent/model-first-router.ts` while preserving current `main` recovery behavior and the branch turn-budget progress-stream changes.
- Replaced EventSource-based turn progress streaming in `client/src/features/agent/hooks/use-agent-shell.ts` with an authenticated `fetch` SSE reader so bearer-header sessions receive progress events.
- Updated `client/src/components/player-name.tsx` to stop suppressing parent click handlers, so parent row/button actions continue to fire when player names are clicked.
- Validation status:
- `npm run check` passed.
- `npm run lint` passed.
- `npm run test:run` passed.
- `npm run format:check` passed.

## 2026-04-06 Relative-Date Grounding for MLB Stat Scans

- [x] Reproduce the wrong-date MLB stat gameplan response from the stored dev thread and confirm whether the bad date came from the tool result or only the final prose
- [x] Trace the MLB stat scan date resolution path and identify why a relative-time prompt could land on a stale explicit date
- [x] Ground `today` / `later today` / `tonight` server-side in the scan tool and anchor the model loop prompt with the current ET date
- [x] Add regressions for relative-date MLB stat scans and prompt time-context injection
- [ ] Re-run the exact prompt through the live dev agent surface once the current app session is ready, to verify it now anchors to April 6, 2026 end to end

Review:

- The stored bad turn already had `2026-03-27` embedded inside the `scan_mlb_stat_gameplan` result, so the issue was upstream of final prose formatting.
- `buildMlbStatGameplanScan()` trusted any model-supplied `args.date` before checking the actual user wording, which let a stale tool arg override a `later today` request.
- `server/agent/hermes-tools.ts` now resolves explicit dates from the user message first, then relative words like `tomorrow`, `today`, `later today`, and `tonight`, and only falls back to a raw tool arg when the user did not express a relative current-slate window.
- `server/agent/model-first-router.ts` now injects the current ET date/time into the tool-loop prompt so the active model gets a concrete calendar anchor before choosing time-sensitive tool args.

## 2026-04-06 Local MLB MCP Launcher

- [x] Confirm local Hermes expects the vendored MLB MCP at `http://127.0.0.1:8081/mcp` when no explicit internal MLB env is set
- [x] Add repo-owned helper scripts to start, check, and stop the local vendored MLB MCP
- [x] Update the MLB MCP runbook with the helper commands
- [ ] Re-verify the helper in a normal local terminal outside the Codex tool shell, since detached child processes do not survive reliably in this session environment

Review:

- Added `scripts/mlb-mcp-local.mjs` with `start`, `start-detached`, `status`, and `stop` commands for the vendored `vendor/mlb-mcp` service.
- Added `npm run mlb-mcp:start`, `npm run mlb-mcp:start:detached`, `npm run mlb-mcp:status`, and `npm run mlb-mcp:stop`.
- Updated `docs/mlb-mcp.md` so the local runbook points to the new helper commands.
- Verified that the vendored Python server starts correctly in the foreground and binds the expected HTTP MCP server path in-session; detached persistence remains a shell-environment issue here, not a vendored MLB MCP code issue.

## 2026-04-04 Assumption-First Direct Action Recovery

- [x] Expand direct-operation planners so bare buy, sell, scout, stack, boost, and watchlist verbs stage deterministic previews instead of returning `null`
- [x] Align Hermes plan-tool descriptions with assumption-first behavior so the runtime can recover obvious action intent through `preview_direct_operation`
- [x] Broaden explicit staged-action intent detection so bare `scout`, `track`, and related verbs recover through plan tools when the model answers in prose
- [x] Add regression coverage for assumption-first planner behavior and router plan-only recovery
- [x] Run repo validation plus live `/api/agent/threads` replays for bare buy/scout/watchlist prompts on local dev

Review:

- `server/agent/operations-planner.ts` now treats bare action prompts as valid deterministic planning inputs: `buy Aaron Judge shares` assumes a starter-size buy, `sell Aaron Judge` assumes one share, `stack my Aaron Judge shares` uses the max stackable regular shares, `scout Aaron Judge` defaults to one scout, and `track Aaron Judge` stages the default-watchlist add.
- `server/agent/model-first-router.ts` now treats bare `scout`, `track`, `save`, `watchlist`, and `unwatch` verbs as explicit staged-action intent, so Hermes recovers through `preview_direct_operation` instead of accepting advisory prose when the user clearly asked for a direct move.
- Added regression coverage in `server/agent/operations-planner.test.ts` and `server/agent/model-first-router.test.ts`.
- Live local `/api/agent/threads` validation on `dev_user` confirmed:
- `buy Aaron Judge shares` stages a `$25` starter buy bundle instead of returning the empty-provider fallback
- `scout Aaron Judge` stages a 1-scout bundle instead of drifting into advisory text
- `track Aaron Judge` stages a default-watchlist add
- `buy Aaron Judge and put him in my 4x boost slot today` fails cleanly on slot occupancy instead of malformed fallback text

## 2026-04-03 Ranked MLB Workflow Support

- [x] Inspect the current compound bundle fallback and deterministic planner paths for ranked stat-selection prompts
- [x] Add a deterministic MLB ranked workflow for stat-driven multi-player buy, stack, and boost requests
- [x] Prevent `preview_multi_action_bundle` from falling back to clause splitting when the ranked workflow returns its own holistic result
- [x] Add regression coverage for the ranked planner path and the bundle-preview guard
- [x] Run repo validation plus live `/api/agent/threads` replays for the ranked workflow, MCP reads, and `/agent` Configure load

Review:

- `server/agent/operations-planner.ts` now detects ranked MLB workflow prompts such as lowest ERA or highest OBP, resolves leaderboard-driven player sets through the internal MLB MCP, splits available balance evenly across the selected players, and stages ordered buy/stack/boost actions through the deterministic planner instead of free-form clause splitting.
- `server/agent/hermes-tools.ts` now treats `ranked_stat_multi_player_workflow` as a holistic preview result, so an unavailable ranked workflow stays on its own clear failure path rather than degrading into malformed fragment errors.
- Added targeted regressions in `server/agent/operations-planner.test.ts` and `server/agent/hermes-tools.test.ts`.
- Live validation confirmed:
- the original ranked-ERA prompt now fails cleanly when the requested boost slots are already occupied
- the same ranked-ERA prompt stages a six-step pending bundle when rerun against open slots (`3x` and `2x`) for tomorrow
- the `/agent` Configure tab loads without the schema error and shows built-in MLB data-source state
- the OBP/OPS advisory gameplan path uses live internal MLB MCP reads

## 2026-04-03 Hermes Gameplay + MCP Validation Pass

- [ ] Fix deterministic planner gaps for natural `stack ... shares of ...` phrasing and sell-led compound workflows
- [ ] Add regression coverage for compound planner and bundle-preview identity carryover
- [ ] Update `/agent` browser coverage to match the current shell and prove slash-command behavior
- [ ] Add a full internal MLB MCP catalog validator and run it against the live local MLB MCP
- [ ] Re-run live local/dev Hermes conversations for gameplay combinations, MCP-backed gameplans, and slash-command chat flows
- [ ] Run `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

## 2026-03-30 Lean Load-Time Performance Pass

- [x] Phase 1: reduce production client logging, remove eager chunk warmups, and apply cache headers/static asset caching for safe public data
- [x] Phase 1 validation: run targeted typecheck/lint/tests for touched surfaces and capture any regressions before continuing
- [x] Phase 2: batch locked-share lookups, add cache single-flight coalescing, and cache safe derived market/dashboard/mobile overview reads with 60s soft TTL
- [x] Phase 2 validation: run targeted and repo-wide verification to confirm no drift in player queries, boost eligibility, or power/lock semantics
- [x] Final validation: run `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- `server/storage.ts` now batches player share-lock totals with alias-aware canonical resolution, and the boost eligibility paths use that batch lookup instead of per-player N+1 lock queries.
- `server/routes.ts` `/api/daily-boosts/eligible-all` and `server/market-mobile-overview.ts` holding aggregation now reuse the batched lock totals, which reduces repeat DB work without changing one-share-per-slot, lock, or stacked-share semantics.
- `server/cache.ts` now coalesces concurrent cache misses per key so repeated public reads share one in-flight computation, and `server/cache.test.ts` locks that behavior down.
- `server/market-mobile-overview.ts` now caches the unauthenticated overview only when running with real production deps, preserving deterministic custom-deps test behavior while reducing repeated public recomputation in production.
- Validation status:
- `npm run check` passed.
- `npm run lint` passed.
- `npm run test:run` passed.
- `npm run format:check` passed.

## 2026-03-30 Production Crash Recovery + Android Release PR Hardening

- [x] Investigate the production crash on Railway and identify the failing runtime path
- [x] Harden authenticated user sync so transient database timeouts fail closed without crashing the Node process
- [x] Move non-critical startup warmups off the critical server boot path so the app can bind and serve before background repair work finishes
- [x] Reconcile the Android/Play release branch onto current `origin/main`, fix failing CI, and open a fresh PR for review
- [x] Re-run required validation plus Android release build smoke and confirm production health

Review:

- Root cause of the production outage was an unhandled database connection timeout during `upsertSupabaseUser` inside `isAuthenticated`, which could terminate request handling and take the process down during auth-gated traffic.
- `server/supabaseAuth.ts` now catches storage-sync failures, returns HTTP 503 instead of crashing, and has regression coverage in `server/supabaseAuth.test.ts`.
- `server/routes.ts` now pushes schema-repair and startup warmup work into a background task so the Express server can call `listen` and start serving before optional maintenance completes.
- `server/mlb-pregame-insights.ts` now materializes `Map.values()` before `flatMap`, fixing the Node-compatible CI failure that was blocking the fresh release PR.
- The release branch was rebuilt from current upstream and published as PR #113 (`codex/android-play-release-readiness`) so GitHub has the same intended change set Railway is running.
- Validation status:
- `npm run check` passed.
- `npm run lint` passed.
- `npm run test:run` passed.
- `npm run format:check` passed.
- `npm run mobile:build:android` passed.

## 2026-03-29 MLB Doubleheader + MCP Session Snapshot Follow-Up

- [x] Fix MLB probable-starter matchup resolution so doubleheaders keep the correct per-game context
- [x] Snapshot dynamic MLB tool availability once per MCP session and reuse it across public discovery resources
- [x] Add targeted regression coverage for the doubleheader and MCP session-snapshot cases
- [x] Run targeted validation, update lessons, and push the branch fix

Review:

- `server/mlb-pregame-insights.ts` now preserves all team matchup contexts for doubleheaders and adds a probable-starter-specific lookup, so a second-leg starter resolves to the correct `gameId`, matchup chip, and summary instead of inheriting the first game.
- `server/mcp/public-tool-registry.ts` and `server/routes/mcp.ts` now resolve the dynamic MLB catalog once when a public MCP session server is created and reuse that snapshot for both dynamic tool registration and discovery resources, eliminating session drift between `tools/list` and `sportfolio://*` resources.
- Added targeted regressions in `server/mlb-pregame-insights.test.ts` and `server/mcp/mcp-server.test.ts` for MLB doubleheaders and post-connect MLB catalog churn.
- Validation status:
- `npm run check` passed.
- `npm run lint` passed.
- `npm run test:run` passed.
- `npm run format:check` passed.

## 2026-03-29 Agent Result Formatting Upgrade

- [x] Extend the shared agent `uiBlocks` catalog for leaderboard, schedule, execution, tool-catalog, and stat-highlight result shapes
- [x] Render the new result blocks in chat with mobile-safe density and inline player modal behavior
- [x] Upgrade markdown fallback rendering so leaderboard tables and internal player links behave cleanly inside chat
- [x] Add presentation metadata to the Hermes/public MCP tool catalog so agents can infer the right formatting profile
- [x] Update prompt guidance and tests so leaderboard/schedule/tool-catalog answers prefer structured formatting
- [x] Re-run validation and targeted browser coverage for the formatted chat experience

Review:

- `shared/agent-ui.ts` now supports leaderboard, entity-table, schedule-board, execution-checklist, tool-catalog, and stat-highlight blocks so Hermes can render common sports/result shapes natively instead of relying on long prose.
- `client/src/features/agent/components/agent-ui-blocks.tsx` and `client/src/features/agent/components/agent-conversation.tsx` now blend structured result blocks and markdown fallbacks into the transcript, add mobile-safe table scrolling, and open `PlayerModal` from structured rows or `/player/:id` markdown links.
- `server/agent/types.ts`, `server/agent/hermes-tool-registry.ts`, `server/agent/hermes-tools.ts`, `server/agent/internal-mlb-mcp.ts`, `server/mcp/public-tool-registry.ts`, and `server/routes/mcp.ts` now carry presentation metadata like `presentationProfile`, `primaryEntityType`, and `preferredColumns` through the internal tool catalog and public MCP discovery surface.
- `server/agent/conversation-prompts.ts` and `server/agent/ui-blocks.ts` now guide Hermes toward native leaderboard/schedule/tool-catalog/checklist formatting and synthesize checklist fallbacks for pending/strategy-review turns.
- Validation status:
- `npm run check` passed.
- `npm run lint` passed.
- `npm run test:run` passed.
- `npm run format:check` passed.
- `npx playwright test tests/e2e/agent-shell.spec.ts --grep "formatted leaderboard output" --project=chromium` passed.

## 2026-03-28 MLB Dev Runtime + Box Score Blend Pass

- [x] Make development auto-detect the local vendored MLB MCP when no explicit internal endpoint is configured
- [x] Fix the MLB adapter to accept the real wrapped MCP payload shape returned by the live server
- [x] Tighten lineups to the actual batting order instead of every player who appeared
- [x] Blend the MLB modal into a more natural baseball box-score layout without frontend provider labeling
- [x] Verify the live dashboard and MLB modal on a mobile viewport with Playwright against the real dev app
- [x] Re-run full validation and Railway MLB smoke before wrapping up

Review:

- `server/agent/internal-mlb-mcp.ts` now auto-falls back to the local vendored MLB MCP in development when explicit MLB env is absent, and uses a less brittle default timeout for local dev reads.
- `server/mlb-pregame-insights.ts` now unwraps live `result`-wrapped MCP payloads, which was the root cause of `mlbEnrichment: pending` despite a healthy local MCP, and now prefers `battingOrder` for real box-score lineups.
- `client/src/components/game-command-center-modal.tsx` now reads more like a baseball game center, keeps the frontend blended, and shows a clear loading state while the detailed MLB box score is hydrating instead of falsely showing lineup pending on completed games.
- Browser verification on a real mobile viewport confirmed:
- the dashboard slate shows probable pitchers on MLB rows
- the MLB detail modal hydrates into venue, weather, attendance, linescore, scoring summary, starter context, and nine-man batting orders
- the lineup list now matches a real batting order instead of every participant in the box score

## 2026-03-28 MCP Discoverability Hardening

- [x] Add live MCP discovery resources that reflect both the static Sportfolio surface and dynamic MLB tool projection
- [x] Enrich public MCP tool metadata so agents can infer confirmation model, provider/source, and useful usage hints more reliably
- [x] Expand MCP smoke/test coverage to verify dynamic MLB discovery through `tools/list` and discovery resources
- [x] Re-run full validation, browser verification, and Railway MLB smoke

Review:

- `server/mcp/public-tool-registry.ts` now exposes a live `sportfolio://tool-catalog` resource plus dynamic `sportfolio://capabilities` and `sportfolio://action-surface` payloads that include projected `mlb_mcp__*` tools and dynamic-source availability metadata.
- `server/routes/mcp.ts` now reuses shared dynamic MLB tool discovery, enriches projected tool metadata, and preserves more JSON Schema detail when converting remote schemas into public MCP Zod inputs.
- Public MCP metadata now distinguishes provider/source and confirmation model, which makes the tool surface easier for external agents to reason over without exposing Ball Don't Lie vs MLB MCP distinctions in the product UI.
- `server/mcp/mcp-server.test.ts` and `scripts/mcp-smoke.ts` now verify that a dynamic MLB tool appears consistently in `tools/list`, `sportfolio://capabilities`, `sportfolio://action-surface`, and `sportfolio://tool-catalog`.
- `docs/wiki/getting-started/mcp-access.md` now documents the richer live discovery resources.
- Validation status:
- `npm run check` passed.
- `npm run lint` passed.
- `npm run test:run` passed.
- `npm run e2e -- tests/e2e/mlb-game-card.spec.ts` passed.
- `npm run mcp:smoke` passed.
- `npm run mlb-mcp:probe:railway` passed.
- `npm run format:check` passed.

## 2026-03-28 Authenticated Public MLB MCP + Blended MLB Card Verification

- [x] Extend the authenticated public `/mcp` surface to expose read-only `mlb_mcp__*` tools through Sportfolio instead of making the Railway MLB service public
- [x] Keep the provider boundary backend-only so MLB frontend surfaces stay blended and avoid Ball Don't Lie vs MLB MCP labeling
- [x] Verify the MLB game card behavior in browser automation for scheduled, live, final, and enrichment-unavailable states
- [x] Re-run full repo validation plus Railway MLB MCP smoke and record outcomes

Review:

- `server/routes/mcp.ts` now dynamically registers authenticated read-only `mlb_mcp__*` tools on Sportfolio's public `/mcp` surface using the existing internal MLB bridge, while leaving the private Railway `mlb-mcp` service non-public.
- `server/mcp/public-tool-registry.ts`, `server/agent/internal-mlb-mcp.ts`, and `server/mcp/testing.ts` now share one backend path for Hermes and public MCP callers, so external access uses the same bounded, fail-soft execution layer as the internal agent.
- `server/mcp/mcp-server.test.ts` now proves an authenticated MCP client can list and call an MLB tool through Sportfolio `/mcp`.
- The MLB fallback/status copy in `client/src/components/game-command-center-modal.tsx` stays provider-agnostic, so the frontend reads as one coherent MLB experience even though the backend keeps Ball Don't Lie authoritative for gameplay and scoring.
- Browser verification passed in `tests/e2e/mlb-game-card.spec.ts` for scheduled, live, final, and unavailable MLB game-card states, including home-slate probable pitchers and modal content.
- Validation status:
- `npm run check` passed.
- `npm run lint` passed.
- `npm run test:run` passed.
- `npm run e2e -- tests/e2e/mlb-game-card.spec.ts` passed.
- `npm run mlb-mcp:probe:railway` passed for `test_get_schedule_tool`, `test_get_stats_tool`, `test_get_available_endpoints_tool`, `test_get_last_game_tool`, and `test_get_next_game_tool`.
- `npm run format:check` passed.

## 2026-03-26 PR 109 Merge Conflict Resolution + Patch Review

- [x] Fast-forward the PR 109 worktree to the latest remote branch head and inspect mergeability against current `origin/main`
- [x] Resolve merge conflicts against `origin/main` and keep the intended `currency.ts` formatting behavior plus the `scan_sport_slate` team/sport inference path in `server/agent/hermes-tools.ts`
- [x] Review the resulting patch set for unnecessary churn, regressions, and missing coverage
- [x] Run required validation (`npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`) and record the branch-quality verdict

Review:

- The PR ballooning was mostly stale-`main` churn. After syncing to current `origin/main`, the real branch delta is the intended agent surface: slash commands, built-in MLB status visibility, team-aware slate/roster scans, prompt fallback messaging, and a small currency formatter adjustment.
- Actual merge conflicts were only in `client/src/lib/currency.ts` and `server/agent/hermes-tools.ts`. Resolved them by keeping the compact-currency `.0` trim and preserving the team-filter sport inference plus explicit team filtering in sport-slate scans.
- Tightened the patch quality beyond conflict cleanup:
- Exported and attached concrete input schemas for `scan_sport_slate` and `scan_team_roster` so the runtime tool catalog exposes the new arguments cleanly.
- Added direct coverage for slash-command matching, the MLB MCP fallback prompt note, and the team scan tool contracts in the Hermes tool catalog.
- Expanded the cleanup to the unrelated Prettier drift the user explicitly wanted fixed, bringing repo formatting back to a clean state.
- Validation status:
- `npx vitest run client/src/features/agent/lib/slash-commands.test.ts client/src/lib/currency.test.ts server/agent/conversation-prompts.test.ts server/agent/hermes-tools.test.ts` passed.
- `npm run check` passed.
- `npm run lint` passed.
- `npm run test:run` passed.
- `npm run format:check` passed.

## 2026-03-26 Agent Settings 503 on Agents Tab

- [x] Trace the Agents tab settings fetch path and confirm the failing endpoint (`/api/agent/profile`)
- [x] Identify why settings can return 503 instead of a profile payload
- [x] Add a robust self-healing path so agent system-settings reads bootstrap schema/row on demand and retry automatically
- [x] Run validation (`npm run check`, `npm run lint`, `npm run test:run`) and record outcomes

Review:

- Root cause: `/api/agent/profile` depends on `getActiveManagedProviderSelection()` (from `agent_system_settings`). If that table/column is missing (migration drift), profile load throws and routes map that to HTTP 503, which surfaces in UI as "Couldn't load agent settings" with service unavailable.
- Fix: `server/agent/system-settings.ts` now performs a targeted schema bootstrap + retry when `agent_system_settings` relation/column is missing, so reads and writes self-heal and preserve persisted provider/model settings.
- Result: Agents tab can still load profile/settings state even during migration drift, and once bootstrap succeeds it uses canonical DB-backed settings rather than a temporary in-memory/default-provider fallback.
- Validation: `npm run check` passed, `npm run lint` passed, and `npm run test:run` failed on a pre-existing assertion in `client/src/lib/currency.test.ts` (`$1.0K` vs `$1K`).

## 2026-03-25 Hermes Advisory De-Determinization + PR Bundle

- [x] Remove broad advisory/capability/review deterministic planner responses from the main Hermes direct-operation router while keeping deterministic mutation previews and blocking validations
- [x] Replace planner-backed advisory scan tools with native structured scans so Hermes can synthesize idle-balance and community-boost advice from tool context
- [x] Update focused agent tests to reflect model-first advisory routing and deterministic execution-preview boundaries
- [x] Run required validation plus targeted Hermes smokes, then bundle the approved local patch set into PR #107

Review:

- Hermes preview/materialization paths now call `planDirectAgentOperation` with `allowAdvisoryResponses: false`, so capability/setup/review/market discussion shortcuts no longer leak through the deterministic planner in the normal Hermes runtime.
- `scan_idle_balance_options` and `scan_community_boost_candidates` now build structured scans directly from operator context, scanner state, games, and community-boost state instead of proxying through deterministic planner prose.
- The model-first loop now receives structured scan/read summaries, observations, warnings, and context instead of primarily consuming canned `replyText`, while still preserving the human-readable tool reply for empty-provider fallback recovery.
- Hermes capability routing now has a first-class `get_agent_capabilities` tool and stronger prompt guidance for capability, setup-review, cash-deployment, cleanup, market, and community-boost advisory turns.
- The hardcoded follow-up explanation shortcut was removed from the orchestrator, so prompts like `what do you mean?` now go back through the Hermes model/tool loop.
- Validation status:
- `npx vitest run server/agent/operations-planner.test.ts server/agent/hermes-tools.test.ts server/agent/model-first-router.test.ts server/agent/hermes-orchestrator.test.ts` passed.
- `npm run check` passed.
- `npm run lint` passed.
- `npm run test:run` passed.
- `npx tsx scripts/agent-audit.ts --static-only --batch 8` passed and reported the full Hermes tool surface.
- `npx tsx scripts/agent-smoke.ts --user smoke_user` is still environment-blocked locally by the existing DB auth issue: `password authentication failed for user "postgres"`.
- `npm run format:check` still fails due pre-existing formatting drift in unrelated files under `client/src/features/agent/*` and untouched `server/agent/*`; the touched files in this patch were formatted.

## 2026-03-25 Mobile Pools Market Summary Refresh

- [x] Replace the gimmicky mobile Player Pools top card with a tighter market-summary header
- [x] Add broad indicator figures for volatility, 24h volume, pool shares, and market TVL
- [x] Make Top Risers use explicit positive 24h mover ordering instead of the old momentum proxy
- [x] Add an inline Value Scan explanation affordance on mobile
- [x] Run validation (`npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`) and record any pre-existing failures

Review:

- Reworked the top mobile pools card into a restrained `Market Summary` module with one compact stats grid and cleaner status chips instead of the old composite/health dashboard treatment.
- Extended `server/market-mobile-overview.ts` and `server/storage.ts` so mobile indicators now carry aggregate `totalVolume24h`, `totalPoolShares`, and market-wide TVL data for the header.
- Top Risers now prefers an explicit positive 24h risers feed built from real trade-based change data, then falls back only if needed; added regression coverage in `server/market-mobile-overview.test.ts`.
- Value Scan now includes a tappable `?` explainer describing the value index and how to read lower scores.
- Validation status:
- `npx vitest run server/market-mobile-overview.test.ts` passed.
- `npm run check` passed.
- `npm run lint` passed.
- `npm run test:run` fails due pre-existing unrelated timeouts/assertions in agent/job/storage suites (`server/agent/*`, `server/jobs/*`, `server/storage.share-payouts.test.ts`), while the touched overview suite passes.
- `npm run format:check` still fails due pre-existing formatting drift in unrelated `client/src/features/agent/*` and `server/agent/*` files.

## 2026-03-25 Marketplace Sort + 24h Change Fix

- [x] Make marketplace price sorting use the same AMM-aware price that the UI displays
- [x] Replace marketplace 24h change rendering/sorting with a live 24h AMM calculation
- [x] Remove retired bid/ask sort UI and legacy placeholder response fields tied to it
- [x] Run validation (`npm run check`, `npm run lint`, `npm run test:run`) and document any pre-existing failures

Review:

- Marketplace `price` sort now orders by the same AMM-aware effective price the UI renders instead of the stale raw `players.lastTradePrice` column.
- Marketplace `24h Change` now uses a live batch calculation from AMM trades in the last 24 hours, and the same metric is used for `/api/players` rendering and `change` sorting.
- Removed retired portfolio `bid`/`ask` sort options, removed the legacy `bestBid`/`bestAsk` placeholder fields from portfolio/player list responses, and stopped persisting dead bid/ask metrics into `playerMarketMetrics`.
- Validation status:
- `npm run check` currently fails in unrelated pre-existing worktree code under `client/src/components/market-mobile-pools-board.tsx` (`getMarketHealthBadgeClassName`, `MarketIndicatorBar`, `breadthDisplay`, etc. are missing), outside this marketplace/portfolio patch.
- `npm run lint` passed.
- `npm run test:run` failed due a pre-existing mismatch in `server/agent/hermes-tools.test.ts` against the already-modified `shared/schema.ts` profile shape (`internalMlbMcpEnabled`), unrelated to this marketplace/portfolio patch.
- `npm run format:check` still fails due pre-existing formatting drift in unrelated files outside this change set.

## 2026-03-25 Compact Currency Formatting

- [x] Add a shared client currency formatter with adaptive compact formatting and tests
- [x] Migrate large-value dashboard, profile, leaderboard, marketplace, player, portfolio, and mobile summary surfaces to the shared formatter
- [x] Run required validation (`npm run check`, `npm run lint`, `npm run test:run`) and record any pre-existing failures

Review:

- Added `client/src/lib/currency.ts` plus focused tests to standardize USD formatting, compact notation, and threshold-based switching at `$1,000`.
- Replaced page-local compact currency logic on the main user-facing summary surfaces so large balances, TVL, market cap, liquidity, payouts, and aggregate portfolio values now render with shared adaptive formatting.
- Left precision-sensitive per-share and quote displays on standard currency formatting paths.
- Validation status:
- `npx vitest run client/src/lib/currency.test.ts` passed.
- `npm run lint` passed.
- `npm run test:run` passed.
- `npm run check` failed due pre-existing unresolved identifiers in `client/src/components/market-mobile-pools-board.tsx` (`getMarketHealthBadgeClassName`, `breadthDisplay`, `MarketIndicatorBar`, `clampPercent`, `indexTone`, `breadth`, `breadthTone`), unrelated to this formatter change.
- `npm run format:check` failed due pre-existing formatting drift in untouched agent files under `client/src/features/agent/*` and `server/agent/*`.

## 2026-03-25 Main Sync + Source Control Investigation

- [ ] Compare current branch against `origin/main` and inspect worktree state
- [ ] Identify the actual local/untracked files causing Source Control noise
- [ ] Sync this branch with `origin/main` if it can be done safely without losing local edits
- [ ] Document the root cause and resulting branch/worktree state

## 2026-03-27 MLB MCP Local Vendor + Railway Parity

- [x] Bring the existing MLB MCP codebase into the repo under a clearly separate internal service boundary
- [x] Add a local run path and documentation/env wiring so Sportfolio can target the vendored MLB MCP in development
- [x] Probe Yankees probable-pitcher and starting-lineup data against both the local vendored MCP and the Railway production MCP
- [x] Document the exact returned fields and the recommended separation boundary versus Ball Don't Lie

Review:

- Vendored `etweisberg/mlb-mcp` into `vendor/mlb-mcp` and pinned the imported snapshot in `vendor/mlb-mcp/VENDORING.md` so the MLB enrichment lane is under Sportfolio control without mixing it into the main Express runtime.
- Added local dev wiring/docs in `docs/mlb-mcp.md`, `.env.example`, `.gitignore`, and `package.json`, plus a reusable local Yankees probe in `scripts/mlb-mcp-probe.mjs`.
- Local vendored MCP probe against `http://127.0.0.1:8081/mcp` on 2026-03-27 confirmed:
- `get_stats(schedule, hydrate=probablePitcher(note))` resolved Yankees at Giants (`gamePk` `823243`) with probable pitchers `Cam Schlittler` and `Robbie Ray`.
- `get_stats(game, gamePk=823243)` returned lineup paths at `liveData.boxscore.teams.away.batters` and `...home.batters`, with mapped batting orders and player names for both clubs.
- The schedule payload did not include a populated `probablePitcher.note` field for this sample even with `hydrate=probablePitcher(note)`.
- Added Railway production smoke in `scripts/mlb-mcp-railway-smoke.mjs` and validated the deployed `mlb-mcp` service over Railway with passing MCP pytest checks for:
- `test_get_schedule_tool`
- `test_get_stats_tool`
- `test_get_available_endpoints_tool`
- Separation recommendation: keep Ball Don't Lie as canonical ingest/sync, and treat the vendored MLB MCP as a separate MLB StatsAPI enrichment provider behind Sportfolio-owned normalization.

## 2026-03-27 MLB Display-Only Game Card Enrichment

- [x] Keep Ball Don't Lie as the source of truth for gameplay and calculations while confining MLB MCP usage to optional display-only enrichment
- [x] Expand MLB detail cards with lineups, venue, broadcasts, hitter spotlights, lineup signals, weather, attendance, and live/final linescore context
- [x] Add club-context summaries from the MLB MCP for recent/next matchup context without changing home-slate compactness
- [x] Re-run required validation plus Railway MLB MCP smoke for the exact tools used by the display layer

Review:

- The MLB enrichment lane stays fully additive: routes only attach optional `mlbPregame` display fields, and gameplay economics/payout paths continue to rely on Ball Don't Lie plus stored Sportfolio state.
- The click-through MLB game card now behaves like a fuller baseball card: probable pitchers, venue/broadcasts, lineup status and batting orders, hitter spotlights, lineup quality signals, weather, attendance, and structured game-state/linescore context for live/final states.
- Added club-context summaries from the MCP using `get_last_game`, `get_next_game`, and game detail follow-ups, so the card can show record plus recent/next matchup summaries without exposing raw MCP payloads to the client.
- The home dashboard slate remains compact and probable-pitcher-first; the heavier lineup/hitter/team context only loads on the game detail path.

## 2026-03-25 Internal MLB MCP Review Fixes

- [x] Add a short-lived negative cache for internal MLB MCP discovery failures so repeated Hermes turns fail fast during outages
- [x] Bound internal MLB MCP tool payloads before returning them to Hermes and add regression coverage
- [x] Run required validation (`npm run check`, `npm run lint`, `npm run test:run`) plus focused agent tests, then push the PR branch

Review:

- `server/agent/internal-mlb-mcp.ts` now extends the cached discovery snapshot with a short retry window when refresh fails, including the cold-start/no-cache case, so repeated Hermes turns return the cached empty/stale catalog instead of stalling on every discovery timeout.
- The internal MLB MCP read bridge now bounds `replyText`, `structuredContent`, and raw `content` before returning tool results to Hermes, and records truncation metadata when the payload was clipped.
- Added focused regression coverage in `server/agent/internal-mlb-mcp.test.ts` for both the failure-cache behavior and the oversized-payload truncation path.
- Validation status:
- `npx vitest run server/agent/internal-mlb-mcp.test.ts server/agent/runtime-adapter.internal-mcp.test.ts server/agent/hermes-tools.test.ts` passed.
- `npm run check` passed.
- `npm run lint` passed.
- `npm run test:run` still fails due pre-existing Vitest collection of `.claude/worktrees/flamboyant-dewdney/tests/e2e/*.spec.ts` Playwright files, unrelated to this patch.
- `npm run format:check` still fails due pre-existing formatting drift in unrelated files under `client/src/features/agent/*`, `server/agent/*`, and `server/agent/strategy-runner.test.ts`; the touched files for this patch were formatted and pass targeted Prettier checks.

## 2026-03-25 Hermes BYOK OpenRouter Parity + Conflict Resolution

- [x] Confirm rebase/merge-conflict cleanup on `server/agent/hermes-tools.ts` and branch state
- [x] Run live BYOK smoke with OpenRouter `MiniMax-M2.7` through Hermes runtime/tool loop
- [x] Run managed/in-house MiniMax smoke with equivalent prompt for parity comparison
- [x] Patch BYOK/runtime/UI behavior if any divergence is discovered
- [x] Run required validation (`npm run check`, `npm run lint`, `npm run test:run`) and targeted Hermes tests
- [ ] Push branch and update PR

Review:

- Resolved the `server/agent/hermes-tools.ts` merge conflict by keeping both the main-branch imports and the internal MLB MCP bridge imports.
- Root-cause fix: BYOK OpenRouter failed when users entered `MiniMax-M2.7` because OpenRouter requires provider-prefixed IDs (for example `minimax/minimax-m2.7`).
- Added server-side model normalization for OpenRouter BYOK so managed-style MiniMax IDs are accepted and translated automatically.
- Added regression coverage in `server/agent/pi-provider.test.ts` and surfaced an explicit OpenRouter model-format hint in the BYOK UI.
- Live parity smoke (managed + BYOK, same prompt path) succeeded with Hermes calling `mlb_mcp__get_league_leader_data` in all successful runs.
- Validation status:
- `npm run check` passed.
- `npm run lint` passed.
- `npm run test:run` failed due pre-existing `.claude/worktrees/flamboyant-dewdney/tests/e2e/*.spec.ts` Playwright collection errors unrelated to this patch.

## 2026-03-24 Internal MLB MCP Provider via Hermes (Railway)

- [x] Add a Hermes-owned internal MLB MCP client/registry module that discovers tools from the Railway private service and projects them into Hermes tool definitions
- [x] Merge projected internal MLB MCP tools into the runtime Hermes tool catalog/allowlist without changing the public MCP surface
- [x] Route Hermes read-tool execution for projected MLB MCP tools through the internal MCP client and preserve strict internal-only behavior
- [x] Add focused regression tests for runtime tool catalog merge and projected read-tool execution
- [x] Run required validation (`npm run check`, `npm run lint`, `npm run test:run`) and targeted Hermes tests/smoke coverage

Review:

- Added `server/agent/internal-mlb-mcp.ts` to discover internal MLB MCP tools over Streamable HTTP, cache mappings, project them into Hermes read-tool definitions, and execute prefixed `mlb_mcp__*` tool calls.
- Hermes runtime now uses `getAgentRuntimeToolCatalog()` so projected internal MLB tools are included in model-visible catalog/allowlist generation, while public MCP routes remain unchanged.
- `runHermesReadTool()` now returns runtime tool catalog for `get_tool_catalog` and delegates unknown prefixed tools to the internal MLB MCP bridge.
- Added regression coverage:
- `server/agent/internal-mlb-mcp.test.ts`
- `server/agent/runtime-adapter.internal-mcp.test.ts`
- `server/agent/hermes-tools.test.ts` (catalog merge + delegated read execution)
- `server/agent/model-first-router.test.ts` (MLB MCP read -> trade-plan composition for `buy 10 shares...home runs last year`)
- Validation summary:
- `npm run check` passed.
- `npm run lint` passed.
- `npm run test:run` fails in this workspace because Vitest picks up unrelated `.claude/worktrees/flamboyant-dewdney/tests/e2e/*` Playwright specs plus an unrelated `.claude/worktrees/.../public-surface-coverage.test.ts` parity assertion; Hermes-targeted suites and the new tests pass.
- Upstream/real-tool checks:
- Cloned `https://github.com/etweisberg/mlb-mcp`, installed dependencies, and executed real leader-query calls successfully.
- Verified Streamable HTTP endpoint behavior (`/mcp` works; root `/` returns `404` for MCP POST initialize).
- Verified end-to-end Hermes bridge smoke against a live local `mlb-mcp` HTTP server: discovered `mlb_mcp__get_league_leader_data` and returned 2025 HR leader data through `runHermesReadTool`.

## 2026-03-24 MiniMax-Only Managed Provider + M2.7 In-House Default

- [x] Remove non-MiniMax managed-provider options from the provider registry, system settings defaults, and managed-provider schema constraints
- [x] Set the managed in-house default model to `MiniMax-M2.7` and ensure the managed runtime always defaults to that model for agent actions
- [x] Simplify managed model catalog + provider smoke coverage to MiniMax-only behavior and update tests accordingly
- [x] Run required repo validation (`check`, `lint`, `test:run`) plus formatting checks

Review:

- Managed-provider resolution is now MiniMax-only: `ManagedProviderKey` is constrained to `minimax`, default managed provider settings are `minimax`, and settings input no longer accepts legacy provider enums.
- The in-house managed default model is now hard-pinned to `MiniMax-M2.7` in registry/runtime defaults, while still exposing the MiniMax family in supported model suggestions.
- Removed OpenRouter-specific managed catalog fetching and legacy multi-provider smoke coverage in favor of MiniMax-only catalog/runtime smoke validation.
- Validation passed with `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check` after formatting cleanup.

## 2026-03-24 Hermes Plan-Tool Intent Guardrails

- [x] Inspect the model-first router and confirm why broad advisory asks can still route into confirmation-gated preview tools
- [x] Add a guardrail that rejects premature plan-tool calls for advisory prompts and requests safer read/scan rerouting
- [x] Add regression coverage proving broad MLB strategy asks no longer get trapped in plan-tool-only paths
- [x] Run targeted tests and required validation commands for this change

Review:

- Added explicit plan-intent gating in the model-first router so confirmation-gated plan tools are only accepted when the message is clearly planning/action-oriented (or concrete action args are present), instead of blindly honoring a premature plan selection on broad advisory asks.
- When a plan tool is rejected for weak intent, Hermes now feeds a structured retry note back into the loop so the model reroutes to read/scan or advisory behavior instead of failing the turn.
- Added a regression test that reproduces a broad MLB strategy prompt and verifies Hermes rejects the premature plan tool call, reroutes through read tooling, and returns a usable answer.

## 2026-03-23 Hermes Runtime Reliability + Agent Mobile Composer Recovery

- [x] Move Hermes managed-provider defaults and capability checks onto tool-loop-safe provider/model pairs instead of silently honoring unsafe legacy defaults
- [x] Classify repeated empty provider replies explicitly, persist effective provider/model metadata, and preserve the latest successful tool result when the provider goes empty after a tool call
- [x] Let preview/staging tools resolve player references by name so natural prompts do not fail just because the model omitted canonical player IDs
- [x] Rebuild mobile `/agent` chat and strategy detail around a flatter dashboard-derived layout with a usable composer instead of stacked card shells
- [x] Add real mobile typing/send coverage plus local `/agent` Playwright auth bypass for loopback-only harness runs, then verify the live page in Playwright MCP
- [x] Re-run required validation and push the fixes onto the existing PR branch

Review:

- Hermes no longer defaults onto the unsafe legacy managed path. Managed-provider resolution now prefers configured providers that explicitly advertise Hermes tool-loop support, the DB default moved to `openrouter`, and legacy `chutes` + Kimi settings are auto-upgraded to the new safe default on read.
- The model-first router and orchestrator now classify empty assistant payloads as provider/runtime failures, log the effective provider/model on the run, and reuse the latest successful tool result if the provider goes empty after an earlier successful tool call instead of dropping straight into the generic fallback.
- Preview tools now resolve players from either `playerId` or `playerName`, so prompts like asking Hermes to invest in strong MLB names for the week no longer depend on the model knowing Sportfolio's canonical IDs up front.
- Mobile `/agent` was rebuilt away from the loose card stack: main chat and strategy chat now use a flatter transcript-plus-composer shell, strategies use denser strip/row layouts, and the mobile composer has explicit focus/visibility handling.
- Local Playwright coverage now exercises the real mobile typing/send path on `/agent`, and the loopback-only auth bypass keeps the harness on the protected route without weakening normal app auth. Live Playwright MCP smoke also succeeded for mobile main chat and strategy chat.
- Validation passed with `npm run check`, `npm run lint`, `npm run format:check`, `npm run test:run`, and `npx playwright test tests/e2e/agent-shell.spec.ts --reporter=line --workers=1`.

## 2026-03-23 Agent Command Center Visual Redesign

- [x] Recompose `/agent` around a stronger command-center shell with a clearer workspace switch and operator framing
- [x] Redesign the strategies desk into a denser command brief plus slot rail/detail canvas layout
- [x] Refine chat hierarchy so the workbench, transcript, and thread rail read like one interface instead of stacked cards
- [x] Validate with `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- `/agent` now opens inside a stronger Hermes operator shell with a dedicated workspace switch, denser chrome, and a more intentional first viewport.
- Strategies now reads like a command desk instead of a card stack: the top brief is more poster-like, slot selection is a tighter rail, and the selected strategy detail feels like the main canvas.
- Chat now leads with a proper workbench brief and a transcript frame, while the thread rail uses denser list-row treatments instead of generic conversation cards.
- Validation passed for `npm run check`, `npm run lint`, and `npm run test:run`. `npm run format:check` still fails only on the pre-existing unrelated files `server/mcp/testing.ts` and `server/routes/mcp.ts`.

## 2026-03-23 Agent Mobile Command Center + Bottom Nav Recovery

- [x] Restore the shared mobile bottom nav on `/agent` and reserve vertical space for it in the route shell
- [x] Rework mobile Strategies to open on a command-center overview instead of jumping directly into selected detail
- [x] Collapse mobile strategy detail into single-scroll views for overview/rules and keep chat as a secondary drill-down
- [x] Update targeted `/agent` Playwright coverage for the command-center-first mobile flow and bottom-nav visibility

Review:

- `/agent` now keeps the standard mobile bottom nav visible like the rest of the site, and the route shell reserves space for it so the agent workspace no longer stretches behind the nav.
- Mobile Strategies now opens on a dedicated command center with Today brief, next actions, and the strategy deck instead of forcing users straight into a selected strategy detail pane.
- Strategy detail remains available after a slot tap, but overview and rules now use a single mobile scroll owner while chat stays a deliberate secondary drill-down.
- Targeted `/agent` Playwright coverage now checks the command-center-first mobile flow, slot navigation back/forth, and Agent bottom-nav visibility.

## 2026-03-23 Continuous Hermes Operator + Continuity Verification

- [x] Add a server-owned continuity brief so manual chat, strategy runs, and runtime detail payloads all carry recent actions, open loops, active strategies, and evidence updates
- [x] Surface the continuity state in `/agent` Chat and Strategies using the frontend-skill app-workbench rubric
- [x] Fix the live thread-message contract so ordinary chat turns can send `null` strategy/trigger/execution context blocks without failing schema validation
- [x] Update focused tests and `/agent` Playwright fixtures for the new continuity contract
- [x] Run deep validation across typecheck, lint, full Vitest, targeted `/agent` Playwright, live non-model agent route smoke, and UI review

Review:

- Hermes now carries a continuity brief through the runtime path and exposes that state in thread runtime details plus strategy detail payloads, so the agent can reason from prior actions, scheduled work, and fresh evidence instead of starting over each wake.
- `/agent` now shows the continuity layer directly: Chat includes a compact continuity strip for open loops, recent actions, and active strategy context, while Strategy Overview adds a dedicated continuous-state section ahead of the policy/timeline detail.
- Live smoke uncovered and fixed a real regression in `POST /api/agent/threads/:threadId/messages`: ordinary chat threads were sending `null` runtime context blocks into a schema that only accepted objects. A focused regression test now locks that down.
- Validation passed with `npm run check`, `npm run lint`, `npm run test:run`, and `npx playwright test tests/e2e/agent-shell.spec.ts --reporter=line`.
- Additional live route smoke passed for non-model endpoints using the local dev user: thread creation, runtime-details fetch, strategy creation, strategy detail fetch, review, and archive all succeeded and returned continuity payloads.
- `npm run format:check` still fails only on the pre-existing unrelated files `server/mcp/testing.ts` and `server/routes/mcp.ts`.
- Two broader repo checks also still fail outside this continuity scope: `npm run openapi:check` reports missing `/api/holdings/condense`, and `npm run invariants:check` reports a missing `power: integer(\"power\")` token in `shared/schema.ts`.

## 2026-03-23 Agent-First Strategy Desk + Autonomous Guardrails

- [x] Shift `/agent` to open on the Strategies workspace and frame it as the primary autonomous strategy desk
- [x] Add a product-owned autonomy policy layer so broad goals are interpreted as portfolio-management mandates instead of literal one-shot trade prompts
- [x] Expand live strategy auto-execution to the approved gameplay surface while explicitly excluding community boosts, premium, checkout, and purchase-like flows
- [x] Update strategy prompts, docs, and tests so the new autonomy contract and timeline/trust model are visible across the stack
- [x] Run required repo validation and record any introduced or pre-existing failures

Review:

- `/agent` now defaults into a strategy-first desk with a clearer daily brief, active-strategy framing, and an operations timeline, while chat is still available as a secondary refinement and inspection surface.
- Added a shared strategy policy module that injects portfolio-manager behavior for broad requests, including diversification bias, pacing across the week, and hard exclusions for community boosts and any purchase-like flow.
- Tightened the server-side strategy runner and public capability contract so autonomous strategies can use the broader approved gameplay action set without slipping into premium, checkout, or community-boost execution.
- Updated agent docs, prompts, focused tests, and the `/agent` shell coverage so the autonomy-first contract is described consistently and the new strategy-first default path is exercised.
- Validation results: `npm run check`, `npm run lint`, and `npm run test:run` passed. `npm run format:check` still fails on pre-existing unrelated files `server/mcp/testing.ts` and `server/routes/mcp.ts`.

## 2026-03-23 MCP Client Playwright Timeout Fix

- [x] Reproduce the MCP client timeout against the current `/mcp` route and mock harness
- [x] Trace the transport/session behavior expected by external MCP clients and find the protocol mismatch
- [x] Patch the MCP server path and tests/smokes so the client handshake completes reliably
- [x] Run targeted MCP validation plus required repo checks where the current worktree permits

Review:

- Root cause was protocol drift in the public `/mcp` surface: we were creating a brand-new stateless transport per POST, returning initialize as `text/event-stream` with no `Mcp-Session-Id`, and hard-rejecting `GET /mcp`, which is enough to make session-oriented MCP clients hang or time out waiting for a proper streamable HTTP handshake.
- The MCP route and mock harness now create session-backed Streamable HTTP transports with JSON request/response mode, issue a session ID during initialize, reuse the same transport for later POST/GET/DELETE requests, and tear sessions down cleanly without recursive close loops.
- Added a regression test that exercises the raw initialize plus GET/DELETE session path, and validation passed with `npx vitest run server/mcp/mcp-server.test.ts`, `npm run mcp:smoke`, `npm run check`, `npm run lint`, and `npm run test:run`.

## 2026-03-21 Hermes Strategy Review + Broad Gameplay Delegation

- [x] Add explicit review-before-activation state to saved strategies so live runs only happen after the user approves the latest saved playbook
- [x] Broaden gameplay-safe strategy auto-execution to the full approved gameplay action surface while keeping explicit no-payments guardrails
- [x] Upgrade the Strategies Rules/Overview UI to expose review status, saved stages, and activation readiness clearly on mobile and desktop
- [x] Add focused regression coverage and rerun `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- Added a saved review-state layer to strategy rule sheets so every strategy now carries explicit approval metadata, activation blocks on unreviewed changes, and live strategies automatically pause when materially edited until the user reviews them again.
- Broadened the strategy runner's auto-exec allowlist to the full current gameplay-safe action surface, while keeping server-side validation around action scope, spend caps, and an explicit no-payments/no-checkout runtime guard.
- Reworked the Strategy Rules surface into a real playbook review screen with approval status, stage-by-stage saved timeline visibility, and clear activation readiness instead of a thin cron-and-caps form.
- Updated Hermes prompts and public runtime docs so the no-payments rule is explicit, and added regression coverage for review-state blocks, no-payments prompting/validation, broader gameplay action execution, and the new web-only strategy review route.
- Validation passed with `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`, and `npx playwright test tests/e2e/agent-shell.spec.ts --reporter=line`.

## 2026-03-21 Agent UI Blocks Deepening + Legacy Cleanup

- [x] Move agent block materialization deeper into the Hermes response path and enrich strategy-specific block synthesis
- [x] Remove the stale cockpit surface and tighten the remaining Chat/Strategies chrome so goal blocks stay primary
- [x] Improve the strategy builder/review workspace with richer draft, schedule, and rules summaries
- [x] Update the live agent surface doc to reflect `Chat` / `Strategies` plus native `uiBlocks`
- [x] Run `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`, and `npx playwright test tests/e2e/agent-shell.spec.ts --reporter=line`

Review:

- Replaced service-only block fallback usage with shared `materializeAgentUiBlocks()` output so strategy builder/refinement/review turns now default to richer first-class blocks, including schedule and rules summaries, before the UI sees them.
- Seeded new strategy conversations with draft-oriented `uiBlocks`, which makes blank strategy slots open into a real builder workspace instead of an empty chat plus generic shell chrome.
- Removed the stale cockpit component and trimmed more remaining static chrome from Chat and Strategies so the active goal, pending decision, and draft/review blocks stay primary.
- Tightened the visual language further with denser schedule/performance/source block treatments and strategy overview behavior that prefers draft context until the strategy is truly active.
- Validation passed with `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`, and targeted Playwright coverage for the Chat/Strategies flows.

## 2026-03-21 Agent UI Blocks + Visual System Refactor

- [x] Replace the generic `/agent` overview chrome with a compact goal-first `Chat` workbench and a slot-first `Strategies` workspace
- [x] Add a Hermes-safe `uiBlocks` contract plus fallback block derivation so approved native UI blocks can ride the existing Hermes runtime path
- [x] Rework Chat and Strategies to use the repo's terminal/trading visual language instead of oversized AI-dashboard cards
- [x] Add regression coverage for uiBlocks prompt/runtime handling and the new mobile-first Chat/Strategies experience
- [x] Validate with `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`, and `npx playwright test tests/e2e/agent-shell.spec.ts --reporter=line`

Review:

- Added a closed shared `AgentUiBlock` catalog and threaded it through the Hermes response/runtime/message contracts so the server can persist approved goal, decision, strategy, source, and run-summary UI blocks without widening the tool surface.
- Introduced safe server-side fallback block derivation for current Hermes responses, which lets the app adopt the new UI layer immediately while the sidecar/prompt path learns to emit first-class blocks directly.
- Rebuilt the main `/agent` surfaces around the repo's existing terminal/trading language: flatter shells, tighter density, compact goal strips, and lighter strategy chrome instead of generic AI hero cards and repeated summary grids.
- Updated Chat and Strategies so the transcript or active strategy workspace is visible sooner, while Hermes metadata remains available through compact blocks and inline expandable message details instead of dominating the first viewport.
- Validation passed with `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`, and targeted Playwright coverage for the new desktop/mobile Agent flows.

## 2026-03-21 Agent Mobile Cutoff Root-Cause Fix

- [x] Trace the remaining `/agent` mobile clipping through the app shell, agent shell, and strategy workspace to find the real viewport/overflow owner
- [x] Remove duplicate `100dvh` ownership, simplify chat/strategy scroll containers, and add safe-area bottom padding where the agent content actually ends
- [x] Add targeted browser coverage that scrolls the real agent chat and strategy workspaces instead of the page window
- [x] Run `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`, and targeted `npx playwright test tests/e2e/agent-shell.spec.ts --reporter=line`

## 2026-03-18 Hermes Strategy Continuity + Mobile Strategy Hub

- [x] Add strategy lifecycle events, strategy detail/performance surfaces, and event-driven wakeups without creating a second orchestration engine
- [x] Extend the strategy runner to wake on gameplay-day and research-refresh events through the Hermes runtime path and persist visible lifecycle history
- [x] Rework `/agent` mission and strategy views into a mobile-first organized workspace with a clearer briefing hierarchy, collapsible secondary panels, and sheet-based strategy detail on mobile
- [x] Add focused strategy-runner and `/agent` browser coverage for Hermes event routing and mobile layout behavior
- [x] Validate with `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`, and `npx playwright test tests/e2e/agent-shell.spec.ts --reporter=line`

Review:

- Added `user_agent_strategy_events`, strategy detail aggregation, and estimated sleeve/performance summaries so strategies now have real lifecycle history and attributable live-state visibility instead of only template metadata.
- Extended the Hermes-native strategy runner to wake on gameplay-day and research-refresh signals, record deduped event triggers, and keep all wakeups flowing through the same Hermes runtime boundary used by manual turns and schedules.
- Reorganized the `/agent` mission view around a single briefing surface plus mobile accordions for secondary automation/evidence/capability panels, and rebuilt the Strategy Hub into grouped live/library/attention sections with sheet-based detail on mobile.
- Added regression coverage proving gameplay-triggered strategy wakes still route through Hermes strategy mode, plus Playwright coverage for the organized mobile mission view and the mobile strategy detail sheet.
- Validation passed serially with `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`, and `npx playwright test tests/e2e/agent-shell.spec.ts --reporter=line`. A parallelized validation attempt produced unrelated timeout-only failures in existing long-running tests, but the serial rerun passed cleanly.

## 2026-03-16 Hermes Ops Cockpit Revamp

- [x] Tighten the live Hermes tool surface so the runtime only sees the explicit gameplay-scoped catalog for the turn
- [x] Add thread runtime/cockpit data that exposes active focus, progress timeline, schedules, research sources, and capability groups from real Hermes state
- [x] Rebuild `/agent` into a proactive cockpit with active-focus, since-last-message, progress, evidence, automation, and capability panels while preserving mobile-safe layout rules
- [x] Enrich assistant message rendering with tool traces, memory/skill context, and confirmation previews so Hermes reads as a real orchestrator
- [x] Run targeted validation (`npm run check`, `npm run lint`, `npm run test:run`) and record any pre-existing failures

Review:

- Tightened Hermes default tool access so the runtime only inherits tools from the explicit gameplay catalog and automatically excludes `hidden_fallback` and `internal_only` entries.
- Added a thread-scoped runtime-details server surface that turns real messages, pending bundles, schedules, and research into active objective, timeline, since-last-message, capability-map, and isolation metadata for the cockpit.
- Reworked the `/agent` shell into a two-column proactive cockpit that keeps mobile-safe density while surfacing focus, progress, evidence, automation, and capability state around the transcript instead of hiding everything inside chat bubbles.
- Enriched assistant message cards with Hermes run metadata including tool traces, skill usage, memory influences, schedule provenance, and confirmation previews.
- Added targeted regression coverage for the safe default Hermes allowlist and the runtime-details aggregator; validation passed with `npm run check`, `npm run lint`, `npm run format:check`, and `npm run test:run`.

## 2026-03-18 Hermes Normalization + Strategy Scaffolding

- [x] Normalize the in-app Hermes runtime around one shared request builder and portfolio-operator defaults without widening the tool boundary
- [x] Add sidecar-ready portfolio aliases/default migration hooks so Hermes identity and request assembly stop living in scattered scout-specific wrappers
- [x] Add thin user strategy persistence, slot enforcement (`5` saved / `1` live), and agent routes without creating a second orchestration engine
- [x] Surface saved strategies inside `/agent` so users can save the current Hermes thread as a reusable strategy template and manage live/pause/archive state
- [x] Run required validation (`npm run check`, `npm run lint`, `npm run format:check`, `npm run test:run`) and record any introduced or pre-existing failures

Review:

- Split Hermes request assembly into a shared runtime adapter so the local runtime and the sidecar path build the same canonical Hermes request contract instead of duplicating payload logic.
- Normalized the default Hermes identity to a portfolio operator, added compatibility aliases for portfolio-first service entrypoints, and auto-upgrade legacy scout-default profiles when they still match the old stock prompt strings.
- Added first-class strategy tables and service/routes for saving thread-backed strategy templates, enforcing the `5` saved / `1` live slot limits, and keeping strategies as thin product-owned mandates rather than a new execution engine.
- Wired a Strategy panel into the `/agent` cockpit so users can save the current thread, inspect saved mandates, and manage live/pause/archive state from the same Hermes surface.
- Added focused tests for the shared runtime adapter and strategy normalization/slot limits.
- Validation passed with `npm run check`, `npm run lint`, `npm run format:check`, and `npm run test:run` after updating the shared public-surface route audit for the new authenticated strategy routes.

## 2026-03-18 Hermes Runtime Boundary Refactor

- [x] Replace the request-builder-only runtime helper with a formal Hermes runtime adapter that can execute locally or through the documented sidecar transport
- [x] Wire the documented `HERMES_AGENT_URL` path so the main app can call a dedicated Hermes sidecar with the same canonical turn contract instead of always running in-process
- [x] Extend the Hermes runtime contract with explicit strategy, trigger, and execution context metadata without widening the gameplay tool boundary
- [x] Route the current in-app and bot Hermes entrypoints through the shared adapter instead of directly depending on the local orchestrator path
- [x] Add parity-focused runtime tests and rerun required validation (`npm run check`, `npm run lint`, `npm run format:check`, `npm run test:run`)

Review:

- Added a real runtime transport layer in `server/agent/runtime-engine.ts` that selects between the in-process Hermes path and the documented sidecar URL, so the app now has a genuine sidecar-ready execution boundary instead of a request-builder-only helper.
- Kept the existing Hermes orchestration framework intact by reusing the shared turn-request builder for both transports; the sidecar transport sends the same canonical turn metadata, while the dedicated sidecar service still rebuilds runtime config and context on its side instead of trusting widened product payloads.
- Extended the Hermes runtime contract with explicit `strategyContext`, `triggerContext`, and `executionContext` blocks so manual threads, schedules, and future strategy runs can all enter Hermes through the same interface without hardcoding route-specific behavior.
- Routed the main in-app agent service, due schedule runner, and Hermes bot runtime through the shared adapter and attached concrete trigger/execution metadata for each path.
- Added focused tests for the new request contract and sidecar transport path. Validation passed with `npm run check`, `npm run lint`, `npm run format:check`, and `npm run test:run`.

## 2026-03-18 Hermes Sidecar Cutover + Strategy Execution

- [ ] Make the Hermes runtime fail closed when sidecar mode is required, persist transport/correlation metadata on runtime sessions, and expose enough provenance to prove a turn actually routed through the sidecar
- [ ] Add a Hermes-native live strategy runner that wakes due strategies, calls the shared Hermes runtime contract, auto-executes only the approved strategy-safe action subset, and persists run history plus block/failure state
- [ ] Wire strategy run visibility and manual run/retry controls into the `/agent` cockpit without adding a second orchestration engine
- [ ] Add parity and failure-mode coverage for sidecar routing, runtime metadata, and strategy execution, then rerun `npm run check`, `npm run lint`, `npm run format:check`, and `npm run test:run`

## 2026-03-18 Agent Tab Cleanup: Chat + Strategies

- [ ] Fix the `/agent` desktop/mobile clipping bug by giving Chat and Strategies their own scroll ownership instead of one shared workspace scroll area
- [ ] Replace the current `Mission / Thread / Strategies` IA with `Chat / Strategies` and simplify Chat into a mostly chat-first Hermes workspace
- [ ] Convert strategies into dedicated strategy conversations with separate strategy threads, slot-based mobile-first navigation, and overview-first detail views with chat always accessible
- [ ] Add Hermes conversation-mode prompt layering for general chat, strategy builder, and strategy refinement so existing strategies carry the right context when edited
- [ ] Replace user-facing jargon like `mandate` and `wakeups`, add regression coverage for the new flows, and rerun `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`, and `npx playwright test tests/e2e/agent-shell.spec.ts --reporter=line`

## 2026-03-13 Issue 99 Canonical Player ID Repair

- [x] Sync local repo to latest `origin/main` and branch the issue 99 fix from current main
- [x] Add canonical player ID alias storage/runtime resolution across boost assignment, lock, settlement, and stats ingestion
- [x] Harden NFL and MLB roster syncs to track the canonical post-upsert player ID instead of the raw provider ID
- [x] Add the `player_id_aliases` schema migration plus a guarded duplicate-player / zero-payout boost repair script
- [x] Add regression coverage and run required validation (`npm run check`, `npm run lint`, `npm run format:check`, `npm run test:run`)
- [x] Apply the `player_id_aliases` migration against Supabase, seed the live alias map, and repair historical zero-payout boosts
- [ ] Finish the full production alias-market retirement pass (active alias pools + open alias orders/history) in a maintenance-window follow-up if we want every legacy market/archive row physically rewritten or removed

Review:

- Added an explicit `player_id_aliases` table and identity-aware storage methods so stale IDs now resolve to the canonical player row for boost-critical paths instead of relying on exact equality only.
- Daily boost assignment and community boost creation now store canonical player IDs, boost/community settlement reads use identity-aware stat lookups, and `upsertPlayerGameStats` now writes under the canonical player ID to prevent future stat drift.
- `lockBoostShares` now burns the matching holding or stacked-share row across the full alias group and normalizes the boost row onto the canonical player ID when it locks.
- Added a guarded `scripts/repair-player-id-integrity.ts` script for duplicate-player rewrites and historical zero-payout boost repair, plus new roster-sync regression tests to prevent the canonical-row deactivation bug.
- Applied `migrations/0041_player_id_aliases.sql` directly against the production Supabase project through the authenticated management SQL endpoint, seeded 378 live alias mappings, and repaired all 8 historically repairable processed zero-payout boosts; production now shows `repairable_zero_boosts_remaining = 0`.
- Production canonicalization is already complete for the user-owned/player-critical tables that caused issue 99 (`holdings`, `player_multipliers`, `daily_boosts`, `boost_payouts`, `community_boosts`, `share_payouts`, and `player_game_stats`), so stale player IDs no longer block boost settlement or future stat ingestion.
- Remaining live duplicate rows are concentrated in legacy market/archive surfaces (`orders`, some scout history/distributions, plus 46 alias LP positions across 378 alias pool rows with 335 open alias-market orders). Because the Supabase management API enforces a hard request timeout and those tables are materially larger, the full physical retirement of alias market rows should be treated as a follow-up maintenance-window operation rather than hidden behind a risky long-running migration.

## 2026-03-13 PR 100 Review Follow-up

- [x] Patch boost regular-share burning so alias-group selection uses unlocked per-row availability before canonical preference
- [x] Preserve NFL/MLB active roster IDs across transient player update failures
- [x] Add regression coverage for both review findings and rerun required validation
- [ ] Push the PR branch update after verification

Review:

- Added a dedicated regular-share selection helper so `lockBoostShares()` now burns from the alias/canonical holding row with the most unlocked quantity, only falling back to canonical preference after availability ties.
- NFL and MLB roster syncs now mark each provider player ID active before attempting writes, which prevents transient `updatePlayer()` failures from deactivating still-live roster rows later in the same sync.
- Added regression coverage for the new holding-selection rules and for the NFL/MLB failed-update deactivation case.
- Validation passed serially: `npm run check`, `npm run lint`, `npm run format:check`, and `npm run test:run`.

## 2026-03-12 PR 97 Review Follow-up

- [x] Fix public scout-assignment staging so scout-only pending bundles can be confirmed without a scout run id
- [x] Remove public API-token creation from bearer-token-authenticated CLI/MCP surfaces
- [x] Restore human-readable CLI `portfolio summary` output while keeping raw JSON available
- [x] Address the remaining PR 97 review nits for parser preview player labels and capability parity validation
- [x] Run targeted tests plus required repo validation, then push the PR branch update

Review:

- Scout-only bundles staged through the public registry now confirm by executing direct `scout_set_count` actions when no scout run id exists, while legacy run-backed scout plans still go through scout-run approval.
- The bearer-token public surface no longer exposes `create_api_token`; the shared route audit now marks `POST /api/account/tokens` as intentionally excluded and session-only.
- CLI `portfolio summary` again prints a dedicated balance/top-holdings summary, and `get_portfolio_summary` now carries a top-level summary string for generic tool consumers.
- Added regression coverage for the parser-backed preview player-name preference, public scout staging/confirmation, CLI portfolio rendering, and the public route audit/parity checks.
- Validation passed: `npm run check`, `npm run lint`, `npm run format:check`, and `npm run test:run`.

## 2026-03-11 Unified Public Capability Catalog + CLI/MCP Parity

- [x] Audit every authenticated non-admin user action and classify it as cataloged or explicitly excluded
- [x] Add a canonical public capability catalog with shared schemas, surface metadata, and executor bindings
- [x] Refactor MCP registration and CLI commands/routes to derive from the shared catalog
- [x] Add parity coverage tests plus catalog-driven smoke/validation runners for CLI and MCP
- [x] Run `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`, and exhaustive dev validation for all exposed CLI/MCP capabilities

Review:

- Unified the public CLI and MCP surfaces behind one capability catalog so tool metadata, schemas, prompts, resources, and execution paths now come from the same server-owned source of truth.
- Fixed external staging so preview-backed MCP/CLI actions persist pending bundles directly onto threads instead of depending on internal Hermes-turn-only context.
- Added direct planner coverage for scout assignments, tightened parser-backed preview message generation, and made cannot-stage responses reflect real clarification/action availability.
- Added catalog coverage tests plus a catalog-driven dev validator that exercises every exposed CLI and MCP tool, prompt, and resource as an external user; the latest sweep passed 252 cases with only `start_sms_link` blocked by missing `TELNYX_API_KEY`.

## 2026-03-11 LP Liquidity Follow-up Smoke Validation

- [x] Re-audit LP add flows and validate likely lock sources that can reduce available shares
- [x] Add smoke tests that cover add-liquidity success with no locks and failure when locks consume available shares
- [x] Run `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- Confirmed LP lock pressure can come from holdings locks (`holdings_locks`), including boost/order reservation paths; the new LP checks now align with project-wide available-share semantics.
- Added `server/amm/pool.add-liquidity.smoke.test.ts` with transaction-level mocks to verify LP adds still succeed with no locks and fail with clear errors when locked shares exceed available quantity.
- Re-ran full repo validation; all required checks passed.

## 2026-03-11 LP Add-Liquidity Guardrails + Mobile Popup UX

- [x] Audit AMM liquidity-add paths and reproduce why users cannot add players to LP in locked-share scenarios
- [x] Patch AMM liquidity adds to use available shares (quantity - locked) and preserve share precision
- [x] Update whale alert/mobile popup behavior: 3s timeout and swipe-to-dismiss support
- [x] Run `npm run check`, `npm run lint`, and `npm run test:run`

Review:

- Root cause found in LP add flows: they validated/debited raw holdings quantity and ignored `holdings_locks`, causing failed/invalid behavior when shares were reserved by boosts/orders.
- Updated both fixed-ratio and optimal-ratio add-liquidity paths to enforce available-share checks and lock the holdings row in-transaction.
- Removed integer rounding during LP share debits to prevent precision loss on fractional holdings.
- Whale alerts now auto-dismiss after 3 seconds and support swipe-to-dismiss for mobile; toast popups use mobile-friendly swipe affordances.

## 2026-03-10 Hermes Bot Runtime Stabilization + Live Sync Log Cleanup

- [x] Inspect the Hermes bot runtime, admin status surface, live-stats sync path, and player-volume refresh job to confirm the concrete failure points
- [x] Refactor the bot runtime for dev-sized cycle windows, smaller per-tick bot slices, explicit failure classification, and per-run timing metrics
- [x] Fix the broken 24h volume refresh query and reduce MLB live-sync log noise by batching missing-player skips into summarized warnings
- [x] Add focused regression coverage and run `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- Updated the Hermes bot runtime so cycle bucketing is now environment-driven, development can use minute-level bot cycles, and each tick only processes a smaller deterministic bot slice instead of serially walking the entire active population every time.
- Added structured bot diagnostics through `bot_run_logs.failure_class` and `bot_run_logs.metrics`, with run classification for direct-loop failures, advisory-only turns, policy-filtered plans, and execution failures instead of collapsing everything into generic `skipped` rows.
- Tightened bot planning around a smaller stabilization surface: pool buys, pool sells, simple LP adds, and scout adjustments, plus a strict `NO_ACTION:` contract so freeform advisory text is no longer treated as a valid bot outcome.
- Expanded runtime status with cycle interval, bots-per-tick, last successful bot action, recent run latency averages, and failure-class breakdowns so the admin/runtime surface is useful for monitoring.
- Fixed the broken `refreshPlayerVolume24h` SQL aliasing bug and added regression coverage for the generated update statements.
- Reduced MLB live-sync noise by batching local-player existence checks up front and logging one summarized warning for missing-player stat rows instead of hundreds of per-row FK-style errors.
- Added focused tests in `server/bot/runtime.test.ts`, `server/storage.share-payouts.test.ts`, and `server/jobs/sync-mlb-stats.test.ts`.
- Applied `migrations/0038_bot_runtime_diagnostics.sql` to the dev database and verified the new `bot_run_logs.failure_class` and `bot_run_logs.metrics` columns exist.
- Validation passed: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-10 Hermes Bot Gameplay Loop Expansion + Vesting Retirement

- [ ] Expand the Hermes bot runtime from the stabilization action subset into the full gameplay bot loop: trading, LP add/remove/zap, scouting, daily boosts, shared research, and richer runtime telemetry
- [ ] Remove vesting from the active bot, agent, route, CLI, dashboard, and activity surfaces so it is no longer part of the live product/runtime
- [ ] Restart or directly re-run the current code against the dev database, observe DB-backed bot/job logs, and keep iterating until the target bot mechanics execute cleanly without new errors
- [ ] Re-run `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

## 2026-03-10 Dev Runtime Live Verification Loop

- [x] Restart or otherwise re-run the latest bot/job code against the dev database instead of relying on the stale long-lived watcher process
- [x] Observe fresh bot and job activity in the dev database and current log capture instead of relying on the stale `.agent-dev.log`
- [x] Fix the remaining runtime failures in `bot_engine`, `refresh_player_volume_24h`, `stats_sync_live`, and `nascar_live_sync`
- [x] Re-run targeted validation plus a fresh live observation pass until the target jobs stop failing and bot runs produce executable or explicit `NO_ACTION` outcomes

Review:

- Fixed the remaining AMM seed invariant bug by normalizing pool defaults around the live 50k shares / $500k cash seed, correcting zero-trade pool repair detection to include `k` mismatches, and patching both setup/seed scripts so new pools stop inheriting the legacy `10000000` invariant.
- Added `migrations/0039_player_pool_seed_normalization.sql` and applied it to the dev database, which repaired the four zero-trade pools whose `k` value was still legacy while shares/cash had already been upgraded.
- Tightened fallback bot sizing so low-budget bots only place market buys that can clear at least one share; if a target would require more than the bounded fallback budget, the bot now skips that market candidate and can fall through to scouting instead of writing repeated `Trade too small` noise.
- Verified the repaired dev database directly: `refresh_player_volume_24h`, `stats_sync_live`, and `nascar_live_sync` are succeeding again with zero recorded errors in recent job runs.
- The long-lived local `tsx watch` process did not pick up the final fallback-sizing patch reliably, so verification used a direct one-off `runBotEngineTick()` on the current code path against the dev database; that completed with `botsProcessed: 3`, `botsSkipped: 0`, and `errors: 0`, and the resulting bot run logs were all `executed`.
- Validation passed after the final code shape: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-10 Hermes Bot Dev Monitoring Ramp

- [x] Confirm the bot scheduler cadence path and dev database migration target
- [x] Make `bot_engine` run every minute in development while production stays at 15 minutes unless overridden
- [x] Apply the Hermes bot runtime schema changes to the dev database and verify the new tables and bot profile columns exist
- [x] Run `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- Confirmed the local development database target resolves through `DEV_DATABASE_URL` to `sportfolio_dev` on `localhost:5433`, while production still depends on `DATABASE_URL`.
- Updated `server/jobs/scheduler.ts` so `bot_engine` now defaults to `* * * * *` in development, stays at `*/15 * * * *` in production, and can still be overridden explicitly with `BOT_ENGINE_SCHEDULE`.
- Updated `docs/CRON_JOBS.md` to document the new dev-vs-prod cadence and the `BOT_ENGINE_SCHEDULE` override path.
- Applied `migrations/0037_hermes_bot_runtime.sql` directly to the dev database and verified `bot_cycle_briefs`, `bot_run_logs`, and the new `bot_profiles` strategy/research columns exist.
- Validation passed: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-10 Boost Selection Live/ Scheduled Status Fix

- [x] Trace the dashboard game-status path and the boost eligibility / assignment path to find the divergence
- [x] Unify boost eligibility, boost assignment, community boost gating, and boost locking around a shared game-status helper
- [x] Add focused regression coverage for scheduled-but-not-live games
- [x] Run `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- Root cause was duplicated status logic: the dashboard only treated `scheduled` games as live when there was live evidence, but boost eligibility, boost assignment, community boost creation, and the lock job still used time-only heuristics or raw `startTime <= now` checks.
- Added `shared/game-status.ts` as the canonical status helper and routed the dashboard plus the boost/community/lock flows through it so scheduled games remain boostable until there is actual live evidence or the stale-sync completion fallback applies.
- Extended boost-eligible storage rows with game status and score fields so the legacy sport-specific eligibility endpoint can compute `gameStarted` from the same normalized rules instead of raw time.
- Added focused regression tests in `shared/game-status.test.ts` and `server/jobs/lock-boost-shares.test.ts` to lock in the scheduled-vs-live behavior and prevent boost shares from locking just because the scheduled tipoff time passed.
- Validation passed: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-10 Main Admin Route Auth Hotfix

- [x] Confirm `main` is fully synced before applying any direct-to-main hotfix
- [x] Tighten stray `/api/admin/*` routes that still use `isAuthenticated` instead of `adminAuth`
- [x] Re-run validation for the auth hotfix
- [x] Push the hotfix to `main` to trigger Railway redeploy

Review:

- Synced local `main` to `origin/main` first so the hotfix sits directly on top of the merged PR `93` state that Railway missed while it was down.
- Tightened five stray admin routes in `server/routes.ts` so they now use `adminAuth` instead of `isAuthenticated`: `/api/admin/whop/sync`, `/api/admin/premium/grant`, `/api/admin/games/cleanup-duplicates`, `/api/admin/sync/:jobName`, and `/api/admin/jobs/:jobName/trigger`.
- Removed redundant inline admin checks where `adminAuth` now guarantees access control, and preserved token-backed admin access for premium grants and manual job triggers by using `req.adminContext` for actor metadata/logging.
- Validation passed: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-09 PR 93 Review Comment Follow-Up

- [x] Inspect unresolved PR `93` review threads and confirm the exact files/behaviors called out
- [x] Patch the portfolio activity ledger so the client can request vesting activity and the server can paginate beyond 250 source rows
- [x] Add focused regression coverage for the review fixes
- [x] Run `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`
- [x] Push the updated PR `93` branch to GitHub

Review:

- Confirmed two unresolved PR `93` review threads: the portfolio activity tab never requested `vesting`, and the server-side merged-feed pagination capped per-source reads at `250`, which could strand older history for active users.
- Updated the client activity fetch params to request all supported activity categories, so the existing `Vesting` filter and `All` view can actually surface vesting claims instead of silently excluding them.
- Removed the server-side `250` cap by routing the source fetch window through a small helper that scales with `limit + offset`, preserving access to older activity rows when users scroll deeper into the ledger.
- Added focused regression coverage for both fixes and re-ran `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`; all passed.

## 2026-03-09 Dashboard Slate Exposure Card Refocus

- [x] Replace the top dashboard showcase with an exposure-only card built around `Owned` and `Missing` slate relevance
- [x] Extend game and NASCAR insights with slate-wide player/driver lists so exposure can be ranked across the whole viewed slate
- [x] Tighten the card to scoreboard-level mobile density with compact pills, mini subtabs, and an internally scrolling row list
- [x] Re-run `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`
- [x] Follow up on row interaction and summary treatment so row taps open the shared player modal and raw missing totals are not surfaced in the header
- [x] Keep the shared player modal close control off the top-right action cluster on mobile so the `Pool` button remains fully tappable

Review:

- Rebuilt the top dashboard card into a compact `Slate Exposure` surface with only `Owned` and `Missing` views for authenticated users plus a generic `Top Slate` guest view, removing the old boost/pulse/movers framing from that location entirely.
- Extended `/api/games/insights` with `slatePlayers` and `/api/races/insights` with `slateDrivers` so the client can rank owned exposure and uncovered top-slate names across the full viewed slate instead of relying on one leader per game.
- Tightened the UI to match dashboard score density: short header copy, three compact pills, mini subtabs, dense rows, and an internal scroll window so mobile keeps the card compact above scores.
- Exposure rows now open the shared `PlayerModal` instead of jumping directly into Player Pools, which gives the dashboard card a browse-first interaction without forcing a trade path.
- The summary line and compact pills no longer advertise a raw missing count; the `Missing` tab still ranks uncovered names, but the card header stays focused on owned and earning exposure.
- The shared player modal now reserves a dedicated top strip on mobile, so the close `X` no longer sits on top of the `Buy / Sell / Pool` action row.
- Validation passed: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-09 Premium Activity Ledger Completion

- [x] Add an immutable premium activity ledger table/schema surface for premium credits and redemptions
- [x] Record premium activity events on live premium purchase, redeem, admin-credit, and dev-credit flows
- [x] Remove inactive premium-trade assumptions from the Portfolio activity feed and keep legacy completed checkout sessions only as purchase fallback history
- [x] Add the append-only `0036_premium_activity_events.sql` migration and apply it to the production database ahead of merge
- [x] Re-run validation and capture any unrelated repo-wide blockers separately

Review:

- Added `premium_activity_events` as the canonical immutable ledger for live premium inventory/access changes so Activity can represent premium without relying on not-yet-shipped premium trades.
- Wired premium event writes into Whop sync, checkout finalization, webhook fulfillment, premium redemption, admin grant/manual credit, and the dev grant helper, with idempotent purchase credits keyed off receipt/payment ids.
- Simplified the Portfolio premium activity feed to read canonical premium ledger rows first and use old completed checkout sessions only as fallback purchase history when no ledger credit exists for that receipt.
- Added `migrations/0036_premium_activity_events.sql` and applied that exact SQL against the production `Sportfolio-Replit` database; verified `premium_activity_events` plus `premium_activity_user_created_idx`, `premium_activity_event_type_idx`, and `premium_activity_event_ref_idx` exist in prod.
- Validation passed for `npm run lint`, `npm run check`, and `npm run test:run`. `npm run format:check` still fails on unrelated existing files `client/src/components/dashboard-showcase-card.helpers.ts`, `client/src/components/dashboard-showcase-card.tsx`, and `server/lib/performance-earnings.ts`.

## 2026-03-09 Mobile Player Pools Intel Consolidation

- [x] Collapse the mobile pre-table stack into one compact `Market Intel` module with the three requested subtabs: `Market Indicators`, `Top Risers`, and `Top Market Value`
- [x] Add explicit market indicator data to the mobile overview payload so the first tab can show market health, index, breadth, and supporting leaders without inventing client-only heuristics
- [x] Move mobile player-pool controls to a visible desktop-style control bar above the table with inline search, sort, and expandable filters
- [x] Validate with `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- Added `marketIndicators` to the mobile overview response and covered the new health/index/liquidity/scout expectations in `server/market-mobile-overview.test.ts`.
- Replaced the mobile `/pools` entry surface with a slim pulse strip plus one consolidated intel card using the requested three subtabs, then tightened the indicators tab into dashboard-style pills and dense leader rows instead of a spread-out stat grid.
- Swapped mobile `/pools` onto a dedicated `MarketMobilePoolsBoard` component so the new layout is isolated from the in-progress legacy mobile-home file.
- Put search directly above the mobile trade board and kept visible sort/filter controls there, with team, position, and watchlist filters available inline instead of relying on a drawer-first interaction.
- Validation passed: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-08 Share Payout + Ready Tab Mechanic Correction

- [x] Change game-performance share payouts back to stacked-share-only earning units
- [x] Keep regular-share boost-slot earnings intact while narrowing dashboard `Ready` to stacked-share players only
- [x] Add regression coverage for the payout snapshot query and update showcase helper expectations
- [x] Re-run validation and document the corrected mechanic

Review:

- Updated `server/storage.ts` so share-payout snapshots now source `earning_units` only from `player_multipliers`, which means unstacked player holdings no longer earn game-performance cash outside of boost slots.
- Left boost-slot assignment behavior intact, so a regular `1x` share can still earn if the user explicitly places it into a daily boost slot.
- Reworked dashboard `Ready` selection and copy to surface only upcoming, unboosted players with stacked shares, replacing the earlier raw-share stacking prompts with boost-ready stacked-share context.
- Added a storage-level regression test for the payout snapshot query and updated showcase helper coverage for the new `Ready` criteria.
- Validation results: `npm run test:run -- server/storage.share-payouts.test.ts`, `npm run test:run -- client/src/components/dashboard-showcase-card.helpers.test.ts`, and `npm run lint` passed. `npm run check` fails on unrelated existing missing symbols in `client/src/components/market-mobile-home.tsx`. `npm run test:run` fails on unrelated existing `server/market-mobile-overview.test.ts` mocks missing `getTopPoolPlayerIds`. `npm run format:check` fails on unrelated existing files `client/src/components/portfolio-activity-tab.helpers.ts`, `client/src/components/portfolio-activity-tab.tsx`, and `server/market-mobile-overview.ts`.

## 2026-03-09 Mobile Player Pools Board Refresh

- [x] Extend the mobile market overview payload with ranked market leaderboards and authenticated personal-edge context
- [x] Rebuild mobile `/pools` into a market-first movers deck followed by a denser board-style table while preserving the existing player sheet flow
- [x] Run `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`; document any unrelated failures separately

Review:

- Extended `GET /api/market/mobile-overview` so mobile `/pools` now receives explicit market leaderboards (`risers`, `topPools`, `mostActive`, `boostWindow`) plus authenticated `personalEdge` data for owned movers, watchlist movers, boost-ready holdings, and LP fee/value context.
- Reframed the mobile page above the board into a tighter market-first stack: `Market Pulse`, a tabbed `Movers Deck`, and a compact `Your Edge` rail instead of the earlier dashboard-like tape/module pileup.
- Replaced the old mobile player card stack with a denser board-style row layout that keeps desktop-style scanability while preserving the existing player sheet and quick actions.
- Added focused assertions in `server/market-mobile-overview.test.ts` for the new leaderboard and personal-edge response shape.
- Validation passed: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-09 Mobile Player Pools Density Correction

- [x] Remove the standalone mobile pulse card and make `Market Intel` the only top card on `/pools`
- [x] Replace player-leader indicator content with compact market-wide signals and make risers/value lists show at least 5 names with board-sort handoff
- [x] Compress the mobile trade board into a true no-wrap spreadsheet row layout and re-run validation
- [x] Standardize mobile row labels so the CTA always reads `Trade`, owned names use green text only, and row tokens stay action-first

Review:

- Removed the separate `Market Pulse` card and folded freshness plus health into the `Market Intel` header so mobile `/pools` now opens with a single compact top surface instead of stacked summary cards.
- Rebuilt the `Indicators` tab around market-wide signals only: `Market Index`, `Volatility`, `Breadth`, and `Liquidity`, rendered as compact mini-bars plus small market pills instead of player leader rows.
- `Top Risers` and `Top Value` now show 5 dense rows each and add a `See more in board` action that auto-sorts the main mobile table by `24h Change` or `TVL` on the same screen.
- Tightened the mobile trade board into one no-wrap row per player with a single compact token, one action cell, reduced control heights, and much smaller padding throughout.
- Standardized the trading row language so the green button always says `Trade`, removed `OWN` as a row token, rendered only the owned player name text in green, and switched the remaining compact row labels to readable action/context tokens like `Boost Ready`, `Live`, and `Watch`.
- Updated `server/market-mobile-overview.ts` and `server/market-mobile-overview.test.ts` so `marketIndicators` now exposes market-wide fields (`volatilityIndex`, `liquidityHealth`, `totalMarketTvl`) instead of player-leader slots.
- Validation passed: `npm run check`, `npm run lint`, `npm run format:check`, `npm run test:run -- server/market-mobile-overview.test.ts`, and `npm run test:run -- server/jobs/settle-boosts.test.ts`.
- `npm run test:run` is currently flaky outside this change surface: one full-suite rerun timed out in `server/jobs/settle-boosts.test.ts`, but that same test passed immediately when re-run in isolation and the full suite had passed earlier in this work session.

## 2026-03-08 Dashboard Showcase Exposure / Ready / Pulse Reframe

- [x] Replace the old `Play` framing with `Exposure` centered on portfolio overlap with the day's slate leaders
- [x] Rework `Ready` into a conditional stack-needed tab with direct boost-slot modal access from each listed player row
- [x] Repurpose `Pulse` into top 24h portfolio gainers and extend `/api/dashboard` with the mover data needed to drive it
- [x] Reuse date-scoped boost eligibility / slot data on dashboard and rerun focused + full validation

Review:

- Rebuilt `DashboardShowcaseCard` around `Exposure / Ready / Pulse` so signed-in users now see slate overlap, stack-needed names, and portfolio movers instead of the earlier generic `Play / Ready / Pulse` summary.
- `Exposure` now favors owned exposure to the slate's highest-rated fantasy leaders, surfaces `playing / eligible` counts at the card level, and keeps the mobile panel compact with a single top line visible at a time.
- `Ready` now uses `/api/daily-boosts/eligible-all` plus `/api/daily-boosts/all?date=...` to show only upcoming, unboosted players with stackable raw shares; each row includes a compact `Boost` action that opens a slot-assignment modal instead of forcing a page change.
- Added `portfolioMovers24h` to `/api/dashboard` and used it to drive `Pulse` as the user's top 5 positive 24h movers by portfolio value gained, which avoids duplicating the floater's 24h P/L summary.
- Validation passed for `npm run check`, `npm run lint`, `npm run test:run -- client/src/components/dashboard-showcase-card.helpers.test.ts`, `npm run test:run`, and `npm run format:check`.

## 2026-03-08 Dashboard Showcase Mobile Condense Pass

- [x] Compress the new dashboard showcase so the mobile version behaves like a briefing, not a stacked multi-panel block
- [x] Keep the richer multi-panel layout for larger screens while switching mobile to one active panel at a time
- [x] Leave Player Pools surfaces unchanged and keep the mobile portfolio popup as the only account-summary surface
- [x] Add/update focused showcase helper coverage and rerun the full validation stack

Review:

- Reworked `DashboardShowcaseCard` so mobile now renders a segmented `Play / Ready / Pulse` layout with one compact panel visible at a time, while desktop keeps the fuller command-center layout.
- Tightened the mobile card header/footer, limited mobile content to a single top spotlight row per panel, and added a mobile height cap so the card reads as a quick briefing instead of taking over the full first screen.
- Did not modify the Player Pools tab or its mobile surfaces in this pass; the only product-surface changes were to the dashboard showcase.
- Added a helper-backed default mobile panel selection path and extended showcase helper tests to cover the panel-priority logic.
- Validation passed for `npm run check`, `npm run lint`, `npm run test:run`, `npm run test:run -- client/src/components/dashboard-showcase-card.helpers.test.ts`, and `npm run format:check`.

## 2026-03-08 Dashboard Showcase Command Center

- [x] Add a mobile-first showcase card above the dashboard slate that frames Sportfolio as a market/strategy surface instead of a scores-first page
- [x] Keep cash / portfolio snapshot details out of the new card and preserve the existing mobile portfolio popup as the canonical account-summary surface
- [x] Curate the top card around today-in-play exposure, stacked-share / multiplier readiness, and market pulse signals using existing dashboard and market-overview data
- [x] Move onboarding missions out of the first screen so mobile opens with the showcase card and the slate
- [x] Add focused helper coverage and run validation for the dashboard showcase changes

Review:

- Added `DashboardShowcaseCard` plus helper selectors/tests to build a compact command-center card above the slate without adding new backend contracts.
- The new card stays dense and mobile-first: small dashboard-matched type, short labels, 2-3 item modules, and no duplication of the mobile portfolio popup's cash / account snapshot data.
- For signed-in users, the first screen now highlights owned positions on the selected slate, best stacked-share multipliers, and live market signals; guests see concise product-differentiation copy plus live tape metrics instead of a score-only opening.
- Moved `OnboardingMissions` below the slate so mobile users land on the showcase card and then the games table, which better matches the desired "site showcase first, scores second" flow.
- Validation passed for `npm run check`, `npm run lint`, `npm run test:run`, and `npm run test:run -- client/src/components/dashboard-showcase-card.helpers.test.ts`.
- `npm run format:check` still fails, but only on unrelated pre-existing portfolio worktree files: `client/src/components/portfolio-stacking-tab.tsx` and `client/src/pages/portfolio-stacking-helpers.ts`.

## 2026-03-08 Portfolio Stacking Tab + Terminology Refresh

- [x] Add a dedicated `Stacking` tab to Portfolio with a mobile-first evaluation layout
- [x] Reuse live portfolio + boost-eligibility data to show unlocked raw shares, stack-ready players, and stack projections
- [x] Refresh Portfolio stacking terminology so holdings surfaces stop relying on the old lightning/power badge treatment
- [x] Add focused helper coverage and run validation

Review:

- Added a new Portfolio `Stacking` tab that summarizes stack-ready players, singles available to stack, and existing stacked positions, then renders a dense dashboard-style table focused on player context, singles available to add, current stack level, and direct `Stack` / `View` actions.
- Reused `/api/portfolio` and `/api/daily-boosts/eligible-all` instead of adding a new endpoint, and corrected Portfolio stack actions to use unlocked raw shares (`availableQuantity`) instead of total raw holdings when seeding the stack dialog.
- Refreshed Portfolio UI copy away from the old lightning/power framing so holdings/card views now read in stacking terms (`effective`, `Stacked 5x`, unlocked raw shares, stacking breakdown) while keeping the existing stack execution dialog.
- Added `client/src/pages/portfolio-stacking-helpers.test.ts` to lock in candidate aggregation, state classification, and default actionability sorting.
- Validation passed: `npm run check`, `npm run lint`, `npm run test:run -- client/src/pages/portfolio-stacking-helpers.test.ts`, `npm run test:run`, and `npm run format:check`.

## 2026-03-08 Dev DB Schema Drift Fix

- [x] Confirm the active dev database target and current failure mode on game-loading endpoints
- [x] Apply the current schema to the dev database so `player_multipliers` and related objects exist
- [x] Re-verify `/api/games/insights` and `/api/dashboard` against the running dev server
- [x] Run validation and capture any unrelated failures separately

Review:

- Confirmed the running dev app was not using the shell-exported `DATABASE_URL` pooler value; the effective local dev target came from `.env` and resolved to the `sportfolio_dev` database when loaded through the normal `dotenv` + `server/db.ts` path.
- The user-facing symptom was not missing game rows or duplicate `npm run dev` listeners: `/api/games/today` already returned `200`, while `/api/games/insights` and `/api/dashboard` failed on `relation "player_multipliers" does not exist`.
- `drizzle-kit push` could not complete non-interactively because of rename-detection prompts, and `drizzle-kit migrate` was blocked by an out-of-sync historical migration journal on the existing dev database.
- Fixed the dev DB by applying the checked-in March 8 SQL migrations (`0032` through `0035`) directly against `sportfolio_dev` after deleting two orphaned legacy stacked-share holdings for `dev-user-12345678` (`nba_31030`, `nba_9325`) that referenced missing players and blocked the backfill.
- Verification after the DB repair: `/api/games/insights?sport=NBA` and `/api/dashboard` now return `200`; `player_multipliers`, `player_multiplier_events`, and `reddit_post_history` exist; legacy `holdings.power*` and `share_payouts.share_power` columns are gone and the new multiplier columns are present.
- Validation passed for `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-08 Wiki MCP Handbook Review Fixes

- [x] Restore regular-share earning units in share-payout snapshots so 1x holdings still earn holder payouts
- [x] Reinstate `/power` as a backwards-compatible alias for the renamed boosts page
- [x] Exclude postponed/cancelled games from playable mobile/marketplace slate state and keep watchlist movers sport-scoped
- [x] Re-run focused and full validation, then capture the review outcome

Review:

- Updated `server/storage.ts` so share-payout snapshots aggregate effective earning units from both regular player holdings and stacked-share multipliers, preserving holder payouts for ordinary 1x inventory.
- Restored `/power` in `client/src/App.tsx` as a compatibility route and auth-bootstrap prefix while keeping `/boosts` as the canonical page.
- Hardened market-state helpers in `server/market-mobile-overview.ts` and `server/routes.ts` so postponed/cancelled/delayed/suspended games are treated as out-of-slate instead of upcoming, and filtered authenticated `watchlistMoves` to the requested sport.
- Added regression coverage in `server/market-mobile-overview.test.ts` for postponed-game boost windows and mixed-sport watchlist filtering.
- Validation passed for `npm run test:run -- server/market-mobile-overview.test.ts`, `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-08 Multiplier Cutover Rollout Hardening

- [x] Remove duplicate migration numbering so future DB rollouts have a single unambiguous apply order
- [x] Add an append-only migration for the post-cutover `share_payouts.earning_model` default and multiplier constraint validation
- [x] Capture the production rollout follow-up in task tracking and lessons learned

Review:

- Renamed the Reddit schema migration to `migrations/0034_reddit_post_history.sql` so the multiplier cutover files remain the canonical `0032` and `0033` sequence with no duplicate numeric prefix.
- Added `migrations/0035_finalize_multiplier_cutover_defaults.sql` to encode the production follow-up that sets new share-payout rows to default to `multiplier_only` and validates the `player_multipliers` minimum constraint.
- This keeps the repo's migration history append-only and aligned with the production database state after the March 8, 2026 multiplier rollout.

## 2026-03-08 Multiplier Canonicalization Phase 2

- [x] Drop legacy `holdings.power` / `holdings.powerLevel` and old boost/payout compatibility columns from the canonical schema
- [x] Refactor storage, routes, jobs, and AMM flows so multiplier/effective-share accounting is the only live model
- [x] Remove remaining `power` / `powerLevel` terminology and response fields from client, agent, CLI, SEO, and docs surfaces
- [x] Run the full validation stack plus targeted reference scans and document any residual unrelated failures

Review:

- Added `migrations/0033_finalize_multiplier_canonicalization.sql` to collapse duplicate regular holdings, backfill boost/payout multiplier fields, enforce the canonical unique holdings index, and drop the live `holdings.power`, `holdings.powerLevel`, `daily_boosts.power_level`, and `share_payouts.share_power` columns.
- Refactored storage, AMM, routes, jobs, agents, client pages/components, SEO, and docs so the live model is `tradeable shares + stacked-share multipliers`, with valuation and payouts driven by `effectiveShares`, `multiplier`, `shareMultiplier`, and `isStackedShare`.
- Removed legacy public terminology and compatibility fields from active runtime/API/UI/docs surfaces; the only remaining legacy `power*` names are in old append-only migration history files, while the active schema/runtime no longer exposes them.
- Validation passed for `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`, and `npm run docs:build`.

## 2026-03-08 Repo-wide Stacking Shares Terminology Alignment

- [x] Inventory and replace remaining `condense` / `power` terminology in active server, agent, client, and docs flows
- [x] Rename active helpers, route handlers, planner/tool copy, and UI labels to `stack shares` / `stacked share` / `multiplier`
- [x] Preserve only deliberate compatibility contracts where old field names are still required temporarily
- [x] Re-run full validation and document any remaining compatibility exceptions

Review:

- Active server, client, agent, CLI, SEO, and docs surfaces now consistently use `Stack Shares`, `stacked share`, `Multiplier`, `effectiveShares`, and `shareMultiplier`.
- The boosts page and mobile market overview were updated to consume the canonical multiplier contracts, including the last stale `powerLevel` client references and the personal boost-context regression caused by stacked-share aggregation.
- Targeted residue scans over `client/`, `server/`, `shared/`, and `docs/` found no active `powerLevel`, `Power Level`, `Power Up`, `/api/holdings/condense`, or raw legacy column references after the cleanup.
- Historical migration files still mention old column names by design as migration history; no live code path or public product surface depends on them anymore.

## 2026-03-08 Sportfoliobot Devvit Rebuild + Backend Integration

- [x] Create a local canonical `sportfoliobot` Devvit package in `packages/` for the existing Reddit app/install footprint
- [x] Add Sportfolio Reddit integration endpoints for preview/report plus runtime-backed Reddit post history persistence
- [x] Extract reusable Reddit market-post builders from the current tweet/news/gameplay data sources and add optional image generation
- [x] Add Devvit scheduler, settings/secrets, mod menu actions/forms, install/upgrade handling, and Redis dedupe/report flows
- [x] Add focused backend tests and package docs/scripts, then run validation

Review:

- Added a dedicated Reddit integration backend with signed preview-image support, post-history persistence, ET-aware morning/pregame builders, and report recording through `server/reddit-market-posts.ts`, `server/routes/reddit-bot.ts`, and the `reddit_post_history` schema/migration.
- Recreated the live `sportfoliobot` as a local Devvit package in `packages/sportfoliobot`, including installation/app settings, a 15-minute scheduler tick, install/upgrade triggers, Redis-backed disable/backoff state, mod-only preview/post/retry actions, and image-backed thread submission against the new Sportfolio endpoints.
- Added root helper scripts for Devvit workflows, package docs, and focused backend route coverage for the Reddit endpoints, including the signed public preview-image route.
- Validation passed for `npm run check`, `npm run lint`, `npm run test:run`, `npm run test:run -- server/routes/reddit-bot.test.ts`, `npm --prefix packages/sportfoliobot run typecheck`, and `npx devvit settings list --config devvit.json` from `packages/sportfoliobot`.
- `npm run format:check` still fails on unrelated pre-existing formatting drift in `server/jobs/snapshot-share-payouts.ts` and `server/routes.ts`, which were left untouched because those files already had active worktree changes outside this Reddit bot implementation.
- Deployed the additive Reddit backend endpoints to the live `Sportfolio-Replit` Railway service from a clean production-based worktree, then verified `https://www.sportfolio.market/api/integrations/reddit/preview-image.svg` now returns `400` instead of `404`, unauthenticated preview calls return `401`, and an authenticated preview call succeeds.
- Added a dedicated `REDDIT_BOT_API_TOKEN` to the production `Sportfolio-Replit` Railway service, uploaded new `sportfoliobot` Devvit builds through `0.0.16`, normalized Devvit setting keys to lowercase slugs, and upgraded `r/sportfoliobot_dev` to `v0.0.16.1`.
- The remaining operational gap is end-to-end Reddit post validation in `r/sportfoliobot_dev`; the backend and app are configured, but I have not yet forced a visible test thread through the Devvit UI/menu flow in the subreddit.

## 2026-03-08 Analytics Command Center + Mobile Density Pass

- [x] Rebuild `/analytics` into a command-center layout with a compact command bar and overflow-safe section rail
- [x] Tighten analytics mobile typography to match the dashboard/profile compact scale
- [x] Replace static metric cards with a selectable metric deck, market pulse hero, and sport momentum matrix
- [x] Rework leaders, compare, and relationships into spotlight, compare lab, and correlation-radar sections
- [x] Add helper coverage plus analytics E2E coverage, then run validation

Review:

- Rebuilt `client/src/pages/analytics.tsx` into a command-center view with an interactive metric deck, market pulse hero, sport filter matrix, player spotlight, compare lab, and relationship radar, while tightening the mobile type scale to match the denser dashboard/profile rhythm.
- Added analytics view helpers plus focused Vitest coverage in `client/src/pages/analytics-helpers.ts` and `client/src/pages/analytics-helpers.test.ts`, and added `tests/e2e/analytics.spec.ts` to cover the desktop drill-down flow and mobile rail/title behavior with mocked analytics endpoints.
- Validation passed for `npm run check`, `npm run lint`, `npm run test:run -- client/src/pages/analytics-helpers.test.ts`, and `npx playwright test tests/e2e/analytics.spec.ts --project=chromium`.
- `npm run test:run` still fails in pre-existing mobile-market worktree changes at `server/market-mobile-overview.test.ts`, and `npm run format:check` is blocked by an unrelated syntax error in the untracked `client/src/components/market-mobile-home.tsx`.

## 2026-03-08 PR #91 Review Fixes

- [x] Preserve legacy `/wiki/:section/:slug#heading` fragments when redirecting into handbook anchors
- [x] Restore authenticated handbook/search fetching so optional auth routes receive the Supabase bearer token
- [x] Re-run targeted validation and sync the branch with `origin/main` to clear merge conflicts

Review:

- Updated the wiki redirect helper so old article heading fragments map into the new handbook heading anchors instead of being dropped at chapter top.
- Switched the handbook and search page queries back onto the shared authenticated fetch helper, restoring the authenticated request path for optional-auth docs routes.
- Validation passed for `npm run check`, `npm run lint`, `npm run format:check`, and the targeted docs/wiki Vitest set. Full `npm run test:run` still has unrelated timeout failures in untouched agent/jobs suites.

## 2026-03-07 Wiki Handbook + Access Clarity + Docs QA

- [x] Replace the article-index wiki UX with a single handbook view backed by combined docs sections and chapter anchors
- [x] Add explicit handbook access guidance for web, mobile, SMS, CLI, repo-local CLI usage, and current MCP status
- [x] Add public docs handbook and docs ask APIs with docs-only natural-language answers plus lightweight IP rate limiting
- [x] Convert legacy `/wiki/:section` and `/wiki/:section/:slug` routes into handbook deep-link compatibility flows
- [x] Update mobile header navigation so Wiki replaces the top-bar Agent shortcut while bottom-nav Agent remains available
- [x] Add targeted tests for handbook composition, docs QA fallback/routing, and route coverage, then run validation

Review:

- Replaced the article-card wiki with a handbook-first `/wiki` experience that renders all readable docs as one long-form markdown handbook, with stable section/chapter/heading anchors, sticky desktop TOC, mobile drawer navigation, live search highlighting, and compatibility redirects from legacy article URLs into handbook deep links.
- Added explicit access coverage in the docs source for web, mobile, SMS, CLI, repo-local CLI usage, and current MCP status, and exposed that content through a new `GET /api/docs/handbook` route plus a public `POST /api/docs/ask` docs-only answer path with handbook citations and a `5 requests / 10 minutes / IP` limiter.
- Added targeted backend/client coverage for handbook composition, docs-answer fallback behavior, route behavior, rate limiting, and legacy deep-link helpers.
- Validation passed: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-07 PR #89 Review Follow-up

- [x] Pull the open review comments for PR `#89` and map the actionable feedback
- [x] Route top-level command help through the CLI error handler so invalid `--help` requests fail cleanly
- [x] Add regression coverage and validate the fix before pushing

Review:

- Fixed the CLI regression called out in PR `#89`: `sportfolio foo --help` now stays inside the existing `try/catch` path, so unknown command help requests use the normal `fail(...)` output instead of leaking a raw Node stack trace.
- Added `packages/sportfolio-cli/src/index.test.ts` to lock in both the invalid-command help failure path and the supported-command help path, then re-ran `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-07 Fresh PR Packaging

- [x] Audit the local worktree and separate product changes from local-only artifacts before staging
- [x] Create a fresh feature branch, stage the intended repo changes, and review the staged diff for secrets/junk
- [x] Commit, push, and open a GitHub PR for review

Review:

- Bundling the current local batch into a fresh PR that includes the leaderboard/profile overhaul, NASCAR hardening, CLI/action-surface improvements, and the agent shell restructure while excluding `.codex*` audit artifacts from the PR.
- Created branch `feat/agent-cli-leaderboards-nascar`, pushed commit `1d61a02`, and opened PR `#89` for review: `https://github.com/michaelhmiv/Sportfolio/pull/89`.

## 2026-03-07 Public Holdings Table + Mobile Type Scale Pass

- [x] Bring public profile holdings closer to the private portfolio table with sorting and denser row data
- [x] Align the public profile mobile type scale to the dashboard compact sizing patterns and make the standard explicit in code
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- Replaced the bare public holdings list with a sortable holdings surface: mobile gets compact sortable cards and desktop gets clickable sortable table headers for asset, quantity, average cost, price, value, P&L, and portfolio weight.
- Added explicit compact profile typography standards in `client/src/pages/user-profile.tsx` so mobile labels, meta copy, section titles, and metric values now follow the same denser dashboard-oriented scale instead of oversized one-off classes.
- Validation passed cleanly: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-07 Interactive Leaderboards + Public Trader Status Pages

- [x] Replace the stale leaderboard metric with rolling 24h trading volume and normalize leaderboard category/hash handling
- [x] Expand the public leaderboard API with current-user rank context, rank windows, and freshness metadata
- [x] Expand the public user profile API with richer rankings, trend history, public activity, and holdings/status summaries
- [x] Rebuild the leaderboard and public profile pages around live ranking/status UX
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- Replaced the stale vesting/shares-mined leaderboard slot with a canonical `tradingVolume24h` category and added legacy hash/category normalization so old links resolve onto the live board instead of breaking or drifting.
- `/api/leaderboards` now returns richer board metadata, current-user rank context, and a focused current-user window, while `/api/user/:userId/profile` now powers a full public trader status page with rankings, trend history, public activity, and portfolio concentration data.
- Added a dedicated `server/leaderboards.ts` helper module plus regression coverage in `server/leaderboards.test.ts` for category normalization, rank-change math, and current-user window behavior.
- Rebuilt the `/leaderboards` and public profile pages around live status, rank movement, jump-to-my-spot flow, public trader discovery, and richer holdings/activity presentation.
- Validation passed cleanly: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-07 NASCAR Pre-Race Completion / Payout Hardening

- [x] Reproduce the NASCAR provider payload for today and confirm why a non-race session can be treated as completed
- [x] Harden NASCAR live sync so only race sessions (`run_type=3`) can update game status and race stats
- [x] Harden race-result sync gating so non-final/live session data cannot mark races completed
- [x] Add regression tests for qualifying-session payload behavior
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run` (and `npm run format:check` if formatting-sensitive)

Review:

- Root cause confirmed with live provider payload: `live-feed.json` was returning a qualifying session (`run_type=2`, pole run) with a terminal flag state, and our live sync treated that as a completed race.
- `sync-nascar-live` now ignores non-race sessions, self-heals any incorrectly completed game status back to a safe pre-race/in-progress state, and only writes race stats for `run_type=3`.
- NASCAR ET datetime parsing is now explicit and DST-safe (`America/New_York`) for schedule/status and stats sync paths.
- Additional payout hardening now blocks NASCAR settlement when stats metadata indicates a non-race session (qualifying/practice), preventing accidental credits even if upstream status drifts.
- Added regression coverage in `server/jobs/sync-nascar-live.test.ts` for both non-race and race session handling.
- Validation passed: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-07 MCP Review Fixes

- [x] Bind MCP confirm/cancel flows to the validated `pendingBundleId` in thread-service
- [x] Fix `stage_lp_add_optimal` to pass the preview contract's `maxShares`/`maxPlayMoney` fields
- [x] Sort community-boost eligible players before applying the MCP tool limit
- [x] Tighten MCP mocks/tests so the reviewed regressions are covered
- [x] Validate via targeted MCP/Hermes tests plus `npm run check`, `npm run lint`, and `npm run test:run`

Review:

- `confirm_pending_action` and `cancel_pending_action` now pass the validated bundle id into thread-service, and thread-service applies/rejects that exact bundle instead of whichever pending bundle is latest on the thread.
- `stage_lp_add_optimal` now maps to the preview contract's `maxShares` and `maxPlayMoney` fields, with backward-compatible aliases retained in the MCP schema.
- Community boost eligibility now mirrors the existing route ordering by sorting on `communityBoostCount` and player name before applying the MCP limit.
- The MCP mock harness now enforces bundle-id forwarding and the LP-optimal preview contract, and `server/mcp/mcp-server.test.ts` adds an ordering regression test for community boost candidates.
- Validation passed for targeted MCP/Hermes tests, `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-07 Full Gameplay MCP Parity + Exhaustive Verification

- [ ] Build a canonical gameplay capability matrix that enumerates every included gameplay workflow and every explicit MCP v1 exclusion
- [ ] Add a stable public MCP tool registry over the existing Hermes/tool executor layer
- [ ] Fix Hermes intent grounding so idle-cash asks stay in the cash-deployment domain and do not reuse generic cross-domain levers
- [ ] Add a remote `/mcp` Streamable HTTP server with bearer-token auth using existing user API tokens
- [ ] Harden staged confirmations so MCP confirm/cancel require both `threadId` and `pendingBundleId`
- [ ] Expose typed gameplay read/state/mutation tools for the full non-billing gameplay surface
- [ ] Add parity audit coverage, MCP protocol tests, and an exhaustive smoke harness that calls every public MCP tool at least once
- [ ] Run `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`, and the new MCP verification commands

## 2026-03-04 PR #87 Comment Fix Pass (Manual)

- [x] Sync `main` with `origin/main` and check out PR `#87`
- [x] Reproduce and address actionable PR comments in `agent-self-improve` and `check-text-encoding`
- [x] Normalize previously exempted tracked text files to valid UTF-8 so encoding checks are enforceable
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- Added a missing-artifact guard in `scripts/agent-self-improve.mjs` so a fresh checkout no longer throws `ENOENT` and instead gives clear remediation (`npm run agent:debug` first).
- Removed the permanent `legacyBinaryAllowlist` bypass in `scripts/check-text-encoding.mjs` so high-value tracked text files are checked consistently.
- Re-encoded `README.md`, `CODEOWNERS`, `.github/PULL_REQUEST_TEMPLATE.md`, `pr_comments.json`, and `pr_review.json` to clean UTF-8 text and removed embedded NUL bytes/replacement-char prefix artifacts.
- Validation now passes for `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-04 Player Search Reliability Hardening

- [x] Unify `/api/players` search contract to accept canonical `q` with backward-compatible `search` alias
- [x] Harden backend player matching to include full name, compact full name, team, position, ID, and token-aware matching
- [x] Add search relevance ranking so exact/prefix hits rank above broad substring matches
- [x] Remove duplicate `/api/teams` route registration and keep one handler with optional sport filter
- [x] Migrate player-searching UI surfaces (`marketplace`, `scout dashboard`, `watchlists`, `community boost`, `power`) to shared search logic
- [x] Replace watchlist add-player subset search (`limit=500` local filtering) with server-driven query search
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- Root cause for "player sometimes doesn’t appear" was confirmed in backend logic: only `firstName OR lastName` search matching, which misses common full-name queries.
- Backend now normalizes search input and matches across full name, compact full name, team, position, and ID with token fallback, then ranks by explicit relevance before secondary sort fields.
- `/api/teams` had two route definitions; this is now a single route that optionally filters by `sport`, removing registration-order ambiguity.
- Watchlists no longer depend on the top 500 player subset for search; add-player dialog now queries `/api/players` directly with canonical search and returns live server results.
- Validation status: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check` all pass.

## 2026-03-04 User UI Terminal Compliance (Phase 3)

- [x] Finish the remaining route and shared-component cleanup so the repo-wide user UI no longer relies on soft rounded/gradient defaults
- [x] Push the terminal aesthetic through the shared `ui/*` layer where rounded/shadowed defaults were still leaking back into product surfaces
- [x] Re-run repo-wide UI scans to confirm the main `pages` and `components` trees are clear of the tracked soft-style patterns
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- This completion sweep finished the residual product-facing hotspots that were still soft after the earlier phases: analytics/dashboard/portfolio micro-elements, market and scouting widgets, command-center surfaces, celebration overlays, collection and milestone badges, and the remaining shell indicators.
- The final pass also moved the shared `ui/*` primitives themselves onto the same flatter visual language where they were still reintroducing rounded/full or heavy-shadow defaults, so the design system now reinforces the terminal aesthetic instead of working against it.
- Repo-wide pattern scans for the targeted drift now come back clean across both `client/src/pages` and `client/src/components` (excluding intentionally out-of-scope `admin` and unrouted `landing` surfaces), which means the visible app is no longer hiding obvious soft-card regressions behind shared primitives.
- Validation results: `npm run check`, `npm run lint`, and `npm run format:check` all pass. `npm run test:run` currently fails in untouched `server/docs-service.test.ts` because the docs-service agent-knowledge list is returning zero articles; that failure is outside this UI sweep and should be treated as a separate docs/runtime issue rather than a regression from the terminal-aesthetic work.

## 2026-03-04 User UI Terminal Compliance (Phase 2)

- [x] Restyle the next high-impact soft user-facing surfaces (`/power`, `/watchlists`, CLI access, SMS access)
- [x] Convert the main public long-form reference pages (`/about`, `/how-it-works`, `/privacy`, `/terms`) onto the same terminal shell
- [x] Run a second repo-wide UI compliance scan and capture the remaining non-compliant user-facing hotspots
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- This pass moved the last obviously soft high-traffic account surfaces onto the same terminal system: square avatars, mono metadata, flatter dialogs, and bordered shell panels are now consistent on Power, Watchlists, and the account access cards.
- The main informational routes no longer fall back to generic marketing-card layouts; they now render as documentation-style terminal panels with the same dark shell and uppercase strip language as the trading surfaces.
- Second-pass scan confirms the biggest remaining user-facing gaps are still `client/src/pages/contact.tsx`, `client/src/pages/auth-error.tsx`, `client/src/pages/checkout-success.tsx`, `client/src/pages/marketplace.tsx`, `client/src/pages/premium.tsx`, plus several celebratory/secondary components (boost/scout ceremonies, whale alert, onboarding, some portfolio/player subviews). `client/src/pages/admin.tsx` also remains soft, but it is outside the main user-facing scope.
- Validation results: `npm run lint`, `npm run test:run`, and `npm run check` all passed. `npm run format:check` still fails, but only because of pre-existing formatting drift in untouched documentation files (`design_guidelines.md`, `GAMIFICATION_TEST_REPORT.md`, `IMPLEMENTATION_INSTRUCTIONS.md`, `PHASE_5_6_PROMPT.md`, `PRODUCTION_SETUP.md`) and this task log before reformatting.

## 2026-03-04 User UI Terminal Compliance (Phase 1)

- [x] Add opt-in terminal variants to shared UI primitives (`Card`, `Button`, `Tabs`, `Input`, `EmptyState`) plus shared terminal utility classes
- [x] Restyle the highest-traffic soft user-facing routes (`/login`, `/news`, daily digest, `/wiki`, wiki article, `/blog`, blog post, `/leaderboards`) onto the terminal design layer
- [ ] Follow through on the remaining user-facing routes and secondary components (power, watchlists, long-form content pages, CLI/SMS cards, and other soft surfaces)
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- This pass keeps the existing dark dashboard surfaces as the visual anchor and adds additive terminal variants instead of globally restyling every primitive by default.
- The strongest immediate changes land on the public/auth shell pages that were furthest from the desired Bloomberg-terminal feel, so the site now reads more consistently across entry points.
- Validation results: `npm run lint` and `npm run test:run` passed. `npm run check` is still blocked by pre-existing server type errors in untouched bot/jobs files, and `npm run format:check` is still blocked by unrelated formatting drift in untouched files outside this UI pass.
- Remaining gap: several lower-traffic user pages and secondary components still need to be migrated onto the same terminal layer for full site-wide consistency.

## 2026-03-04 Agent Composer Visibility Follow-Up

- [x] Fix the inner agent chat column sizing so the transcript can shrink instead of pushing the composer off-screen
- [x] Validate via `npm run lint`, and confirm `npm run check` / `npm run test:run` are currently blocked by unrelated server issues

Review:

- The dedicated full-screen route removed the outer shell conflict, but the inner transcript pane still lacked `min-h-0` on the relevant flex items.
- Once messages appeared, the scroll area expanded to content height instead of shrinking, which pushed the composer below the visible frame.
- Fixed by converting the shell interior to flex-based height sharing end-to-end and adding `min-h-0` to the transcript container and `ScrollArea`.
- `npm run lint` passed. `npm run check` currently fails in untouched server files (`server/agent/model-first-router.ts`, `server/contest-scoring.ts`, several `server/jobs/*`) and `npm run test:run` currently fails on unrelated server test timeouts (`server/agent/*`, `server/jobs/settle-boosts.test.ts`), so neither failure is tied to this client layout patch.

## 2026-03-04 Daily Digest Brief Redesign

- [x] Audit the current Daily Digest UI against the live gameplay loops and mobile usage
- [x] Replace the digest's multi-panel explorer UI with a mobile-first Daily Brief layout
- [x] Normalize the existing digest payload into action-first sections while hiding retired or low-signal sections by default
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- Rebuilt the News tab's digest into a mobile-first Daily Brief with a compact header, fixed stat grid, action-first "What Mattered" and "Today's Setup" sections, and simple vertical lists for user holdings and market context.
- Kept the existing digest API contract and added a client-side normalization layer so the UI now promotes active loops (boosts, scouting, holdings, market context), plus direct shortcut buttons into boosts, pools, and the scout dashboard flow.
- Trimmed the backend digest generator so it no longer emits contest or vesting sections, and removed the vesting-specific earnings row so the payload itself stays aligned with the active product loops.
- Wired the brief to the existing dashboard balance query so the setup section can show real available cash when it is loaded, and aligned the News page copy from "Daily Digest" to "Daily Brief".
- `npm run lint` passed. `npm run check` still fails on unrelated pre-existing type errors in `server/agent/model-first-router.ts` plus existing bot/contest-related server files. `npm run test:run` still fails on unrelated pre-existing timeout issues in `server/agent/executor.test.ts`, `server/agent/operations-planner.test.ts`, and `server/jobs/settle-boosts.test.ts`. `npm run format:check` still fails on pre-existing formatting drift in many untouched files, but a targeted Prettier check passed for the files changed in this task.

## 2026-03-04 Agent Full-Screen Shell Follow-Up

- [x] Remove the remaining shared app chrome from `/agent` so the route owns the full viewport
- [x] Keep an explicit in-route exit path after hiding the shared header/sidebar on the agent tab
- [x] Validate via `npm run lint` and `npm run test:run`, and confirm `npm run check` is blocked by an unrelated server type error

Review:

- Hiding only the footer/nav was not enough; the agent route still lived inside the shared header/sidebar frame, which could leave the chat shell feeling squeezed and made the full-height composer math too brittle.
- Fixed by rendering `/agent` in a dedicated full-screen app-shell branch and adding a direct Dashboard button inside the agent header so the route remains easy to exit.
- `npm run lint` and `npm run test:run` passed. `npm run check` currently fails in untouched `server/agent/context-loader.ts` because `ScoutAgentRecommendedTarget` now requires `sport`, and that pre-existing server compile error is outside this UI fix.

## 2026-03-04 Agent Route Scroll Anchoring

- [x] Keep the agent transcript auto-scroll inside the chat viewport instead of scrolling the app shell
- [x] Make the `/agent` route a full-height shell without the global footer or bottom nav beneath it
- [x] Validate via `npm run check`, `npm run lint`, and `npm run test:run`

Review:

- Root cause was a nested layout mismatch: the agent route lived inside the app shell but still used viewport-based min heights, and the transcript end marker used `scrollIntoView`, which pulled the outer page container to the footer instead of just scrolling the chat pane.
- Fixed by making `/agent` fill its parent container, hiding the global footer/bottom nav on that route, and scrolling the Radix scroll-area viewport directly.
- `npm run format:check` still reports unrelated formatting drift in the already-modified `server/vite.ts`, which was outside this fix.

## 2026-03-04 Contest Removal

- [x] Remove contest routes, pages, and UI references from the live client surface
- [x] Remove contest API handlers, jobs, and supporting backend code paths
- [x] Remove contest-specific schema/storage/runtime references where they are no longer used
- [x] Revise the wiki and user-facing copy so contests are no longer described as part of active gameplay
- [x] Validate the repo and document any pre-existing failures separately from this change

Review:

- Removed contest routes, page components, WebSocket events, invalidation paths, storage methods, schema exports, scheduler hooks, seed utilities, and contest-only scripts so the live app no longer exposes contests as a product surface.
- Replaced contest documentation with boost- and leaderboard-based explanations across the wiki, public metadata, and operational docs, and cleaned leftover support artifacts (ops docs, design notes, RLS helpers, and the bot profile seed CSV) so active repo guidance no longer treats contests as live.
- Validation passed for `npm run docs:build`, `npm run docs:check`, `npm run check`, `npm run lint`, and `npm run test:run` (the full suite was briefly flaky once in `server/agent/improvement.test.ts` earlier in the pass but passed on immediate re-run and on the latest full run).
- `npm run dev` reaches normal initialization, route registration, and Vite setup, but a second local launch still hits `EADDRINUSE` on port `5000` because an existing local `node ... server/index.ts` dev process was already bound there; the current listener on `http://127.0.0.1:5000` responds with `200`.
- Final formatting validation passed: `npm run format:check` now clears repo-wide after reformating the touched markdown/task files.

## 2026-03-04 Wiki Coverage Overhaul

- [x] Audit the live web/API surface and compare it to current `docs/wiki` coverage
- [x] Expand the existing public wiki articles so they explain core Sportfolio loops in detail
- [x] Add new canonical wiki articles for missing product areas (feature map, sports coverage, portfolio, contests, glossary, and auxiliary features)
- [x] Validate the docs surface and run repo checks (`npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`)

Review:

- Expanded the public wiki from 11 total articles to 18 total articles, adding dedicated coverage for platform navigation, portfolio mechanics, contests, sports coverage, platform systems, a glossary, and a deeper agent runtime explainer.
- Rewrote the short core articles for getting started, player pools, scouts, power, the agent, SMS, FAQ, and CLI so they now match the live AMM-first product and retire outdated vesting-first guidance.
- `npm run docs:check`, `npm run check`, `npm run lint`, and `npm run test:run` all passed.
- `npm run format:check` failed only because of the pre-existing formatting issue in `client/src/App.tsx`; a docs-only Prettier check on `docs/wiki/**/*.md` passed.

## 2026-03-04 Hermes Model-First Routing

- [x] Remove heuristic scan and direct-operation pre-routing from the primary Hermes turn path
- [x] Add a model-first router that decides between direct reply, supported read/research tools, and confirmation-gated plan tools
- [x] Expand the model-first router to cover the full current Hermes live-tool allowlist (read, scan, plan, action, memory, and compatibility tools)
- [x] Keep runtime skills as routing hints only instead of hard-selecting tools ahead of the model
- [x] Stop generic discussion fallbacks from forcing a scout-review reply on non-scout prompts
- [x] Fix the new agent chat shell ref typing so `npm run check` is green again
- [x] Update Hermes docs/runbooks to reflect the new model-first routing contract
- [x] Validate via targeted agent tests, `npm run check`, `npm run lint`, and full `npm run test:run`
- [x] Run `npm run format:check` and confirm the only remaining failure is the pre-existing formatting drift in `client/src/App.tsx`

Review:

- Normal Hermes turns no longer auto-run regex-selected scan tools or jump straight into direct planners before the model sees the message.
- The model-first router now covers the full current live tool allowlist, including scan, action, memory, and compatibility tools in addition to the earlier read/plan path.
- The scout compatibility path no longer injects a forced `review_setup` fallback for generic discussion errors, so non-scout prompts do not collapse into the canned scout review reply.
- Fixed the new chat-shell ref typing issue in the extracted agent feature so `npm run check` now passes.
- Validation passed for `npm run check`, `npm run lint`, targeted agent tests, and full `npm run test:run`.
- `npm run format:check` still fails because of pre-existing formatting drift in `client/src/App.tsx`, which was already modified outside this task.

- [x] 2026-03-04: Investigate the extra pre-dashboard loading screen on initial app load
- [x] 2026-03-04: Stop blocking public routes on auth bootstrap and remove the redundant pre-dashboard gate
- [x] 2026-03-04: Reduce landing-path fetch overhead so the dashboard can load without waiting on auth setup
- [x] 2026-03-04: Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- Root cause was two-stage client bootstrapping on `/`: the router blocked the entire page on auth initialization, then the landing route still lazy-loaded the dashboard page.
- The public dashboard request also waited on Supabase auth setup because it always used `authenticatedFetch`, which added avoidable startup latency for unauthenticated and still-initializing sessions.
- Fixed by eagerly importing the dashboard route, limiting auth-bootstrap blocking/error states to auth-dependent routes only, and letting the dashboard fetch public data immediately before refreshing once auth becomes available.
- Also gated the header balance query behind `isAuthenticated` so the header no longer triggers a dashboard fetch during anonymous startup.
- Validation passed: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

- [x] 2026-03-04: Replace the monolithic `/agent` page with a split feature shell (chat shell + drawers + shared view helpers)
- [x] 2026-03-04: Redesign the agent route around a conversation-first mobile/desktop chat shell
- [x] 2026-03-04: Remove automatic empty-thread creation and create new threads only from explicit fresh-chat/send actions
- [x] 2026-03-04: Add focused unit coverage for the extracted agent view helpers
- [x] 2026-03-04: Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- Replaced the old 1,900-line single-file route with a thin page wrapper plus a dedicated `client/src/features/agent/` feature module.
- The new UI is a conversation-first shell on both desktop and mobile: one main chat surface, a left history drawer, and a right settings drawer instead of a persistent split dashboard.
- New chats now open as a draft state and only hit `POST /api/agent/threads` when the user explicitly starts fresh and sends the first message, which removes the old auto-bootstrap side effect.
- Proposal cards are now compact by default, with a shorter staged-move summary up front and expandable details for full step-by-step review.
- Added direct unit coverage for the new shared agent view helpers so the split formatting/comparison logic is not only validated indirectly through route compilation.

- [x] 2026-03-04: Restyle the new agent shell to a darker, flatter dashboard-like visual language
- [x] 2026-03-04: Replace the bright rounded agent cards with darker blocky chat surfaces and darker drawers
- [x] 2026-03-04: Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- Shifted the new agent shell from the bright soft-card look into a darker local route theme with `#131722`/`#0f1420` panel backgrounds and stronger border contrast.
- Replaced the oversized rounded chat cards with flatter `rounded-md` cards/buttons so the page reads closer to the dashboard and other in-product control surfaces.
- Updated the drawers, proposal cards, message bubbles, empty state, and composer together so the route now feels visually cohesive instead of mixing a dark shell with bright interior cards.

- [x] 2026-03-04: Tighten the agent shell into a denser terminal-like layout
- [x] 2026-03-04: Restyle execution confirmation to use dashboard-style card chrome inside the chat flow
- [x] 2026-03-04: Validate the updated agent UI via targeted checks

Review:

- Reduced spacing across the shell, drawers, messages, and composer so the route now reads more like a compact terminal pane than a roomy chat card layout.
- Applied a monospace-forward treatment to the main shell and controls, which pushes the route closer to a terminal/operator feel without changing behavior.
- Swapped the confirmation block from the amber chat-panel look into a neutral card treatment (`bg-card`/border/shadow) so staged execution reads more like a dashboard control surface embedded in the transcript.

- [x] 2026-02-12: Profile admin and scheduler hot paths tied to prod DB pressure
- [x] 2026-02-12: Replace `/api/admin/stats` full-table fetches with aggregate count queries
- [x] 2026-02-12: Add short TTL cache for `/api/admin/stats` and invalidate on admin-triggered job/backfill completion
- [x] 2026-02-12: Add scheduler overlap guard so the same job cannot run concurrently
- [x] 2026-02-12: Stagger high-frequency cron jobs and lower non-critical refresh frequencies
- [x] 2026-02-12: Reduce admin page polling cadence (faster only while jobs/backfill are running)

## 2026-02-25 SEO Phase 1 (Search + AI Crawlers)

- [x] Consolidate duplicate `/sitemap.xml` handlers into a single canonical source
- [x] Remove non-indexable URLs from sitemap (`/player/:id`, nonexistent contest detail pages)
- [x] Add server-side 301 redirect from legacy `/marketplace` to canonical `/pools`
- [x] Standardize canonical site URL configuration across server sitemap + client metadata/schema
- [x] Add route-level canonical + robots metadata for public vs private routes
- [x] Update `robots.txt` for canonical sitemap URL and explicit AI crawler directives
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`

## 2026-02-25 SEO Phase 2 (Server Rendering + Index Quality)

- [x] Add shared SEO route policy utilities for consistent metadata across client/server
- [x] Inject server-rendered SEO head tags (title, description, canonical, robots, OG/Twitter) in dev and prod
- [x] Add server-rendered JSON-LD payloads for core site routes and blog articles
- [x] Return HTTP 404 for unknown non-asset app routes while preserving SPA routing for known paths
- [x] Ensure unknown `/api/*` routes return JSON 404 instead of SPA HTML fallback
- [x] Add social preview image for stable OG/Twitter cards

## 2026-02-25 SEO Phase 3 (AI Discoverability + Public Retrieval)

- [x] Add `llms.txt` and extended LLM context document under public assets
- [x] Add crawler-safe `/api/public/*` endpoints for market summary, blog feed, and contest summaries
- [x] Update robots policy to explicitly allow `/llms.txt` and `/api/public/*` for AI crawlers

## 2026-02-25 SEO Phase 4 (Performance + Indexing Operations)

- [x] Implement route-level code-splitting with lazy-loaded page modules and suspense fallback
- [x] Add idle-time preloading for high-traffic public routes
- [x] Add feed endpoints (`/feed.xml`, `/feed.json`) and include them in discoverability surfaces
- [x] Add richer server-side structured data (breadcrumbs + article schema on blog detail)
- [x] Enforce canonical host redirects in production (configurable via env)
- [x] Add SEO operations runbook and automated `seo:check` script

## 2026-02-25 Bot Market Activity Investigation

- [x] Investigate bot activity staleness using `job_execution_logs`, `bot_profiles`, and `bot_actions_log`
- [x] Confirm root causes for low movement (scheduler inactivity window + low trade execution yield)
- [x] Enable `bot_engine` in manual/admin trigger allowlist for external cron compatibility
- [x] Improve bot trade execution by ensuring pools exist before bot buy/sell/LP actions
- [x] Improve bot LP targeting to choose players the bot actually holds (avoid near-certain LP failures)
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`

- [ ] Rename Marketplace to Player Pools (canonical route `/pools`, redirect legacy `/marketplace`)
- [ ] Fix AMM trade panel to use authenticated requests in production (buy + sell)
- [ ] Add Player Pool contribution UI on player page (add/remove liquidity + zap shares-only)
- [ ] Implement zap backend endpoints (quote + execute) with atomic transaction
- [ ] Update copy/links/docs so Marketplace vs Pools is not confusing
- [ ] Verify: typecheck, tests, and manual smoke flows (trade, add/remove LP, zap)

- [ ] Fix 24h volume accuracy: compute rolling 24h shares volume from `trades` and stop roster sync from clobbering market fields

## 2026-02-28 Agent Route Loading + Cleanup

- [x] Diagnose why `/agent` appears stuck on loading
- [x] Harden agent thread schema bootstrap so the route works even if the latest migration was not applied yet
- [x] Add explicit frontend error/retry states for agent profile, thread list, and conversation loading
- [x] Remove remaining unused legacy agent surface that is no longer part of the canonical flow
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-28 Managed Agent Provider Switching

- [x] Add persistent system-level agent managed-provider settings for Chutes, MiniMax, and OpenRouter
- [x] Refactor the agent provider registry to resolve the active managed provider from admin settings while preserving BYOK behavior
- [x] Add admin API endpoints to read/update the active managed provider
- [x] Add live provider-model catalog support for admin OpenRouter selection while still allowing manual model IDs
- [x] Add an admin UI control to switch the default system AI provider
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-28 Scout Agents (BYOK + Managed AI)

- [x] Add user agent schema/storage foundations (profiles, secrets, runs, proposals)
- [x] Implement backend agent service (encryption, provider adapters, context loading, proposal validation, execution)
- [x] Add authenticated `/api/agent/*` routes
- [x] Add scout dashboard agent UI (config, analyze, review, approve/reject)
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`

## 2026-02-28 Scout Agents Managed Provider (Chutes)

- [x] Confirm Chutes managed-provider contract (`https://llm.chutes.ai/v1/chat/completions`, raw `Authorization` header)
- [x] Switch managed agent defaults/env handling from OpenAI to Chutes
- [x] Enable managed Chutes JSON mode (`response_format: { type: "json_object" }`) for reliable structured agent output
- [x] Preserve generic BYOK OpenAI-compatible behavior while adding Chutes-specific auth handling
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`
- [x] Configure dev `.env`, push schema to local dev DB, and smoke test managed analyze + approve flow

## 2026-02-28 Agent Foundation Migration (pi-mono / pi-ai)

- [x] Install `@mariozechner/pi-ai` and `@mariozechner/pi-agent-core` as the upstream agent foundation
- [x] Replace the custom managed/BYOK provider execution layer with a single `pi-ai` adapter
- [x] Move MiniMax onto the `pi-ai` Anthropic-compatible transport instead of the old OpenAI-style path
- [x] Keep Chutes support via a custom `pi-ai` OpenAI-compatible model while preserving raw auth override behavior
- [x] Keep OpenRouter support on the `pi-ai` execution path while preserving live remote model discovery
- [x] Remove obsolete custom provider adapter files so there is one canonical runtime path
- [x] Add targeted adapter regression tests for Chutes raw auth, MiniMax transport, and BYOK base URL normalization
- [x] Add root `vitest.config.ts` and exclude the local `vendor/` reference clone plus Playwright specs from app unit tests
- [x] Exclude `vendor/` from Prettier so local reference material does not break repo validation
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-28 Agent Planning Migration (pi-agent-core Tool Calls)

- [x] Replace the scout agent's JSON-only prompt/parse loop with a `pi-agent-core` tool-call planning turn
- [x] Reuse the same pi runtime resolution for managed and BYOK providers so tool calls run through the canonical provider path
- [x] Remove obsolete JSON-only planner code paths (`prompt-builder`, text parser, unused completion wrappers)
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-28 Agent Tool-Call Stabilization

- [x] Force provider-level tool choice so scout planning turns cannot silently ignore `submit_scout_plan`
- [x] Persist failed-turn traces for tool-call misses so agent run diagnostics remain useful
- [x] Add a single stricter retry when the first model response skips the required tool call
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-28 Agent Provider Transport Hardening

- [x] Move managed MiniMax execution off the failing Anthropic path and onto the OpenAI-compatible transport
- [x] Add MiniMax-specific OpenAI compatibility overrides (`max_tokens`, no `stream_options`, no `strict`, `reasoning_split`)
- [x] Strip stray `<think>` tags from assistant reply text before it reaches the chat UI
- [x] Add a real local end-to-end smoke test that exercises the `pi-agent-core` tool loop against mock Chutes, MiniMax, and OpenRouter providers
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`, `npm run build`

## 2026-02-20 Dashboard Listing Redesign

- [x] Add `liveEarned` to game and race insights payloads for authenticated users
- [x] Update dashboard insight types for `liveEarned`/`earningsStatus`
- [x] Align team sport card layout columns (`Market`, `Away`, `Home`, `Progress`, `Live Earned`)
- [x] Align NASCAR row layout columns and keep race-specific metadata
- [x] Sort dashboard sections by date for live/upcoming/final groupings
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## Notes

- Keep `/marketplace` working as a legacy alias to avoid breaking old links.
- Premium share trading removed; future trading returns via pools.

## 2026-02-20 Live Market Status Enrichment

- [x] Add live market status enrichment for NBA/NFL/MLB in `/api/games/insights` (inning/quarter/clock)
- [x] Extend game insight types with optional `liveMarketStatus`
- [x] Render sport-specific live market status in dashboard market column (replace generic `LIVE`)

## 2026-02-20 PR Review Follow-ups

- [x] Scope live-earned power alias matching by sport to avoid cross-league ID collisions
- [x] Restore SQL-level season filtering in `getBatchPlayerSeasonStatsFromLogs` to avoid full historical scans
- [x] Validate via `npm run check`, `npm run lint`, and `npm run test:run`

## 2026-02-20 MLB Away Team Shows TBD on Dashboard

- [x] Investigate MLB away-team field mapping from BallDontLie to `daily_games`
- [x] Add compatibility parsing for both `visitor_team` and `away_team` payload shapes
- [x] Update MLB schedule/stats sync paths to use compatibility helpers
- [x] Add regression tests for away-team/away-score fallback behavior
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`

## 2026-02-20 Pricing Integrity Hardening

- [x] Identify remaining API paths that still fallback to placeholder `players.currentPrice`
- [x] Remove placeholder-price fallback in top-market-cap and market-activity enrichment paths
- [x] Update market scanner sourcing to require pool-backed pricing (or real trade price)
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-20 MLB Live Inning/Score/Stats Contract Fix

- [x] Diagnose MLB Market tab live-status/score regressions and trace provider contract drift
- [x] Update MLB API adapters for `STATUS_*` normalization and modern score/stat payload fields
- [x] Patch MLB schedule/stats sync jobs to map current BallDontLie game + team shapes
- [x] Fix `/api/games/insights` live enrichment to surface inning/status/score reliably for MLB
- [x] Fix `/api/games/:gameId/live-stats` MLB mapping for modern stats rows (`game_id`, `team_name`)
- [x] Add dashboard guardrail to avoid false `LIVE` when backend has no live evidence
- [x] Surface live-stats fetch errors in game command center modal
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-20 PR #70 Review + Pool Seeding Follow-up

- [x] Review PR #70 comments and isolate the scanner SQL type mismatch in `getFinancialMarketScanners`
- [x] Fix scanner query typing so `COALESCE` uses compatible SQL types at runtime
- [x] Ensure pool seeding also repairs active players with unseeded/legacy pool liquidity state
- [x] Expose repaired count in admin seed response and UI messaging
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-20 PR #70 Latest Review Comment

- [x] Exclude non-positive AMM spot prices from `/api/players/spotlight/top-market-cap`
- [ ] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-20 Signup Reliability + Onboarding UX

- [x] Add shared email normalization/validation utility for auth inputs
- [x] Harden `useAuth` signup/login flows with normalized email and mapped auth error messaging
- [x] Add signup verification follow-up UX (resend verification + sign-in return path)
- [x] Refresh onboarding modal content and styling to match Sportfolio aesthetic and gameplay priorities
- [x] Align onboarding missions terminology with updated onboarding concepts
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-20 Signup + Onboarding Follow-through

- [x] Add Playwright coverage for signup normalization/verification resend and onboarding CTA navigation
- [x] Add auth telemetry ingestion endpoint and metrics counters for signup/login outcome codes
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`
- [x] Validate targeted e2e via `npx playwright test tests/e2e/auth-onboarding.spec.ts`

## 2026-02-21 API Health Checker + Admin Monitoring

- [x] Add reusable server-side API health checker (DB ping, critical job freshness, route smoke checks)
- [x] Add scheduled daily `api_health_check` job and manual trigger support in scheduler
- [x] Expose admin API health endpoints (`GET /api/admin/api-health`, `POST /api/admin/api-health/run`)
- [x] Add API health monitor card in admin dashboard with per-check status and run history
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-21 Dashboard Sport Filter Tab Audit + Fix

- [x] Audit dashboard sport tab/filter state transitions for NASCAR lock-in and disappearing tabs
- [x] Ensure dashboard always fetches complete game-sport set for the selected date
- [x] Render stable sport tabs (`ALL`, `NBA`, `NFL`, `MLB`, `NASCAR`) regardless of current filtered payload
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-21 PR #74 Review Follow-up (Dashboard Sport Tabs)

- [x] Attempt to fetch PR #74 inline comments and audit prior fix scope
- [x] Keep dashboard sport tabs visible during loading and NASCAR mode
- [x] Align dashboard tab source with canonical `SPORTS` config to prevent drift
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-21 PR #74 Inline Comment Resolution (Boost Context Regression)

- [x] Pull PR #74 inline comments using provided classic PAT
- [x] Restore sport-aligned `/api/games/insights` requests to preserve boost/eligibility context
- [x] Keep stable dashboard sport tabs independent from payload-derived sport lists
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-02-28 Agent Runtime Stabilization

- [x] Replace the slow multi-turn scout planning path with deterministic fast paths for direct slate commands and one-adjustment reviews
- [x] Add provider-specific timeouts plus deterministic emergency fallback so slow providers return usable plans instead of hard errors
- [x] Live-test `/api/agent/threads` end to end against MiniMax, Chutes, and OpenRouter through the running dev server
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`

## 2026-03-01 Agent Semantic Routing + Embeddings

- [x] Add DB-backed agent question embedding storage with startup schema guards and migration
- [x] Add a fast local embedding path for per-message semantic routing without increasing chat latency
- [x] Add optional non-blocking Perplexity embedding upgrades for the stored semantic index when `PERPLEXITY_API_KEY` is configured
- [x] Use semantic route hints to widen deterministic scout fast paths for paraphrased prompts
- [x] Expand `/api/admin/agent/question-logs` with semantic route counts and semantic clusters
- [x] Validate via `npm run check`, targeted agent tests, and full repo validation

## 2026-03-01 Agent Conversation Quality + Intent Routing

- [x] Replace the rigid JSON-shaped advisory payload with a richer analyst-style prompt payload that uses stable, structured sections
- [x] Improve the discussion system prompt so advisory answers are insight-led and do not incorrectly ask the user to "confirm" before a plan exists
- [x] Add a lightweight ambiguity-only LLM intent classifier fallback so unclear phrasing can resolve to discussion vs commit without slowing obvious turns
- [x] Respect the user's configured temperature/max token settings for agent analysis instead of only platform constants
- [x] Validate via `npm run check`, targeted agent tests, `npm run lint`, `npm run test:run`, and `npm run format:check`

## 2026-03-01 Agent Expansion (Player Pools + Daily Boosts)

- [x] Audit the current pool, LP, and daily boost execution flows and map the safe action surface the agent can stage and confirm
- [x] Generalize agent action bundles beyond scout-only payloads while preserving the existing scout proposal audit path
- [x] Add deterministic parsing, planning, and confirmed execution for pool trading / LP actions and daily boost assign/remove commands
- [x] Update the agent UI/types so non-scout plans render cleanly and confirmation copy stays accurate
- [x] Add targeted automated coverage for the new parsing/execution paths and run full repo validation plus live local smoke tests

## 2026-03-01 Agent Conversational Parser Hardening

- [x] Broaden advisory-vs-directive detection so exploratory phrasing stays conversational while operational asks like "can you buy..." still stage actions
- [x] Normalize conversational preambles in the pool and daily-boost parsers so natural text-message phrasing still resolves to the right operation
- [x] Add deterministic strategy-chat replies for common gameplay tradeoffs (boost vs pool, buy vs LP) so those asks do not need to hit the model
- [x] Expand agent intent/planner tests for conversational phrasing and harden the slow cold-import test path for full-suite stability
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

## 2026-03-01 Agent Market Intelligence + Power Workflow

- [x] Archive active contest references from the canonical agent docs so contests are treated as legacy, not part of the current agent surface
- [x] Add deterministic market-intelligence replies for schedule/trending questions so broad asks do not collapse into scout-only framing
- [x] Add share-count pool buy parsing so commands like "buy 16 Jokic shares" stage the correct pool action instead of being treated like dollar buys
- [x] Add a multi-step buy -> power-up -> daily boost workflow planner for direct commands
- [x] Add `holdings_condense` as a first-class agent action and execution path
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

## 2026-03-01 Agent Clarification + Market Read Expansion

- [x] Correct the canonical condense rule reference back to the live 2-for-1 product mechanic
- [x] Add structured player-name clarification payloads so blocked operations can preserve resumable state
- [x] Resume blocked direct operations from a short follow-up reply (for example a full player name) instead of treating the next message as a brand-new request
- [x] Skip semantic-question embedding writes for clarification-only replies so question logs stay useful
- [x] Broaden deterministic market reads to cover portfolio-specific value questions and next-two-day setup language using existing market/schedule data
- [x] Add targeted regression coverage for clarification helpers and the new planner paths
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

## 2026-03-01 Agent UI Backlog

- [x] Redesign the agent interface on mobile and desktop to use a simpler ChatGPT-style chat shell (clean history, minimal chrome, no clutter like live/status noise)
- [x] Align the agent route visual language with the dashboard aesthetic (font, color, spacing, card treatment)
- [x] Redesign the Daily Digest to match the dashboard aesthetic instead of using a separate visual style

## 2026-03-01 Agent Action Surface Expansion

- [x] Extend the confirmation-gated agent action model into watchlist add/remove commands
- [x] Add deterministic community-boost staging and execution with the same live eligibility checks the route uses
- [x] Add deterministic vesting-claim staging and execution using shared vesting accrual math
- [x] Add a minimal in-chat clarification card so blocked operations show a simple “waiting on one detail” state
- [x] Expand planner and executor coverage for the new action families
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`
- [x] Next: lift these flat action bundles into true workflow bundles so multi-step clarifications and follow-up edits can persist across more than one blocked field

## 2026-03-01 Agent Workflow Bundles

- [x] Add a workflow-bundle payload shape with step-level metadata so action bundles can persist richer multi-step state
- [x] Treat `pending_clarification` as a first-class bundle status and keep the latest active clarification visible in thread summaries and cancel flow
- [x] Preserve workflow preview steps inside clarification payloads so blocked multi-step plans still show the intended sequence
- [x] Keep backward-compatible readers for legacy array-based bundle payloads while migrating the new workflow shape
- [x] Update the agent page to render workflow steps and clarification details instead of only flat action rows
- [x] Add targeted workflow-bundle coverage and validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

## 2026-03-01 NASCAR Race Status Investigation

- [x] Trace the NASCAR schedule/status ingestion path from upstream source to dashboard payload
- [x] Confirm the upstream status for the race on 2026-03-01 and compare it to stored/app status handling
- [x] Fix the status normalization if a local mapping bug is confirmed
- [x] Validate via targeted inspection and relevant checks

## 2026-03-01 Broad Operator Rollout (Hosted Brave Search + Agent Surface)

- [x] Promote hosted Brave Search from a pre-router path into a first-class server-executed tool in the model discussion loop
- [x] Keep Brave search provider-agnostic so managed and BYOK users share the same hosted web-research capability
- [x] Add agent capability/research endpoints that expose supported surface area and thread research sources
- [x] Add deterministic broad-operator setup reviews and a capability guide so open-ended asks use cross-domain state instead of falling back to scout-only framing
- [x] Broaden the model-visible operator context (portfolio, boosts, vesting, watchlists, balance) and add more deterministic cross-domain operator reads
- [x] Tag stored agent run traces with lightweight outcome categories (`staged_plan`, `advisory_only`, `blocked_*`, `research_only`, `failed`) for easier testing triage
- [x] Add a lightweight internal `scripts/agent-smoke.ts` harness for capability, advisory, action-plan, and optional hosted-research smoke passes
- [x] Document the current thin-PI test milestone capability surface in `docs/agent/current-surface.md`
- [ ] Configure the local `.env` for hosted Brave search and run live non-destructive smoke checks against the Brave-backed agent research path
- [ ] Validate with `npm run check`, `npm run lint`, `npm run format:check`, plus targeted smoke scripts for the new hosted-research flow
- [ ] Follow through on the remaining broad-operator rollout beyond the hosted research layer (deeper multi-domain tooling, broader model orchestration, and fuller non-destructive smoke coverage)

## 2026-03-02 Knowledge Hub + CLI Foundation

- [x] Add canonical markdown docs under `docs/wiki` with frontmatter metadata
- [x] Add shared docs types plus docs index/article/search APIs
- [x] Ship an in-app `/wiki` route with a browsable index and article pages
- [x] Add user API tokens plus CLI-only authenticated endpoints
- [x] Add a standalone `packages/sportfolio-cli` package with auth, docs, portfolio, and agent commands
- [ ] Expand authenticated docs and add a first in-app token-management UI
- [x] Mark canonical wiki articles with `surface: agent` and inject a wiki-backed knowledge brief into the agent prompt so product guidance stays sourced from one place

## 2026-03-02 SMS Agent Foundation

- [x] Reuse canonical wiki articles for guest SMS concierge guidance so unknown numbers get a conversational first reply instead of a hard signup wall
- [x] Add SMS account routes, Telnyx webhook routes, and a `/sms/link` completion page so the phone-link flow is fully wired
- [x] Add a profile-level SMS access card and internal Telnyx setup documentation so the SMS channel has one maintained setup path

## 2026-03-02 PR #77 Review Fixes

- [x] Remove raw internal error leakage from the new CLI and SMS routes
- [x] Tighten Telnyx webhook routing and classify inbound vs delivery events before background processing
- [x] Harden SMS consent and dedupe handling for unknown STOP/START flows and missing provider event ids
- [x] Limit guest SMS/wiki agent grounding to public-only knowledge while preserving authenticated agent context
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

## 2026-03-02 Hermes Orchestrator Cutover

- [x] Add Hermes runtime fields and durable agent-memory persistence to the canonical schema and startup guards
- [x] Replace the live PI reasoning path with a Hermes orchestrator client while preserving the current deterministic staging and confirmation/execution backend
- [x] Add internal tool routes and auth so an external Hermes sidecar can call approved Sportfolio tools only
- [x] Keep the live app deployable by using a local compatibility bridge behind the Hermes contract until an external Hermes sidecar is configured
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

## 2026-03-02 Production Display Investigation

- [x] Inspect linked Railway production service status and recent deploy/runtime logs
- [x] Identify the concrete runtime or deploy failure preventing the production app from rendering
- [x] Apply a targeted fix if it is caused by repo code/config, or document the external/platform root cause
- [x] Record investigation outcome and any required follow-up

Review:

- Root cause was a production redirect loop, not a failed deploy. `PUBLIC_SITE_URL` on Railway was set to `https://sportfolio.market` while `VITE_PUBLIC_SITE_URL` (and repo defaults) were already `https://www.sportfolio.market`.
- The backend canonical-host middleware in `server/index.ts` used `PUBLIC_SITE_URL` and redirected `www.sportfolio.market` to the apex host, while the apex host was already redirecting back to `www`, creating an infinite 301 loop.
- Fixed by updating Railway `PUBLIC_SITE_URL` to `https://www.sportfolio.market`, which triggered a successful redeploy.
- Verified after deploy: `https://www.sportfolio.market/` now returns `200 OK`; the apex host still redirects to `www`, which now resolves normally instead of looping.

## 2026-03-02 Google Sign-In Investigation

- [ ] Inspect the client/server Google auth flow and callback handling
- [ ] Pull recent Railway auth-related logs to identify where the login state is lost
- [ ] Apply a targeted fix if the issue is in repo code/config
- [ ] Validate the fix and record any required production follow-up

## 2026-03-02 Seamless Hermes User-Agent Cutover

- [x] Replace the PI-backed Hermes compatibility bridge as the normal sidecar path with a true in-repo Hermes orchestration flow
- [x] Expand Hermes request/response contracts and internal tool coverage toward broader user action parity
- [x] Strengthen durable memory writes with supersede/archive behavior instead of append-only duplicates
- [x] Add per-user agent advisory schedule persistence and a scheduler job to run due advisory prompts
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- The Hermes sidecar now uses an in-repo orchestration layer first: deterministic operation planning, hosted research, and stateful operator advisories are the normal path, with the PI bridge retained only as fallback.
- Hermes request/response contracts now carry tool policy, confirmation policy, tool usage, and standardized confirmation preview metadata.
- Durable memory writes now supersede older single-profile preference memories instead of stacking contradictory active records.
- A new `user_agent_schedules` table plus the `agent_advisory_schedules` cron job now enable proactive in-app Hermes advisory messages for active users, seeded with a default daily setup review schedule.
- Remaining gap: the internal tool surface is broader, but not yet exhaustive for every authenticated website workflow; this is a meaningful expansion, not complete full parity.

## 2026-03-02 Hermes Tooling Parity + Vesting Surface Removal

- [x] Audit the remaining active non-USD user workflows and map them to Hermes tool gaps
- [x] Add structured Hermes read/preview/action tools for AMM/LP details, player detail/history, watchlist CRUD, schedule CRUD, and explicit stage/confirm/cancel flows
- [x] Remove vesting from the Hermes-facing agent surface, schedules, capabilities, and docs
- [x] Add targeted coverage for the expanded Hermes tool surface and run local smoke validation
- [ ] Create a clean PR with only the Hermes parity follow-up changes

Validation notes:

- `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check` all pass on the final worktree.
- `railway run --service Sportfolio-Replit -- npx tsx scripts/agent-smoke.ts --user aa6b3061-d164-44fe-9dfc-b61326903d23 --include-action-plans --live-research` completed successfully without executing any confirmation-gated mutations.
- `npm run cli:smoke` passed.
- Direct Hermes read/plan tool smokes succeeded against the Railway service environment, including the hardened schedule path and structured pool-buy preview.

## 2026-03-02 Hermes Conversational Grounding

- [x] Inspect the live Hermes prompt/request path to verify how the latest user message is passed into the runtime
- [x] Route non-deterministic Hermes advisory turns through a model-backed response before falling back to static operator text
- [x] Explicitly anchor the latest user message at the end of the advisory/planning prompt payload so the model answers the current turn directly
- [x] Validate locally via targeted agent tests, full repo validation, and a local `/agent` smoke turn

Review:

- The main disconnect was real: the current message was passed into the Hermes request object, but the normal Hermes-first advisory path often answered with a static operator overview instead of taking a model turn, so short follow-ups could feel ignored.
- Fixed by letting the Hermes orchestrator use a model-backed operator turn for non-deterministic requests before dropping to static fallback copy, while still keeping the explicit deterministic planner and hosted research paths first.
- The advisory and planning prompt payloads now end with a dedicated `<current_user_message>` block and a direct response instruction so the latest turn is explicitly the final thing the model sees before responding.
- Validation passed: targeted agent tests, `npm run check`, `npm run lint`, full `npm run test:run`, and `npm run format:check`.
- The workstation's local `.env` still has a stale local Postgres password, so the smoke harness failed against that local secret; the same smoke succeeded when run locally with the active Railway Sportfolio env injected, and the targeted Hermes follow-up flow now returns an actual explanation instead of repeating the generic overview.

## 2026-03-03 Hermes Agent-First Tool Routing

- [x] Add a first-class Hermes tool catalog and expose it through the internal tool surface
- [x] Add dedicated Hermes scan tools for ambiguous advisory asks, including daily boost candidate scans
- [x] Route ambiguous Hermes turns through tool-first scan selection before the generic model fallback
- [x] Add regression coverage for the exact boost-slot advisory prompt and validate the new scan path
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`, `npm run cli:smoke`, and Railway-backed agent smoke checks

Review:

- Hermes now keeps the narrow direct-operation fast path for explicit commands, but ambiguous advisory turns try scan tools first.
- The new `scan_daily_boost_candidates` path fixes the exact production misroute where boost-slot questions were falling into scout-style replies.
- Hermes tool traces now show `tool_first_router` plus the concrete scan tool used, which makes future transcript review and missing-tool audits easier.
- Local `scripts/agent-smoke.ts` still fails against the stale workstation `.env` database password, but the same smoke passed when run through `railway run --service Sportfolio-Replit ...` with live service env injected.

## 2026-03-03 Hermes Direct Tool Loop + Audit Foundation

- [x] Replace the synthetic `route_user_turn` meta-router path with a direct Hermes model tool loop over real tools
- [x] Expand the default Hermes tool surface toward primitive read/market/portfolio capabilities and remove `respond_to_user_turn` from the normal allowlist
- [x] Add executable tool metadata (`inputSchema`, `autoContextArgs`, exposure) and sport-aware context plumbing for tool-driven requests
- [x] Add a first-pass `agent-audit` script that audits the tool surface and can run safe live advisory turns against a test user
- [x] Re-run validation on the Hermes changes and document any remaining repo-wide failures outside this scope

Review:

- Hermes now uses a bounded direct tool loop in `server/agent/model-first-router.ts` for normal turns. The model can call real Hermes tools sequentially and only bubbles a plan tool back out when a confirmation-gated preview is needed.
- The default request payload now exposes a much broader primitive tool surface through Hermes, while the legacy `respond_to_user_turn` compatibility tool is no longer part of the normal allowlist.
- The new `scripts/agent-audit.ts` script gives the repo a concrete starting point for tool-surface audits and safe live-turn smoke testing.
- Validation status after this change: `npm run lint` passed, `npm run test:run` passed, `npm run check` still fails because of unrelated pre-existing type errors in contest/bot/server files outside the Hermes scope, and `npm run format:check` still fails because of unrelated pre-existing formatting drift in other files.

## 2026-03-03 Hermes Improvement Loop + Audit Hardening

- [x] Add a durable `user_agent_improvement_candidates` persistence surface for structured remediation candidates
- [x] Classify weak/failed Hermes turns into concrete failure classes and record remediation candidates without blocking the user-facing turn
- [x] Expand `scripts/agent-audit.ts` so static coverage audits can run without a live user or DB access and so live audits emit weak-turn flags and simple scores
- [x] Validate the new improvement loop with targeted tests, full repo tests, and static audit output
- [x] Attempt live non-destructive audits against the existing smoke user and record the runtime blocker if local env is still misconfigured

Review:

- Hermes now persists clustered remediation candidates in `user_agent_improvement_candidates` instead of leaving failure patterns buried only in `user_agent_runs.raw_response`.
- Agent runs now attach `failureClass` and `improvementCandidateId` into the stored trace metadata whenever the direct loop, fallback path, or an obviously weak advisory turn indicates a concrete remediation opportunity.
- `scripts/agent-audit.ts` now has a real static coverage mode that does not require a user id, and live audits now score/flag weak turns using the same failure classifier used for persisted improvement candidates.
- Validation passed for `npm run check`, `npm run lint`, targeted agent tests, and full `npm run test:run` (`32` files, `172` tests).
- `npm run format:check` still fails because of unrelated pre-existing formatting drift in many untouched files across the repo.
- Live non-destructive audit attempts against the prior smoke user still fail locally because the workstation development DB credentials are stale (`password authentication failed for user "postgres"`), so the static audit and test suite passed, but local live audit remains environment-blocked until the DB connection is corrected.

## 2026-03-03 Hermes-First Skill Cutover

- [x] Remove the remaining top-level parser-first split so normal user turns always flow through Hermes first
- [x] Add persistent admin-governed runtime skills with user-scoped reuse and admin-reviewed global promotion
- [x] Upgrade compound operational handling so Hermes can use `preview_multi_action_bundle` before falling into generic fallback
- [x] Extend internal/admin surfaces for skill review and update Hermes runtime contracts to carry tool catalog + available skills
- [ ] Run the full validation and smoke suite, then create a fresh PR with all unpushed local changes

Review:

- Hermes is now the single front door for normal user turns; deterministic planners still exist, but only behind Hermes-selected tools.
- Runtime skills are constrained macros over existing approved tools. They can be created automatically for a single user, but shared/global promotion still requires admin approval.
- The highest-value compound regression is now handled through `preview_multi_action_bundle`, which lets Hermes decompose linked requests without bouncing into scout-biased fallback.

## 2026-03-11 Production DB Migration + Supabase RLS Hardening

- [x] Verify the current production Supabase schema state for the Hermes bot runtime migrations and the flagged public tables with RLS disabled
- [x] Add an idempotent migration that enables RLS on the backend-owned public tables flagged by the Supabase linter
- [x] Apply the pending PR migrations plus the new RLS migration to the production Supabase project and verify the resulting schema/security state
- [x] Re-run repo validation and record any remaining operational caveats

Review:

- Confirmed production was missing the Hermes bot runtime schema (`bot_cycle_briefs`, `bot_run_logs`, new `bot_profiles` columns), still had legacy `player_pools` seed defaults (`1000` shares / `10000` cash / `10000000` k), and still had every Supabase-linted backend-owned public table with RLS disabled.
- Added `migrations/0040_enable_rls_for_private_public_tables.sql` as an idempotent RLS hardening migration for the flagged backend-owned public tables, then extended it to include the newly introduced `bot_cycle_briefs` and `bot_run_logs` tables after a broader public-schema check exposed them as the next likely linter findings.
- Applied `migrations/0037_hermes_bot_runtime.sql`, `migrations/0038_bot_runtime_diagnostics.sql`, `migrations/0039_player_pool_seed_normalization.sql`, and `migrations/0040_enable_rls_for_private_public_tables.sql` directly against the production Supabase project via the official management SQL endpoint because the locally stored direct `DATABASE_URL` password was stale while the authenticated Supabase CLI access token remained valid.
- Verified production after apply: `bot_cycle_briefs` and `bot_run_logs` now exist, the expected bot runtime diagnostic columns are present, `player_pools` defaults are normalized to the 50k / 500k seed values, zero-trade pool repairs remain at `0`, and a full public-table RLS check now returns no tables with `relrowsecurity = false`.
- Validation passed: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.
- Operational caveat: the production DB schema is now correct, but the local `.env` `DATABASE_URL` password is stale for direct Postgres access. Future direct `pg` / `drizzle` production commands from this machine should either use a refreshed DB password from Supabase project settings or continue through the authenticated management API path.

## 2026-03-03 PR #83 CI Fix

- [x] Reproduce the failing `Validate Code` check locally and confirm the exact import path
- [x] Patch the test-time DB bootstrap so unit tests can import DB-backed modules without a real `DATABASE_URL`
- [x] Validate with repo checks, then push the fix to the PR branch

Review:

- Root cause: Vitest runs with `NODE_ENV=test`, and several agent/auth tests import DB-backed modules at module load. `server/db.ts` threw immediately when neither `DATABASE_URL` nor `DEV_DATABASE_URL` was present in CI.
- Fix: keep the runtime guard for normal environments, but allow test imports to construct the shared `pg` pool with a placeholder Postgres URL when running under Vitest/`NODE_ENV=test`.
- Validation passed after the fix: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-03 Telnyx SMS Intake Investigation

- [x] Trace the SMS route, webhook verification, and production DB/log state
- [x] Patch webhook handling so the primary Telnyx webhook endpoint can process both inbound and delivery events
- [x] Correct the live Telnyx messaging profile webhook URL and verify the updated configuration
- [x] Validate locally and document the root cause plus any remaining operational follow-up

Review:

- Root cause was production configuration drift: the live Telnyx messaging profile webhook was set to `https://sportfolio.market/api/webhooks/telnyx/sms`, but non-GET requests to the apex host return `405 Method Not Allowed` before they reach the Express app. The working route lives on `https://www.sportfolio.market/api/webhooks/telnyx/sms`.
- Production evidence matched that diagnosis: the public `www` webhook route responds from Express, while the production database had zero `sms_message_events` rows and zero `user_phone_links`, so the app had never successfully processed an inbound SMS or completed SMS linking.
- Fixed the live Telnyx messaging profile to use the canonical `www` webhook URL.
- Also hardened the repo route so the primary `/api/webhooks/telnyx/sms` endpoint now accepts both inbound and delivery events, which matches Telnyx's single messaging-profile webhook model; the `/api/webhooks/telnyx/sms/status` route remains as a backward-compatible alias.
- Local validation passed: `npm run check`, `npm run lint`, `npm run test:run -- server/services/telnyx-sms.test.ts`. `npm run format:check` required a follow-up Prettier pass on this task log after the initial note was added.

## 2026-03-04 Power Page Mobile Stats + Community Boost Sport Filter Consistency

- [x] Keep Power page mobile quick stats (Active Slots, Live Slots, Premium Shares, Est. Payout) consolidated into a single horizontal row to maximize small-screen space.
- [x] Investigate NASCAR missing from Power page Community Boost filters and align filter options to the shared sports source used across the app.
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

Review:

- Root cause for NASCAR missing on the Power page was a page-local hard-coded filter array (`["All", "NBA", "NFL", "MLB"]`) that had drifted from the app's shared sports definition.
- Power now builds community boost filter tabs from the shared `SPORTS` export in `client/src/lib/sport-context.tsx` (mapped to include `All` and exclude only `ALL`), which keeps this page aligned with cross-site sport options and avoids piecemeal filter lists.
- Mobile quick stats were switched to a horizontal flex strip with small-screen min-width cards and horizontal scrolling, so Active Slots, Live Slots, Premium Shares, and Est. Payout stay on one compact row instead of wrapping into multiple rows.
- Validation ran successfully: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check` all pass.

## 2026-03-07 Agent Page UX Audit

- [ ] Map the `/agent` route layout, shell, and thread/composer state flow
- [ ] Audit mobile-first layout failures: viewport sizing, drawer behavior, scroll ownership, keyboard/composer interactions, and new-chat transitions
- [ ] Audit desktop behavior and note secondary regressions or mismatches
- [ ] Deliver prioritized findings with concrete file references and recommended fixes

## 2026-03-07 CLI + User Action Surface Hardening

- [x] Simulate first-time CLI onboarding and action staging flows against local dev + mock smoke harness
- [x] Capture friction points and convert them into concrete UX/docs hardening changes
- [x] Improve CLI discoverability (`--help`, command-scoped help, clearer usage strings, network error guidance)
- [x] Improve CLI route resiliency messaging for agent-concurrency collisions (`429` retryable response)
- [x] Publish canonical docs for command reference and cross-surface capability mapping
- [x] Harden in-app CLI access card and root README so users/agents can find setup and capabilities quickly

Review:

- Reproduced live CLI flows as a user: auth + docs + portfolio + agent reads were successful; action staging was intermittently blocked by concurrent agent analysis and surfaced as opaque failures.
- CLI now has command-scoped help (`sportfolio <command> --help`), global `--json` discoverability, clearer action usage text, and actionable network-failure messaging.
- CLI backend now returns a specific retryable `429` message when a request collides with an in-flight agent analysis instead of only returning a generic `500` failure.
- Added two new canonical wiki docs: `/wiki/cli/command-reference` and `/wiki/features/user-action-surface` to map actual available actions across web/CLI/SMS/agent.
- Updated `/wiki/cli/overview`, the profile CLI access card, and the root `README.md` so setup and possibility discovery are explicit for both human users and agents.

## 2026-03-07 Agent Shell Restructure

- [x] Replace the `/agent` shell with a mobile-safe full-height layout and compact header/actions
- [x] Add a persistent desktop conversation rail while keeping mobile history in a sheet
- [x] Replace transient fresh-chat state with immediate real thread creation and preserve selection through thread-list refresh
- [x] Add targeted Playwright coverage for desktop persistent history and mobile fresh-chat flow
- [x] Validate via `npm run check`, `npm run lint`, `npm run test:run`, targeted `npx playwright test tests/e2e/agent-shell.spec.ts --project=chromium`, and targeted Prettier check

Review:

- Rebuilt the agent route around a single transcript scroll owner, a compact mobile header, safe-area-aware shell/composer padding, and a persistent desktop history rail so the chat viewport no longer collapses under stacked chrome.
- `New Chat` now creates a real thread immediately instead of relying on local-only draft state, and a thread-selection guard prevents the newly created thread from snapping back to the previous one while the refreshed thread list is still in flight.
- Mobile history now closes when starting a fresh chat, and the new Playwright spec locks in both the persistent desktop rail and the fixed mobile fresh-chat behavior.
- Validation passed for `npm run check`, `npm run lint`, `npm run test:run`, `npx playwright test tests/e2e/agent-shell.spec.ts --project=chromium`, and targeted Prettier check on the touched files.
- `npm run format:check` still fails, but only because of pre-existing formatting drift in untouched files: `client/src/pages/leaderboards.tsx`, `server/leaderboards.test.ts`, `server/leaderboards.ts`, `server/routes.ts`, `server/storage.ts`, and `tasks/todo.md`.

## 2026-03-08 Handbook MCP Accuracy + Wiki Nav Rework

- [x] Correct handbook MCP coverage so it reflects the live authenticated `/mcp` surface
- [x] Add a dedicated public MCP handbook chapter and cross-link it from access surfaces
- [x] Update docs-QA MCP fallback/model guidance and related tests
- [x] Make the handbook chapter rail independently scrollable with per-section collapse on desktop
- [x] Keep mobile handbook navigation as a collapsible sidebar drawer with per-section collapse inside it
- [x] Validate via `npm run mcp:audit`, `npm run mcp:smoke`, `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`

Review:

- Replaced the stale handbook language that claimed MCP was undocumented and added a new canonical `/wiki/getting-started/mcp-access` chapter covering the live `/mcp` endpoint, bearer-token auth, public v1 surface, and exclusions.
- Updated the access, CLI overview, and user action surface handbook chapters so public docs now point to MCP accurately instead of pushing every external-access question back to CLI only.
- Reworked the handbook navigation so the desktop chapter rail is a sticky bounded panel with its own scroll area, while both desktop and mobile navigation now support per-section collapse and auto-open active/search-matching sections.
- Updated docs-QA, docs-service, and docs-route tests to reflect the live MCP surface, and extended handbook helper tests to cover section expansion behavior and active-anchor ownership.
- Validation passed for `npm run docs:build`, `npm run mcp:audit`, `npm run mcp:smoke`, `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-08 Mobile Player Pools Live Market Redesign

- [ ] Add `GET /api/market/mobile-overview` with live pulse, ticker, narrative modules, and authenticated watchlist context built from existing market/boost/scout/game data
- [ ] Extend the WebSocket client freshness model and marketplace polling fallback so mobile can show live/catching-up/offline states
- [ ] Rebuild mobile `/pools` into a live-market scroll with sticky pulse strip, live tape, narrative modules, filter sheet, and richer player cards while preserving desktop behavior
- [ ] Replace the mobile player modal with a trade-first bottom sheet and wire quick actions safely against existing buy/sell/boost/scout flows
- [ ] Add targeted backend + Playwright coverage and validate via `npm run check`, `npm run lint`, `npm run test:run`, and targeted `npx playwright test`

## 2026-03-08 Portfolio Activity Ledger Refresh

- [x] Expand `/api/activity` beyond the legacy vesting/market/scout feed into a portfolio ledger with stacking, boosts, payouts, liquidity, community, and premium activity from existing event tables
- [x] Add shared activity feed types and response metadata for category counts, summaries, and load-more pagination
- [x] Replace the bare Portfolio activity tab with a dense mobile-first ledger UI that includes summaries, search, focus filters, category chips, and drill-in links
- [x] Add targeted helper coverage for activity filtering and summary counts
- [x] Validate via `npm run lint` and targeted `npm run test:run -- client/src/components/portfolio-activity-tab.helpers.test.ts client/src/pages/portfolio-stacking-helpers.test.ts`

Review:

- Rebuilt the Portfolio activity surface around a mobile-first ledger instead of a thin market/scout list, so users can scan recent portfolio-changing events without wasting vertical space on tall cards.
- `/api/activity` now aggregates stacking, daily boost entry/settlement, holder payouts, LP adds/removals, community boosts, and available premium activity from the existing immutable tables instead of inventing a second event store.
- The new tab adds summary counts, category chips, search, a compact focus filter, and per-row drill-ins to player, boosts, liquidity, or premium surfaces.
- `npm run check` is still blocked by pre-existing unrelated TypeScript errors in `client/src/components/market-mobile-home.tsx`, and full `npm run test:run` is still blocked by pre-existing `server/market-mobile-overview.test.ts` failures tied to missing `getTopPoolPlayerIds` test deps.

## 2026-03-23 Agent Mobile Scroll Hardening

- [x] Constrain `/agent` route height so the page shell, not the document, owns mobile layout
- [x] Remove mobile horizontal overflow from the strategy command center and slot rail
- [x] Compact mobile chat and strategy detail chrome so transcript/detail panes remain reachable above the composer
- [x] Verify mobile `/agent` scroll owners with Playwright MCP before validation

## 2026-03-23 Agent Scroll Contract Refactor + Dashboard Density Pass

- [x] Refactor `/agent` so chat, strategy command center, and strategy detail each have one primary vertical scroll owner
- [x] Trim repeated helper copy and restyle `/agent` with dashboard-style typography and tighter spacing instead of generic stacked cards
- [x] Rework mobile strategy detail and strategy chat so the visible detail body owns scrolling while the composer stays anchored
- [x] Verify the live `/agent` surface in Playwright MCP and rerun repo validation

Review:

- `/agent` now uses a tighter dashboard-derived rhythm: smaller uppercase labels, denser rows, fewer hero-style summaries, and less repeated explanatory copy across Chat and Strategies.
- Chat header chrome was reduced to one compact workbench strip plus actionable blocks, and the transcript/composer shell now keeps scroll ownership in the transcript body instead of spreading it across nested panels.
- Strategies now opens into a denser command brief and slot rail, while strategy detail keeps one stable body region for `Overview`, `Chat`, and `Rules`; the mobile strategy chat/composer stack no longer depends on page scroll.
- Playwright MCP verification on the live app showed the intended mobile behavior: `window.scrollY` stayed at `0` while the chat transcript, strategy command center, strategy overview, and strategy chat containers all scrolled internally, and the send button stayed inside the viewport.
- Validation passed for `npm run check` and `npm run lint`. `npm run format:check` still fails only on pre-existing unrelated files `server/mcp/testing.ts` and `server/routes/mcp.ts`.
- `npm run test:run` timed out in the existing full Vitest suite, and `npx playwright test tests/e2e/agent-shell.spec.ts --reporter=line` still fails in the current harness because the browser test does not reliably observe the authenticated workspace switch, even though the same `/agent` flows were verified directly in Playwright MCP.

## 2026-03-27 Buy Slider Slippage-Capped Max

- [x] Locate AMM buy/sell slider amount logic on the player trade panel
- [x] Make buy slider max cap to `min(balance max, slippage-safe max)` so 100% aligns with executable max
- [x] Keep manual/custom amount input synchronized with slider movement and capped max updates
- [x] Run required validation (`npm run check`, `npm run lint`, `npm run test:run`) and record results

Review:

- Implemented a slippage-aware buy max cap in `client/src/components/amm-trade-panel.tsx` using current pool reserves and AMM fee math with a small safety buffer.
- Slider and quick-select now map percentages against the capped max, and manual amount remains synchronized/clamped when max changes.
- Validation passed: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.

## 2026-03-27 MLB Lifecycle Card Visibility + Live/Final Context

- [x] Finish the always-visible MLB lifecycle card at the top of the game modal for scheduled, live, and final games
- [x] Keep the home-screen slate compact and probable-pitcher-only while preserving the display-only Ball Don't Lie / MLB MCP boundary
- [x] Add user-centric live/final context that helps a Sportfolio player check shares: lineups, linescore, scoring summary, top performers, and owned-player earnings
- [x] Re-run validation plus Railway MLB MCP smoke and record outcomes

Review:

- `client/src/components/game-command-center-modal.tsx` now renders a single always-visible MLB lifecycle card above the tabbed command-center body, so scheduled, live, and final MLB games all surface the baseball-specific context without relying on the hidden `pre` tab state.
- The lifecycle card keeps mobile-first hierarchy: matchup/venue chips, your Sportfolio angle, linescore and scoring summary for live/final, probable pitchers, posted lineups, hitter matchup context for pregame, team context, and expandable advanced pitching stats.
- Follow-up mobile polish tightened the first-screen hierarchy: the modal now uses a taller small-screen viewport, the MLB hero card has clearer visual emphasis, the Sportfolio angle block is more prominent, and the advanced toggle moved into the `Probable starters` header so mobile users do not have to scroll to the bottom to expand pitcher metrics.
- `server/mlb-pregame-insights.ts` now normalizes scoring-play summaries from the MLB game payload so the modal can show recent run-scoring events for live/final games while still failing soft if the MCP omits them.
- `AGENTS.md` and `tasks/lessons.md` now capture the product rule to design sports features from the perspective of a user checking shares, boosts, and portfolio relevance, not just generic sports stats.
- Validation status:
- `npm run check` passed.
- `npm run lint` passed.
- `npm run format:check` passed.
- `npm run test:run -- server/mlb-pregame-insights.test.ts` passed.
- `npm run mlb-mcp:probe:railway` passed for `test_get_schedule_tool`, `test_get_stats_tool`, `test_get_available_endpoints_tool`, `test_get_last_game_tool`, and `test_get_next_game_tool`.
- `npm run test:run` now passes after excluding `.claude/worktrees/**` from Vitest collection.

## 2026-03-27 MLB Visibility Status + Browser Verification

- [x] Surface explicit MLB enrichment availability state so the dashboard and game modal do not silently hide MLB context when the internal MCP is disabled or missing
- [x] Add deterministic mobile Playwright coverage for scheduled, live, final, and unavailable MLB game-card states
- [x] Re-run full repo validation plus Railway MLB MCP smoke and record the real end-to-end result

Review:

- `server/mlb-pregame-insights.ts` now returns per-game MLB enrichment status alongside optional `mlbPregame` insight payloads, distinguishing `available`, `pending`, and `unavailable` states instead of silently returning nothing.
- `server/routes.ts` attaches that status to every MLB `GameInsight`, so the client can render a clear fallback when display-only MLB context is not configured or has not posted yet.
- `client/src/components/game-command-center-modal.tsx` now shows a dedicated MLB status card whenever an MLB game has no enrichment payload, with copy that keeps Ball Don't Lie positioned as the gameplay source of truth.
- `client/src/pages/dashboard.tsx` now shows `MLB unavailable` or `Probables pending` on MLB slate rows when schedule enrichment is missing, instead of leaving those rows visually empty.
- Added `tests/e2e/mlb-game-card.spec.ts` to verify the actual mobile flow in Chromium for:
- scheduled MLB row + modal with probable pitchers and lineups
- live MLB modal with linescore, scoring summary, and Sportfolio earnings context
- final MLB modal with recap/share-check content
- explicit unavailable-state rendering when enrichment is missing
- Validation status:
- `npm run e2e -- tests/e2e/mlb-game-card.spec.ts` passed.
- `npm run check` passed.
- `npm run lint` passed.
- `npm run format:check` passed.
- `npm run test:run -- server/mlb-pregame-insights.test.ts` passed.
- `npm run test:run` passed.
- `npm run mlb-mcp:probe:railway` passed for `test_get_schedule_tool`, `test_get_stats_tool`, `test_get_available_endpoints_tool`, `test_get_last_game_tool`, and `test_get_next_game_tool`.

## 2026-04-08 Discord Integration Rollout (Official Server)

- [x] Repair and finalize `server/routes/discord.ts` interaction/auth/linking flow with strict guild scope and canonical account mapping
- [x] Wire Discord route registration + startup schema ensure into server boot paths
- [x] Implement Discord automation jobs for news channel posting and hourly market digest posting with dedupe protection
- [x] Add Discord link-complete web page + router wiring so Discord-first users can authenticate and complete account linking
- [x] Add focused tests for Discord service and routing behavior, then run full validation (`npm run check`, `npm run lint`, `npm run test:run`, `npm run format:check`)
- [x] Execute end-to-end smoke checks for command sync and job/manual trigger paths and document any env blockers

Review:

- Added full Discord route surface in `server/routes/discord.ts` (interaction webhook with signature verification, guild lock, linking APIs, admin command-sync/cleanup APIs, and slash-command handlers for portfolio/player/market/news/trading/stack/boost/scout).
- Added canonical Discord account mapping storage and state/intent/post-history lifecycle helpers in `shared/schema.ts`, `server/discord-service.ts`, and startup schema ensure in `server/routes.ts`.
- Added Discord API helpers in `server/discord-api.ts` for guild command definition/sync and channel posting.
- Added scheduled Discord automation in `server/jobs/discord-posting.ts` and wired scheduler jobs/manual triggers in `server/jobs/scheduler.ts`.
- Added Discord link completion web UX in `client/src/pages/discord-link.tsx` and route wiring in `client/src/App.tsx`, plus post-login redirect support across `client/src/pages/Login.tsx`, `client/src/pages/AuthCallback.tsx`, and `client/src/hooks/useAuth.tsx`.
- Validation status:
- `npm run check` passed.
- `npm run lint` passed.
- `npm run test:run` passed.
- `npm run format:check` passed.
- Discord smoke status (with `.env` loaded):
- `syncDiscordGuildCommands()` succeeded (`status: 200`) and guild command install includes 12 commands (`start`, `help`, `link`, `portfolio`, `player`, `buy`, `sell`, `stack`, `market`, `news`, `boost`, `scout`).
- `postDiscordHourlyMarketDigest()` and `postDiscordNewsUpdates()` executed without runtime errors (dedupe-safe no-op when there is nothing new to post).
- Local server route probes succeeded (`GET /api/discord/health` => `200`, `GET /api/discord/link/state` without state => expected `400`).
- Discord application metadata still reports `interactions_endpoint_url = null`, which will cause slash commands in Discord to show “application did not respond” until the endpoint is set to the deployed webhook URL.

## 2026-04-02 Agent MCP Source Schema Hardening

- [x] Confirm the local Agents-tab failure path and identify the missing optional schema dependency
- [x] Add bootstrap/ensure coverage for `user_mcp_sources` in the agent MCP-source storage layer and startup warmups
- [x] Make agent capability/profile loading fail soft when optional external MCP-source state is unavailable
- [x] Add targeted regression coverage for MCP-source bootstrap and fail-soft capability summaries
- [x] Run `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`
- [x] Apply the new MCP-source schema to the local dev DB and verify the table/column state

Review:

- Root cause of the local Agent settings failure was not `user_agent_profiles`; `/api/agent/profile` was failing while building capability state because `getAgentDataSourceSummary()` tried to read `user_mcp_sources`, and that optional external MCP-source table was missing locally.
- `server/agent/mcp-sources.ts` now self-heals `user_mcp_sources` on first access with a targeted bootstrap + retry path, and `server/routes.ts` includes the same ensure in startup warmups so local/dev drift gets repaired before users hit the Configure panel.
- `server/agent/data-sources.ts` now treats external MCP-source state as optional during profile/capability assembly, so built-in/internal Hermes data-source state still loads even if external MCP-source storage is absent or temporarily unavailable.
- Added regressions in `server/agent/mcp-sources.test.ts` and `server/agent/data-sources.test.ts` to lock down bootstrap-on-missing-schema and fail-soft capability loading.
- Validation passed: `npm run check`, `npm run lint`, `npm run test:run`, and `npm run format:check`.
- Local dev DB repair passed via the new ensure path, and `user_mcp_sources` now exists locally with the expected columns: `id`, `user_id`, `name`, `url`, `auth_type`, `auth_token`, `enabled`, `discovered_tools`, `last_verified_at`, `last_error`, `created_at`, and `updated_at`.
