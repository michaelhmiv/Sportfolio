# Collections and Public Identity — Implementation Assessment

**Assessment date:** 2026-07-14
**Baseline:** `origin/main` at `f321a1fd1952636956f873e9afd0da8522980dc0`
**Working stack:** `feat/collections-domain-v2` and follow-on branches
**Baseline verification:** `npm run check` passed; `npm run test:run` passed (143 files, 1,051 tests).

This assessment is the pre-coding contract for replacing Sportfolio's current collection scaffolding. It deliberately separates factual collection definitions, current share assembly, immutable completion history, active identity, and public profile presentation.

## 1. Current architecture and relevant files

### Server and data

- `shared/schema.ts:3706-3751` defines the entire existing collection model as one `user_collections` row with `collectionType`, raw `targetId`, integer `progress`/`total`, reversible `completed`, and one `completedAt`.
- `server/jobs/update-collections.ts` contains collection definitions, qualification logic, evaluation, persistence, and notification in one periodic job.
- `server/routes.ts:4941-5057` exposes only `GET /api/user/collections`; there are no definition, detail, allocation, release, completion, badge-preference, public Trophy Case, or admin collection APIs.
- `shared/schema.ts:627-656` and `server/storage.ts:2736-2888` implement `holdings_locks` and row-locked share reservation. Locks currently support `order`, `vesting`, `pending`, and `other`; quantities are integers.
- `server/amm/pool.ts:672-875` excludes active `holdings_locks` from sellable shares inside a transaction. `server/storage.ts:7577-7735` moves shares from regular holdings to `stacked_shares`, so stacked shares are already economically separate from ordinary holdings.
- `server/jobs/scout-distribution.ts`, `server/amm/pool.ts`, vesting routes, and stacking routes are the main ownership-changing integration points.
- `server/websocket.ts` and `client/src/lib/websocket.tsx` provide explicit subscription channels, but collections currently piggyback on `marketActivity` rather than having collection event contracts.
- MLB ingestion uses `server/mlb-statsapi.ts`, `server/jobs/sync-mlb-stats.ts`, and `player_game_stats.stats_json` (`shared/schema.ts:1043-1086`). Sportfolio stores game-level counting inputs, not an authoritative finalized season-leader catalog.

### Client

- `client/src/components/collections/*` contains generic badge, progress, list, and ceremony scaffolding. The directory is exported only from its own `index.ts`; no product route imports it.
- `client/src/pages/user-profile.tsx` is a single market/portfolio dashboard with owner settings mixed into the public-profile route.
- `client/src/pages/leaderboards.tsx` manually composes avatar and username presentation.
- `client/src/components/user-name.tsx` is only a linked text primitive; there is no shared public-user identity component or batch public-identity API.
- `docs/ui/visual-system.md` is the normative visual contract. It allows stronger effects for collections/ceremonies but requires semantic tokens, finite/reduced motion, responsive overlays, and surface/border hierarchy.
- `docs/ui/ui-surface-matrix.md` already identifies all four collection components as visually noncompliant/orphaned and the profile route as pending public-profile work.

### Repository state

- The implementation baseline is the roll-up UI-overhaul merge already on `main`; the older stacked UI PRs `#255-#258` remain open but their merged result is represented by `f321a1f`.
- No open GitHub issues currently define collection work.
- Work proceeds in a dedicated clean worktree rather than the unrelated local `refactor/mlb-statsapi-direct-frontend` branch.

## 2. Existing collection-system defects

1. **Definitions do not exist as data.** Collection rules are hard-coded in one job; there is no season, sport, league, source, lifecycle, version, publication state, or frozen membership.
2. **Team collections are not sport-scoped.** `players.team` alone defines membership, so abbreviations and cross-sport records can collide.
3. **Rookie is not rookie logic.** The job explicitly counts any distinct held player.
4. **Position logic is NBA-only.** It hard-codes `PG`, `SG`, `SF`, `PF`, and `C` without a sport field.
5. **“All-Star” is invented.** It uses market capitalization of at least $1 million rather than an official sports fact.
6. **Presence is mistaken for allocation.** Any positive regular holding satisfies a slot; required quantity, partial slot progress, locks, open orders, and stacked shares are not modeled.
7. **Shares can be double-used.** The same holding can satisfy every current collection because no allocation exists.
8. **Completion is accidental and reversible.** Reaching the computed total immediately toggles `completed`; there is no deliberate finalize action or immutable award.
9. **Historical and active state are conflated.** A single row cannot represent first completion, current assembly, inactive Trophy Case history, or reactivation.
10. **Stored totals can become stale.** Existing rows update `progress` but not `total` when team membership changes.
11. **Evaluation is scan-heavy and query-heavy.** Every six hours the job scans all users with holdings, every active team, and then performs per-user/per-team queries.
12. **Events are ambiguous and not commit-safe by contract.** Completion is sent as `marketActivity`; no progress, ready, deactivated, reactivated, badge, or membership event types exist.
13. **The UI is not integrated.** Existing collection components have no product route, use generic icons/raw targets, and present a generic ceremony.
14. **Public identity is absent.** Profile, leaderboard, and actor surfaces independently render users and cannot resolve an active badge or preference fallback efficiently.
15. **Profile semantics are misleading.** The “Live” treatment represents a current WebSocket connection, not an intentional public presence state.
16. **Premium and collection prestige can conflict.** Both use trophy/gold-heavy language; the redesign must keep premium as entitlement and collections as factual achievement identity.

