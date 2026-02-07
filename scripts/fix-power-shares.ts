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

async function fixPowerShares() {
  // Find holdings with power > 1 that might need fixing
  const result = await pool.query(`
    SELECT id, user_id, asset_id, quantity, power, power_level
    FROM holdings
    WHERE power > 1
    ORDER BY user_id, asset_id
  `);

  console.log(`Checking ${result.rows.length} powered holdings:\n`);

  for (const row of result.rows) {
    // If quantity = 1 but power != power_level, they don't match
    // For correct format: quantity=1, power should equal power_level
    const powerAsNum = parseFloat(row.power || "0");
    const powerLevelAsNum = parseFloat(row.power_level || "0");

    // Check for the buggy format: quantity=1, power=160, power_level=160
    // This should be: quantity=1, power=32, power_level=32
    // The bug was setting power = power_level instead of power = power_level / 5
    if (row.quantity === 1 && powerAsNum === powerLevelAsNum && powerAsNum > 50) {
      // This is the buggy format - power was set to power_level instead of power_level/5
      const correctPower = Math.round((powerLevelAsNum / 5) * 100) / 100;
      console.log(`Fixing: ${row.user_id} | ${row.asset_id}:`);
      console.log(
        `  Before: quantity=${row.quantity}, power=${row.power}, power_level=${row.power_level}`,
      );
      console.log(`  Note: power_level/5 = ${powerLevelAsNum}/5 = ${correctPower}`);

      await pool.query(
        `
        UPDATE holdings
        SET power = CAST($1 AS INTEGER),
            power_level = CAST($1 AS NUMERIC),
            last_updated = NOW()
        WHERE id = $2
      `,
        [correctPower.toString(), row.id],
      );

      console.log(`  After:  quantity=1, power=${correctPower}, power_level=${correctPower}`);
      console.log("");
    } else if (row.quantity === 1 && powerAsNum !== powerLevelAsNum) {
      console.log(`Fixing: ${row.user_id} | ${row.asset_id}:`);
      console.log(
        `  Before: quantity=${row.quantity}, power=${row.power}, power_level=${row.power_level}`,
      );

      // If power != power_level, one of them is wrong
      // The correct format is: power = power_level (when quantity=1)
      // Fix: set power_level = power
      await pool.query(
        `
        UPDATE holdings
        SET power_level = CAST($1 AS NUMERIC),
            last_updated = NOW()
        WHERE id = $2
      `,
        [powerAsNum.toString(), row.id],
      );

      console.log(`  After:  quantity=1, power=${row.power}, power_level=${row.power}`);
      console.log("");
    } else {
      console.log(
        `OK: ${row.user_id} | ${row.asset_id}: quantity=${row.quantity}, power=${row.power}, power_level=${row.power_level}`,
      );
    }
  }

  console.log("\nDone!");
}

fixPowerShares()
  .then(() => {
    pool.end();
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    pool.end();
    process.exit(1);
  });
