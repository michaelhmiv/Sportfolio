import "dotenv/config";
import { db } from "../server/db";
import { scoutDistributions, users, scoutAssignments } from "../shared/schema";
import { eq, desc, sql } from "drizzle-orm";

async function check() {
  // Get the most recent distribution for dev-user-12345678
  console.log("=== Scout Distributions for dev-user-12345678 ===");
  const devDists = await db
    .select()
    .from(scoutDistributions)
    .where(eq(scoutDistributions.userId, "dev-user-12345678"))
    .orderBy(desc(scoutDistributions.hourTimestamp))
    .limit(5);

  console.log(`Found ${devDists.length} distributions`);
  devDists.forEach((d) => {
    console.log(`  ${d.hourTimestamp}: ${d.playerId} | ${d.sharesEarned} shares`);
  });

  // Now let's see what users have scout assignments
  console.log("\n=== Users with scout assignments ===");
  const userStats = await db
    .select({
      userId: scoutAssignments.userId,
      username: users.username,
      totalScouts: sql<number>`SUM(${scoutAssignments.scoutCount})`.as(),
    })
    .from(scoutAssignments)
    .innerJoin(users, eq(scoutAssignments.userId, users.id))
    .groupBy(scoutAssignments.userId, users.username);

  userStats.forEach((u) => {
    console.log(`  ${u.username}: ${u.totalScouts} scouts`);
  });

  // Check balance for dev_user
  console.log("\n=== dev-user-12345678 balance ===");
  const [devUser] = await db.select().from(users).where(eq(users.id, "dev-user-12345678"));
  console.log(`  Username: ${devUser?.username}`);
  console.log(`  Balance: $${devUser?.balance}`);
}

check().catch(console.error);
