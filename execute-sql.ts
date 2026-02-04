import { pool } from './server/db.ts';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function executeSqlScript() {
  console.log('🔧 AMM Tables SQL Executor\n');
  
  try {
    // Read SQL file
    const sqlPath = join(__dirname, 'scripts', 'fix-amm-tables.sql');
    console.log(`📄 Reading SQL file: ${sqlPath}`);
    
    const sqlContent = readFileSync(sqlPath, 'utf-8');
    
    // Split SQL into individual statements more carefully
    // First remove comments, then split by semicolons that end statements
    const cleanedSql = sqlContent
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');
    
    const statements = cleanedSql
      .split(/;\s*(?=\n|$)/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    console.log(`📊 Found ${statements.length} SQL statements\n`);
    console.log('=' .repeat(60));
    
    const results = {
      success: [] as string[],
      failed: [] as { statement: string; error: string }[],
    };
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const firstLine = statement.split('\n')[0].trim();
      const displayName = firstLine.length > 50 
        ? firstLine.substring(0, 50) + '...' 
        : firstLine;
      
      console.log(`\n${i + 1}/${statements.length}: ${displayName}`);
      
      try {
        const result = await pool.query(statement);
        
        // Handle different result types
        if (result.command === 'SELECT') {
          console.log(`  ✅ SELECT - ${result.rowCount} rows`);
          if (result.rows.length > 0) {
            console.log('  Results:');
            result.rows.forEach(row => {
              console.log(`    - ${JSON.stringify(row)}`);
            });
          }
        } else if (result.command === 'CREATE') {
          console.log(`  ✅ ${result.command} - Success`);
        } else if (result.command === 'INSERT') {
          console.log(`  ✅ ${result.command} - ${result.rowCount} rows affected`);
        } else {
          console.log(`  ✅ ${result.command} - ${result.rowCount || 'Success'}`);
        }
        
        results.success.push(displayName);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`  ❌ FAILED: ${errorMessage}`);
        results.failed.push({ statement: displayName, error: errorMessage });
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('\n📋 SUMMARY:');
    console.log(`  ✅ Successful: ${results.success.length}`);
    console.log(`  ❌ Failed: ${results.failed.length}`);
    
    if (results.failed.length > 0) {
      console.log('\n  Failed Statements:');
      results.failed.forEach((f, i) => {
        console.log(`    ${i + 1}. ${f.statement}`);
        console.log(`       Error: ${f.error}`);
      });
    }
    
    console.log('\n✨ Script execution complete!');
    
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

executeSqlScript();
