---
description: how to set up and use the local development database
---

# Local Dev Database Setup

## DEV vs Production

| Aspect | Development | Production |
| --- | --- | --- |
| Environment Variable | `DEV_DATABASE_URL` | `DATABASE_URL` |
| Location | Local Docker (`localhost:5433`) | Supabase Cloud |
| When Used | `NODE_ENV !== production` | `NODE_ENV=production` |
| Data | Test/fake data, safe to delete | Real user data, never delete |

## Database Selection Rules

```text
IF NODE_ENV === 'production'
  -> Use DATABASE_URL
ELSE
  -> Use DEV_DATABASE_URL
  -> No fallback to DATABASE_URL
```

Railway sets `NODE_ENV=production`, so deployments always use `DATABASE_URL`.

## Prerequisites

- Docker Desktop installed and running

## First-Time Setup

1. Start local PostgreSQL:

```bash
docker-compose -f docker-compose.dev.yml up -d
```

2. Add `DEV_DATABASE_URL` to `.env`:

```text
DEV_DATABASE_URL=postgresql://postgres:devpassword@localhost:5433/sportfolio_dev
```

3. Run migrations against local dev DB:

```bash
npm run db:push
```

## Daily Usage

Start:

```bash
docker-compose -f docker-compose.dev.yml up -d
```

Stop (keep data):

```bash
docker-compose -f docker-compose.dev.yml stop
```

Remove (delete data):

```bash
docker-compose -f docker-compose.dev.yml down -v
```

Logs:

```bash
docker logs sportfolio-dev-db
```

## Verification

```bash
npm run db:push
```

Look for `[Drizzle] Using DEVELOPMENT database`.

## Files That Control DB Selection

- `server/db.ts`
- `drizzle.config.ts`
