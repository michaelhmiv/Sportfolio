# Lessons Learned

## 2026-03-27

- When an optional enrichment provider drives visible UI, verify the real runtime wiring and show an explicit unavailable or pending state in the product; silent omission makes implemented features look nonexistent.
- For feature work that changes what users should see on the page, finish with browser verification on the real surface or a deterministic Playwright spec before claiming the UI is shipped.
- For MCP-backed adapters, do not trust mocked top-level payloads if the live server is already available; verify the actual response envelope first or the UI can look broken even while the tool probe passes.
- For baseball lineups, `boxscore.teams.<side>.batters` is too broad for a natural box-score view on completed games; prefer `battingOrder` so the UI shows the actual nine-man order instead of everyone who appeared.

## 2026-03-25

- For internal sidecar-style providers like the MLB MCP, do not stop at local parity; validate the deployed Railway service before calling the work complete, even if the local vendored server returns the expected payloads.
- When product logic already trusts Ball Don't Lie for MLB gameplay, keep any MLB StatsAPI or MCP additions display-only behind a Sportfolio-owned adapter; optional enrichment must never become a dependency for payouts, locks, or core market behavior.
- For user-facing sports surfaces, do not stop at proving the data exists; design the view around what a Sportfolio player wants to check about their shares in that game right now, and make that context visible in the primary viewport.
- If Hermes gains a built-in internal data source, surface that availability in both Configure and Hermes capability context; hiding it only in runtime tools makes the agent falsely claim it has no MCP/data connections.
- When the product has fully retired a mechanic like bid/ask order-book pricing, remove the dead UI sort controls and placeholder response fields instead of preserving non-functional compatibility stubs.
- For OpenRouter BYOK, managed model aliases (for example `MiniMax-M2.7`) are not valid model IDs; normalize them to provider-prefixed IDs (for example `minimax/minimax-m2.7`) server-side to avoid empty-turn failures in Hermes.
- When adding an internal MCP bridge to Hermes, cache failed discovery refreshes for a short retry window and bound returned tool payloads before they re-enter the model loop; otherwise outages and large datasets can repeatedly stall or bloat the runtime.
- On the mobile Player Pools header, lead with broad market figures and explain proprietary metrics inline; personal/action framing plus dense health jargon reads gimmicky on this surface.
- If a tab is called `Top Risers`, source it from real positive 24h movers rather than a generic momentum ranking, or users will correctly read the ordering as broken.

## 2026-03-23

- Planning-intent guards should recognize explicit planning phrases paired with action targets (for example, "plan a trade") even when request mode is `auto`, or legitimate staging requests will be misrouted as advisory.

- When product policy requires a single in-house managed model/provider, enforce it at type, schema, settings, runtime, and test layers together; leaving legacy enum options in any one layer creates silent drift.

- When users send broad strategy prompts, do not let the model jump straight to confirmation-gated preview tools; require explicit action/planning intent or concrete args, then force a read/scan reroute before staging.

- For `/agent`, "mobile verified" is not real until Playwright proves the full tap-focus-type-send loop on an iPhone-sized viewport; scroll visibility alone is too weak and let a broken composer ship.
- If Hermes can be configured with multiple managed providers, do not let an unsafe legacy default remain the effective runtime path just because it is present in env or older DB rows; prefer an explicitly Hermes-safe configured provider and upgrade stale settings automatically.
- When the provider returns neither text nor tool calls, classify that as an empty provider response immediately and log the effective provider/model. Treating it as a generic unsupported turn hides the real failure mode.
- If the model goes empty after already completing a useful tool call, preserve and return the latest successful tool result rather than discarding it and falling back to a dead apology.
- Preview and staging tools should resolve natural player references server-side; requiring the model to always emit canonical Sportfolio player IDs makes ordinary prompts fail for avoidable reasons.
- When Playwright harness behavior disagrees with live MCP verification, inspect the trace instead of assuming the harness is flaky; here it exposed a real `reviewState` nullability crash in the mocked strategy-detail path.
- For local browser automation against protected routes, keep any auth bypass loopback-only and explicit so the harness can stay on the real route without weakening production/session behavior.

