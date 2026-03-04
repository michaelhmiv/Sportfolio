# ADR 0001: Route and storage modularization for agent loops

- Status: Accepted
- Date: 2026-03-04

## Context

The repository has very large files (`server/routes.ts`, `server/storage.ts`) that make
plan-implement-test loops slower and riskier for both humans and coding agents.

## Decision

- Introduce a route module registration shim (`server/routes/register-domain-routes.ts`) to
  isolate secondary route registration from the core route body.
- Extract storage season-selection logic into `server/storage/season-utils.ts` as the first
  split step from `server/storage.ts`.
- Continue decomposing high-churn domains into dedicated modules in follow-up ADRs.

## Consequences

- Immediate reduction in top-level route orchestration noise.
- Creates a stable seam for future domain extraction without changing route behavior.
- Establishes a repeatable strategy for incremental storage decomposition.

## Validation

- Type-check, lint, tests, and format checks pass.
- Existing route registration behavior remains unchanged.
