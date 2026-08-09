import pg from "pg";

if (process.env.BETTER_AUTH_RECOVER_JWKS_ONCE !== "true") {
  console.log("[AUTH_JWKS_RECOVERY] Disabled; skipping");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for Better Auth JWKS recovery");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const result = await client.query("DELETE FROM auth_jwks RETURNING id");
  console.warn(`[AUTH_JWKS_RECOVERY] Cleared ${result.rowCount ?? 0} stale JWKS record(s)`);
} finally {
  await client.end();
}
