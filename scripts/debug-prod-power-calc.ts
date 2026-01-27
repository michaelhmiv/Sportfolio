import 'dotenv/config';
import { Pool } from 'pg';

async function checkPowerLevelCalculation() {
  console.log("=== Checking PowerLevel Calculation ===\n");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  const userId = 'dev-user-12345678';

  // Check if powerLevel equals quantity * power for all holdings
  console.log("--- PowerLevel Calculation Check ---");
  const check = await client.query(`
    SELECT
      h.id,
      p.first_name,
      p.last_name,
      h.quantity,
      h.power,
      h.power_level,
      (h.quantity * h.power) as expected_power_level,
      CASE
        WHEN h.power_level::numeric = (h.quantity * h.power)
        THEN '✓ CORRECT'
        ELSE '❌ WRONG'
      END as status
    FROM holdings h
    JOIN players p ON h.asset_id = p.id
    WHERE h.user_id = $1 AND h.asset_type = 'player'
    ORDER BY p.last_name
  `, [userId]);

  console.log(`Total holdings: ${check.rows.length}\n`);

  const wrong = check.rows.filter(r => r.status === '❌ WRONG');
  const correct = check.rows.filter(r => r.status === '✓ CORRECT');

  console.log(`Correct: ${correct.length}`);
  console.log(`Wrong: ${wrong.length}`);

  if (wrong.length > 0) {
    console.log("\n--- Wrong PowerLevel Holdings ---");
    for (const r of wrong) {
      console.log(`${r.first_name} ${r.last_name}:`);
      console.log(`  quantity=${r.quantity}, power=${r.power}`);
      console.log(`  power_level='${r.power_level}'`);
      console.log(`  expected=${r.expected_power_level}`);
    }
  }

  // Check scout distribution history for this user
  console.log("\n--- Scout Distribution History ---");
  const scoutDist = await client.query(`
    SELECT *
    FROM scout_distributions
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 20
  `, [userId]);

  console.log(`Recent scout distributions: ${scoutDist.rows.length}`);
  for (const d of scoutDist.rows) {
    console.log(`  ${d.created_at}: ${d.shares_earned} shares for ${d.player_id}`);
  }

  await client.release();
  await pool.end();
}

checkPowerLevelCalculation().catch(console.error);
