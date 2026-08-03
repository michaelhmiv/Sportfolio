# Supabase OAuth Setup for the Sportfolio Plugin

## Current project

- Project: `Sportfolio`
- Project ref: `xolfyrbtkmwgllrazcfh`
- OAuth issuer: `https://xolfyrbtkmwgllrazcfh.supabase.co/auth/v1`
- Discovery endpoint: `https://xolfyrbtkmwgllrazcfh.supabase.co/.well-known/oauth-authorization-server/auth/v1`
- JWKS endpoint: `https://xolfyrbtkmwgllrazcfh.supabase.co/auth/v1/.well-known/jwks.json`

The Auth database already contains Supabase OAuth tables for clients, authorizations, consents, PKCE, and the OAuth `resource` parameter. No OAuth clients are currently registered.

## Dashboard configuration required

The Supabase management connector does not currently expose OAuth Server configuration or JWT signing-key mutation. Complete these steps in the Supabase dashboard:

1. Open **Authentication → OAuth Server**.
2. Enable OAuth 2.1 Server.
3. Set the authorization path to `/oauth/consent`.
4. Enable dynamic client registration for staging compatibility testing.
5. Require explicit user consent.
6. Open **Authentication → Signing Keys**.
7. Add and activate an asymmetric RS256 or ES256 signing key.
8. Confirm the project Site URL is the canonical Sportfolio web URL.
9. Do not manually register a production ChatGPT client until the submission portal provides the exact callback and client requirements.

## Compatibility probe

Run:

```bash
PLUGIN_OAUTH_ISSUER=https://xolfyrbtkmwgllrazcfh.supabase.co/auth/v1 \
  npx tsx scripts/plugin-oauth-discovery-check.ts
```

The probe verifies:

- exact issuer matching;
- HTTPS authorization, token, and JWKS endpoints;
- dynamic client registration advertisement;
- authorization-code and refresh-token grants;
- code response support;
- PKCE S256 support;
- public-client token authentication support;
- asymmetric JWKS availability.

## Additional end-to-end checks

Discovery is necessary but not sufficient. Before enabling the production plugin endpoint, verify:

1. Dynamic registration accepts the ChatGPT client metadata and exact callback URI.
2. Authorization requests preserve and validate the OAuth `resource` value.
3. The consent page receives `authorization_id` and displays the requesting client and scopes.
4. Code exchange requires the matching PKCE verifier.
5. Refresh-token rotation works.
6. Grant revocation prevents later refresh.
7. Access tokens contain the expected `iss`, `sub`, `client_id`, `exp`, and `aud` claims.
8. Tokens with a different audience are rejected by Sportfolio.
9. Access tokens do not need `email`, `phone`, or `profile` scopes for normal marketplace tools.
10. OAuth logs and application logs never include authorization codes, access tokens, refresh tokens, or full callback URLs containing secrets.

## Audience customization

Supabase OAuth access tokens normally use the standard Supabase audience. The Sportfolio MCP resource server requires an audience dedicated to:

```text
https://www.sportfolio.market/mcp/plugin
```

Use a Supabase Custom Access Token Hook keyed by OAuth `client_id` to set the plugin audience once the final ChatGPT client-registration method is known. The hook must leave normal Sportfolio web and mobile sessions unchanged.

## Decision gate

Proceed with Supabase when all compatibility checks pass.

If dynamic registration, `resource`, audience, or callback behavior cannot satisfy the OpenAI MCP authentication contract, stop and select an established OAuth provider with explicit MCP support rather than implementing a custom authorization server.
