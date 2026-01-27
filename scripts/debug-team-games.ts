import 'dotenv/config';
import { db } from "../server/db";
import { users, players, holdings, dailyGames } from "../shared/schema";
import { eq, and, gte, lt, or } from "drizzle-orm";
import { getTodayET, getETDayBoundaries } from "../server/lib/time";

const { startOfDay, endOfDay } = getETDayBoundaries(getTodayET());

async function debug() {
  console.log("=== Checking all NBA games in database ===\n");
  console.log("Date range:", startOfDay.toISOString(), "to", endOfDay.toISOString());

  // Get ALL games in the database regardless of date
  const allGames = await db.select().from(dailyGames).where(eq(dailyGames.sport, 'NBA'));
  console.log("\nTotal NBA games in database:", allGames.length);

  // Group by date
  const gamesByDate = new Map<string, typeof allGames>();
  for (const game of allGames) {
    const dateKey = new Date(game.startTime).toISOString().split('T')[0];
    if (!gamesByDate.has(dateKey)) gamesByDate.set(dateKey, []);
    gamesByDate.get(dateKey)!.push(game);
  }

  console.log("\nGames by date:");
  for (const [date, games] of gamesByDate) {
    console.log(`\n${date}: ${games.length} games`);
    for (const g of games) {
      console.log(`  ${g.awayTeam} @ ${g.homeTeam} | ${g.status} | ${new Date(g.startTime).toISOString()}`);
    }
  }

  // Check user teams specifically
  console.log("\n\n=== Checking user teams ===");
  const userHoldings = await db.select({
      holding: holdings,
      player: players
  })
      .from(holdings)
      .innerJoin(players, eq(holdings.assetId, players.id))
      .where(and(
          eq(holdings.userId, 'dev-user-12345678'),
          eq(holdings.assetType, 'player'),
          eq(players.sport, 'NBA')
      ));

  const userTeams = [...new Set(userHoldings.map(h => h.player.team))];
  console.log("User teams:", userTeams.join(', '));

  // Search for games with ANY of these teams (in any time range)
  console.log("\n=== Searching for games with user teams (all time) ===");
  for (const team of userTeams) {
    const teamGames = await db.select().from(dailyGames).where(
      or(
        eq(dailyGames.homeTeam, team),
        eq(dailyGames.awayTeam, team)
      )
    );
    console.log(`\n${team} games (${teamGames.length} total):`);
    for (const g of teamGames.slice(0, 10)) {
      console.log(`  ${g.date}: ${g.awayTeam} @ ${g.homeTeam} | ${g.status} | ${new Date(g.startTime).toISOString()}`);
    }
  }

  // Check exact teams in today's games
  console.log("\n\n=== Today's games with exact team names ===");
  const todaysGames = await db.select().from(dailyGames)
      .where(and(
          eq(dailyGames.sport, 'NBA'),
          gte(dailyGames.startTime, startOfDay),
          lt(dailyGames.startTime, endOfDay)
      ));

  console.log("Today's games:");
  for (const g of todaysGames) {
    console.log(`  ${g.awayTeam} @ ${g.homeTeam} - ${g.status}`);
  }
}

debug().catch(console.error);
