import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

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
  max: 5, // Limit pool to 5 connections to prevent Supabase "MaxClientsInSessionMode" errors
  connectionTimeoutMillis: 5000, // Fail fast if pool is full
  idleTimeoutMillis: 30000, // Close idle connections
});
export const db = drizzle(pool, { schema });
