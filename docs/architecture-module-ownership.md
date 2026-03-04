# Architecture Module Ownership Map

This complements `CODEOWNERS` by describing conceptual boundaries for review routing.

## Domains

- **Trading core**: `server/routes.ts`, `server/routes/amm.ts`, `server/routes/lp.ts`, `server/amm/`
- **Economy model**: `shared/schema.ts`, `server/storage.ts`, `server/jobs/settle-*.ts`
- **Agent runtime**: `server/agent/`, `client/src/features/agent/`
- **Data sync/jobs**: `server/jobs/sync-*.ts`, `server/jobs/scheduler.ts`
- **Frontend shell**: `client/src/App.tsx`, `client/src/pages/`
- **Observability/ops**: `server/observability/`, `.github/workflows/`, `scripts/`

## Review guidance

- Route/economy changes should include at least one reviewer familiar with AMM/boost/scout invariants.
- Agent runtime changes should include test updates in `server/agent/*.test.ts` when behavior changes.
- Schema changes should include migration and runbook impact checks.