The old job, route, table, and UI must be disabled/archived once the replacement reads and writes are live. They will not be translated into statistical awards.

## 3. Proposed schema

All IDs remain UUID/varchar-compatible with repository conventions. Share quantities use `numeric(20,4)` and are serialized as strings across API boundaries.

### Definition layer

- **`collection_definitions`** — stable logical identity: `slug`, `sport`, `league`, `season`, `family`, `kind` (`player_slots` or `master`), lifecycle (`draft`, `tracking`, `finalizing`, `final`, `disabled`), current version number, publication/finalization dates, and timestamps.
- **`collection_definition_versions`** — versioned content: title, description, qualification text/rules, source type/URI/metadata, points, art key, live/final state, and audit timestamps. `(definition_id, version)` is unique.
- **`collection_slots`** — version-bound membership: stable slot key, player, label, required quantity, required/optional flag, qualification/rank/stat metadata, display order, and active/removed status.
- **`collection_prerequisites`** — exact version-to-version requirements for master collections. Masters never reserve player shares.

Published logical identity fields and finalized versions, slots, and prerequisite rows are database-protected from historical rewrites. Publication is irreversible: neither a definition nor one of its published versions can return to draft, a non-draft version cannot remain under a draft definition at commit, and versions cannot move between logical definitions. Published definitions are soft-disabled rather than deleted. A correction must point to an earlier finalized version of the same definition; it never silently rewrites a final collection.

### User assembly and history

- **`user_collection_allocations`** — one current allocation per user/slot, exact player, allocated quantity capped at that slot's requirement, corresponding holdings-lock reference, and timestamps. Active allocation/lock pairs are commit-time constrained to the same user, player, quantity, and reference. Slot/player mismatches, orphan locks, and over-allocation are rejected by database triggers and the service.
- **`user_collection_states`** — denormalized, rebuildable current state per user/version: allocated/required totals, qualified/required slot counts, progress basis points, assembly state (`unstarted`, `in_progress`, `ready`, `active`, `inactive`), evaluation timestamp, and activation/deactivation timestamps.
- **`user_collection_awards`** — immutable first-completion record, unique by user/version, with first-completed time, optional sequence/rarity snapshot, and bounded reward metadata.
- **`user_collection_state_events`** — append-only audit stream for completed, deactivated, and reactivated transitions; not every allocation adjustment.
- **`user_badge_preferences`** — ordered logical-definition preferences. Resolution selects the first currently active collection; otherwise identity is neutral.
- **`user_featured_collections`** — owner-managed ordered showcase preferences. Public resolution includes only definitions the owner has earned and that are currently active; retaining inactive preferences keeps owner ordering stable across deactivation/reactivation.

### Constraints and indexes

- Unique slugs, definition versions, slot keys per version, awards, preferences, featured positions, and allocation per user/slot.
- Master definitions reject direct player slots; player-slot definitions reject prerequisite rows, including draft kind changes that would invalidate existing membership.
- Positive numeric checks on requirements/allocations and bounded progress basis points.
- Targeted indexes for catalog filters, live/final definitions, active states, user Trophy Case, slot-player lookup, active allocations, badge resolution, featured collections, and reconciliation by user/player.
- Generalize `holdings_locks.locked_quantity` to `numeric(20,4)`, add `collection` as a lock type, and make collection lock references globally unique with a partial index while preserving existing order-lock reference behavior.

### Legacy migration policy

- `user_collections` is not trustworthy enough to grant permanent awards: its rules are invented, non-versioned, non-sport-scoped, and based on mere possession.
- PR 1 is additive so it can be deployed safely.
- PR 2 disables the old evaluator/API, archives the old rows as legacy diagnostics, and removes the old client exports. No generic row is mapped to a factual statistical definition.
- Forward corrections use new definition versions; rollback leaves additive tables isolated until the new feature is enabled.

