import "dotenv/config";
import { pool } from "../server/db";

async function runMigration() {
  try {
    const dbName = await pool.query("SELECT current_database()");
    console.log("Running on database:", dbName.rows[0].current_database);

    // Check if we need to switch database within the query if possible,
    // but the connection string determines the database.
    // If the server connects to sportfolio_dev, we need to ensure this script does too.

    const sql = `
      INSERT INTO users (id, email, username, balance, is_bot)
      VALUES 
        ('pool', 'pool@system.internal', 'AMM Pool', 10000, true),
        ('protocol_lp_owner', 'protocol@system.internal', 'Protocol LP Owner', 10000, true)
      ON CONFLICT (id) DO NOTHING;
    `;

    await pool.query(sql);
    console.log("System users created/verified.");

    const count = await pool.query(
      "SELECT COUNT(*) FROM users WHERE id IN ('pool', 'protocol_lp_owner')",
    );
    console.log("Account count:", count.rows[0].count);
  } catch (error: any) {
    console.error("Migration failed:", error.message);
  } finally {
    await pool.end();
  }
}

runMigration();
