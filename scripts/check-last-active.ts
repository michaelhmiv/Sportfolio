import "dotenv/config";
import { db } from "../server/db";
import { users, scoutHistory } from "../shared/schema";
import { eq, desc } from "drizzle-orm";

async function check() {
  const [devUser] = await db.select().from(users).where(eq(users.id, "dev-user-12345678"));
  console.log(`dev-user lastActiveAt: ${devUser?.lastActiveAt}`);

  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  console.log(`24 hours ago: ${twentyFourHoursAgo.toISOString()}`);

  // Is dev_user considered "active"?
  const isActive = devUser?.lastActiveAt && new Date(devUser.lastActiveAt) > twentyFourHoursAgo;
  console.log(`Is dev_user active (lastActiveAt > 24h ago)? ${isActive}`);

  // The issue: the scout_history query doesn't filter by user being active
  // It filters by users.last_active_at in the CTE
  console.log("\nThe scout_distribution job has a bug:");
  console.log("  - It filters to only include users who were active in the last 24h");
  console.log("  - But dev_user has NOT called any scout API since Jan 18");
  console.log("  - So dev_user is being excluded from the distribution!");
}

check().catch(console.error);
