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

- [ ] Redesign the agent interface on mobile and desktop to use a simpler ChatGPT-style chat shell (clean history, minimal chrome, no clutter like live/status noise)
- [ ] Align the agent route visual language with the dashboard aesthetic (font, color, spacing, card treatment)
- [ ] Redesign the Daily Digest to match the dashboard aesthetic instead of using a separate visual style

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
