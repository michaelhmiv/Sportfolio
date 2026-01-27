import { config } from "dotenv";
import { Pool } from "pg";

// Load .env file
config({ path: ".env" });

const databaseUrl = process.env.DEV_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL not found in .env");
  process.exit(1);
}

console.log("Connecting to database...\n");

const pool = new Pool({
  connectionString: databaseUrl,
});

async function checkHoldings() {
  // Check ALL holdings with power > 1
  const result = await pool.query(`
    SELECT id, user_id, asset_id, quantity, power, power_level
    FROM holdings
    WHERE power > 1
    ORDER BY user_id, asset_id
  `);

  console.log(`Found ${result.rows.length} powered holdings total:\n`);
  for (const row of result.rows) {
    console.log(`  ${row.user_id} | ${row.asset_id}: quantity=${row.quantity}, power=${row.power}, power_level=${row.power_level}`);
  }

  // Check if there are any for dev_user specifically
  const devUserResult = await pool.query(`
    SELECT id, asset_id, quantity, power, power_level
    FROM holdings
    WHERE user_id = 'dev_user' AND power > 1
  `);

  console.log(`\nFor 'dev_user': ${devUserResult.rows.length} powered holdings`);
  for (const row of devUserResult.rows) {
    console.log(`  ${row.asset_id}: quantity=${row.quantity}, power=${row.power}, power_level=${row.power_level}`);
  }
}

checkHoldings()
  .then(() => {
    pool.end();
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    pool.end();
    process.exit(1);
  });
