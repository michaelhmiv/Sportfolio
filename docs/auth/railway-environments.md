# Sportfolio authentication environments

## Runtime model

Sportfolio deploys the same reviewed commit to two Railway application services. Better Auth is the only supported authentication provider. Environment variables control feature availability and environment safety, not provider selection.

Both services intentionally use the production Railway Postgres database. The beta service is therefore a controlled alternate application surface, not a disposable data sandbox.

| Service         | Public URL                     | Database                    | Purpose                                      |
| --------------- | ------------------------------ | --------------------------- | -------------------------------------------- |
| Sportfolio      | https://www.sportfolio.market  | production Railway Postgres | production                                   |
| Sportfolio-Beta | https://beta.sportfolio.market | production Railway Postgres | controlled authentication integration tests |

## Required safety invariants

- Beta must explicitly set `AUTH_SHARED_PRODUCTION_DATABASE=true` when `AUTH_DATABASE_ENVIRONMENT=production`.
- The shared-database flag is invalid for any environment pairing other than beta application plus production database.
- `AUTH_MIGRATION_MODE=execute` is prohibited from the beta runtime.
- Migration execution is accepted only from the production runtime with all of the following exact values:

  ```text
  AUTH_ENVIRONMENT=production
  AUTH_DATABASE_ENVIRONMENT=production
  AUTH_MIGRATION_CONFIRM_DATABASE=production
  AUTH_MIGRATION_CONFIRM_CANONICAL_HOST=www.sportfolio.market
  ```

- Beta may run read-only migration analysis in `dry-run` mode, but dry-run tooling must not write to the database.
- Destructive migration tests, database resets, synthetic bulk imports and rollback deletion drills are prohibited against the shared database.
- Authentication schema migrations must be additive and backward-compatible.
- Reserved test identities must be used for live beta authentication tests.
- Beta must use `https://beta.sportfolio.market` as both `PUBLIC_SITE_URL` and `BETTER_AUTH_URL`.
- Production must use `https://www.sportfolio.market` as both `PUBLIC_SITE_URL` and `BETTER_AUTH_URL`.
- Callback and continuation URLs must remain on the configured application origin.
- `RUN_SCHEDULED_JOBS=false` is mandatory for the beta application.
- Production is the only service that runs scheduled jobs.

## Production authentication settings

```text
AUTH_PROVIDER=BETTER_AUTH
AUTH_MAGIC_LINK_ENABLED=true
AUTH_NEW_REGISTRATIONS_ENABLED=true
AUTH_OAUTH_PROVIDER_ENABLED=true
AUTH_NATIVE_HANDOFF_ENABLED=true
AUTH_MIGRATION_MODE=off
AUTH_ENVIRONMENT=production
AUTH_DATABASE_ENVIRONMENT=production
AUTH_SHARED_PRODUCTION_DATABASE=false
BETTER_AUTH_URL=https://www.sportfolio.market
PUBLIC_SITE_URL=https://www.sportfolio.market
PLUGIN_OAUTH_ISSUER=https://www.sportfolio.market/api/auth/better
PLUGIN_MCP_RESOURCE=https://www.sportfolio.market/mcp/plugin
RUN_SCHEDULED_JOBS=true
```

## Beta authentication settings

```text
AUTH_PROVIDER=BETTER_AUTH
AUTH_MAGIC_LINK_ENABLED=true
AUTH_NEW_REGISTRATIONS_ENABLED=true
AUTH_OAUTH_PROVIDER_ENABLED=true
AUTH_NATIVE_HANDOFF_ENABLED=true
AUTH_MIGRATION_MODE=off
AUTH_ENVIRONMENT=beta
AUTH_DATABASE_ENVIRONMENT=production
AUTH_SHARED_PRODUCTION_DATABASE=true
BETTER_AUTH_URL=https://beta.sportfolio.market
PUBLIC_SITE_URL=https://beta.sportfolio.market
PLUGIN_OAUTH_ISSUER=https://beta.sportfolio.market/api/auth/better
PLUGIN_MCP_RESOURCE=https://www.sportfolio.market/mcp/plugin
RUN_SCHEDULED_JOBS=false
```

Secrets and credentials are intentionally omitted from this document. They must be stored only in the relevant Railway environment.
