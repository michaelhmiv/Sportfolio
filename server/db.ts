import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { ensurePasswordlessAuthSchema } from "./auth/ensure-auth-schema";
import { ensureProfileSafetySchema } from "./profile/ensure-profile-safety-schema";

// Determine which database to use based on environment
const isProduction = process.env.NODE_ENV === "production";
const isTestEnvironment = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
const databaseUrl = isProduction
  ? process.env.DATABASE_URL
  : isTestEnvironment
    ? process.env.TEST_DATABASE_URL ||
      process.env.DEV_DATABASE_URL ||
      "postgresql://postgres:postgres@127.0.0.1:5432/sportfolio_test"
    : process.env.DEV_DATABASE_URL;

console.log(`[DB] Environment: ${process.env.NODE_ENV || "development"}`);
console.log(
  `[DB] Using ${isProduction ? "PRODUCTION (DATABASE_URL)" : "DEVELOPMENT (DEV_DATABASE_URL)"} database`,
);

if (!databaseUrl) {
  throw new Error(
    isProduction
      ? "DATABASE_URL must be set in production."
      : "DEV_DATABASE_URL must be set for local development (no fallback to DATABASE_URL).",
  );
}

export const pool = new Pool({
  connectionString: databaseUrl,
  max: 20, // Tuned for Railway PostgreSQL direct connection (was 5 for Supabase pooler)
  connectionTimeoutMillis: 5000, // Fail fast if pool is full
  idleTimeoutMillis: 30000, // Close idle connections
});

await ensurePasswordlessAuthSchema(pool);
await ensureProfileSafetySchema(pool);

// Advisory locks must not consume clients from the application query pool while
// the locked job performs its normal database work. A separate, deliberately
// small pool prevents a top-of-hour burst from exhausting `pool` and deadlocking
// every locked callback while it waits for an application connection.
export const jobLockPool = new Pool({
  connectionString: databaseUrl,
  max: 2,
  // Wait for one of the two lock clients instead of dropping simultaneous cron
  // callbacks when both lock slots are occupied by longer-running jobs.
  connectionTimeoutMillis: 0,
  idleTimeoutMillis: 30000,
  application_name: "sportfolio-job-lock",
});
export const db = drizzle(pool, { schema });
