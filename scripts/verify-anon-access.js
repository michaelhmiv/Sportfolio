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

async function check() {
  console.log("--- SECURITY VERIFICATION START ---");

  // Check 1: Admin Access via Postgres Protocol (Backend Simulator)
  if (DB_URL) {
    try {
      const pool = new Pool({ connectionString: DB_URL });
      const res = await pool.query("SELECT count(*) FROM players");
      console.log(`✅ [BACKEND/PG] Access Successful. Players Count: ${res.rows[0].count}`);
      await pool.end();
    } catch (e) {
      console.error(`❌ [BACKEND/PG] Error: ${e.message}`);
    }
  } else {
    console.error("⚠️ [BACKEND/PG] DATABASE_URL missing");
  }

  // Check 2: Public Access via Supabase Anon Key (Malicious Actor Simulator)
  if (SUPABASE_URL && ANON_KEY) {
    try {
      const supabase = createClient(SUPABASE_URL, ANON_KEY);
      console.log(`🔍 Attempting public access to 'players' table...`);
      const { data, error, count } = await supabase
        .from("players")
        .select("*", { count: "exact", head: true });

      if (error) {
        console.log(`✅ [PUBLIC/JS] Access BLOCKED as expected. Error: ${error.message}`);
      } else if (count > 0) {
        console.error(`❌ [PUBLIC/JS] SECURITY RISK! Visible to public: ${count} rows`);
      } else {
        console.log(`✅ [PUBLIC/JS] Access result: Empty (0 rows visible), which is secure.`);
      }

      // Specific check for 'users' table (sensitive)
      console.log(`🔍 Attempting public access to 'users' table...`);
      const usersCheck = await supabase.from("users").select("id").limit(1);
      if (usersCheck.data && usersCheck.data.length > 0) {
        console.error(`❌ [PUBLIC/JS] CRITICAL! User data is still publicly visible!`);
      } else {
        console.log(`✅ [PUBLIC/JS] User data is SECURE.`);
      }
    } catch (e) {
      console.error(`⚠️ [PUBLIC/JS] Exception: ${e.message}`);
    }
  } else {
    console.error("⚠️ [PUBLIC/JS] Supabase URL/Key missing in environment");
  }
  console.log("--- SECURITY VERIFICATION END ---");
}

check();
