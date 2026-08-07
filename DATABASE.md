# Database Configuration

This project uses strict environment-based database switching to avoid local sessions
accidentally pointing at production.

## Quick Reference

| Environment | Variable Used      | Description                                         |
| ----------- | ------------------ | --------------------------------------------------- |
| Development | `DEV_DATABASE_URL` | Local Docker PostgreSQL (port 5433)                 |
| Production  | `DATABASE_URL`     | Supabase Cloud (Railway sets `NODE_ENV=production`) |

## How It Works

```text
NODE_ENV === 'production' -> DATABASE_URL (Supabase)
NODE_ENV !== 'production' -> DEV_DATABASE_URL (no fallback to DATABASE_URL)
```

## Local Development Setup

1. Start Docker PostgreSQL:

```bash
docker-compose -f docker-compose.dev.yml up -d
```

2. Add to `.env`:

```text
DEV_DATABASE_URL=postgresql://localhost:5433/sportfolio_dev
```

3. Run migrations:

```bash
npm run db:push
```

Use `DEV_DATABASE_URL` for local test databases and the approved migration scripts under `scripts/` for controlled changes.

## Files That Control Database Selection

- `server/db.ts` - Runtime connection
- `drizzle.config.ts` - Drizzle migrations

## Verification

When running `npm run db:push`, look for:

- `[Drizzle] Using DEVELOPMENT database`
- `[Drizzle] Using PRODUCTION database`
