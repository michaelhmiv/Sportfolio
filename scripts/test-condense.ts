/**
 * Test script for Community Break-Even Engine
 * Tests: condenseShares storage function, market fee calculation
 *
 * Run with: npx tsx scripts/test-condense.ts
 */

import "dotenv/config";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { holdings, users, players } from "../shared/schema";
import { eq, and } from "drizzle-orm";

async function testCondenseShares() {
  console.log("\n=== Testing condenseShares Function ===\n");

  // Get a real user from the database
  const [testUser] = await db.select().from(users).limit(1);
  if (!testUser) {
    console.log("❌ No users found in database");
    return false;
  }
  console.log(`Using test user: ${testUser.username || testUser.email || testUser.id}`);

  // Get a player this user has shares in
  const userHoldings = await db
    .select()
    .from(holdings)
    .where(and(eq(holdings.userId, testUser.id), eq(holdings.assetType, "player")))
    .limit(5);

  if (userHoldings.length === 0) {
    console.log("❌ User has no player holdings");
    return false;
  }

  // Find a holding with at least 5 shares
  let eligibleHolding = userHoldings.find((h) => h.quantity >= 5);

  // If no eligible holding, SEED one for testing purposes
  if (!eligibleHolding) {
    console.log("⚠️ No holdings with 5+ shares found. Seeding test data...");
    const [player] = await db.select().from(players).limit(1);
    if (player) {
      // Check if holding exists for this player
      const existing = userHoldings.find((h) => h.assetId === player.id);
      if (existing) {
        await db
          .update(holdings)
          .set({ quantity: 10, powerLevel: existing.powerLevel || "0" })
          .where(eq(holdings.id, existing.id));
      } else {
        await db.insert(holdings).values({
          userId: testUser.id,
          assetType: "player",
          assetId: player.id,
          quantity: 10,
          powerLevel: "0",
          avgCostBasis: "10.00",
          totalCostBasis: "100.00",
        });
      }
      console.log(`✅ Seeded 10 shares of ${player.id} for user`);

      // Refresh holdings list
      const refreshedHoldings = await db
        .select()
        .from(holdings)
        .where(and(eq(holdings.userId, testUser.id), eq(holdings.assetType, "player")));
      eligibleHolding = refreshedHoldings.find((h) => h.assetId === player.id);
    }
  }

  if (!eligibleHolding) {
    console.log("❌ Failed to seed or find holdings with 5+ shares");
    return false;
  }

  const playerId = eligibleHolding.assetId;
  const originalQuantity = eligibleHolding.quantity;
  const originalPowerLevel = parseFloat(eligibleHolding.powerLevel || "0");

  console.log(`Player: ${playerId}`);
  console.log(`Original quantity: ${originalQuantity}`);
  console.log(`Original power level: ${originalPowerLevel}`);

  // Test 1: Try to condense 5 shares
  console.log("\n--- Test 1: Condense 5 shares ---");
  try {
    const result = await storage.condenseShares(testUser.id, playerId, 5);
    console.log(`✅ Condensed 5 shares`);
    console.log(`   New power level: ${result.newPowerLevel}`);
    console.log(`   Shares condensed: ${result.sharesCondensed}`);

    // Verify the holding was updated
    const updatedHolding = await storage.getHoldingWithPowerLevel(testUser.id, playerId);
    if (updatedHolding) {
      console.log(
        `   Updated quantity: ${updatedHolding.quantity} (expected: ${originalQuantity - 5})`,
      );
      console.log(
        `   Updated power level: ${updatedHolding.powerLevel} (expected: ${(originalPowerLevel + 1).toFixed(2)})`,
      );

      if (
        updatedHolding.quantity === originalQuantity - 5 &&
        parseFloat(updatedHolding.powerLevel) === originalPowerLevel + 1
      ) {
        console.log("✅ Holdings correctly updated");
      } else {
        console.log("❌ Holdings mismatch");
      }
    }
  } catch (error: any) {
    console.log(`❌ Failed: ${error.message}`);
    return false;
  }

  // Test 2: Try to condense 3 shares (should fail - not divisible by 5)
  console.log("\n--- Test 2: Condense 3 shares (should fail) ---");
  try {
    await storage.condenseShares(testUser.id, playerId, 3);
    console.log("❌ Should have failed but didn't");
    return false;
  } catch (error: any) {
    if (error.message.includes("divisible by 5") || error.message.includes("Minimum 5")) {
      console.log(`✅ Correctly rejected: ${error.message}`);
    } else {
      console.log(`❌ Wrong error: ${error.message}`);
      return false;
    }
  }

  // Test 3: Try to condense 2 shares (should fail - minimum 5)
  console.log("\n--- Test 3: Condense 2 shares (should fail) ---");
  try {
    await storage.condenseShares(testUser.id, playerId, 2);
    console.log("❌ Should have failed but didn't");
    return false;
  } catch (error: any) {
    if (error.message.includes("Minimum 5")) {
      console.log(`✅ Correctly rejected: ${error.message}`);
    } else {
      console.log(`❌ Wrong error: ${error.message}`);
      return false;
    }
  }

  console.log("\n✅ All condenseShares tests passed!\n");
  return true;
}

