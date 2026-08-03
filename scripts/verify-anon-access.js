import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const DB_URL = process.env.DATABASE_URL;
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const PROTECTED_TABLES = [
  "user",
  "session",
  "account",
  "verification",
  "account_deletion_requests",
  "transactions",
  "watchlist",
  "user_notification_preferences",
  "user_notification_settings",
  "user_push_devices",
  "user_push_tokens",
  "price_alerts",
  "transaction_alerts",
  "push_notification_events",
];

async function check() {
  console.log("--- SECURITY VERIFICATION START ---");
  let failed = false;

  if (DB_URL) {
    try {
      const pool = new Pool({ connectionString: DB_URL });
      const res = await pool.query("SELECT count(*) FROM players");
      console.log(`✅ [BACKEND/PG] Access successful. Players count: ${res.rows[0].count}`);
      await pool.end();
    } catch (error) {
      failed = true;
      console.error(`❌ [BACKEND/PG] Error: ${error.message}`);
    }
  } else {
    console.warn("⚠️ [BACKEND/PG] DATABASE_URL missing; backend access was not tested.");
  }

  if (!SUPABASE_URL || !ANON_KEY) {
    console.error("❌ [PUBLIC/JS] Supabase URL or anonymous key is missing.");
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const table of PROTECTED_TABLES) {
    const { data, error } = await supabase.from(table).select("*").limit(1);
    if (!error && Array.isArray(data) && data.length > 0) {
      failed = true;
      console.error(`❌ [PUBLIC/JS] ${table} returned a row to the anonymous role.`);
      continue;
    }

    if (!error) {
      failed = true;
      console.error(`❌ [PUBLIC/JS] ${table} was queryable by the anonymous role, even though it returned no rows.`);
      continue;
    }

    console.log(`✅ [PUBLIC/JS] ${table} is blocked: ${error.code || "permission_denied"}`);
  }

  console.log("--- SECURITY VERIFICATION END ---");
  if (failed) process.exitCode = 1;
}

check().catch((error) => {
  console.error(`❌ Security verification failed: ${error.message}`);
  process.exitCode = 1;
});
