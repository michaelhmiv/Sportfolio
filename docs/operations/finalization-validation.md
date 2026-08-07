# Sportfolio finalization validation

This record defines the release gate for the August 2026 platform consolidation.

A finalization commit is eligible for beta certification only after repository formatting, lint, TypeScript checking, unit/integration tests, production build, plugin-readiness checks, and security checks pass. Beta must then validate Better Auth passwordless web login, the device-bound native handoff, OAuth discovery/JWKS/dynamic client registration/consent, MCP read/write authorization, account lifecycle behavior, and the portable holding advisory-lock verifier against the shared Railway PostgreSQL database.

Production cutover is permitted only after beta certification. Supabase authentication credentials and retired Hermes/SMS/Telnyx variables are removed only after identity reconciliation and production Better Auth + Resend certification complete successfully.
