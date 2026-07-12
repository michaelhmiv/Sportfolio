# July 2026 Repository Refactor Audit and Program

- **Status:** active program
- **Audit date:** 2026-07-12
- **Baseline commit:** `39457e3` (`main` / `origin/main`)
- **Implementation branch:** `refactor/job-registry-foundation`

## Purpose and guardrails

This audit converts the post-NHL repository review into an evidence-backed refactor program. It is not permission to rewrite product behavior.

Guardrails:

- Preserve routes, response shapes, cron schedules, job names, trigger behavior, and failure isolation unless a separately approved change says otherwise.
- Characterize high-risk seams before moving them.
- Prefer extraction and delegation over broad rewrites.
- Treat storage, schema, AMM, and provider-client changes as behavior-sensitive.
- Keep commits narrow and independently reviewable.
- Require focused tests plus the complete validation matrix before merge.

## Baseline evidence

### Repository and checks

| Measure                          |                   Baseline |
| -------------------------------- | -------------------------: |
| Unit/integration test files      |                 130 passed |
| Unit/integration tests           |                 836 passed |
| Type check                       |                     passed |
| ESLint                           |                     passed |
| Prettier check                   |                     passed |
| Build                            |                     passed |
| Test duration                    |                     9.74 s |
| Bundled server (`dist/index.js`) |   2.8 MB (esbuild display) |
| Largest JS asset                 | 426.34 kB (125.95 kB gzip) |

Coverage from `vitest run --coverage`:

| Statements | Branches | Functions |  Lines |
| ---------: | -------: | --------: | -----: |
|     48.09% |   37.23% |    52.37% | 48.38% |

The scheduler baseline is materially weaker than the repository average: 21.10% statements, 14.70% branches, 9.21% functions, and 21.31% lines.

### Structural metrics

- `server/routes.ts`: 11,854 lines and 169 direct `app.get/post/put/patch/delete/use` registrations.
- `server/storage.ts`: 7,901 lines and 167 public `DatabaseStorage` methods.
- `server/agent/operations-planner.ts`: 6,582 lines; tests are substantial, but parsing, planning, execution, and response construction remain co-located.
- `shared/schema.ts`: 3,992 lines and 111 table declarations.
- `client/src/components/game-command-center-modal.tsx`: 3,793 lines, 29 `useQuery` calls, 19 `useMutation` calls, and 41 query-key declarations.
- `server/amm/pool.ts`: 2,601 lines; AMM logic remains a high-risk behavior seam.
- Source-only `jscpd` scan: 668 files, 127,809 lines, 260 clones, 3,988 duplicated lines (3.12%). Generated coverage output must be excluded; the default script currently scans it if it exists.
- Context audit: 1,106 text files, 331,985 lines, and an estimated 2.70M-4.51M tokens before default exclusions. The default exclusions reduce characters by 31.90%, but active docs still compete with historical root files and a 3,050-line task log.

### Baseline tool failures that are findings, not refactor regressions

1. `npm run invariants:check` fails because it expects the removed legacy schema token `power: integer("power")`. The invariant no longer matches stacked-share semantics.
2. `npm run openapi:check` fails because `/api/holdings/condense` is missing from the OpenAPI contract.
3. `npm run code:dead` cannot run without a database URL because importing Drizzle configuration evaluates environment requirements. With a dummy URL it reports 95 production dependencies as unused, demonstrating that the current Knip entry/config model is not trustworthy for deletion decisions.
4. `npm run code:dup` is contaminated by generated `coverage/` HTML when coverage has just run.
5. The successful build emits a chunk-size warning; this is a ratchet candidate, not a reason to mix bundle work into the scheduler change.

## Foundation branch result

The foundation implementation preserves the verified scheduler contract while moving job metadata and adapters into `server/jobs/job-registry.ts`.

| Measure                           |      Baseline |   Post-change |     Delta |
| --------------------------------- | ------------: | ------------: | --------: |
| Passing test files                |           130 |           130 |         — |
| Passing tests                     |           836 |           851 |       +15 |
| Statements                        |        48.09% |        48.56% |  +0.47 pp |
| Branches                          |        37.23% |        37.44% |  +0.21 pp |
| Functions                         |        52.37% |        53.54% |  +1.17 pp |
| Lines                             |        48.38% |        48.86% |  +0.48 pp |
| Scheduler statements              |        21.10% |        57.94% | +36.84 pp |
| Scheduler lines                   |        21.31% |        58.09% | +36.78 pp |
| Source-only clone count           |           260 |           260 |         — |
| Source-only duplicated lines      | 3,988 (3.12%) | 3,988 (3.12%) |         — |
| Scheduler/job mutual import pairs |            18 |             0 |       -18 |

