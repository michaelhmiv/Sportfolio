import "dotenv/config";
import { db } from "../server/db";
import { users } from "@shared/schema";
import { inArray, eq } from "drizzle-orm";

async function main() {
  const botNames = ["MomentumBot", "ContestSpecialist", "ValueHunter", "Whale_Alpha"];

  const bots = await db
    .select({
      username: users.username,
      lastActiveAt: users.lastActiveAt,
      isBot: users.isBot,
    })
    .from(users)
    .where(inArray(users.username, botNames));

  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  console.log(`Current Time: ${now.toISOString()}`);
  console.log(`Cutoff: ${twentyFourHoursAgo.toISOString()}`);

  bots.forEach((b) => {
    const active = b.lastActiveAt && b.lastActiveAt > twentyFourHoursAgo;
    console.log(
      `${b.username}: ${b.lastActiveAt?.toISOString() || "NULL"} - ${active ? "ACTIVE" : "INACTIVE"}`,
    );
  });
}

main()
  .catch(console.error)
  .finally(() => process.exit());