## 4. Lock/allocation strategy

**Recommendation: extend the current holdings-lock system rather than create a second availability ledger.**

1. Allocation uses an **absolute desired quantity** (`PUT` semantics), not an additive delta. Retries are naturally idempotent.
2. In one database transaction, the service locks the canonical ordinary holding row, the user/slot allocation row, and relevant active lock rows.
3. Available quantity is `ordinary holdings - active incompatible locks`. Stacked shares are absent from ordinary holdings and therefore cannot count. Collection locks prevent sell/order reservation/stacking/burn paths from consuming allocated shares.
4. Increasing allocation reserves only the difference; decreasing releases only the difference. The allocation and its `holdings_locks` row always agree.
5. The transaction reevaluates current state. Reaching 100% creates `ready`, not an award.
6. `POST .../complete` locks and revalidates every required slot, validates the current definition/version, inserts the unique immutable award, and transitions to `active`.
7. Removing any required allocation immediately lowers progress and makes an active collection inactive while preserving the award.
8. Events are returned from the transaction and published only after commit. Ownership-changing flows enqueue/trigger targeted reevaluation; a periodic job repairs missed work.

**Release default: immediate in v1.** There is no cash/share reward to farm, active score disappears immediately, and history does not drive primary rank. A cooldown would trap user-owned shares and add a pending-lock state without a demonstrated abuse case. Keep a configurable release-delay hook for later; if enabled, deactivation should occur when release is requested, not after the delay.

## 5. MLB data-source findings

Live probes on 2026-07-14 confirmed:

- `GET https://statsapi.mlb.com/api/v1/stats?stats=season&group=hitting&season=2025&sportIds=1&sortStat=homeRuns` returns historical player season totals.
- `playerPool=QUALIFIED&sortStat=onBasePlusSlugging` returns the official qualified OPS pool; the equivalent pitching query supports qualified ERA.
- `gameType=P` returns postseason aggregates.
- `teamId=<id>` restricts season stats to a team and supports team-season leader imports.
- 2026 season endpoints already return current live leaders, so tracking definitions are viable.
- `GET /api/v1/awards` exposes stable IDs including `ALSS`, `NLSS`, `ALGG`, `NLGG`, `MLBAFIRST`, and `MLBSECOND`; `/awards/{id}/recipients?season=2025` returned official player IDs and positions for Silver Slugger, Gold Glove, and All-MLB teams.
- The generic `/stats/leaders` endpoint can return multiple stat groups unless `statGroup` is explicit. The importer should prefer `/stats` with an explicit `group`, fetch enough rows, and apply tie-inclusive cutoffs itself.

Sportfolio's `player_game_stats.stats_json` stores HR, RBI, stolen bases, strikeouts, earned runs, converted innings pitched, saves, and related counting inputs. It can reproduce many counting totals as a validation source. It does **not** store all official rate-stat qualification inputs (for example sacrifice flies/complete plate appearances), and should not be the authority for finalized OPS or award membership.

Every imported member must resolve the StatsAPI person ID to a canonical `players.id` and be tradeable/available. Missing players fail the preview/publish step; they are never silently omitted or substituted.

## 6. Proposed first MLB catalog

### Final 2025 definitions

| Family          | Collection                            | Rule/source                                     | Initial slot quantity |
| --------------- | ------------------------------------- | ----------------------------------------------- | --------------------: |
| Season leaders  | 2025 MLB Home Run Leaders             | Top 10, ties at cutoff; StatsAPI season hitting |                    50 |
| Season leaders  | 2025 MLB RBI Leaders                  | Top 10, ties at cutoff                          |                    50 |
| Season leaders  | 2025 MLB OPS Leaders                  | Top 10 official qualified hitters, ties         |                    50 |
| Season leaders  | 2025 MLB Stolen Base Leaders          | Top 10, ties                                    |                    50 |
| Season leaders  | 2025 MLB Strikeout Leaders            | Top 10 pitchers, ties                           |                    50 |
| Season leaders  | 2025 MLB ERA Leaders                  | Top 10 official qualified pitchers, ties        |                    50 |
| Season leaders  | 2025 MLB Saves Leaders                | Top 10, ties                                    |                    50 |
| Threshold clubs | 2025 MLB 30 Home Run Club             | Every player with at least 30 HR                |                    20 |
| Threshold clubs | 2025 MLB 100 RBI Club                 | Every player with at least 100 RBI              |                    20 |
| Threshold clubs | 2025 MLB 200 Strikeout Club           | Every pitcher with at least 200 strikeouts      |                    20 |
| Official awards | 2025 MLB Silver Slugger Winners       | Combined `ALSS` + `NLSS` recipients             |                    30 |
| Official awards | 2025 MLB Gold Glove Winners           | Combined `ALGG` + `NLGG` recipients             |                    30 |
| Official teams  | 2025 All-MLB First Team               | `MLBAFIRST` recipients                          |                    30 |
| Postseason      | 2025 MLB Postseason Home Run Leaders  | Top 10 postseason totals, ties                  |                    35 |
| Postseason      | 2025 MLB Postseason Strikeout Leaders | Top 10 postseason totals, ties                  |                    35 |

