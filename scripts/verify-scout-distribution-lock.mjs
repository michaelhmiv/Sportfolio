#!/usr/bin/env node
/* global process, console */
import { Client } from "pg";
import { createHash } from "node:crypto";

function deriveKeys(eventKey) {
  const digest = createHash("sha256").update(eventKey, "utf8").digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (String(process.env.RUN_SCHEDULED_JOBS || "").toLowerCase() !== "false") {
  throw new Error("RUN_SCHEDULED_JOBS must be false for advisory-lock verification.");
}

const client = new Client({
  connectionString: databaseUrl,
  application_name: "sportfolio-scout-lock-verifier",
  connectionTimeoutMillis: 10_000,
});
await client.connect();
try {
  const [keyA, keyB] = deriveKeys("sportfolio:scout_distribution:verification");
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)", [keyA, keyB]);
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  console.log(JSON.stringify({
    check: "scout_distribution_advisory_lock",
    status: "ok",
    overload: "pg_advisory_xact_lock(integer, integer)",
  }));
} finally {
  await client.end();
}