- When `/agent` already has the right product model, the redesign should change composition before contracts: elevate the command center, slot rail, and detail canvas instead of inventing new agent concepts.
- If a dense operator page feels like stacked cards, remove equal visual weight before adding new visuals; stronger section hierarchy and fewer repeated shells does more than adding more widgets.
- For the agent workspace switch, do not duplicate tab state owners just to restyle the header; keep one source of truth and make the visual switch a thin control over that state.
- On `/agent`, scrolling bugs that survive multiple passes are usually layout-contract bugs, not padding bugs; collapse each workspace to one real scroll owner instead of patching nested `overflow-y-auto` regions one by one.
- If the dashboard is the visual reference, match its information rhythm directly: tighter labels, denser rows, and fewer explanation blocks. Do not leave chat/strategy headers reading like generic AI cards once the core IA is already correct.
- When verifying `/agent`, use Playwright MCP against the live app to measure the actual scroll container and `window.scrollY`; browser test harnesses can still miss or flake on the authenticated workspace shell even when the real page behavior is correct.

- If `/agent` is meant to feel integrated with the rest of the mobile product, do not hide the shared bottom nav just because the page is workspace-heavy; reserve viewport space for it and let the route adapt instead of creating a special mobile shell.
- For mobile strategy workspaces, a preselected desktop detail pane should not dictate the first mobile screen; keep a command-center/list view as the default mobile entry and open detail only after an explicit user drill-down.
- When the user explicitly requires a named Codex skill or workflow, install it if needed, read it, and use it as an actual review/build rubric for the touched surface instead of treating it like a loose suggestion.
- When expanding `/agent` runtime payloads with new required fields, update both the live API nullability contract and the browser/mock fixtures in the same pass; otherwise real thread turns and Playwright coverage will drift in different ways.

## 2026-03-21

- When adding a new authenticated web-only agent route, update the public surface audit/exclusion registry in the same pass or the parity suite will correctly fail even if the product behavior itself works.
- For Hermes recurring workflows, keep review-before-activation as saved strategy state rather than a UI-only flag; activation, live-edit pausing, prompts, and strategy overview all need the same source of truth.

## 2026-03-12

- When a public action stages a scout-only bundle outside the normal scout-run pipeline, confirmation must fall back to direct action execution instead of assuming a scout run id exists.
- Bearer-token public surfaces must not be able to mint fresh bearer tokens; keep API token creation explicitly web-session-only even if list/revoke flows are shared elsewhere.
- Generic tool renderers are not a safe replacement for command-specific CLI summaries; preserve dedicated human-readable output for high-traffic commands like `portfolio summary`.

## 2026-03-18

- In the Agents tab, keep the IA in plain user language and match the task model: `Chat` for one-off help, `Strategies` for recurring workflows, and dedicated strategy conversations instead of deriving strategies directly from general chat.
- If `/agent` is already mounted inside a full-height app shell, do not give the agent page another `100dvh` root; duplicated viewport ownership plus nested `overflow-hidden` is what causes the bottom of mobile chat and strategy views to get clipped.
- When redesigning `/agent`, do not fall back to generic AI-dashboard cards; reuse the repo's sharper terminal/trading visual language, keep the first viewport focused on the active goal or decision, and push run metadata into compact blocks or inline expansions.
- If agent-generated UI is the direction, start with a closed `uiBlocks` catalog over the existing Hermes contract before adopting a full external UI protocol; it captures most of the UX benefit while keeping the host app in control of rendering, trust, and mobile hierarchy.
- For strategy workspaces, a draft should read like a build surface, not a mini analytics dashboard; prioritize draft/schedule/rules summaries over performance tiles until the strategy is actually active and running.
- When validating this repo, run the heavy Vitest suite serially if you need a trustworthy signal; running `check`, `lint`, `test:run`, and formatting in parallel can create timeout-only failures in unrelated long-running tests.
- For `/agent` on mobile, do not keep secondary runtime state as a long stack of equal-weight cards; keep one top briefing surface and collapse supporting automation, evidence, and capability panels behind accordions or sheets.
- When the product is supposed to be Hermes-native, do not accept “same request contract” as proof of alignment; persist and assert transport provenance so strategy runs, schedules, and manual turns can be shown to have actually traversed the Hermes runtime path instead of a quiet local shortcut.

## 2026-03-13

- When burning boost shares across canonical and alias player IDs, choose the regular holding row by actual unlocked availability for that specific asset ID before using canonical/quantity tiebreakers; raw quantity alone can burn from a fully locked row.
- When a roster sync job uses the API roster itself as the active-source-of-truth, mark the provider ID active before attempting DB writes so transient update failures do not accidentally deactivate still-active players later in the same run.

## 2026-03-11

- For external stage tools, a valid preview is not enough; verify that the pending bundle is actually written to the thread and that confirm/cancel work through the same public contract, or MCP can appear correct while real users still hit `cannot_stage`.
- When validating Hermes tool execution, exercise the public CLI and MCP surfaces as a separate authenticated user with real thread creation, natural-language `send_agent_message`, and post-state checks; internal helper-path tests alone will miss adapter and staging-context drift.

