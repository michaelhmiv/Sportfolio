# Supabase removal checklist

Removal is blocked until the production cutover and rollback-retention window complete.

- [ ] Replace client login, callback, logout and session refresh.
- [ ] Replace server token verification and provider-subject assumptions.
- [ ] Replace Supabase OAuth discovery, issuer, audience hook and consent operations.
- [ ] Replace MCP token verification while preserving `req.pluginAuth`.
- [ ] Replace Android and iOS session/deep-link behavior.
- [ ] Replace Supabase Admin account deletion and revocation.
- [ ] Import identities without passwords, access tokens, refresh tokens or active sessions.
- [ ] Verify every Better Auth identity maps to one existing canonical `users.id`.
- [ ] Remove `@supabase/supabase-js`.
- [ ] Remove `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] Remove Supabase SQL hooks, verification scripts and active documentation.
- [ ] Run `npm run auth:supabase-inventory` and require zero active references.
- [ ] Confirm no runtime traffic reaches a Supabase domain.
- [ ] Retain exports and rollback evidence according to the cutover runbook.
