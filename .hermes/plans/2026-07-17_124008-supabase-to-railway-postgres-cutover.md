# Sportfolio Supabase → Railway PostgreSQL Cutover Implementation Plan

> **For Hermes:** Resume from the “Current checkpoint” and “Next actions” sections. Use the `sportfolio-dev`, `railway`, `subagent-driven-development`, `test-driven-development`, and review skills as relevant. Never work directly on local `beta`; use `feat/*` branches and PRs to `beta`, phone/PWA verification, then merge to `main`.

**Goal:** Make Railway PostgreSQL the single source of truth for all Sportfolio application data while retaining Supabase Auth only, repairing historical duplicate scout payouts, and guaranteeing only one scheduler owns recurring writes.

**Architecture:** Supabase remains the identity provider. React continues using Supabase only for authentication; Express resolves authenticated identities and performs every application-data operation against Railway PostgreSQL. A database advisory-lock singleton plus explicit `RUN_SCHEDULED_JOBS` ownership prevents duplicate scheduler execution. Cutover uses a coordinated write freeze, transactional dump/restore, structural and row parity verification, runtime smoke tests, and a timed rollback window.

**Tech stack:** React, Express, TypeScript, Drizzle ORM, PostgreSQL, Supabase Auth, Railway, Vitest, GitHub Actions.

---

## Non-negotiable constraints

- Canonical baseline for this program: `origin/beta` at `b0b30755ad172e22c89afea87aa44923301b280b`.
- Never commit or force-push local `beta`.
- Feature branches → PR to `beta` → verify beta on phone/PWA → PR/merge to `main`.
- Supabase Auth remains unchanged; no front-end auth migration.
- Entire PostgreSQL `public` schema moves as one atomic unit, including `public.users`.
- Railway PostgreSQL becomes the only application-data source of truth.
- Remove RLS policies and application-schema dependencies on `auth.uid()` during restore.
- No AMM pool bootstrapping or pre-funding.
- Duplicate or inconsistent financial/gameplay records are release blockers.
- Do not expose database URLs or dumps in process arguments, logs, manifests, or world-readable files.
- Do not destroy rollback data until the rollback window closes and Michael authorizes billing cleanup.

## Current checkpoint — 2026-07-17 14:40 UTC

**All preparation phases (p1–p5) complete. Moving to production cutover (p6).**

### Completed

- **PRs #273–#276** all merged into `beta`. Beta redeployed with `RUN_SCHEDULED_JOBS=false`.
- **Duplicate repair executed**: 8,605 duplicate `scout_distributions` rows deleted, 513,466 excess shares removed. Holdings confirmed correct (no negative quantities).
- **Migration tooling hardened**: secure artifact permissions (0700/0600), cross-version schema fingerprint normalization (PG 17→18), SHA-256 integrity, no remaining blockers.
- **Full rehearsal**: dump/restore/verify succeeded against Railway PG 18 target.
- **Beta service**: running normally with scheduler disabled, commit `5193767` (merge of all 4 PRs).

### Next: Phase 2 — Production cutover

1. Provision production Railway PostgreSQL service.
2. Activate maintenance mode (write freeze) on production.
3. Dump + restore + verify from Supabase → Railway PG.
4. Swap `DATABASE_URL` on production Sportfolio service.
5. Remove RLS policies.
6. Tune connection pool for Railway (20–30 vs Supabase pooler max 5).
7. Verify auth, gameplay, scheduler on new DB.
8. Decommission rehearsal PostgreSQL service.

- PR #275 — scout distribution identity/idempotency, branch `feat/scout-distribution-idempotent`, reviewed checkpoint `93eb193` is **blocked pending further remediation**.
- PR #276 — maintenance/migration tooling, branch `feat/maintenance-migration-tooling`, reviewed checkpoint `57d8641` is **blocked pending further remediation**.

### Rehearsal status

- Disposable Railway PostgreSQL was provisioned and restored from a full Supabase snapshot.
- Hardened rehearsal artifacts: `/tmp/sportfolio-hardened-rehearsal-20260717`.
- Runtime auth env: `/tmp/sportfolio-auth-rehearsal.env`.
- Railway target variables snapshot: `/tmp/railway-postgres-vars.json`.
- Dump, transactional restore, RLS stripping, definition inventory, and runtime read smoke tests passed.
- `/api/health` reached ready and `/api/players?limit=1` returned database-backed data.
- Maintenance mode blocked POST writes before body parsing across API, MCP, internal, and webhook paths while leaving reads available.
- Rehearsal PostgreSQL must be destroyed after final verification; do not destroy it prematurely.

