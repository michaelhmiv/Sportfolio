import 'dotenv/config';
import { db } from "../server/db";
import { users, players, holdings, dailyGames } from "../shared/schema";
import { eq, and, gte, lt } from "drizzle-orm";
import { getTodayET, getETDayBoundaries } from "../server/lib/time";

async function check() {
  const { startOfDay, endOfDay } = getETDayBoundaries(getTodayET());
  const mockUserId = 'dev-user-12345678';

  console.log("=== Checking all user holdings by sport ===\n");

  // Get all user holdings with player info
  const userHoldings = await db.select({
      holding: holdings,
      player: players
  })
      .from(holdings)
      .innerJoin(players, eq(holdings.assetId, players.id))
      .where(eq(holdings.userId, mockUserId));

  console.log(`Total holdings: ${userHoldings.length}\n`);

  // Group by sport
  const bySport = new Map<string, typeof userHoldings>();
  for (const h of userHoldings) {
    const sport = h.player.sport;
    if (!bySport.has(sport)) bySport.set(sport, []);
    bySport.get(sport)!.push(h);
  }

  for (const [sport, holdings] of bySport) {
    console.log(`=== ${sport} (${holdings.length} players) ===`);
    const teams = [...new Set(holdings.map(h => h.player.team))];
    console.log(`Teams: ${teams.join(', ')}`);

    // Get games for this sport today
    const todaysGames = await db.select().from(dailyGames)
        .where(and(
            eq(dailyGames.sport, sport),
            gte(dailyGames.startTime, startOfDay),
            lt(dailyGames.startTime, endOfDay)
        ));

    const gameTeams = new Set<string>();
    for (const g of todaysGames) {
      gameTeams.add(g.homeTeam);
      gameTeams.add(g.awayTeam);
    }

    console.log(`Games today: ${todaysGames.length} games`);
    console.log(`Teams playing: ${[...gameTeams].sort().join(', ')}`);

    const matchingTeams = teams.filter(t => gameTeams.has(t));
    console.log(`User teams with games: ${matchingTeams.length > 0 ? matchingTeams.join(', ') : 'NONE'}`);
    console.log();
  }
}

check().catch(console.error);
