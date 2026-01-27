/**
 * Script to credit pending community shares for users who paid but weren't credited.
 * This fixes the bug where community purchases weren't credited due to webhook issues.
 */

require('dotenv').config();
const { Client } = require('pg');

const client = new Client(process.env.DEV_DATABASE_URL);

async function creditPendingCommunityShares() {
  await client.connect();

  try {
    // Get all pending community checkout sessions
    const sessionsResult = await client.query(`
      SELECT * FROM community_checkout_sessions
      WHERE status = 'pending'
      ORDER BY created_at DESC
    `);

    const sessions = sessionsResult.rows;
    console.log(`Found ${sessions.length} pending community checkout sessions\n`);

    for (const session of sessions) {
      console.log(`Processing session ${session.id} for user ${session.user_id}`);
      console.log(`  Plan ID: ${session.plan_id}`);
      console.log(`  Quantity: ${session.quantity}`);
      console.log(`  Amount: $${session.amount_cents / 100}`);
      console.log(`  Created: ${session.created_at}`);

      // Check if user already has community shares
      const holdingResult = await client.query(`
        SELECT * FROM holdings
        WHERE user_id = $1 AND asset_type = 'community' AND asset_id = 'community'
      `, [session.user_id]);

      let currentQty = 0;
      if (holdingResult.rows.length > 0) {
        currentQty = parseInt(holdingResult.rows[0].quantity);
        console.log(`  Current community shares: ${currentQty}`);
      } else {
        console.log(`  No existing community shares`);
      }

      // Calculate new values
      const sessionQty = parseInt(session.quantity);
      const newQty = currentQty + sessionQty;
      const avgCost = 1.0000;
      const totalCost = newQty * avgCost;

      if (holdingResult.rows.length > 0) {
        await client.query(`
          UPDATE holdings
          SET quantity = $1, avg_cost_basis = $2, total_cost_basis = $3, last_updated = NOW(), power_level = $4, power = 1
          WHERE id = $5
        `, [newQty, avgCost, totalCost, newQty, holdingResult.rows[0].id]);
        console.log(`  Updated holding: ${currentQty} -> ${newQty}`);
      } else {
        await client.query(`
          INSERT INTO holdings (user_id, asset_type, asset_id, quantity, avg_cost_basis, total_cost_basis, last_updated, power_level, power)
          VALUES ($1, 'community', 'community', $2, $3, $4, NOW(), $5, 1)
        `, [session.user_id, sessionQty, avgCost, totalCost, sessionQty]);
        console.log(`  Created new holding: ${sessionQty} shares`);
      }

      // Mark session as completed
      await client.query(`
        UPDATE community_checkout_sessions
        SET status = 'completed', completed_at = NOW(), receipt_id = 'manual_fix_' || NOW()::text
        WHERE id = $1
      `, [session.id]);
      console.log(`  Marked session as completed\n`);
    }

    console.log('Done!');

    // Show final holdings
    console.log('\n=== ALL COMMUNITY HOLDINGS ===');
    const allHoldings = await client.query(`
      SELECT h.*, u.email
      FROM holdings h
      JOIN users u ON h.user_id = u.id
      WHERE h.asset_type = 'community'
      ORDER BY h.quantity DESC
    `);
    console.log(JSON.stringify(allHoldings.rows, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

creditPendingCommunityShares();
