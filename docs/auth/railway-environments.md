# Sportfolio authentication environments

## Runtime model

Sportfolio deploys the same reviewed `main` commit to two Railway application services. Authentication behavior is selected by validated environment variables rather than branch-specific code.

Both services intentionally use the production Railway Postgres database. The beta service is therefore a controlled alternate application surface, not a disposable data sandbox.

| Service           | Public URL                     | Database                    | Purpose                                      |
| ----------------- | ------------------------------ | --------------------------- | -------------------------------------------- |
| Sportfolio-Replit | https://www.sportfolio.market  | production Railway Postgres | production                                   |
| Sportfolio-Beta   | https://beta.sportfolio.market | production Railway Postgres | controlled authentication integration tests |

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
- Beta must use `https://beta.sportfolio.market` as `PUBLIC_SITE_URL`.
- Production must use `https://www.sportfolio.market` as `PUBLIC_SITE_URL`.
- Callback and continuation URLs must remain on the configured application origin.
- `RUN_SCHEDULED_JOBS=false` is mandatory for the beta application.
- Production remains on Supabase until the explicit cutover PR and configuration change.
- A production Postgres backup is required before the first authentication schema migration and before identity import execution.

## Initial production authentication settings

```text
AUTH_PROVIDER=SUPABASE
AUTH_MAGIC_LINK_ENABLED=false
AUTH_SUPABASE_FALLBACK_ENABLED=true
AUTH_NEW_REGISTRATIONS_ENABLED=true
AUTH_OAUTH_PROVIDER_ENABLED=false
AUTH_NATIVE_HANDOFF_ENABLED=false
AUTH_MIGRATION_MODE=off
AUTH_ENVIRONMENT=production
AUTH_DATABASE_ENVIRONMENT=production
AUTH_SHARED_PRODUCTION_DATABASE=false
```

## Initial beta authentication settings

```text
AUTH_PROVIDER=SUPABASE
AUTH_MAGIC_LINK_ENABLED=false
AUTH_SUPABASE_FALLBACK_ENABLED=true
AUTH_NEW_REGISTRATIONS_ENABLED=true
AUTH_OAUTH_PROVIDER_ENABLED=false
AUTH_NATIVE_HANDOFF_ENABLED=false
AUTH_MIGRATION_MODE=off
AUTH_ENVIRONMENT=beta
AUTH_DATABASE_ENVIRONMENT=production
AUTH_SHARED_PRODUCTION_DATABASE=true
RUN_SCHEDULED_JOBS=false
```

The beta service begins on the same legacy provider baseline. Better Auth, Resend, native handoff and OAuth capabilities are enabled only after their implementation PR passes automated and controlled live beta certification.
