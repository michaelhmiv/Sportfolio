import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

async function main() {
    console.log("Applying migration 0005_scout_history.sql...");
    
    const migrationPath = path.join(process.cwd(), "migrations", "0005_scout_history.sql");
    const migrationSql = fs.readFileSync(migrationPath, "utf-8");
    
    // Split by semicolon to handle multiple statements if driver doesn't support batch
    // But pg driver usually does. Let's try raw execute first.
    
    try {
        await db.execute(sql.raw(migrationSql));
        console.log("Migration applied successfully!");
    } catch (err: any) {
        console.error("Migration failed:", err.message);
        // Fallback: Split by ;
        if (err.message.includes("syntax error") || err.message.includes("cannot insert multiple commands")) {
             console.log("Retrying with split statements...");
             const statements = migrationSql.split(';').filter(s => s.trim().length > 0);
             for (const stmt of statements) {
                 await db.execute(sql.raw(stmt));
             }
             console.log("Split migration applied successfully!");
        }
    }
}

main().catch(console.error).finally(() => process.exit());