### Live 2026 definitions

Launch tracking versions for HR, RBI, stolen bases, pitching strikeouts, ERA (qualified), OPS (qualified), and saves. Membership can change until finalization. When a slot changes, any old allocation is released to ordinary availability, the replacement slot is empty, and the user receives a membership-change explanation; shares are never redirected.

### Masters

- **2025 MLB Batting Leaders** — requires active HR, RBI, OPS, and stolen-base leader collections.
- **2025 MLB Pitching Leaders** — requires active strikeout, ERA, and saves leader collections.
- **2025 MLB Season Leaders** — requires both masters active.

Masters require no additional player locks and still use an explicit completion confirmation.

### Deferred from v1

- Team-season leader collections: technically supported by `teamId`, but 30 teams multiplied by categories creates a large catalog and content-operations burden. Pilot one team only after the global catalog is healthy.
- World Series starting lineups: definitions are ambiguous across games and require boxscore-by-boxscore review.
- Award finalists: leave out until a stable official finalist source and position/tie policy are documented.
- Utility rewards and cash/share payouts: visual identity, Trophy Case, active score, and rank are enough for v1.

Quantities and point values live on definition versions and remain content configuration, not source constants.

## 7. API and event design

### Public/read APIs

- `GET /api/collections` — filters by sport, league, season, family, lifecycle; cursor pagination.
- `GET /api/collections/:slug` — version, source/rule, slots, public active-collector count, and authenticated viewer progress when applicable.
- `GET /api/users/:id/collections` — active showcase plus Trophy Case; never unfinished progress.
- `POST /api/public-identities/resolve` — bounded batch user-ID resolution for leaderboards/activity; no N+1 profile calls.

### Owner/write APIs

- `GET /api/me/collections` — private progress, availability, and release state.
- `PUT /api/me/collections/:slug/slots/:slotId/allocation` — absolute decimal quantity; authenticated, transactional, idempotent.
- `DELETE /api/me/collections/:slug/slots/:slotId/allocation` — immediate release in v1.
- `POST /api/me/collections/:slug/complete` — deliberate, revalidated, idempotent completion/reactivation.
- `PUT /api/me/collection-badge-preferences` — ordered preferences.
- `PUT /api/me/featured-collections` — ordered earned-definition preferences; public reads filter to currently active entries.

### Admin APIs/scripts

Authenticated admin-only preview, create version, import slots, publish tracking, finalize, correct via new version, disable, reconcile, and participation-report operations. Source code is not edited to publish content.

### Errors

Machine codes include `INSUFFICIENT_AVAILABLE_SHARES`, `SLOT_PLAYER_MISMATCH`, `COLLECTION_NOT_ALLOCATABLE`, `DEFINITION_VERSION_CHANGED`, `COLLECTION_NOT_READY`, `ALLOCATION_CONFLICT`, and `IDEMPOTENCY_CONFLICT`.

### Events

`collection_progress_changed`, `collection_ready`, `collection_completed`, `collection_deactivated`, `collection_reactivated`, `displayed_badge_changed`, and `collection_membership_changed` are explicit WebSocket payloads emitted after commit. Clients invalidate the exact catalog/detail/profile/identity queries affected.

## 8. Public-profile redesign plan

### Information architecture

- **Overview:** collection-themed header, framed avatar, username, exact selected active badge, active collections, active score, collector rank, lifetime completions, featured active collections, compact market snapshot, top holdings/exposure, and notable public activity.
- **Collections:** active assembly/showcase first; permanent Trophy Case below with muted inactive treatment; group/filter by sport and season. Owner-only in-progress content is a clearly private collapsible section.
- **Portfolio:** preserve and reorganize current net worth, chart, performance, ranks, public holdings, and sport exposure.
- **Activity:** trades, notable Scout distributions, first completions, reactivations, badge changes, and meaningful rank movement—not allocation churn.

