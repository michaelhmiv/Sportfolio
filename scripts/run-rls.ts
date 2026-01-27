
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DATABASE_URL = process.env.DATABASE_URL;
const ENV = process.env.NODE_ENV || 'development';

// Use DEV_DATABASE_URL for development, DATABASE_URL for production
const targetDbUrl = ENV === 'development' ? process.env.DEV_DATABASE_URL : DATABASE_URL;

if (!targetDbUrl) {
    console.error(`${ENV}: DATABASE_URL not set`);
    process.exit(1);
}

console.log(`Running on ${ENV} database...`);

const client = new Client({ connectionString: targetDbUrl });

(async () => {
    try {
        await client.connect();

        // Use fix-rls.sql which has all the policies including new tables
        const sqlPath = path.resolve(process.cwd(), 'scripts', 'fix-rls.sql');
        console.log('SQL Path:', sqlPath);

        if (!fs.existsSync(sqlPath)) {
            throw new Error(`File not found: ${sqlPath}`);
        }

        const sql = fs.readFileSync(sqlPath, 'utf8');
        console.log('Read SQL file, length:', sql.length);

        console.log('Running RLS fix script...');
        const result = await client.query(sql);

        console.log('RLS policies applied successfully!');
        if (Array.isArray(result)) {
            const lastResult = result[result.length - 1];
            if (lastResult.rows) console.log(lastResult.rows);
        } else if (result.rows) {
            console.log(result.rows);
        }
    } catch (error) {
        console.error('FULL ERROR:', error);
    } finally {
        await client.end();
    }
})();