## Active blockers from frozen adversarial reviews

### PR #275 — scout distribution

1. Claims are keyed by mutable canonical player IDs. A later alias redirect can re-key an already-paid economic event and permit a second claim. Fix with a permanent identity key or atomic claim/ledger reconciliation during alias mutation.
2. Scout credits can be lost against concurrent AMM holding writers because other mutation paths do not share the new locking/update discipline. Centralize all holding mutations behind row locking plus atomic SQL arithmetic, including sell-to-pool, direct trades, admin/reset paths, and any other quantity writer.
3. Migration quiescence must cover every public ledger writer, not only scout distribution.
4. Add concurrency tests proving no lost update across scout credit versus each relevant holding writer.
5. Add alias-after-payment regression coverage proving retry cannot double-credit.

### PR #276 — migration tooling

1. Normalize PostgreSQL identity comparison using lowercase host, effective port `5432`, and decoded database name; omitted port and explicit `:5432` must be treated as the same database before any target connection.
2. Create artifact directories as `0700`, files as `0600`, and reject insecure pre-existing artifact directories/files.
3. Include check-constraint expressions in structural fingerprints.
4. Include sequence ownership and state (`last_value`/effective state as appropriate) in verification or explicitly reconcile and verify sequences after restore.
5. Add focused tests for all cases above and rerun the complete rehearsal from a fresh target.

## Execution plan

### Phase 1 — Finish code containment and review

- [ ] Receive and inspect delegated remediation in `/data/Sportfolio-scout-idempotency` and `/data/Sportfolio-maintenance`.
- [ ] Verify each changed worktree is clean before edits and only expected files changed afterward.
- [ ] Run focused RED/GREEN tests for every blocker.
- [ ] Run full build, focused suites, ESLint, Prettier check, and `git diff --check`.
- [ ] Commit and push only from the feature branches.
- [ ] Dispatch fresh SHA-locked adversarial reviews for PR #275 and PR #276.
- [ ] Repeat remediation/review until both verdicts are PASS.
- [ ] Confirm PR #273 and PR #274 checks are still green and mergeable.

### Phase 2 — Design and rehearse duplicate-payout repair

- [ ] Freeze a read-only audit snapshot of duplicate natural keys `(hour_timestamp, player_id/immutable_identity, user_id)`.
- [ ] Trace each duplicate payout through `scout_distributions`, holdings, player totals, and any corresponding transaction/ledger tables.
- [ ] Prove the exact excess amount per user/player/event instead of assuming every downstream table was doubled identically.
- [ ] Write a transaction-safe repair script that preserves one canonical event and reverses only the excess credit.
- [ ] Refuse repair if resulting quantity, basis, balance, or aggregate would be negative or if cardinality differs from the audited one-to-one duplicate pattern.
- [ ] Add dry-run JSON output with before/after checksums and counts.
- [ ] Run repair only on the disposable Railway rehearsal copy first.
- [ ] Verify no duplicate natural keys, no negative values, and aggregate reconciliation after rehearsal repair.
- [ ] Obtain a fresh adversarial data-integrity review of the repair artifact.

### Phase 3 — Merge to beta and restore beta safely

- [ ] Merge approved PRs #273–#276 to `beta` through GitHub; never push directly to `beta`.
- [ ] Configure beta `RUN_SCHEDULED_JOBS=false` with `skipDeploys:true`.
- [ ] Configure beta pool size appropriate for Railway (initial target 20 only after connection-budget verification).
- [ ] Restore `Sportfolio-Beta` start command from `sleep infinity` to platform default/intended application command and restart policy from `NEVER` to `ON_FAILURE`.
- [ ] Redeploy beta and verify the running commit SHA.
- [ ] Read Railway `environmentLogs` and confirm “Automatic scheduled work disabled.”
- [ ] Verify beta has no scout/job execution rows over at least one scheduler boundary.
- [ ] Phone/PWA test sign-in, portfolio, player pages, trading, scouting reads, and reconnect behavior.

### Phase 4 — Final fresh migration rehearsal