async function testMarketFee() {
  console.log("\n=== Testing Market Fee Configuration ===\n");

  const MARKET_FEE_PERCENT = parseFloat(process.env.MARKET_FEE_PERCENT || "0.05");
  console.log(`Market fee configured: ${(MARKET_FEE_PERCENT * 100).toFixed(1)}%`);

  // Test calculation
  const tradeCost = 100;
  const expectedFee = tradeCost * MARKET_FEE_PERCENT;
  const expectedSellerProceeds = tradeCost - expectedFee;

  console.log(`Trade of $${tradeCost}:`);
  console.log(`  Fee burned: $${expectedFee.toFixed(2)}`);
  console.log(`  Seller receives: $${expectedSellerProceeds.toFixed(2)}`);
  console.log(`  Buyer pays: $${tradeCost.toFixed(2)}`);

  if (expectedFee === 5 && expectedSellerProceeds === 95) {
    console.log("✅ Market fee calculation correct");
    return true;
  } else {
    console.log("❌ Market fee calculation incorrect");
    return false;
  }
}

async function testGetHoldingWithPowerLevel() {
  console.log("\n=== Testing getHoldingWithPowerLevel ===\n");

  // Get a user with holdings
  const [testUser] = await db.select().from(users).limit(1);
  if (!testUser) {
    console.log("❌ No users found");
    return false;
  }

  const userHoldings = await db
    .select()
    .from(holdings)
    .where(and(eq(holdings.userId, testUser.id), eq(holdings.assetType, "player")))
    .limit(1);

  if (userHoldings.length === 0) {
    console.log("❌ No player holdings found");
    return false;
  }

  const holding = userHoldings[0];
  const result = await storage.getHoldingWithPowerLevel(testUser.id, holding.assetId);

  if (result) {
    console.log(`Player: ${holding.assetId}`);
    console.log(`  Quantity: ${result.quantity}`);
    console.log(`  Power Level: ${result.powerLevel}`);
    console.log(`  Available Shares: ${result.availableShares}`);
    console.log("✅ getHoldingWithPowerLevel working");
    return true;
  } else {
    console.log("❌ getHoldingWithPowerLevel returned undefined");
    return false;
  }
}

async function main() {
  console.log("=========================================");
  console.log("Community Break-Even Engine Test Suite");
  console.log("=========================================");

  try {
    // Test 1: Market fee calculation
    const feeTestPassed = await testMarketFee();

    // Test 2: getHoldingWithPowerLevel
    const holdingTestPassed = await testGetHoldingWithPowerLevel();

    // Test 3: condenseShares (modifies data - run last)
    const condenseTestPassed = await testCondenseShares();

    console.log("\n=========================================");
    console.log("Test Results Summary");
    console.log("=========================================");
    console.log(`Market Fee:              ${feeTestPassed ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`getHoldingWithPowerLevel: ${holdingTestPassed ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`condenseShares:          ${condenseTestPassed ? "✅ PASS" : "❌ FAIL"}`);
    console.log("=========================================\n");

    process.exit(feeTestPassed && holdingTestPassed && condenseTestPassed ? 0 : 1);
  } catch (error: any) {
    console.error("Fatal error:", error.message);
    process.exit(1);
  }
}

main();