Additional structural evidence:

- `server/jobs/scheduler.ts` shrank from 871 to 301 physical lines and now owns only cron lifecycle, overlap protection, execution logging, and status reporting.
- The 35 canonical names occur once each as registry definitions; registration, manual dispatch, and advertised-name listing are derived views.
- Registry coverage is 89.47% statements and 89.13% lines in the post-change coverage run.
- The combined scheduler and registry source is 1,351 characters larger than the prior monolith because the extracted registry now includes explicit metadata, runtime validation, immutable snapshots, and result adapters.
- `npm run check`, `npm run lint`, `npm run format:check`, `npm run test:run`, `npm run build`, docs checks, context audit, and `npm run agent:improve` all pass.
- The stale invariant, OpenAPI gap, and noisy Knip report were unchanged by the registry refactor itself and were resolved in the follow-up hygiene pass documented below.

### Follow-up tool-hygiene resolution (2026-07-12)

- `npm run invariants:check` now asserts the canonical `holdings`, `player_multipliers`, and `player_multiplier_events` contracts and rejects retired `holdings.power`, `holdings.powerLevel`, `/api/holdings/condense`, and `/api/holdings/power-level` guidance.
- `npm run openapi:check` now structurally requires the live `POST /api/holdings/stack-shares` and `GET /api/holdings/{playerId}/multiplier-state` operations, including the required `playerId` path parameter; the OpenAPI spec already documented both routes.
- `npm run code:dead` now runs Knip as a dependency/import-integrity gate over application, server, shared, script, test, and root-config sources. It checks dependency declarations, binaries, and unresolved imports without conflating the existing export/orphan-file cleanup backlog with this gate.
- Knip no longer evaluates `drizzle.config.ts`, so dead-code analysis does not require a fake database URL. `@capacitor/android`, `@capacitor/clipboard`, and `@capacitor/ios` are explicit dependency exceptions because the committed native projects and native toolchain consume them outside TypeScript imports; `gh` is an intentional system binary.
- Nineteen unreferenced root dependencies were removed, and direct declarations were added for `nanoid`, `@sinclair/typebox`, and `@radix-ui/react-visually-hidden` instead of relying on transitive installs. Packages imported by orphaned but type-checked UI modules remain declared; exhaustive Knip entries prevent them from being misclassified as unused.
- Four standalone scripts that imported removed sync/backfill modules were deleted. The existing authenticated `/api/admin/backfill` route retains its pre-existing retired dynamic import as one exact `ignoreUnresolved` exception rather than weakening unresolved-import checks globally.

## Priority model

Each candidate is scored from 1 (low) to 5 (high) for impact (I), confidence (C), effort (E), coupling (K), and regression risk (R).

`score = 100 × (0.35×I/5 + 0.20×C/5 + 0.20×(6-E)/5 + 0.15×K/5 + 0.10×(6-R)/5)`

High impact, confidence, and coupling increase priority; high effort and risk reduce near-term priority. The score orders work, but explicit dependency and safety constraints still win.

## Prioritized program

| Rank | Score | Candidate                                              | I/C/E/K/R | Disposition                                             |
| ---: | ----: | ------------------------------------------------------ | --------- | ------------------------------------------------------- |
|    1 |    94 | Typed canonical scheduler registry                     | 5/5/2/5/2 | **Do now** after characterization tests                 |
|    2 |    86 | Agent-context and CI/tool hygiene                      | 4/5/2/4/1 | **Do in this foundation branch** where directly related |
|    3 |    81 | Canonical game-data contracts and query keys           | 4/5/3/5/3 | Next narrow PR                                          |
|    4 |    76 | AMM characterization harness                           | 5/5/5/5/5 | Test-first prerequisite; no redesign yet                |
|    5 |    73 | Game Command Center decomposition                      | 4/5/5/5/3 | Incremental extraction after contract work              |
|    6 |    71 | Route composition by bounded domain                    | 4/5/5/5/4 | Continue incrementally; avoid a route rewrite           |
|    7 |    63 | Storage read-path modules and query-count verification | 4/3/5/5/4 | Instrument first; optimize verified paths only          |
|    8 |    63 | Operations Planner parser/planner extraction           | 3/4/4/4/3 | Extract pure seams under existing tests                 |
|    9 |    49 | Provider-client utility convergence                    | 2/3/4/3/3 | Apply rule-of-three; preserve provider semantics        |
|   10 |    47 | `shared/schema.ts` split feasibility                   | 2/3/5/5/5 | Research-only until import/migration safety is proven   |

## Findings and concrete plans

### P0 — Typed canonical scheduler registry

**Verified finding.** Scheduler knowledge is repeated across three independent structures:

