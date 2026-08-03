# Sportfolio plugin readiness report

Status date: August 3, 2026

## Implemented in the stacked PR series

- Separate, feature-gated `/mcp/plugin` endpoint that does not alter the existing `/mcp` contract
- Supabase OAuth 2.1 discovery, PKCE, DCR, asymmetric JWKS, consent UI, grant revocation, JWT verification, and MCP authentication challenges
- Static 22-tool read-only marketplace catalog with explicit security schemes, annotations, output schemas, sanitization, and catalog snapshots
- Marketplace-specific Sportfolio skill with credential, write, gambling, and real-money safeguards
- Public privacy, terms, plugin documentation, and support pages
- Plugin package manifest, app binding template, and local marketplace entry
- Protocol regression, privacy, metadata, package, submission, OAuth, dependency-security, and nightly readiness checks
- Rate limiting, concurrency control, deadlines, health reporting, and plugin metrics
- Reviewer listing copy, five positive cases, three negative cases, demo-account fixture, release notes, and policy worksheet

## Verified

- Supabase project is active and healthy.
- OAuth Server is enabled with `/oauth/consent` and dynamic client registration.
- P-256/ES256 public signing keys are available through JWKS.
- Live OAuth discovery and JWKS certification passes.
- The audience-hook table and Postgres hook function are deployed with an empty allowlist, so they do not alter existing tokens.
- Every public-schema table has RLS enabled and the `anon` and `authenticated` Data API roles have zero table grants.
- Mutable database-function search paths and broad avatar-bucket listing were remediated.
- Critical production dependency advisories were remediated through a non-breaking lockfile update that passed build, unit, and MCP regression testing.
- The existing Sportfolio MCP remains a separate route and registry.
- The permanent Plugin Readiness workflow passes all four jobs on the release-candidate head:
  - repository and plugin TypeScript certification, production build, unit tests, catalog/package/privacy/submission audits, and release-gate reporting;
  - existing MCP audit and smoke plus marketplace MCP smoke;
  - critical production dependency audit;
  - live Supabase OAuth discovery and JWKS compatibility.

## External release blockers

1. Deploy the stacked code to the production Sportfolio service with `PLUGIN_MCP_ENABLED=true`.
2. Register the production MCP in ChatGPT developer mode and replace the `.app.json` placeholder with the assigned `plugin_asdk_app...` ID.
3. Receive and configure the OpenAI domain-verification challenge token.
4. Identify the final registered OAuth client ID, add it to `public.plugin_oauth_clients`, set `PLUGIN_OAUTH_ALLOWED_CLIENT_IDS`, and enable `public.sportfolio_plugin_access_token_hook` under Supabase Authentication → Hooks → Custom Access Token.
5. Create and seed the synthetic reviewer account; keep credentials out of Git and provide them only through the submission portal.
6. Enable Supabase leaked-password protection in Authentication settings.
7. Complete final legal review of policy text and initial United States availability.
8. Add final marketplace artwork and screenshots that reflect the deployed version 1 product.
9. Run all eight submission cases in fresh ChatGPT conversations and freeze the final MCP and skill snapshots.
10. Confirm publisher identity and Apps Management write permission in the submitting OpenAI organization.

## Repository quality fixes completed during certification

The release-candidate work also corrected existing collection fixture typing, collection player nullability, collection metadata typing, and identity WebSocket callback variance. The full repository TypeScript check now passes as a hard readiness gate.

## Release rule

Run the external gate in strict mode only after production values are configured:

```bash
PLUGIN_RELEASE_MODE=true npx tsx scripts/plugin-release-gate.ts --strict
```

Do not submit while any strict gate is blocked.
