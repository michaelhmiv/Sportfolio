# AGENTS.md

Operational guidance for Factory droids working in this repository.

## Session Start Checklist

1. Review open issues:
   - `gh issue list --repo michaelhmiv/Sportfolio`
2. Read project rules in `CLAUDE.md`.
3. For any non-trivial task (3+ steps, architecture, or cross-file change), create a plan first.
4. Use task tracking files:
   - `tasks/todo.md`
   - `tasks/lessons.md`

## Project Snapshot

- Product: Sportfolio (sports trading + fantasy mechanics)
- Stack: React + TanStack Query + Wouter, Express, Drizzle/Postgres
- Real-time: WebSocket (`/ws`)
- Runtime: TypeScript throughout (`client/`, `server/`, `shared/`)
- Key mode: AMM-first trading + LP support

## Canonical Domain Docs (Read Before Changes)

- `docs/architecture-module-ownership.md`
- `docs/wiki/gameplay/player-pools.md`
- `docs/wiki/gameplay/portfolio-and-holdings.md`
- `docs/wiki/gameplay/liquidity-providing.md`
- `docs/wiki/gameplay/scouts-and-rewards.md`
- `docs/wiki/features/user-action-surface.md`

## External Sports Data Contract (BallDontLie)

When answering provider API questions or adding a new sport/data flow, consult the upstream OpenAPI spec first:

- `https://www.balldontlie.io/openapi.yml`

Use it to confirm:

- endpoint availability by sport,
- request params and response schema,
- game/status enum semantics,
- pagination/rate-limit expectations.

Then map the confirmed contract into our ingestion/sync paths before changing route behavior.

Primary source-of-truth code:

- API surface: `server/routes.ts`, `server/routes/amm.ts`, `server/routes/lp.ts`
- Domain model: `shared/schema.ts`
- Core economics: `server/amm/pool.ts`, `shared/vesting-utils.ts`
- Background loops: `server/jobs/`

## Product-Critical Mechanics (Do Not Break)

1. **AMM/LP invariants**
   - Constant-product pool (`x * y = k`) for instant trading.
   - Trade fees are split (pool fee + burn fee) in current AMM logic.
2. **Scout distribution**
   - Hourly distribution is proportional to scout-minutes (time-weighted).
3. **Vesting accrual**
   - Accrual uses elapsed time + residual milliseconds with hard caps.
4. **Boost lifecycle**
   - Daily boosts lock/burn shares at game start and settle post-game.
   - Community boosts modify daily boost multipliers.

## Stacked Shares (Critical Economic Primitive)

Stacked-share multiplier state is separate from regular tradeable holdings and directly impacts boost payouts.

### Data model

- `holdings` stores regular per-user asset quantity and cost basis; it has no `power` or `powerLevel` columns.
- `player_multipliers` stores one non-tradeable stacked-share record per `userId + playerId`, including its effective `multiplier` and retained cost basis.
- `player_multiplier_events` is the immutable ledger for stacking and stacked-share burn events.

### Stack mechanic

- Route: `POST /api/holdings/stack-shares`
- Rule: `sharesToStack` must be an even integer of at least `4`.
- Conversion: stacking `N` regular shares adds `N / 2` to the player's multiplier and keeps one stacked-share record.
- Storage behavior (`stackShares`):
  - checks locked quantities before consuming regular shares,
  - updates or creates the canonical `player_multipliers` row,
  - records cost-basis and supply changes in `player_multiplier_events`.

### Availability and lock semantics

- Available regular shares are `holdings.quantity - holdings_locks.lockedQuantity`.
- Stacking and boost flows must never consume locked regular shares.

### Boost interaction

- Daily boost assignment allows exactly `1` share per slot.
- A boost records whether the selected source is `regular` or `stacked` and snapshots its `shareMultiplier`.
- Locking a stacked source burns the canonical multiplier record, records a `boost_burn` event, and preserves the multiplier snapshot for settlement.

### Invariants for stacked-share changes

1. Keep regular holdings, `player_multipliers`, player supply, and multiplier-event ledgers reconciled.
2. Preserve one-share-per-boost-slot behavior and the stored multiplier snapshot.
3. Keep lock checks in place before regular-share mutations.
4. Validate impact on:
   - `/api/holdings/:playerId/multiplier-state`
   - `/api/holdings/stack-shares`
   - `/api/daily-boosts/eligible*`
   - `/api/daily-boosts/assign`

If your change affects economics, read the applicable gameplay handbook chapters and migration runbooks first.

## Auth & Access Patterns

- `isAuthenticated`: required user JWT/dev-bypass auth.
- `optionalAuth`: enriches user context when token exists.
- `adminAuth`: admin-only routes (JWT admin user or admin API token).

Never reduce auth checks on existing protected endpoints without explicit instruction.

## Working Rules

- Use existing patterns before introducing new abstractions.
- Keep changes minimal and targeted.
- Never expose secrets/tokens in logs or responses.
- Prefer existing libs/utilities over adding new dependencies.
- For user-facing feature work, think like a Sportfolio player using the product live:
  - tie sports data back to owned shares, boosts, and portfolio relevance,
  - prefer lifecycle-appropriate game context over generic stat dumps,
  - keep optional enrichment providers display-only unless they are explicitly promoted into gameplay logic.

## Supabase CLI Note

- For Supabase CLI project targeting, use `SUPABASE_URL` as the source-of-truth environment variable.
- When running DB migration commands (for example `supabase db push --db-url`), use the Postgres connection string from Supabase project settings.

## Validation Before Completion

Run these from repo root unless the user says otherwise:

1. `npm run check`
2. `npm run lint`
3. `npm run test:run`

For formatting-sensitive edits, also run:

- `npm run format:check`

If a command fails, report the failure and whether it is pre-existing or introduced by your change.

## Git Safety

Before commit/push:

1. `git diff --cached`
2. `git status`
3. Verify no credentials, keys, tokens, or secrets are included.

## Deployment Safety

- GitHub is the deployment source of truth for Sportfolio.
- Always push changes to GitHub first, then let Railway pick them up from the tracked branch.
- Do not deploy local-only snapshots directly to Railway with `railway up`.
- If production behavior needs verification, compare the live Railway deployment against the GitHub commit/PR that is intended to own that change.

## Custom Droids Available

- `code-quality-reviewer`
- `documentation-accuracy-reviewer`
- `git-summarizer`
- `performance-reviewer`
- `pr-readiness-reviewer`
- `release-notes-writer`
- `security-code-reviewer`
- `test-coverage-reviewer`
- `test-plan-writer`
- `todo-fixme-scanner`
