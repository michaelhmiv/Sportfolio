import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

const AUTH_SCHEMA_MIGRATIONS = [
  "migrations/0064_passwordless_auth_identity_boundary.sql",
  "migrations/0065_better_auth_oauth_provider.sql",
] as const;
const AUTH_SCHEMA_LOCK = "sportfolio-passwordless-auth-schema-v1";

/**
 * Apply the additive passwordless-auth schema before the auth handlers mount.
 *
 * Railway beta and production share one database, so this uses an advisory lock
 * and the migration's CREATE ... IF NOT EXISTS statements to remain safe across
 * concurrent deploys and repeated starts.
 */
export async function ensurePasswordlessAuthSchema(pool: Pool): Promise<void> {
  if (process.env.AUTH_MAGIC_LINK_ENABLED !== "true") return;

  const migrations = await Promise.all(
    AUTH_SCHEMA_MIGRATIONS.map(async (migration) =>
      readFile(path.resolve(process.cwd(), migration), "utf8"),
    ),
  );
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [AUTH_SCHEMA_LOCK]);
    await client.query("BEGIN");
    for (const migrationSql of migrations) await client.query(migrationSql);
    await client.query("COMMIT");
    console.log("[AUTH_SCHEMA] Passwordless authentication schema is ready");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[AUTH_SCHEMA] Failed to prepare passwordless authentication schema", error);
    throw error;
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext($1))", [AUTH_SCHEMA_LOCK])
      .catch(() => undefined);
    client.release();
  }
}
