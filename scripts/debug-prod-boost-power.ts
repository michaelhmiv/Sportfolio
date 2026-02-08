import "dotenv/config";
import { Pool } from "pg";

async function checkProdHoldingsAndBoosts() {
  console.log("=== Checking PRODUCTION database ===\n");

  // Use production DATABASE_URL
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const client = await pool.connect();

  // Your user ID
  const userId = "dev-user-12345678";

  // 1. Get all holdings for dev-user
  console.log("--- Holdings ---");
  const holdingsResult = await client.query(
    `
    SELECT h.*, p.first_name, p.last_name, p.team
    FROM holdings h
    JOIN players p ON h.asset_id = p.id
    WHERE h.user_id = $1 AND h.asset_type = 'player'
    ORDER BY p.last_name
  `,
    [userId],
  );

  console.log(`Total holdings: ${holdingsResult.rows.length}\n`);

  for (const h of holdingsResult.rows) {
    console.log(`  ${h.first_name} ${h.last_name} (${h.team})`);
    console.log(`    Quantity: ${h.quantity}`);
    console.log(`    Power: ${h.power}`);
    console.log(`    PowerLevel: ${h.power_level}`);
    console.log();
  }

  // 2. Get all boosts (any date)
  console.log("--- All Boosts ---");
  const boostsResult = await client.query(
    `
    SELECT b.*, p.first_name, p.last_name, p.team
    FROM daily_boosts b
    JOIN players p ON b.player_id = p.id
    WHERE b.user_id = $1
    ORDER BY b.boost_date DESC
    LIMIT 20
  `,
    [userId],
  );

  console.log(`Recent boosts: ${boostsResult.rows.length}\n`);

  for (const b of boostsResult.rows) {
    console.log(`  ${b.first_name} ${b.last_name} (${b.team})`);
    console.log(`    Date: ${b.boost_date}`);
    console.log(`    Slot Tier: ${b.slot_tier}x`);
    console.log(`    Shares Entered: ${b.shares_entered}`);
    console.log(`    Boost PowerLevel: ${b.power_level}`);
    console.log(`    Status: ${b.status}`);
    console.log();
  }

  // Cross-reference
  console.log("--- Cross-Reference ---");
  for (const b of boostsResult.rows) {
    const holding = holdingsResult.rows.find((h) => h.asset_id === b.player_id);
    if (holding) {
      console.log(`${b.first_name} ${b.last_name}:`);
      console.log(`  Current Holding PowerLevel: ${holding.power_level}`);
      console.log(`  Boost PowerLevel (at creation): ${b.power_level}`);
    }
  }

  await client.release();
  await pool.end();
}

checkProdHoldingsAndBoosts().catch(console.error);