- 33 scheduled definitions in `initializeCoreJobs()` and `initializeApiJobs()`;
- 34 manual trigger handlers in `triggerJob()`;
- 34 listed names in `getAvailableManualJobNames()`.

Those 101 name declarations represent only 35 distinct jobs. Thirty-two names occur in all three structures. Two asymmetries are intentional current behavior and must be preserved:

- `nascar_active_roster_sync` is scheduled and manually triggerable but omitted from `getAvailableManualJobNames()`;
- `backfill_market_snapshots` is listed but has no manual handler and therefore returns the current unknown-job failure.

`mlb_stats_sync` is manually triggerable/listed but not scheduled. The scheduler also owns the `JobResult` type imported by 22 job files; 18 of those form syntactic mutual import pairs because the scheduler imports their handlers.

**Plan.**

1. Add characterization tests that lock names, exact schedules, enabled flags, registration order, manual-list order, triggerability, intentional drift, and unknown-job text.
2. Move shared job contracts (`JobResult`, schedule/handler types) to a leaf module.
3. Define every job once in a typed registry with explicit metadata: schedule, scheduled handler, manual handler, and admin visibility.
4. Derive initialization, manual dispatch, and available-job listing from the registry.
5. Preserve the three intentional asymmetries above exactly.
6. Compare registry name counts, schedules, and scheduler-focused coverage before and after.

**Out of scope:** changing cron cadence, making the backfill trigger work, exposing the NASCAR active-roster job, changing locking/concurrency, or altering a handler implementation.

### P1 — Agent-context and CI/tool hygiene

**Verified finding.** Active instructions still contain stale `Sportfolio-Replit` clone/fetch commands and pre-stacking economy language. `tasks/todo.md` is 3,050 lines and root-level completion/status documents compete with canonical context. Three validation tools have stale or noisy configuration.

**Plan.**

- Make `AGENTS.md`, `CLAUDE.md`, `AGENT_GUIDE.md`, and `docs/agent/*` point to `michaelhmiv/Sportfolio` and current stacked-share semantics.
- Keep active context concise; archive verified historical task/status material with clear provenance rather than deleting history.
- Update the stale `power` invariant to assert the current holdings/multiplier contract.
- Update OpenAPI validation to require the live `/api/holdings/stack-shares` and `/api/holdings/{playerId}/multiplier-state` contracts and reject retired `/api/holdings/condense` guidance.
- Exclude generated reports from duplication checks.
- Fix Knip entries/configuration before treating its findings as dead code.
- Consider adding `npm run build`, OpenAPI, and invariant checks to PR CI only after the baseline failures are repaired.

### P1 — Canonical game-data transport contracts and query keys

**Verified finding.** The post-NHL changes added useful sport adapters (`shared/sport-config.ts`, `SportProvider`, API response builders), but transport types remain local to consumers. Three components query `/api/games/:id/live-stats`; two use a URL-string key while Game Command Center uses `["/api/games", gameId, "live-stats"]`, allowing duplicate caches for the same endpoint. Game/sport detection also remains partly encoded through component-local ID-prefix checks.

**Plan.**

- Define shared wire contracts for game stats/live stats without leaking database row types.
- Add one query-key factory and one fetch adapter for live/game stats.
- Route sport detection through canonical `Sport`/`SportProvider` helpers.
- Add MLB/NHL/NASCAR contract fixtures and consumer tests before removing local interfaces.
- Keep response payloads byte-for-byte compatible in the first PR.

### P1/P2 — AMM characterization before modularization

**Verified finding.** `server/amm/pool.ts` contains pricing, liquidity, reserve, transaction, and compatibility behavior in 2,601 lines. Its financial impact makes size alone a poor reason to split it.

**Plan.**

- Build a golden characterization matrix for buy/sell quotes, execution, reserve constraints, fees, precision/rounding, empty pools, and transaction rollback behavior.
- Record invariants and tolerated numeric error explicitly.
- Only then extract pure math from persistence/orchestration.
- Do not change formulas or schema in an extraction PR.

### P2 — Game Command Center decomposition

**Verified finding.** The modal combines transport, mutations, query invalidation, sport branching, derived view models, and rendering. It has 29 queries and 19 mutations in 3,793 lines, creating high change amplification.

**Plan.**

1. Introduce canonical query keys/contracts first.
2. Extract pure derived-data selectors with tests.
3. Extract domain hooks (game status, holdings/exposure, boosts, lineups) without changing rendered hierarchy.
4. Extract bounded panels last and visually verify desktop/mobile behavior.
5. Preserve the product hierarchy: score/state, earnings/exposure, lineups, injuries; secondary scoring plays remain collapsed by default.

### P2 — Route composition

