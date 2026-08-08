# Sportfolio runtime configuration

This document is the operational source of truth for application-defined runtime configuration. Railway-provided `RAILWAY_*` variables are platform metadata and are not duplicated here.

## Authentication

Sportfolio uses Better Auth backed by Railway PostgreSQL and Resend passwordless email. Better Auth is the only authentication provider; there is no runtime provider selector. Public password login and social login are intentionally unsupported. Supabase is not an active runtime or authentication dependency.

Required runtime configuration:

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

## Data and sports providers

- `DATABASE_URL`: canonical Railway PostgreSQL database.
- MLB roster, schedule, game, standings, and statistics data is fetched natively by the Sportfolio process from MLB StatsAPI. Expected-stat profiles are fetched directly from Baseball Savant. No `MLB_MCP_*` configuration or separate Railway service is required.
- Provider-specific credentials such as `MYSPORTSFEEDS_API_KEY` or `NASCAR_PROXY_URL` are permitted only while the corresponding active runtime path uses them.

## Product and platform integrations

Variables for Whop, mobile stores, ads, Discord, social posting, search/data providers, and push notifications are permitted only while referenced by an active runtime path. The repository and Railway variable inventories must be reviewed together before removing an integration credential.

## Scheduled jobs

`RUN_SCHEDULED_JOBS` must be enabled on only one production runtime. Beta must keep scheduled jobs disabled while sharing the production database.

## Permanently retired configuration

The following prefixes/names must not be reintroduced:

- `AUTH_PROVIDER`
- `HERMES_*`
- `HERMES_INTERNAL_*`
- `TELNYX_*`
- `SMS_LINK_*`
- `USER_AGENT_MANAGED_PROVIDER`
- `USER_AGENT_SECRET_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_SUPABASE_FALLBACK_ENABLED`
- `AUTH_SUPABASE_FALLBACK_EXPIRES_AT`
- `MLB_MCP_ENABLED`
- `MLB_MCP_URL`
- `MLB_MCP_TIMEOUT_MS`
- `MLB_MCP_HEALTH_CACHE_MS`
- `MLB_MCP_AUTH_BEARER`

## Environment parity rule

`main` is the code source of truth. Production and beta should deploy the same tested commit. Environment differences belong in configuration, not long-lived divergent code branches. Beta keeps environment-specific URLs/credentials and disables production side effects such as scheduled jobs.