## 2026-03-10

- For direct-to-main hotfixes, sync to `main` first and do branch switches plus pulls serially; parallelizing Git state changes can create misleading merge/conflict errors even when the worktree is clean.
- When game state controls gameplay gates like boosts, do not keep separate time-only heuristics in the dashboard, routes, and jobs; use one shared status helper or delayed/stale schedule rows will drift into false `live` locks.
- When a local scheduler/watch process looks stale, verify fixes against DB-backed job logs and a direct one-off job invocation on the current code instead of trusting the long-lived file log or assuming the watcher has reloaded.

## 2026-03-09

- When a mobile market page still needs desktop trading density, do not stack multiple pre-table summary cards; collapse them into one tabbed intel surface and keep search plus core sort/filter controls visible directly above the board.
- If the dashboard is the visual reference for a mobile surface, avoid spreading indicators across multi-card stat grids; use compact pills, short summary lines, and dense row treatments instead.
- When matching dashboard mobile styling, keep the type scale tighter than a normal page header surface: labels should mostly live in the `text-[8px]` to `text-xs` range, and large numeric callouts should be avoided unless they are the single focal point.
- When a user asks for spreadsheet density on mobile market surfaces, remove extra pre-table cards entirely, keep one top intel card, force one-line no-wrap player rows, and limit row context to a single compact token plus one action cell.
- When a mobile market row is fundamentally a trading surface, keep the CTA copy stable as `Trade`; express ownership through green player-name text, not a second ownership token or badge.
- When a dashboard top card is narrowed to one product concept like slate exposure, remove adjacent concepts entirely instead of preserving old tabs or CTA blocks; density and clarity improve more from a single-purpose compact board than from squeezing legacy modules tighter.
- When an exposure card row represents a player, open the shared player modal first instead of deep-linking straight into Player Pools; dashboard row taps should preserve optionality.
- If the user wants a `Missing` view on a large slate, show the actual uncovered names but do not headline a raw missing total in the card summary.
- If a shared modal keeps an absolute top-right close button, reserve explicit mobile top padding when the content also has top-right CTA rows; otherwise the close hit area can sit directly on top of action buttons.

## 2026-03-04

- If a UI-compliance pass is supposed to cover the whole app, stop only after the shared `ui/*` layer is scanned too; route-level cleanup alone can look complete while generic primitives still reintroduce the old visual language underneath.
- For cross-site UI aesthetic shifts, add additive visual variants to shared primitives and migrate routed surfaces onto them incrementally; do not flip global defaults first or you will destabilize already-good screens.
- When legacy mojibake separators leak into touched UI files, normalize the underlying Unicode glyphs to ASCII before the visual pass is complete; otherwise terminal-style cleanup can still ship obvious garbage characters in status lines and metadata rows.
- In tall chat layouts, fixing the outer app shell is not enough; the inner transcript flex item also needs `min-h-0` or it will expand to content height and push the composer off-screen as soon as messages load.
- For a dedicated immersive route like `/agent`, hiding one shared chrome element is not enough; if the route is meant to own the viewport, remove the full shared app frame (header/sidebar/footer/nav) and provide route-local navigation instead.
- For full-height chat routes inside the shared app shell, do not use viewport-based `min-h-screen` sizing or `scrollIntoView` on transcript sentinels; fit the route to its parent container and scroll the inner chat viewport directly.
- When a user says a gameplay loop is retired, treat every active runtime, support script, seed artifact, and player-facing doc reference to that loop as stale until proven otherwise; do not leave it documented as current.
- When the user wants Hermes to feel fully agentic, do not let regex scan routing or direct-operation shortcuts outrank the model; use a model-first router to choose between direct replies, supported read/research tools, and confirmation-gated plan tools.
- If a generic model-routed turn fails, prefer a neutral fallback over a scout-biased canned reply so unrelated prompts do not look ignored.
- If the live Hermes allowlist is broader than the curated tool catalog, supplement missing tool metadata at routing time or the model-first router will silently cover only a subset of the real tool surface.
- Self-improvement should create durable remediation candidates, but candidate persistence must never be allowed to break the user-facing turn; if that write fails, degrade silently and keep the answer path intact.
- Agent audit tooling needs a true static mode that can run without a live user id or working local DB credentials; otherwise the evaluation loop disappears in the exact broken environments where it is most useful.

## 2026-03-08

