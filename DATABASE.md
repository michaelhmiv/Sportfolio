# Database configuration

Sportfolio uses PostgreSQL with strict environment-based connection selection so local development cannot silently fall back to production.

## Quick reference

| Environment | Variable            | Database                                  |
| ----------- | ------------------- | ----------------------------------------- |
| Development | `DEV_DATABASE_URL`  | local development PostgreSQL              |
| Test        | `TEST_DATABASE_URL` | isolated test PostgreSQL when configured  |
| Production  | `DATABASE_URL`      | canonical Railway production PostgreSQL   |

Beta is an application environment, not a separate database environment: it intentionally connects to the production Railway PostgreSQL database and is protected by auth/runtime safety flags. Beta must not run scheduled jobs.

## Runtime selection

```text
NODE_ENV=production -> DATABASE_URL
NODE_ENV=test       -> TEST_DATABASE_URL, then DEV_DATABASE_URL, then isolated local test default
other               -> DEV_DATABASE_URL
```

Non-production application startup does not fall back to the production `DATABASE_URL`.

## Local development

1. Start local PostgreSQL:

```bash
docker-compose -f docker-compose.dev.yml up -d
```

2. Configure `.env`:

```text
DEV_DATABASE_URL=postgresql://postgres:devpassword@localhost:5433/sportfolio_dev
```

3. Run the appropriate Drizzle/migration command for the task. Do not point local or automated destructive workflows at production.

## Source-of-truth files

- `server/db.ts` — runtime connection selection and pools
- `drizzle.config.ts` — Drizzle configuration
- `shared/schema.ts` — current application schema
- `migrations/` — historical schema lineage
- `scripts/` — controlled migration/backfill utilities

Historical migrations may mention previously used infrastructure. Those files document actual database history and must not be interpreted as current runtime configuration.

## Production safety

- Railway PostgreSQL is the canonical production database.
- Production and beta application services intentionally share it.
- Beta must set the shared-production-database safety flag and keep scheduled jobs disabled.
- Destructive migration rehearsals, resets, or synthetic bulk imports must not run against the shared production database.
- Migration/backfill scripts that mutate production must be idempotent, guarded, and verified before being used as deployment steps.
- Never reintroduce Supabase runtime/database configuration as a fallback path.
