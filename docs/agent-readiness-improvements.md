# Agent Readiness Improvements (Implemented)

This tracks implementation progress for the previously proposed top 10 improvements.

1. **Split routes by boundaries (initial step)**
   - Added `server/routes/register-domain-routes.ts` and switched `server/routes.ts` to use it.
2. **Split storage boundaries (initial step)**
   - Extracted season helper into `server/storage/season-utils.ts`.
3. **Coverage thresholds**
   - Added thresholds in `vitest.config.ts` and CI `test:coverage` enforcement.
4. **Deterministic smoke loop**
   - Added `scripts/agent-readiness-smoke.mjs` + `npm run qa:smoke`.
5. **Architecture decisions (ADRs)**
   - Added ADR framework and first decision in `docs/adr/`.
6. **OpenAPI contract for internal APIs**
   - Added `docs/openapi/internal-api.yaml` and validation script.
7. **Module ownership map**
   - Rebuilt `CODEOWNERS` and added `docs/architecture-module-ownership.md`.
8. **Per-domain invariant checks**
   - Added `scripts/check-agent-invariants.mjs` + `npm run invariants:check`.
9. **Docs normalization cleanup**
   - Rewrote `README.md` to remove corruption/duplication.
10. **Agent sandbox fixture dataset**

- Added fixture under `tests/fixtures/agent/` and wired a deterministic test case.

11. **Autonomous improvement loop**
    - Added `npm run agent:debug` and `npm run agent:improve` for deterministic debug → remediation cycles.