Owner controls move into compact management actions: edit profile, manage showcase, badge preferences, view as public, and share. Account/security/integration settings should move to a private settings surface rather than visually dominating `/user/:id`.

### Shared identity

A typed `PublicUserIdentity` payload and `UserIdentity` component support `micro`, `compact`, `ranked`, `featured`, and `profile` variants. Small avatars receive a badge pin; medium avatars receive a thin frame plus pin; large/profile variants use detailed but stable collection artwork. Desktop hover/mobile tap opens an accessible identity popover.

Only a currently active preferred collection can decorate identity. If it deactivates, resolution falls through to the next preference and then neutral. Premium retains a small crown/entitlement treatment and does not imitate collection crests.

## 9. Stacked PR breakdown

1. **PR 1 — Domain model and migration contract**
   - New versioned definition, slot, prerequisite, allocation, state, award, state-event, badge-preference, and featured tables.
   - Numeric collection requirements/allocations and generalized numeric holdings locks.
   - Constraints, indexes, finalized immutability protection, shared types/validators, migration/deprecation documentation, and schema tests.
2. **PR 2 — Allocation and evaluation backend**
   - Transactional absolute allocation/release, deliberate completion, active/inactive/reactivation lifecycle, master evaluation, badge fallback, machine errors, explicit events, ownership hooks, targeted reevaluation, safety reconciliation, old-system shutdown, and concurrency/economy tests.
3. **PR 3 — MLB content operations and first catalog**
   - Reusable StatsAPI client/importer, preview/validation, tradeable-player resolution, tie/qualified/postseason/award rules, live membership reconciliation, finalization/correction workflow, initial catalog seeds, admin operations, and source docs.
4. **PR 4 — Collection product pages**
   - Catalog/detail routes, private allocation controls, slot availability/progress, missing-player actions, ready/complete flow, collection-specific ceremony, finite/reduced motion, responsive/accessibility tests, and visual-system updates.
5. **PR 5 — Public profile and Trophy Case**
   - Overview/Collections/Portfolio/Activity IA, public/private boundaries, active showcase, archival Trophy Case, owner controls, settings separation, and responsive visual verification.
6. **PR 6 — Shared identity across Sportfolio**
   - Batch identity API, variants/popover, active badge frames/pins, leaderboard/activity/search integrations, preference fallback, caching/performance coverage, and premium-language cleanup.

Every PR receives focused RED-GREEN tests, `npm run check`, the full suite, independent spec/quality review, and—when UI-visible—browser screenshots at desktop/mobile and reduced-motion verification. PR heads are pushed separately; no merge is implied.

## 10. Risks and unresolved decisions

| Risk/decision                          | Recommendation                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Concurrent sell/order/stack/allocation | One ordinary-holding row lock and one lock ledger; add unique lock references and concurrency tests.                                            |
| Decimal precision                      | `numeric(20,4)` in DB; decimal strings at API boundary; never JS arithmetic for authoritative availability.                                     |
| Final-definition correction            | New explicit version only; never mutate final slots. Existing awards continue to point to the version completed.                                |
| Live membership churn                  | Release invalid allocations, empty replacement slots, explain the change, and reevaluate immediately.                                           |
| Badge rarity                           | Show **active collector count** in v1; keep completion count as historical metadata. Stable art never changes with rarity.                      |
| Ranking                                | Rank by active configured score; use lifetime completions only as secondary display/tie-break metadata.                                         |
| Release cooldown                       | Immediate release in v1; keep policy configurable but do not implement unused pending complexity.                                               |
| Exact share requirements               | Seed the defaults above but keep every slot value editable before finalization. Review participation before tuning.                             |
| Awards source stability                | Use known StatsAPI award IDs with imported source snapshots; fail preview on unexpected counts/shape changes.                                   |
| Historical player availability         | Publish only after every StatsAPI person maps to a canonical Sportfolio player and passes explicit availability policy.                         |
| Team collections                       | Defer broad rollout; framework supports them without hard-coding 30×N definitions.                                                              |
| Public committed-share totals          | Keep individual allocation quantities private in v1; public surfaces show active/inactive, score, completion date, and active collector count.  |
| First-completion reward                | Cosmetic ceremony/identity only in v1; reward metadata is schema-ready but no economic faucet is enabled.                                       |
| Master confirmation                    | Require explicit completion, consistent with ordinary collections, while prerequisites remain active.                                           |
| Scale                                  | Batch identities, index active state/preferences, target reevaluation by affected user/player, and retain periodic repair only as a safety net. |

The recommended defaults remove the remaining product ambiguity without hard-coding future sports. NFL, NBA, NHL, and NASCAR add source adapters and definition content; they do not require a second collection economy.
