import "dotenv/config";
import { db } from "../server/db";
import { scoutDistributions } from "../shared/schema";
import { desc } from "drizzle-orm";

async function check() {
  const dists = await db
    .select()
    .from(scoutDistributions)
    .orderBy(desc(scoutDistributions.hourTimestamp))
    .limit(10);

  console.log("Recent scout distributions:");
  dists.forEach((d) => {
    console.log(
      `${d.hourTimestamp}: ${d.userId.substring(0, 8)}... | ${d.playerId} | ${d.sharesEarned} shares`,
    );
  });
}

check().catch(console.error);