- When a local dev DB issue appears inconsistent with the shell environment, confirm the app's real connection path with `dotenv/config` and `server/db.ts` before assuming the exported `DATABASE_URL` is the active target.
- If a cutoff migration backfill fails on foreign keys in dev, inspect for orphaned legacy seed rows first; a tiny amount of invalid local data can block an otherwise-correct schema migration and make route failures look like app bugs.
- When a dashboard revamp is meant to showcase the product, keep the existing mobile account-summary floater as the canonical place for cash / portfolio snapshot data and use the new top card for market, slate, and action context only.
- When a mobile dashboard surface is supposed to feel like a briefing, do not just stack desktop modules tighter; switch to one active panel at a time and keep sibling product surfaces like Player Pools out of scope unless the user explicitly asks for them too.
- If the dashboard already exposes 24h P/L in the mobile floater, do not repeat that metric in the top showcase card; use the card for non-duplicative portfolio context like exposure setup, stack-needed names, or top movers instead.
- For portfolio and gameplay evaluation surfaces in this repo, default to dashboard-style density first: compact tables, tight row spacing, and compressed metadata beats roomy card stacks unless the user explicitly asks for a more spacious/mobile-card presentation.
- If the user corrects a payout rule, fix the earning-unit source first and then realign dependent dashboard tabs and copy; do not leave UI messaging claiming stacked-only rewards while backend snapshots still pay regular holdings.
- When adding a ledger category for a live product system, only model live user-visible mechanics in the feed; do not fabricate rows for not-yet-shipped features like premium trading just to fill category coverage.

## 2026-03-07

- When a user explicitly says they want zero ambiguity long term, do not leave legacy economic fields or compatibility aliases in the live canonical model; finish the schema/storage cleanup and keep any transition layer strictly temporary and clearly bounded.
- When a production migration needs a manual post-cutover fix, immediately capture that fix in a new append-only migration and keep migration numbering unique; do not leave prod-only schema state or duplicate migration prefixes around for the next rollout.
- When scoping MCP parity for Sportfolio, separate gameplay actions from external purchase and account-management flows: community boost creation, market trades, LP actions, boosts, condense, scouts, watchlists, schedules, and agent threads are gameplay; checkout, add-cash, premium/community purchase flows, profile/settings, and admin routes are not.
- If a user asks what to do with idle cash, treat that as a cash-deployment intent first and keep the response domain-limited unless they explicitly ask for a broad setup review.
- For MCP wrappers over existing Hermes previews, keep the public input schema aligned with the underlying preview contract and make the smoke harness validate those exact field names so arg drift cannot pass on permissive mocks.
- If an MCP confirm/cancel surface asks the caller for both `threadId` and `pendingBundleId`, enforce the bundle id inside the thread-service mutation itself; a pre-check alone is still race-prone once new thread messages can expire and replace pending bundles.
- When mirroring an existing route in MCP, preserve its ranking semantics before applying any MCP-side limit or the tool will silently diverge from the site surface on larger result sets.

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
- For multi-turn agent UX, do not let the default fallback advisory speak from account state alone; the live user message must be explicitly anchored in the final prompt payload and non-deterministic turns should use a model-backed reply before dropping to static copy.
- When a user wants Hermes to feel genuinely agentic, bias ambiguous turns toward a small, well-described scan/read tool loop before broad fallback prompts; improving tool selection usually beats stuffing more generic context into the model.
- If Hermes is supposed to feel like the real front man, do not keep a hidden parser-first branch above it; let every normal turn enter Hermes first, and keep deterministic planners behind explicit plan tools instead.
- Self-improving agent behavior should come from constrained reusable skills over approved tools, not from auto-creating new backend tools or widening capability without admin review.
- If Hermes is supposed to reason over Sportfolio state, do not spend the model pass on a synthetic meta-router; expose real tools directly, let the model chain them, and only bubble out confirmation-gated planners when needed.
- "Continuous improvement" is not satisfied by memory writes alone; every agent turn needs structured traces plus an audit/remediation loop, or the system only remembers user preferences without actually improving its own behavior.
- For Portfolio account history, treat Activity as a mobile-first ledger backed by existing immutable event tables instead of a decorative feed; dense rows, category chips, and drill-in links matter more than tall cards or narrative copy.
- When the user defines autonomous agent scope broadly, write the exclusions down in code and docs immediately; "everything except purchases/premium/community boosts" is a product boundary, not a conversational preference.
- For `/agent` layout work, do not trust static inspection or repo tests alone; verify the real mobile scroll owners in Playwright MCP before calling the redesign done.
