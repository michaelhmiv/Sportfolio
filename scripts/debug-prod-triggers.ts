import 'dotenv/config';
import { Pool } from 'pg';

async function checkTriggers() {
  console.log("=== Checking Holdings Table Triggers ===\n");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();

  // Check for triggers on holdings
  console.log("--- Triggers on Holdings ---");
  const triggers = await client.query(`
    SELECT
      tgname,
      tgrelid::regclass as table_name,
      tgtype,
      pg_get_triggerdef(oid) as trigger_def
    FROM pg_trigger
    WHERE tgrelid = 'holdings'::regclass
  `);

  if (triggers.rows.length > 0) {
    for (const t of triggers.rows) {
      console.log(`Trigger: ${t.tgname}`);
      console.log(`  Definition: ${t.trigger_def}`);
      console.log();
    }
  } else {
    console.log("No triggers found on holdings table");
  }

  // Check for rules
  console.log("\n--- Rules on Holdings ---");
  const rules = await client.query(`
    SELECT rulename, definition
    FROM pg_rules
    WHERE tablename = 'holdings'
  `);

  if (rules.rows.length > 0) {
    for (const r of rules.rows) {
      console.log(`Rule: ${r.rulename}`);
      console.log(`  ${r.definition}`);
    }
  } else {
    console.log("No rules found");
  }

  // Check if power_level has a default or computed column
  console.log("\n--- Column Info ---");
  const cols = await client.query(`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'holdings'
    AND column_name IN ('power', 'power_level', 'quantity')
    ORDER BY column_name
  `);

  for (const c of cols.rows) {
    console.log(`${c.column_name}: ${c.data_type}, default=${c.column_default}, nullable=${c.is_nullable}`);
  }

  // Check for generated columns
  console.log("\n--- Generated Columns ---");
  const generated = await client.query(`
    SELECT column_name, generation_expression, is_generated
    FROM information_schema.columns
    WHERE table_name = 'holdings'
    AND is_generated = 'ALWAYS'
  `);

  if (generated.rows.length > 0) {
    for (const g of generated.rows) {
      console.log(`Generated column: ${g.column_name}`);
      console.log(`  Expression: ${g.generation_expression}`);
    }
  } else {
    console.log("No generated columns");
  }

  await client.release();
  await pool.end();
}

checkTriggers().catch(console.error);
