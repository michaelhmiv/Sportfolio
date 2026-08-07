# Sportfolio plugin readiness report

Status date: August 3, 2026

## Full-action release scope

- Separate, feature-gated, stateless `/mcp/plugin` endpoint with OAuth 2.1 authentication
- Static marketplace catalog derived directly from the shared Sportfolio site MCP registry
- Public documentation, player, and schedule research without account access
- OAuth-protected connected-account reads and all supported write actions
- Existing staged previews for virtual market trades, scouting, share stacking, daily boosts, community boosts, and liquidity operations
- Exact-bundle `confirm_pending_action` and `cancel_pending_action` finalizers
- Supported immediate watchlist, schedule, profile, onboarding, milestone, news, premium, and account controls
- Twelve static semantic MLB tools with bounded inputs and structured provider errors
- Explicit security schemes, `readOnlyHint`, `openWorldHint`, `destructiveHint`, output schemas, sanitization, rate limits, deadlines, concurrency controls, health reporting, and metrics
- Public privacy, terms, documentation, and support pages
- Plugin package manifest, app binding template, local marketplace entry, five positive cases, three negative cases, reviewer fixtures, release notes, and policy worksheet

## Architecture and safety

- `/mcp` retains API-token authentication and session-oriented transport for the CLI and manually configured clients.
- `/mcp/plugin` uses OAuth and stateless Streamable HTTP.
- Both endpoints reuse the same shared public MCP business logic so ChatGPT actions cannot drift from the tested Sportfolio site MCP behavior.
- Public unauthenticated tools are read-only.
- Private-data and write tools are OAuth-only.
- Staging tools do not finalize the gameplay operation. The skill requires an explicit user confirmation before the destructive finalizer is invoked.
- Marketplace output sanitization removes credentials, authentication tokens, provider keys, direct contact fields, stack traces, SQL details, session IDs, request IDs, and unrelated internal fields.
- Admin, internal, debug, raw database, mobile-store billing, unsupported provider-management, and other web-only capabilities remain excluded from the shared public MCP contract.
- Sportfolio remains a virtual fantasy-sports game with no real-money investing, betting, wagering, cash prizes, or cash-out.

## Previously verified infrastructure

- Supabase project is active and healthy.
- OAuth Server is enabled with `/oauth/consent` and dynamic client registration.
- P-256/ES256 public signing keys are available through JWKS.
- Live OAuth discovery and JWKS certification passes.
- The audience-hook table and Postgres hook function are deployed with an empty allowlist, so they do not alter existing tokens.
- Every public-schema table has RLS enabled and the `anon` and `authenticated` Data API roles have zero table grants.
- Mutable database-function search paths and broad avatar-bucket listing were remediated.
- Critical production dependency advisories were remediated through a non-breaking lockfile update that passed build, unit, and MCP regression testing.
- The production `/mcp/plugin` endpoint is currently healthy; the full-action catalog becomes active only after the full-parity PR is merged and deployed.

## Certification required for this release

The permanent Plugin Readiness workflow must pass all four jobs on the final full-action commit:

- plugin and repository TypeScript certification, production build, unit tests, full-surface catalog/package/privacy/submission audits, and release-gate reporting;
- existing MCP audit and smoke plus marketplace stateless MCP smoke;
- critical production dependency audit;
- live Supabase OAuth discovery and JWKS compatibility.

The marketplace smoke must prove that:

- every shared static site MCP tool appears in `/mcp/plugin`;
- required market, scouting, boost, and confirmation actions are declared as writes;
- `confirm_pending_action` is declared destructive;
- every tool has all three annotations and an output schema;
- public documentation works without OAuth;
- protected reads and writes return the MCP OAuth challenge when disconnected;
- the endpoint rejects MCP session IDs.

## External release blockers

1. Merge the full-parity PR and verify the resulting Railway production deployment.
2. Use a ChatGPT Business or Enterprise/Edu workspace for full MCP write-action developer-mode testing; current OpenAI documentation limits Pro custom MCP connections to read/fetch behavior.
3. Register or refresh the production MCP in ChatGPT developer mode and replace the `.app.json` placeholder with the assigned `plugin_asdk_app...` ID.
4. Receive and configure the OpenAI domain-verification challenge token.
5. Identify the final registered OAuth client ID, add it to `public.plugin_oauth_clients`, set `PLUGIN_OAUTH_ALLOWED_CLIENT_IDS`, and enable `public.sportfolio_plugin_access_token_hook` under Supabase Authentication → Hooks → Custom Access Token.
6. Create and seed the synthetic reviewer account; keep credentials out of Git and provide them only through the submission portal.
7. Complete manual OpenAI-policy review of credential, token, BYOK, premium, and other sensitive account-management tools included for site MCP parity.
8. Complete final legal review of policy text and initial country availability.
9. Add final marketplace artwork and screenshots that reflect the deployed full-action product.
10. Run all eight submission cases in fresh ChatGPT conversations and freeze the final MCP and skill snapshots.
11. Confirm publisher identity and Apps Management write permission in the submitting OpenAI organization.

## Supabase Free-plan security note

Supabase leaked-password protection is available only on Pro and higher plans. It is useful defense in depth, but it is not an OpenAI plugin-submission requirement and is not a release blocker for Sportfolio while the project remains on the Free plan.

Free-plan compensating controls include a strong minimum password policy, confirmed-email requirements where appropriate, OAuth PKCE, short-lived access tokens, client and audience validation, rate limiting, account-recovery protections, and continued monitoring of authentication abuse. Upgrade-based leaked-password screening can be reconsidered if Sportfolio moves to Supabase Pro.

## Release rule

Run the external gate in strict mode only after production values are configured:

```bash
PLUGIN_RELEASE_MODE=true npx tsx scripts/plugin-release-gate.ts --strict
```

Do not submit while any strict gate is blocked.
