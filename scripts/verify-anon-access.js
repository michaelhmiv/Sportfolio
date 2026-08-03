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

const REPRESENTATIVE_TABLES = [
  "user",
  "session",
  "account",
  "verification",
  "transactions",
  "watchlist",
  "user_push_tokens",
  "players",
  "games",
  "player_games",
  "mlb_stats",
  "collection",
];

async function check() {
  console.log("--- SECURITY VERIFICATION START ---");
  let failed = false;

  if (DB_URL) {
    const pool = new Pool({ connectionString: DB_URL });
    try {
      const backend = await pool.query("SELECT count(*) FROM players");
      console.log(`✅ [BACKEND/PG] Access successful. Players count: ${backend.rows[0].count}`);

      const posture = await pool.query(`
        select
          count(*) filter (where not c.relrowsecurity) as tables_without_rls,
          count(*) filter (where g.grantee in ('anon', 'authenticated')) as data_api_grant_rows
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        left join information_schema.role_table_grants g
          on g.table_schema = 'public' and g.table_name = c.relname
        where c.relkind in ('r', 'p')
      `);
      const row = posture.rows[0];
      if (Number(row.tables_without_rls) !== 0 || Number(row.data_api_grant_rows) !== 0) {
        failed = true;
        console.error(
          `❌ [DATABASE] Public schema is not server-only: ${row.tables_without_rls} table(s) without RLS, ${row.data_api_grant_rows} anon/authenticated grant row(s).`,
        );
      } else {
        console.log("✅ [DATABASE] Every public table has RLS and zero anon/authenticated grants.");
      }
    } catch (error) {
      failed = true;
      console.error(`❌ [BACKEND/PG] Error: ${error.message}`);
    } finally {
      await pool.end();
    }
  } else {
    console.warn("⚠️ [BACKEND/PG] DATABASE_URL missing; schema-wide posture was not tested.");
  }

  if (!SUPABASE_URL || !ANON_KEY) {
    console.error("❌ [PUBLIC/JS] Supabase URL or anonymous key is missing.");
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const table of REPRESENTATIVE_TABLES) {
    const { data, error } = await supabase.from(table).select("*").limit(1);
    if (!error) {
      failed = true;
      console.error(
        `❌ [PUBLIC/JS] ${table} was queryable by the anonymous role${Array.isArray(data) && data.length > 0 ? " and returned data" : ""}.`,
      );
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
