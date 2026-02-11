import "dotenv/config";
import { db } from "../server/db";
import { users, players, holdings, dailyGames } from "../shared/schema";
import { eq, and, gte, lt } from "drizzle-orm";
import { getTodayET, getETDayBoundaries } from "../server/lib/time";

async function debug() {
  console.log("=== Team Abbreviation Debug ===");

  // 1. Get today's games teams
  const todayET = getTodayET();
  const { startOfDay, endOfDay } = getETDayBoundaries(todayET);

  const todaysGames = await db
    .select()
    .from(dailyGames)
    .where(
      and(
        eq(dailyGames.sport, "NBA"),
        gte(dailyGames.startTime, startOfDay),
        lt(dailyGames.startTime, endOfDay),
      ),
    );

  const gameTeams = new Set<string>();
  todaysGames.forEach((g) => {
    gameTeams.add(g.homeTeam);
    gameTeams.add(g.awayTeam);
  });

  console.log(`\nGames Teams (${gameTeams.size}):`);
  console.log(Array.from(gameTeams).sort().join(", "));

  // 2. Get user's player teams
  // Just get ALL distinct teams from players that ANY user holds, to be safe, or just our test user?
  // Let's get the test user from before (assuming it's the one logged in)
  const [testUser] = await db.select().from(users).limit(1);
  if (!testUser) return;

  const userHoldings = await db
    .select({
      team: players.team,
    })
    .from(holdings)
    .innerJoin(players, eq(holdings.assetId, players.id))
    .where(
      and(
        eq(holdings.userId, testUser.id),
        eq(holdings.assetType, "player"),
        eq(players.sport, "NBA"),
        gte(holdings.quantity, 0), // Just to filter valid holdings
      ),
    );

  const userTeams = new Set(userHoldings.map((h) => h.team));
  console.log(`\nUser Holdings Teams (${userTeams.size}):`);
  console.log(Array.from(userTeams).sort().join(", "));

  // 3. Intersection
  const overlap = Array.from(userTeams).filter((t) => gameTeams.has(t));
  console.log(`\nOverlap: ${overlap.join(", ")}`);

  if (overlap.length === 0) {
    console.log("!!! NO OVERLAP FOUND !!!");
  }
}

debug().catch(console.error);
