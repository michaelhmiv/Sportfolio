# Sportfolio Copilot Instructions

Use these constraints when generating code or suggestions for this repository.

## Product Mechanics (Do Not Break)

- AMM uses constant-product logic (`x * y = k`) with fee split behavior.
- Scout rewards are time-weighted by scout-minutes.
- Vesting accrual depends on elapsed time plus residual milliseconds with caps.
- Daily boosts lock or burn shares at game start and settle post-game.
- `holdings.powerLevel` must remain `quantity * power` on all write paths.
- Boost slots burn exactly one share per slot, using the selected holding row.

## Data and API Touchpoints

- Primary route files: `server/routes.ts`, `server/routes/amm.ts`, `server/routes/lp.ts`
- Core domain model: `shared/schema.ts`
- AMM internals: `server/amm/pool.ts`
- Jobs: `server/jobs/`

If adding or changing sports-provider integration behavior, confirm contract details with:

- `https://www.balldontlie.io/openapi.yml`

## Auth and Security

- Keep `isAuthenticated`, `optionalAuth`, and `adminAuth` protections intact.
- Do not loosen auth checks on existing protected endpoints.
- Never expose secrets or tokens in code, logs, or output.

## Workflow Expectations

- Prefer minimal, targeted edits using existing patterns.
- Before shipping a change, run:
  - `npm run check`
  - `npm run lint`
  - `npm run test:run`
  - `npm run format:check` (when formatting-sensitive files change)

## Useful Local Commands

- Start app: `npm run dev`
- Worktree bootstrap: `npm run worktree:new -- <name>`
- PR and check status: `npm run gh:pr:status`
