import 'dotenv/config';
import { db } from "../server/db";
import { storage } from "../server/storage";
import { holdings, players } from "../shared/schema";
import { eq, and } from "drizzle-orm";
import { getTodayET, getETDayBoundaries } from "../server/lib/time";

async function test() {
  const userId = 'dev-user-12345678';
  const todayET = getTodayET();
  const { startOfDay, endOfDay } = getETDayBoundaries(todayET);

  console.log('=== Testing API Response ===');

  // Get all holdings with players
  const allHoldings = await storage.getAllHoldingsWithPlayers(userId);
  console.log('allHoldings count:', allHoldings.length);

  // Check each holding
  for (const h of allHoldings) {
    console.log('  -', h.player.firstName, h.player.lastName, '- qty:', h.quantity, 'pl:', h.powerLevel);
  }

  // Check raw holdings
  const rawHoldings = await db.select().from(holdings).where(and(eq(holdings.userId, userId), eq(holdings.assetType, 'player')));
  console.log('raw holdings:', rawHoldings.length);

  console.log('=== Done ===');
}

test().catch(console.error);
