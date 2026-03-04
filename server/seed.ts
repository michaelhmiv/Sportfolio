import { db } from "./db";
import { users, players, vesting, holdings, dailyGames } from "@shared/schema";

async function seed() {
  console.log("Seeding database...");

  const [user] = await db
    .insert(users)
    .values({
      username: "demo",
      balance: "10000.00",
    })
    .onConflictDoUpdate({
      target: users.username,
      set: { balance: "10000.00" },
    })
    .returning();

  console.log("Created user:", user.username);

  const mockPlayers = [
    {
      id: "lebron-james",
      firstName: "LeBron",
      lastName: "James",
      currentTeam: { abbreviation: "LAL" },
      primaryPosition: "F",
      jerseyNumber: "23",
    },
    {
      id: "stephen-curry",
      firstName: "Stephen",
      lastName: "Curry",
      currentTeam: { abbreviation: "GSW" },
      primaryPosition: "G",
      jerseyNumber: "30",
    },
    {
      id: "kevin-durant",
      firstName: "Kevin",
      lastName: "Durant",
      currentTeam: { abbreviation: "PHX" },
      primaryPosition: "F",
      jerseyNumber: "35",
    },
    {
      id: "giannis-antetokounmpo",
      firstName: "Giannis",
      lastName: "Antetokounmpo",
      currentTeam: { abbreviation: "MIL" },
      primaryPosition: "F",
      jerseyNumber: "34",
    },
  ];

  for (const player of mockPlayers) {
    await db
      .insert(players)
      .values({
        id: player.id,
        firstName: player.firstName,
        lastName: player.lastName,
        team: player.currentTeam?.abbreviation || "UNK",
        position: player.primaryPosition || "G",
        jerseyNumber: player.jerseyNumber || "",
        isActive: true,
        isEligibleForVesting: true,
        currentPrice: (10 + Math.random() * 20).toFixed(2),
        volume24h: Math.floor(Math.random() * 10000),
        priceChange24h: ((Math.random() - 0.5) * 10).toFixed(2),
      })
      .onConflictDoUpdate({
        target: players.id,
        set: {
          currentPrice: (10 + Math.random() * 20).toFixed(2),
          volume24h: Math.floor(Math.random() * 10000),
          priceChange24h: ((Math.random() - 0.5) * 10).toFixed(2),
        },
      });
  }

  console.log(`Seeded ${mockPlayers.length} players`);

  await db
    .insert(vesting)
    .values({
      userId: user.id,
      sharesAccumulated: 1200,
      playerId: "lebron-james",
    })
    .onConflictDoUpdate({
      target: vesting.userId,
      set: { sharesAccumulated: 1200, playerId: "lebron-james" },
    });

  console.log("Created vesting record");

  const someShares = [
    { playerId: "lebron-james", quantity: 50, avgCost: "12.50" },
    { playerId: "stephen-curry", quantity: 30, avgCost: "15.00" },
    { playerId: "kevin-durant", quantity: 20, avgCost: "18.00" },
  ];

  for (const share of someShares) {
    await db
      .insert(holdings)
      .values({
        userId: user.id,
        assetType: "player",
        assetId: share.playerId,
        quantity: share.quantity.toString(),
        avgCostBasis: share.avgCost,
        totalCostBasis: (share.quantity * parseFloat(share.avgCost)).toFixed(2),
      })
      .onConflictDoNothing();
  }

  console.log("Created holdings");

  const now = new Date();
  const etOffset = -5;
  const nowET = new Date(now.getTime() + etOffset * 60 * 60 * 1000);
  const startOfDayET = new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate(), 0, 0, 0);

  const game1StartET = new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate(), 17, 0, 0);
  const game2StartET = new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate(), 18, 30, 0);

  const mockGames = [
    {
      gameId: "game-1-today",
      homeTeam: "LAL",
      awayTeam: "GSW",
      date: new Date(startOfDayET.getTime() - etOffset * 60 * 60 * 1000),
      startTime: new Date(game1StartET.getTime() - etOffset * 60 * 60 * 1000),
      status: "scheduled" as const,
    },
    {
      gameId: "game-2-today",
      homeTeam: "MIL",
      awayTeam: "PHX",
      date: new Date(startOfDayET.getTime() - etOffset * 60 * 60 * 1000),
      startTime: new Date(game2StartET.getTime() - etOffset * 60 * 60 * 1000),
      status: "scheduled" as const,
    },
  ];

  for (const game of mockGames) {
    await db.insert(dailyGames).values(game).onConflictDoUpdate({
      target: dailyGames.gameId,
      set: game,
    });
  }

  console.log("Created mock games for today (ET timezone)");
  console.log("Seeding complete.");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed error:", err);
    process.exit(1);
  });
