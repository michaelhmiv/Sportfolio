// Debug script to test the eligible-all endpoint
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function getAllUsers() {
  const { data: users } = await supabase
    .from("users")
    .select("id, email, firstName, lastName")
    .limit(10);
  return users || [];
}

async function getUserHoldings(userId: string) {
  const { data: holdings } = await supabase
    .from("holdings")
    .select("*")
    .eq("userId", userId)
    .eq("assetType", "player");
  return holdings || [];
}

async function getPlayerInfo(playerIds: string[]) {
  if (playerIds.length === 0) return [];
  const { data: players } = await supabase
    .from("players")
    .select("*")
    .in("id", playerIds);
  return players || [];
}

async function getDailyGames() {
  const today = new Date();
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);

  const { data: games } = await supabase
    .from("daily_games")
    .select("*")
    .gte("date", startOfDay.toISOString())
    .lt("date", endOfDay.toISOString());
  return games || [];
}

async function main() {
  console.log("=== ALL USERS ===");
  const users = await getAllUsers();
  console.log(JSON.stringify(users, null, 2));

  if (users.length === 0) {
    console.log("No users found!");
    return;
  }

  // Use the first user
  const user = users[0];
  console.log(`\n=== USING USER: ${user.email} ===`);

  const holdings = await getUserHoldings(user.id);
  console.log(`\n=== HOLDINGS ===`);
  console.log(`Total holdings: ${holdings.length}`);
  if (holdings.length > 0) {
    console.log(JSON.stringify(holdings.slice(0, 3), null, 2));
  }

  const playerIds = holdings.map(h => h.assetId);
  const players = await getPlayerInfo(playerIds);
  console.log(`\n=== PLAYERS ===`);
  console.log(`Total players: ${players.length}`);

  const playerMap = new Map(players.map(p => [p.id, p]));
  holdings.forEach(h => {
    const player = playerMap.get(h.assetId);
    console.log(`  - ${player?.firstName} ${player?.lastName} (${player?.team}) - ${h.quantity} shares, powerLevel: ${h.powerLevel}`);
  });

  const games = await getDailyGames();
  console.log(`\n=== TODAY'S GAMES ===`);
  console.log(`Total games: ${games.length}`);
  games.forEach(g => {
    console.log(`  - ${g.homeTeam} vs ${g.awayTeam} (${g.sport}) at ${g.startTime}`);
  });

  // Check if any player teams have games
  console.log(`\n=== PLAYERS WITH GAMES TODAY ===`);
  const teamsWithGames = new Set([...games.map(g => g.homeTeam), ...games.map(g => g.awayTeam)]);
  holdings.forEach(h => {
    const player = playerMap.get(h.assetId);
    const hasGame = teamsWithGames.has(player?.team);
    console.log(`  - ${player?.firstName} ${player?.lastName}: ${player?.team} - ${hasGame ? 'HAS GAME' : 'NO GAME'}`);
  });
}

main().catch(console.error);
