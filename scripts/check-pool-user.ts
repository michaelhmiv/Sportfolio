/**
 * Check RLS on users table
 */
import { pool } from '../server/db';

async function checkUsersRLS() {
    try {
        // Check if RLS is enabled on users table
        const rlsResult = await pool.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = 'users' AND relkind = 'r'
    `);
        console.log('RLS on public.users:', rlsResult.rows);

        // Get RLS policies on users table
        const policiesResult = await pool.query(`
      SELECT policyname, tablename, roles, cmd, qual, with_check
      FROM pg_policies
      WHERE tablename = 'users' AND schemaname = 'public'
    `);
        console.log('\nRLS Policies on public.users:');
        policiesResult.rows.forEach(row => {
            console.log(`  ${row.policyname} (${row.cmd}): ${row.qual || row.with_check || 'no condition'}`);
        });

        // Check current role
        const roleResult = await pool.query(`SELECT current_user, session_user, current_setting('role')`);
        console.log('\nCurrent roles:', roleResult.rows);

        // Try selecting pool user with different approaches
        console.log('\nDirect SELECT for pool user:');
        const directResult = await pool.query(`SELECT id FROM public.users WHERE id = 'pool'`);
        console.log('  Result:', directResult.rows);

    } catch (error: any) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkUsersRLS();
