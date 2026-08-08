# ADR: passwordless authentication and canonical identity

Status: implemented.

## Decision

Sportfolio uses Better Auth backed by Railway Postgres. Resend delivers passwordless email links. Passwordless email is the only public login method; password authentication and social login are intentionally unsupported.

Existing Sportfolio `users.id` remains the canonical application and game identity. Better Auth user identifiers are authentication-system identifiers and map to canonical users through the explicit `auth_identities` table. Existing game foreign keys are not rewritten.

Web sessions use secure, same-origin, HttpOnly cookies. JavaScript does not receive reusable web session credentials. MCP bearer tokens remain a separate OAuth resource-server mechanism and resolve their subject through `auth_identities`.

Better Auth is the sole authentication provider. Supabase authentication, OAuth, fallback token acceptance, provider selection, and Supabase runtime credentials are permanently retired.

Beta and production intentionally share production Railway Postgres. Beta is a controlled application surface, not a disposable sandbox. Additive schema is allowed after review, but destructive rehearsals and synthetic bulk imports are prohibited. Migration execution is production-runtime-only and is protected by explicit runtime confirmations.

Authorization is same-origin with each application surface: beta uses `https://beta.sportfolio.market/api/auth/better` and production uses `https://www.sportfolio.market/api/auth/better`. There is no dedicated authorization hostname. This keeps cookies same-origin and avoids an unnecessary DNS/TLS dependency. Resend sends from the verified `sportfolio.market` domain.

## Compatibility decision

Use exact matching stable versions of `better-auth` and `@better-auth/oauth-provider`. Better Auth requires Zod 4 through `better-call`, so Sportfolio pins Zod 4 and the Zod 4-compatible `drizzle-zod` release rather than bypassing peer-dependency checks. Use the current OAuth Provider plugin rather than the deprecated Better Auth MCP provider. Keep PKCE enabled, allow public-client registration only through reviewed OAuth Provider mechanisms, require explicit scopes, preserve OAuth `resource`, validate JWT `aud`, rotate refresh tokens, expose JWKS, and support consent and revocation.

The canonical MCP resource is `https://www.sportfolio.market/mcp/plugin`. Production OAuth discovery and JWKS are certified by the repository's live compatibility workflow, while beta uses the same code with beta-specific same-origin issuer configuration.
