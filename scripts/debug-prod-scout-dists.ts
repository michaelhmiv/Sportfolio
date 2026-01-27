import 'dotenv/config';
import { Pool } from 'pg';

async function checkScoutDistributions() {
  console.log("=== Checking Scout Distribution Data ===\n");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  const userId = 'dev-user-12345678';

  // Check scout_history for this user
  console.log("--- Scout History ---");
  const history = await client.query(`
    SELECT *
    FROM scout_history
    WHERE user_id = $1
    ORDER BY started_at DESC
    LIMIT 20
  `, [userId]);

  console.log(`History records: ${history.rows.length}`);
  for (const h of history.rows) {
    console.log(`  Player ${h.player_id}: ${h.scout_count} scouts, ${h.started_at} -> ${h.ended_at || 'OPEN'}`);
  }

  // Check scout_assignments
  console.log("\n--- Scout Assignments ---");
  const assignments = await client.query(`
    SELECT *
    FROM scout_assignments
    WHERE user_id = $1
  `, [userId]);

  console.log(`Assignments: ${assignments.rows.length}`);
  for (const a of assignments.rows) {
    console.log(`  Player ${a.player_id}: ${a.scout_count} scouts`);
  }

  // Check scout_distributions table (different from scout_history)
  console.log("\n--- Scout Distributions Table ---");
  const distTable = await client.query(`
    SELECT *
    FROM scout_distributions
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 20
  `, [userId]);

  console.log(`Distribution records: ${distTable.rows.length}`);
  for (const d of distTable.rows) {
    console.log(`  ${d.created_at}: ${d.shares_earned} shares for ${d.player_id}`);
  }

  // Check the ledger table
  console.log("\n--- Scout Distribution Ledger ---");
  const ledger = await client.query(`
    SELECT *
    FROM scout_distribution_ledger
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 20
  `, [userId]);

  console.log(`Ledger records: ${ledger.rows.length}`);
  for (const l of ledger.rows) {
    console.log(`  ${l.created_at}: ${l.shares_earned} shares for ${l.player_id}`);
  }

  // Check the job execution log for scout distribution
  console.log("\n--- Job Execution Log (Scout) ---");
  const jobs = await client.query(`
    SELECT *
    FROM job_execution_logs
    WHERE job_name LIKE '%scout%'
    ORDER BY created_at DESC
    LIMIT 10
  `);

  console.log(`Job logs: ${jobs.rows.length}`);
  for (const j of jobs.rows) {
    console.log(`  ${j.created_at}: ${j.job_name} - ${j.status} - ${j.message || 'no message'}`);
  }

  await client.release();
  await pool.end();
}

checkScoutDistributions().catch(console.error);
