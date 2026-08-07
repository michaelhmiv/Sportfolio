# ADR: passwordless authentication and canonical identity

Status: accepted for implementation.

## Decision

Sportfolio will replace Supabase Auth and Supabase OAuth with Better Auth backed by Railway Postgres. Resend will deliver passwordless email links. Passwordless email will be the only public login method after cutover.

Existing Sportfolio `users.id` remains the canonical application and game identity. Better Auth user identifiers are authentication-system identifiers and will map to canonical users through an explicit `auth_identities` table. Existing game foreign keys will not be rewritten.

Web sessions will use secure, same-origin, HttpOnly cookies. JavaScript will not receive reusable web session credentials. MCP bearer tokens remain a separate OAuth resource-server mechanism and will resolve their subject through `auth_identities`.

Supabase fallback is temporary. It may be consulted only after Better Auth session and MCP-route resolution, and it may not override an active Better Auth session.

Beta and production intentionally share production Railway Postgres. Beta is a controlled application surface, not a disposable sandbox. Additive schema is allowed after review, but destructive rehearsals and synthetic bulk imports are prohibited. Migration execution is production-runtime-only and is protected by the runtime confirmations added in PR #382.

Authorization is same-origin with each application surface: beta uses `https://beta.sportfolio.market/api/auth/better` and production uses `https://www.sportfolio.market/api/auth/better`. This removes a separate authorization subdomain, keeps cookies same-origin, and avoids an unnecessary DNS/TLS dependency. Resend sends from the verified `sportfolio.market` domain.

## Compatibility decision

Use exact matching stable versions of `better-auth` and `@better-auth/oauth-provider`. Current Better Auth requires Zod 4 through `better-call`, so Sportfolio also pins Zod 4 and the Zod 4-compatible `drizzle-zod` release rather than bypassing peer-dependency checks. Use the current OAuth Provider plugin rather than the deprecated Better Auth MCP provider. Keep PKCE enabled, allow public-client registration only through reviewed OAuth Provider mechanisms, require explicit scopes, preserve OAuth `resource`, validate JWT `aud`, rotate refresh tokens, expose JWKS, and support consent and revocation.

## Rollback boundary

Until the cutover PR changes runtime flags, production remains Supabase-only. This PR adds package-level compatibility evidence and documentation only: no public Better Auth route, Railway migration, login switch, or OAuth issuer switch.
