# Sportfolio authentication environments

## Runtime model

Sportfolio deploys the same reviewed `main` commit to two Railway application services. Authentication behavior is selected by validated environment variables rather than branch-specific code.

| Service           | Public URL                     | Database                       | Purpose                      |
| ----------------- | ------------------------------ | ------------------------------ | ---------------------------- |
| Sportfolio-Replit | https://www.sportfolio.market  | production Railway Postgres    | production                   |
| Sportfolio-Beta   | https://beta.sportfolio.market | isolated beta Railway Postgres | authentication certification |

## Required safety invariants

- Beta and production must not share a database for migration rehearsals or synthetic authentication tests.
- `AUTH_ENVIRONMENT` and `AUTH_DATABASE_ENVIRONMENT` must match before `AUTH_MIGRATION_MODE=execute` is accepted.
- Beta must use `https://beta.sportfolio.market` as `PUBLIC_SITE_URL`.
- Production must use `https://www.sportfolio.market` as `PUBLIC_SITE_URL`.
- Callback and continuation URLs must remain on the configured application origin.
- `RUN_SCHEDULED_JOBS=false` is mandatory for the beta application.
- Production remains on Supabase until the explicit cutover PR and configuration change.

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
```

## Initial beta authentication settings

The beta service begins on the same legacy provider baseline. Better Auth, Resend, native handoff and OAuth capabilities are enabled only after their implementation PR passes automated and live beta certification.