**Verified finding.** `server/routes.ts` remains the largest source file at 11,854 lines despite existing extracted modules under `server/routes/`. Route registration, validation, authorization, and response assembly are still mixed across many domains.

**Plan.**

- Continue the existing router-factory pattern one bounded domain at a time.
- Pass dependencies explicitly; do not move the global storage object into new hidden singletons.
- Add route-level authorization and response-shape tests before extraction.
- Start with a low-coupling admin or read-only domain, not holdings/AMM.

### P2 — Storage read paths and N+1 verification

**Verified finding and bounded hypothesis.** `DatabaseStorage` has 167 public methods and mixes many domains. Some response assembly uses per-item storage calls; for example boost enrichment may issue up to three live-stat lookups per boost. That path is bounded by the small daily-boost set, so query shape—not file size—must determine priority.

**Plan.**

- Add query-count instrumentation around highest-traffic dashboard, marketplace, portfolio, and game-modal endpoints.
- Establish p50/p95 latency and row counts before changing SQL.
- Extract domain read modules while retaining the `IStorage` facade.
- Batch only verified repeated lookups; add result-equivalence tests for every query rewrite.

### P2 — Operations Planner extraction

**Verified finding.** The planner is well tested but combines normalization, directive parsing, ranked workflow parsing, plan construction, execution, and response formatting.

**Plan.**

- Extract pure normalization/parser helpers first, preserving tests and exact parser messages.
- Introduce explicit parse-result and plan types.
- Keep side-effectful storage/tool execution behind current interfaces.
- Avoid changing prompts, model behavior, or operational policy in an extraction PR.

### P3 — Provider utilities only after repeated semantics align

**Verified finding.** Timeout, retry, cache, and in-flight-request patterns occur in multiple provider clients, but retryability and provider response validation differ. NHL already has injectable deterministic retry behavior.

**Plan.**

- Inventory semantics before extraction.
- Share only primitive helpers with identical policy (bounded timeout lifecycle, `Retry-After` parsing, injectable sleep/random).
- Keep provider-specific validation, status handling, caches, and rate limits local.
- Require at least three genuinely matching clients before a shared abstraction.

### P3 — `shared/schema.ts` split feasibility

**Verified finding.** The schema is large, but migrations, Drizzle relations, shared imports, and table initialization order make a mechanical split risky.

**Plan.**

- Generate an import/relation graph and identify cycle-free domain slices.
- Prove Drizzle migration and `drizzle-kit` behavior in a spike.
- Prefer stable barrel exports so consumers do not churn.
- Do not split until generated SQL and schema snapshots are identical.

## Post-NHL reconciliation

The audit explicitly checked merged PRs #251 and #252.

- **#251 — Post-NHL Multi-Sport Refactor Foundation:** introduced `shared/sport-config.ts`, `SportProvider`, provider-aware game-stat response construction, season helpers, NHL API hardening, and component/provider seams. These are foundations to extend, not duplicate.
- **#252 — Fix multi-sport stack regressions:** corrected Game Command Center regressions, restored stats loading, repaired live-game labels/formatting, and added multi-sport stats fallbacks. Follow-up refactors must preserve those fixes and add regression fixtures around them.

No open repository issues define a competing refactor program as of the audit date; the only open item returned by the issue API is PR #250.

## Recommended sequence

### Phase A — Foundation (this branch)

1. Scheduler characterization tests.
2. Leaf job contracts plus typed canonical registry.
3. Derive scheduler/list/manual paths while preserving anomalies.
4. Repair active context and directly related validation hygiene.
5. Full validation, before/after metrics, independent reviews, draft PR.

### Phase B — Multi-sport contracts

1. Shared game/live-stat wire contracts and fixtures.
2. Canonical query-key/fetch adapters.
3. Normalize sport detection.
4. Validate post-NHL regressions across MLB/NHL/NASCAR.

### Phase C — Safe decomposition

1. Game Command Center selectors and hooks.
2. Bounded route modules.
3. Operations Planner pure parser modules.
4. Storage query-count work and verified batching.

### Phase D — High-risk foundations

1. AMM characterization harness.
2. Provider utility convergence where semantics match.
3. Schema split spike; implement only if generated artifacts remain identical.

## Required evidence for every refactor PR

- [ ] Baseline and post-change focused tests
- [ ] `npm run check`
- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm run test:run`
- [ ] `npm run build`
- [ ] Relevant OpenAPI/invariant/tool checks, with pre-existing failures clearly separated
- [ ] Before/after file, duplication, coverage, and build metrics where affected
- [ ] Diff inspection for behavior changes and generated files
- [ ] Security/auth review for routes or external providers
- [ ] Visual desktop/mobile verification for user-facing changes
- [ ] Explicit note for every intentional compatibility anomaly retained or changed
