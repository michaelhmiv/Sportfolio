// Debug script to test directly through the server
import { DatabaseStorage } from "../server/storage.js";

async function main() {
  console.log("=== TESTING STORAGE DIRECTLY ===\n");

  const storage = new DatabaseStorage();

  // Try to get a user first
  console.log("Getting users...");
  const allUsers = await storage.getUsers();
  console.log(`Total users in DB: ${allUsers.length}`);

  if (allUsers.length === 0) {
    console.log("No users found in the database!");
    return;
  }

  const user = allUsers[0];
  console.log(`\nUsing user: ${user.email} (${user.id})`);

  // Get all holdings with players
  console.log("\nGetting all holdings with players...");
  const holdings = await storage.getAllHoldingsWithPlayers(user.id);
  console.log(`Total holdings: ${holdings.length}`);

  if (holdings.length > 0) {
    console.log("\nFirst 3 holdings:");
    holdings.slice(0, 3).forEach((h) => {
      console.log(
        `  - ${h.player.firstName} ${h.player.lastName} (${h.player.team}) - ${h.player.sport}`,
      );
      console.log(`    Quantity: ${h.quantity}, PowerLevel: ${h.powerLevel}`);
    });
  } else {
    console.log("No player holdings found!");
  }

  // Get daily games for today
  console.log("\nGetting today's games...");
  const today = new Date();
  const todayGames = await storage.getDailyGames(today);
  console.log(`Total games today: ${todayGames.length}`);

  todayGames.forEach((g) => {
    console.log(`  - ${g.homeTeam} vs ${g.awayTeam} (${g.sport})`);
  });

  // Check which player teams have games
  if (holdings.length > 0 && todayGames.length > 0) {
    console.log("\n=== PLAYER TEAMS VS GAMES ===");
    const gameTeams = new Set([
      ...todayGames.map((g) => g.homeTeam),
      ...todayGames.map((g) => g.awayTeam),
    ]);

    holdings.forEach((h) => {
      const hasGame = gameTeams.has(h.player.team);
      console.log(
        `  - ${h.player.team}: ${h.player.firstName} ${h.player.lastName} - ${hasGame ? "HAS GAME" : "NO GAME"}`,
      );
    });
  }
}

main().catch(console.error);
