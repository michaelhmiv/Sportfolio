import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL not found in environment");
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log("🚀 Starting RLS Enablement...");

    // Get all tables in public schema
    const tablesResult = await pool.query(`
            SELECT tablename 
            FROM pg_tables 
            WHERE schemaname = 'public'
        `);

    const tables = tablesResult.rows.map((r) => r.tablename);

    for (const table of tables) {
      console.log(`🔒 Enabling RLS on ${table}...`);
      await pool.query(`ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY;`);
    }

    console.log("\n✅ RLS enabled on all tables.");

    // Double check
    const verifyResult = await pool.query(`
            SELECT count(*) as unprotected 
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' 
            AND c.relkind = 'r'
            AND c.relrowsecurity = false
        `);

    const count = parseInt(verifyResult.rows[0].unprotected);
    if (count === 0) {
      console.log("🛡️  Verified: 100% of tables are now protected.");
    } else {
      console.warn(`⚠️  Warning: ${count} tables still have RLS disabled.`);
    }
  } catch (err) {
    console.error("❌ SQL Error:", err.message);
  } finally {
    await pool.end();
  }
}

run();
