import "dotenv/config";
import { db } from "../server/db";
import { scoutAssignments, users, players } from "@shared/schema";
import { eq, like, and, or } from "drizzle-orm";

async function main() {
  console.log("Searching for 'Cade' or 'Cunningham'...");

  const candidates = await db.query.players.findMany({
    where: or(like(players.firstName, "Cade%"), like(players.lastName, "Cunningham%")),
    limit: 10,
  });

  console.log(`Found ${candidates.length} candidates:`);
  candidates.forEach((c) => console.log(`- ${c.firstName} ${c.lastName} (${c.id})`));

  for (const c of candidates) {
    if (c.firstName === "Cade" && c.lastName === "Cunningham") {
      console.log(`
Inspecting ${c.firstName} ${c.lastName} (${c.id})...`);

      // Check raw assignments
      const assignments = await db
        .select()
        .from(scoutAssignments)
        .where(eq(scoutAssignments.playerId, c.id));

      console.log(`Raw Assignments: ${assignments.length}`);
      console.log(assignments);

      // Check joined query
      const joined = await db
        .select({
          username: users.username,
        })
        .from(scoutAssignments)
        .innerJoin(users, eq(scoutAssignments.userId, users.id))
        .where(eq(scoutAssignments.playerId, c.id));

      console.log(`Joined Results: ${joined.length}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit());
