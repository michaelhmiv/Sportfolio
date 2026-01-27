import 'dotenv/config';
import { Pool } from 'pg';

async function checkHoldingTimestamps() {
  console.log("=== Checking Holdings Creation Time ===\n");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  const userId = 'dev-user-12345678';

  const result = await client.query(`
    SELECT
      p.first_name,
      p.last_name,
      h.quantity,
      h.power,
      h.power_level,
      h.last_updated,
      CASE
        WHEN h.power_level::numeric = (h.quantity * h.power)
        THEN 'correct'
        ELSE 'needs_fix'
      END as status
    FROM holdings h
    JOIN players p ON h.asset_id = p.id
    WHERE h.user_id = $1 AND h.asset_type = 'player'
    ORDER BY h.last_updated DESC
  `, [userId]);

  console.log(`Holdings: ${result.rows.length}\n`);

  for (const r of result.rows) {
    console.log(`${r.first_name} ${r.last_name}:`);
    console.log(`  Updated: ${r.last_updated}`);
    console.log(`  quantity=${r.quantity}, power=${r.power}, power_level='${r.power_level}'`);
    console.log(`  Status: ${r.status}`);
  }

  // Count how many need fixing
  const needFix = result.rows.filter(r => r.status === 'needs_fix').length;
  console.log(`\n${needFix} holdings need powerLevel fix`);

  await client.release();
  await pool.end();
}

checkHoldingTimestamps().catch(console.error);
