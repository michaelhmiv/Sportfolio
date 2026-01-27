import 'dotenv/config';
import { db } from "../server/db";
import { dailyGames, players } from "../shared/schema";
import { eq, or, and, gte, lt } from "drizzle-orm";

async function check() {
  console.log("=== Checking for games involving user's teams ===\n");

  const userTeams = ['CLE', 'ORL', 'NYK', 'DET', 'NOP'];
  const teamsWithGames = new Set<string>();

  // Check what games exist for each team in the entire database
  for (const team of userTeams) {
    const games = await db.select().from(dailyGames).where(
      or(eq(dailyGames.homeTeam, team), eq(dailyGames.awayTeam, team))
    );

    if (games.length > 0) {
      console.log(`${team} has ${games.length} games in DB`);
      // Show recent and upcoming games
      const sorted = [...games].sort((a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );
      const recentGames = sorted.filter(g => new Date(g.startTime) > new Date('2026-01-15'));
      console.log('  Recent/upcoming:', recentGames.map(g =>
        `${new Date(g.startTime).toISOString().split('T')[0]}: ${g.awayTeam} @ ${g.homeTeam} (${g.status})`
      ).join(', '));
    } else {
      console.log(`${team} has NO games in database!`);
    }
  }

  // Check all unique teams that have games in next 7 days
  console.log("\n=== All teams with games in next 7 days ===");
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 7);

  const allFutureGames = await db.select().from(dailyGames).where(
    and(
      gte(dailyGames.startTime, new Date()),
      lt(dailyGames.startTime, futureDate)
    )
  );

  const allTeams = new Set<string>();
  for (const g of allFutureGames) {
    allTeams.add(g.homeTeam);
    allTeams.add(g.awayTeam);
  }

  console.log("Teams with games:", [...allTeams].sort().join(', '));

  // Check if any of user's teams are missing entirely from all games
  const allGames = await db.select().from(dailyGames);
  const allGameTeams = new Set<string>();
  for (const g of allGames) {
    allGameTeams.add(g.homeTeam);
    allGameTeams.add(g.awayTeam);
  }

  console.log("\n=== User teams in game database ===");
  for (const team of userTeams) {
    const hasGames = allGameTeams.has(team);
    console.log(`${team}: ${hasGames ? 'IN DATABASE' : 'MISSING FROM ALL GAMES'}`);
  }
}

check().catch(console.error);
