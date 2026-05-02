# AGENTS.md

Operational guidance for Factory droids working in this repository.

## Session Start Checklist

1. Review open issues:
   - `gh issue list --repo michaelhmiv/Sportfolio-Replit`
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

## Canonical Agent Docs (Read Before Domain Changes)

- `docs/wiki/agent/product-mechanics.md`
- `docs/wiki/agent/api-map.md`
- `docs/wiki/agent/data-model-economy.md`
- `docs/wiki/agent/runbooks.md`

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

## Power Levels (Critical Economic Primitive)

Power is modeled per holding row and directly impacts boost payouts.

### Data model

- `holdings.power` = per-share multiplier (integer; `1` means regular share).
- `holdings.powerLevel` = derived effective power (`quantity * power`, stored for compatibility/reporting).
- Regular and powered shares can exist as separate holding rows for the same player.

### Condense mechanic

- Route: `POST /api/holdings/condense`
- Rule: `sharesToCondense` must be `>= 2` and divisible by `2`.
- Conversion ratio: `2 raw shares -> +1 power gained`.
- Storage behavior (`condenseShares`):
  - debits regular shares (`power=1`) after lock checks,
  - creates/updates powered row (`power > 1`),
  - keeps `powerLevel` synchronized with quantity/power.

### Availability and lock semantics

- Available shares are effectively `quantity - lockedQuantity` for player holdings.
- Condense and boost flows must never consume locked shares.

### Boost interaction

- Daily boost assignment allows exactly `1` share per slot.
- Assignment selects an eligible holding row (prefers highest powered share when available).
- Stored boost `powerLevel` represents that single burned share's per-share power.
- Settlement uses that stored value in payout math (with slot tier and community multiplier effects).

### Invariants for any power-related change

1. Keep `powerLevel == quantity * power` consistent on every write path.
2. Preserve one-share-per-boost-slot behavior.
3. Keep lock checks in place before quantity/power mutations.
4. Validate impact on:
   - `/api/holdings/:playerId/power-level`
   - `/api/daily-boosts/eligible*`
   - `/api/daily-boosts/assign`

If your change affects economics, read `docs/wiki/agent/runbooks.md` first and follow the relevant checklist.

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
