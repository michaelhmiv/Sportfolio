import "dotenv/config";
import { Pool } from "pg";

async function checkProdHoldingsDetails() {
  console.log("=== Checking PRODUCTION holdings in detail ===\n");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const client = await pool.connect();
  const userId = "dev-user-12345678";

  // Check holdings raw data
  console.log("--- Raw Holdings Data ---");
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

  for (const h of holdingsResult.rows) {
    console.log(`ID: ${h.id}`);
    console.log(`  Player: ${h.first_name} ${h.last_name} (${h.team})`);
    console.log(`  quantity: ${h.quantity}`);
    console.log(`  power: ${h.power}`);
    console.log(`  power_level: '${h.power_level}'`);
    console.log(
      `  quantity * power should be: ${parseFloat(h.power_level || "0")} (actual: ${h.quantity * h.power})`,
    );
    console.log();
  }

  // Check if there are multiple holdings per player (power=1 and power>1)
  console.log("--- Holdings per Player ---");
  const dupCheck = await client.query(
    `
    SELECT asset_id, COUNT(*) as cnt,
           string_agg(id, ', ') as ids,
           string_agg(power::text, ', ') as powers,
           string_agg(quantity::text, ', ') as quantities,
           string_agg(power_level, ', ') as power_levels
    FROM holdings
    WHERE user_id = $1 AND asset_type = 'player'
    GROUP BY asset_id
    HAVING COUNT(*) > 1
  `,
    [userId],
  );

  if (dupCheck.rows.length > 0) {
    console.log("Multiple holdings per player found:");
    for (const row of dupCheck.rows) {
      console.log(`  Player ${row.asset_id}: ${row.cnt} holdings`);
      console.log(`    IDs: ${row.ids}`);
      console.log(`    Powers: ${row.powers}`);
      console.log(`    Quantities: ${row.quantities}`);
      console.log(`    PowerLevels: ${row.power_levels}`);
    }
  } else {
    console.log("No duplicate holdings per player - each player has exactly 1 holding");
  }

  // Check the actual power_level values as decimal
  console.log("\n--- PowerLevel as Decimal ---");
  const decimalCheck = await client.query(
    `
    SELECT h.id, p.first_name, p.last_name,
           h.quantity, h.power, h.power_level,
           h.quantity::decimal * h.power::decimal as calculated_pl
    FROM holdings h
    JOIN players p ON h.asset_id = p.id
    WHERE h.user_id = $1 AND h.asset_type = 'player'
    ORDER BY p.last_name
  `,
    [userId],
  );

  for (const row of decimalCheck.rows) {
    const match = row.power_level?.trim() === row.calculated_pl?.toFixed(2) ? "✓" : "❌ MISMATCH";
    console.log(
      `${match} ${row.first_name} ${row.last_name}: quantity=${row.quantity} power=${row.power} power_level='${row.power_level}' calculated=${row.calculated_pl?.toFixed(2)}`,
    );
  }

  await client.release();
  await pool.end();
}

checkProdHoldingsDetails().catch(console.error);