- [ ] Provision or truncate a fresh disposable Railway PostgreSQL target.
- [ ] Run hardened dump with artifact permissions verified as `0700/0600`.
- [ ] Restore transactionally with source/target self-guard.
- [ ] Strip RLS/policies and reject residual `auth.uid()` application-schema references.
- [ ] Verify tables, columns, constraints including CHECK expressions, indexes, functions, triggers, sequences, FK validity, row counts, and checksums.
- [ ] Apply the duplicate-payout repair in rehearsal and verify its audit report.
- [ ] Start app with Supabase Auth variables and Railway `DATABASE_URL`; leave scheduled jobs off.
- [ ] Exercise unauthenticated and authenticated runtime contracts where credentials are available.
- [ ] Exercise gameplay reads and a controlled reversible write transaction.
- [ ] Start one scheduler owner, verify advisory-lock ownership, and prove a second instance cannot run jobs.
- [ ] Execute and document a rollback drill from Railway back to a disposable Supabase-compatible PostgreSQL target.

### Phase 5 — Beta → main release gate

- [ ] Merge verified `beta` to `main` via PR after phone/PWA acceptance.
- [ ] Confirm main CI and production build pass.
- [ ] Prepare exact cutover variable matrix for production and beta.
- [ ] Record pre-cutover Supabase and Railway connection identities without secrets.
- [ ] Record last accepted source write timestamp and backup artifact hashes.
- [ ] Confirm rollback decision owner, timeout, and trigger thresholds.

### Phase 6 — Coordinated production cutover

- [ ] Enable `MAINTENANCE_MODE=true` on every application deployment connected to the source.
- [ ] Stop all scheduler ownership and background writers.
- [ ] Verify source write quiescence from database activity and ledger timestamps.
- [ ] Take final secure dump and inventory.
- [ ] Restore into production Railway PostgreSQL transactionally.
- [ ] Apply the reviewed duplicate-payout correction to the target as part of the controlled cutover, not ad hoc on the live source.
- [ ] Run full parity and financial/gameplay reconciliation.
- [ ] Set production `DATABASE_URL` to Railway and tune pool limits within the database connection budget.
- [ ] Keep beta `RUN_SCHEDULED_JOBS=false`; set exactly one production scheduler owner to `true`.
- [ ] Deploy production, verify runtime commit SHA and logs, then disable maintenance mode.
- [ ] Keep Supabase Auth URL/anon/service-role configuration unchanged.

### Phase 7 — Post-cutover verification

- [ ] Verify Supabase login/session refresh/logout and app-user mapping.
- [ ] Verify portfolio balances, holdings, marketplace, player stats, scouting, trades, AMM behavior, and admin workflows.
- [ ] Verify exactly one scheduler lock owner and one execution row per scheduled job/window.
- [ ] Verify no application-data writes reach Supabase after cutover.
- [ ] Monitor HTTP errors, PostgreSQL errors, pool exhaustion, lock waits, duplicate constraints, negative values, and reconciliation totals.
- [ ] Keep rollback artifacts immutable throughout the rollback window.

### Phase 8 — Rollback-window close and cleanup

- [ ] Complete final backup-restore drill from Railway artifacts.
- [ ] Get explicit authorization before deleting any source/rollback resource or reducing Supabase billing.
- [ ] Remove Supabase database usage while retaining Supabase Auth configuration and required auth project resources.
- [ ] Destroy disposable rehearsal PostgreSQL service.
- [ ] Remove temporary dump/auth files securely.
- [ ] Document final topology, scheduler owner, pool budget, backup process, and incident correction report.

## Verification commands and evidence

Use exact commands already represented in repository scripts/runbook where possible:

```bash
npm run build
npm test -- --run <focused-test-files>
npm exec eslint -- <changed-source-files>
npm exec prettier -- <changed-files> --check
git diff --check
npm run db:migration:dump
npm run db:migration:restore
npm run db:migration:verify
```

Database integrity gates:

- Duplicate natural scout-event groups: `0` after repair.
- Duplicate holding keys: `0`.
- Negative holding quantities: `0`.
- Negative cost basis: `0`.
- Negative user balances: `0`.
- Alias cycles: `0`.
- Residual RLS policies on Railway application tables: `0`.
- Residual application-schema `auth.uid()` references: `0`.
- Scheduled job executions per window: exactly `1` for the elected owner.

## Resume checklist for a new session

1. Read this file.
2. Inspect `todo` state and current branch/worktree status.
3. Check Railway `Sportfolio-Beta` still uses `sleep infinity`; do not accidentally restore it before scheduler gating is deployed.
4. Re-run the live duplicate query to establish whether containment stopped new rows after `2026-07-17 12:00:00` UTC.
5. Inspect delegated remediation results before making overlapping edits.
6. Do not treat PR #275 or #276 as approved until a fresh SHA-locked reviewer returns PASS.
7. Continue from Phase 1, then Phase 2; do not jump directly to production cutover.
