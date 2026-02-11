import "dotenv/config";
import { db, pool } from "../server/db";
import { scoutAssignments, users, players } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

async function main() {
  console.log("Checking DB connection...");

  const tables = await db.execute(sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
    `);

  console.log("Tables found:", tables.rows.map((r: any) => r.table_name).join(", "));

  // If scout_assignments exists, query it
  if (tables.rows.some((r: any) => r.table_name === "scout_assignments")) {
    console.log("\nInspecting Scout Assignments...");
    const assignments = await db
      .select({
        userId: scoutAssignments.userId,
        username: users.username,
        playerId: scoutAssignments.playerId,
        count: scoutAssignments.scoutCount,
      })
      .from(scoutAssignments)
      .leftJoin(users, eq(scoutAssignments.userId, users.id))
      .limit(10);

    console.log("Assignments Sample:", assignments);
  } else {
    console.error("scout_assignments table MISSING!");
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit());
