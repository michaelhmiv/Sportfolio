/**
 * Test with the exact player the user is trying: nba_9325
 */
import { executeBuy } from '../server/amm/pool';
import { pool } from '../server/db';

async function testBuy() {
    try {
        const playerId = 'nba_9325';
        const userId = 'dev-user-12345678';

        // Check if pool exists for this player
        const poolResult = await pool.query(`
      SELECT player_id, shares, play_money 
      FROM player_pools 
      WHERE player_id = $1
    `, [playerId]);

        if (poolResult.rows.length === 0) {
            console.log('NO POOL EXISTS for player', playerId);
            return;
        }

        console.log('Pool state:', poolResult.rows[0]);

        // Check if user exists
        const userResult = await pool.query(`SELECT id, balance FROM users WHERE id = $1`, [userId]);
        console.log('User:', userResult.rows[0] || 'NOT FOUND');

        console.log('\nExecuting buy...');
        const result = await executeBuy(playerId, userId, 10, 0.05);
        console.log('\nResult:', JSON.stringify(result, null, 2));

    } catch (error: any) {
        console.error('ERROR:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await pool.end();
    }
}

testBuy();
