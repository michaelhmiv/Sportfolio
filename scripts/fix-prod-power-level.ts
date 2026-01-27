import 'dotenv/config';
import { Pool } from 'pg';

async function fixPowerLevels() {
  console.log("=== Fixing Production power_level Values ===\n");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();

  // First, show current state
  console.log("--- Before Fix ---");
  const before = await client.query(`
    SELECT COUNT(*) as cnt
    FROM holdings
    WHERE asset_type = 'player'
    AND power_level = '0.00'::decimal
    AND power = 1
  `);
  console.log(`Holdings with power_level=0 and power=1: ${before.rows[0].cnt}`);

  // Run the fix
  console.log("\n--- Running Fix ---");
  const result = await client.query(`
    UPDATE holdings
    SET power_level = (quantity * power)::decimal(10,2)
    WHERE asset_type = 'player'
    AND power_level = '0.00'::decimal
    AND power = 1
  `);
  console.log(`Rows updated: ${result.rowCount}`);

  // Show after state
  console.log("\n--- After Fix ---");
  const after = await client.query(`
    SELECT p.first_name, p.last_name, h.quantity, h.power, h.power_level
    FROM holdings h
    JOIN players p ON h.asset_id = p.id
    WHERE h.user_id = 'dev-user-12345678' AND h.asset_type = 'player'
    ORDER BY p.last_name
  `);

  for (const r of after.rows) {
    console.log(`${r.first_name} ${r.last_name}: ${r.quantity} @ power=${r.power} → power_level=${r.power_level}`);
  }

  await client.release();
  await pool.end();
}

fixPowerLevels().catch(console.error);
