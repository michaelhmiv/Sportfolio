/**
 * Data cleanup script for holdings power level consistency.
 *
 * This script fixes the exact failure mode you reported:
 * - holdings.quantity updated (e.g. vesting credit), but holdings.power_level not updated
 *   -> UI can show huge share counts with tiny power.
 *
 * Actions:
 * 1) Deletes zero-quantity player holdings (junk rows)
 * 2) Updates holdings.power_level = ROUND(quantity * power, 2)
 * 3) Cancels ACTIVE daily boosts where shares_entered != 1 (prevents burning a full position)
 */

import "dotenv/config";
import { Pool } from "pg";

const databaseUrl = process.env.DEV_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("Missing DEV_DATABASE_URL or DATABASE_URL in environment");
  process.exit(1);
}

const resolvedDatabaseUrl = databaseUrl;

async function cleanup() {
  console.log("\n=== Holdings Data Cleanup (SQL) ===\n");

  const pool = new Pool({
    connectionString: resolvedDatabaseUrl,
    // Supabase/prod commonly requires SSL; local typically does not.
    ssl: resolvedDatabaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });

  const client = await pool.connect();

  try {
    const [{ count: totalHoldings }] = (
      await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM holdings WHERE asset_type = 'player'`,
      )
    ).rows;

    const [{ count: inconsistentBefore }] = (
      await client.query<{ count: string }>(
        `
            SELECT COUNT(*)::text AS count
            FROM holdings
            WHERE asset_type = 'player'
              AND power_level <> ROUND((quantity * power)::numeric, 2)
            `,
      )
    ).rows;

    const [{ count: zeroQtyBefore }] = (
      await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM holdings WHERE asset_type = 'player' AND quantity = 0`,
      )
    ).rows;

    console.log(`Player holdings: ${totalHoldings}`);
    console.log(`Inconsistent power_level rows: ${inconsistentBefore}`);
    console.log(`Zero-quantity rows: ${zeroQtyBefore}`);

    const deleted = await client.query(
      `DELETE FROM holdings WHERE asset_type = 'player' AND quantity = 0`,
    );
    console.log(`\nDeleted zero-quantity holdings: ${deleted.rowCount ?? 0}`);

    const updated = await client.query(
      `
            UPDATE holdings
            SET power_level = ROUND((quantity * power)::numeric, 2),
                last_updated = NOW()
            WHERE asset_type = 'player'
              AND power_level <> ROUND((quantity * power)::numeric, 2)
            `,
    );
    console.log(`Updated holdings.power_level rows: ${updated.rowCount ?? 0}`);

    const [{ count: badActiveBoosts }] = (
      await client.query<{ count: string }>(
        `
            SELECT COUNT(*)::text AS count
            FROM daily_boosts
            WHERE status = 'active'
              AND shares_entered <> 1
            `,
      )
    ).rows;

    if (Number(badActiveBoosts) > 0) {
      console.log(`\nFound ACTIVE boosts with shares_entered != 1: ${badActiveBoosts}`);
      const cancelled = await client.query(
        `
                UPDATE daily_boosts
                SET status = 'cancelled'
                WHERE status = 'active'
                  AND shares_entered <> 1
                `,
      );
      console.log(`Cancelled boosts: ${cancelled.rowCount ?? 0}`);
    } else {
      console.log("\nNo ACTIVE boosts with shares_entered != 1 found.");
    }

    const [{ count: inconsistentAfter }] = (
      await client.query<{ count: string }>(
        `
            SELECT COUNT(*)::text AS count
            FROM holdings
            WHERE asset_type = 'player'
              AND power_level <> ROUND((quantity * power)::numeric, 2)
            `,
      )
    ).rows;

    console.log(`\nRemaining inconsistent holdings rows: ${inconsistentAfter}`);
    console.log("\n=== Cleanup Complete ===\n");
  } finally {
    client.release();
    await pool.end();
  }
}

cleanup().catch((err) => {
  console.error(err);
  process.exit(1);
});
