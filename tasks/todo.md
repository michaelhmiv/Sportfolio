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
