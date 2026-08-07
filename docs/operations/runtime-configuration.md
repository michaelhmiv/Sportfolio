# Sportfolio runtime configuration

This document is the operational source of truth for application-defined runtime configuration. Railway-provided `RAILWAY_*` variables are platform metadata and are not duplicated here.

## Authentication

Sportfolio uses Better Auth backed by Railway PostgreSQL and Resend passwordless email. Public password login and social login are intentionally unsupported. The application dependency graph and active runtime no longer include the Supabase JavaScript client; legacy Supabase credentials exist only until the live cutover cleanup is certified.

Required runtime configuration:

- `AUTH_PROVIDER=BETTER_AUTH`
- `AUTH_MAGIC_LINK_ENABLED=true`
- `AUTH_NATIVE_HANDOFF_ENABLED=true` for native applications
- `AUTH_OAUTH_PROVIDER_ENABLED=true` where ChatGPT/Codex OAuth is exposed
- `AUTH_NEW_REGISTRATIONS_ENABLED` as the operational registration switch
- `AUTH_ENVIRONMENT` and `AUTH_DATABASE_ENVIRONMENT` for startup validation
- `AUTH_SHARED_PRODUCTION_DATABASE=true` only on beta, because beta intentionally uses production Railway PostgreSQL; production leaves this false
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`, using the environment's own public origin (`https://beta.sportfolio.market` on beta and `https://www.sportfolio.market` on production)
- `BETTER_AUTH_TRUSTED_ORIGINS`
- `AUTH_EMAIL_FROM`
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `PUBLIC_SITE_URL`
- `PLUGIN_MCP_ENABLED`
- `PLUGIN_MCP_RESOURCE` when overriding the canonical MCP resource
- `PLUGIN_OAUTH_ISSUER`, normally the same-origin Better Auth base path (`<PUBLIC_SITE_URL>/api/auth/better`)
- `PLUGIN_OAUTH_ALLOWED_CLIENT_IDS` only when restricting OAuth to an explicit allow-list

Supabase authentication variables are migration-only and must not exist after the final identity reconciliation and production cutover.

## Data and sports providers

- `DATABASE_URL`: canonical Railway PostgreSQL database.
- `BALLDONTLIE_API_KEY`, `MYSPORTSFEEDS_API_KEY`, `NASCAR_PROXY_URL`: provider-specific sports data credentials/endpoints where the corresponding provider remains enabled.
- `MLB_MCP_ENABLED`, `MLB_MCP_URL`, `MLB_MCP_TIMEOUT_MS`, `MLB_MCP_HEALTH_CACHE_MS`: curated MLB provider facade configuration. These variables must point only to the supported provider architecture; retired Hermes-prefixed aliases are forbidden.

## Product and platform integrations

Variables for Whop, mobile stores, ads, Discord, social posting, search/data providers, and push notifications are permitted only while referenced by an active runtime path. The repository and Railway variable inventories must be reviewed together before removing an integration credential.

## Scheduled jobs

`RUN_SCHEDULED_JOBS` must be enabled on only one production runtime. Beta must keep scheduled jobs disabled while sharing the production database.

## Permanently retired configuration

The following prefixes/names must not be reintroduced after finalization:

- `HERMES_*`
- `HERMES_INTERNAL_*`
- `TELNYX_*`
- `SMS_LINK_*`
- `USER_AGENT_MANAGED_PROVIDER`
- `USER_AGENT_SECRET_KEY`

After the Better Auth production cutover and identity reconciliation are certified, these are also permanently retired:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_SUPABASE_FALLBACK_ENABLED`

## Environment parity rule

`main` is the code source of truth. Production and beta should deploy the same tested `main` commit. Environment differences belong in configuration, not long-lived divergent code branches. Beta keeps environment-specific URLs/credentials and disables production side effects such as scheduled jobs.
