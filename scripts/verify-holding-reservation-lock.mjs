#!/usr/bin/env node
/* global process, console */
import { Client } from "pg";
import { createHash } from "node:crypto";

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (String(process.env.RUN_SCHEDULED_JOBS || "").toLowerCase() !== "false") {
  throw new Error("RUN_SCHEDULED_JOBS must be false for advisory-lock verification.");
}
const digest = createHash("sha256").update("holding-reservation:verification", "utf8").digest();
const keys = [digest.readInt32BE(0), digest.readInt32BE(4)];
const client = new Client({
  connectionString: databaseUrl,
  application_name: "sportfolio-lock-check",
});
await client.connect();
try {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1::integer, $2::integer)", keys);
  } finally {
    await client.query("ROLLBACK");
  }
  console.log(
    JSON.stringify({ status: "ok", overload: "pg_advisory_xact_lock(integer, integer)" }),
  );
} finally {
  await client.end();
}
