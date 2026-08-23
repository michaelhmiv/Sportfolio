# Sportfolio finalization validation

This record defines the release gate for the August 2026 platform consolidation.

A finalization commit is eligible for beta certification only after repository formatting, lint, retired-runtime audit, TypeScript checking, unit/integration tests, production build, plugin-readiness checks, and security checks pass. Beta must then validate Better Auth passwordless web login, the device-bound native handoff, OAuth discovery/JWKS/dynamic client registration/consent, MCP read/write authorization, account lifecycle behavior, and the portable holding advisory-lock verifier against the shared Railway PostgreSQL database.

Production uses Better Auth backed by Railway PostgreSQL. Legacy provider credentials and former orchestration or messaging variables are not part of the active deployment configuration; any historical migration record remains archival only.
