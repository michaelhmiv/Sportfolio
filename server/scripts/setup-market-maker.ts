/**
 * Market Maker Setup Script
 * 
 * This script initializes the Sportfolio Market Maker account and sets up
 * LP positions for all existing players with the new 50K shares / $500K standard.
 * 
 * Run this script once when deploying the AMM system to production.
 */

import { db } from "../db";
import { eq, sql, ne } from "drizzle-orm";
import { users, players, playerPools, holdings, lpPositions, lpTransactions } from "@shared/schema";

const MARKET_MAKER_ID = "market_maker";
const MARKET_MAKER_USERNAME = "Sportfolio Market Maker";
const MARKET_MAKER_EMAIL = "marketmaker@system.sportfolio.internal";
const OLD_PROTOCOL_ID = "protocol_lp_owner";

const INITIAL_POOL_SHARES = 50000;
const INITIAL_POOL_PLAY_MONEY = 500000;
const INITIAL_POOL_PRICE = INITIAL_POOL_PLAY_MONEY / INITIAL_POOL_SHARES;

const MARKET_MAKER_STARTING_BALANCE = 500000000; // $500M

async function setupMarketMaker() {
  console.log("[Setup] Starting Market Maker setup...");
  console.log("[Setup] ============================================");

  const migrationLog: string[] = [];

  try {
    // Step 1: Handle existing protocol_lp_owner user
    console.log("[Setup] Step 1: Checking for existing protocol_lp_owner...");
    const oldProtocolUser = await db.select().from(users).where(eq(users.id, OLD_PROTOCOL_ID));
    
    if (oldProtocolUser.length > 0) {
      console.log(`[Setup] Found existing ${OLD_PROTOCOL_ID}, renaming to ${MARKET_MAKER_ID}...`);
      
      // Check if market_maker already exists
      const existingMarketMaker = await db.select().from(users).where(eq(users.id, MARKET_MAKER_ID));
      
      if (existingMarketMaker.length > 0) {
        console.log("[Setup] Both users exist, deleting old protocol_lp_owner...");
        await db.delete(users).where(eq(users.id, OLD_PROTOCOL_ID));
        migrationLog.push(`Deleted old user: ${OLD_PROTOCOL_ID}`);
      } else {
        // Rename old user to new ID
        await db
          .update(users)
          .set({
            id: MARKET_MAKER_ID,
            username: MARKET_MAKER_USERNAME,
            email: MARKET_MAKER_EMAIL,
            isBot: true,
          })
          .where(eq(users.id, OLD_PROTOCOL_ID));
        console.log(`[Setup] Renamed ${OLD_PROTOCOL_ID} to ${MARKET_MAKER_ID}`);
        migrationLog.push(`Renamed ${OLD_PROTOCOL_ID} to ${MARKET_MAKER_ID}`);
      }
    }

    // Step 2: Create or update market maker user
    console.log("[Setup] Step 2: Setting up market maker user...");
    const existingUser = await db.select().from(users).where(eq(users.id, MARKET_MAKER_ID));

    if (existingUser.length === 0) {
      await db.insert(users).values({
        id: MARKET_MAKER_ID,
        email: MARKET_MAKER_EMAIL,
        username: MARKET_MAKER_USERNAME,
        balance: MARKET_MAKER_STARTING_BALANCE.toString(),
        isBot: true,
        isAdmin: false,
      });
      console.log(`[Setup] Created market maker with $${MARKET_MAKER_STARTING_BALANCE.toLocaleString()} balance`);
      migrationLog.push(`Created new market maker user with $${MARKET_MAKER_STARTING_BALANCE.toLocaleString()} balance`);
    } else {
      // Reset balance and update details if user exists
      await db
        .update(users)
        .set({
          balance: MARKET_MAKER_STARTING_BALANCE.toString(),
          username: MARKET_MAKER_USERNAME,
          email: MARKET_MAKER_EMAIL,
          isBot: true,
        })
        .where(eq(users.id, MARKET_MAKER_ID));
      console.log(`[Setup] Updated market maker balance to $${MARKET_MAKER_STARTING_BALANCE.toLocaleString()}`);
      migrationLog.push(`Updated market maker balance to $${MARKET_MAKER_STARTING_BALANCE.toLocaleString()}`);
    }

    // Step 3: Clear existing market maker holdings and LP positions
    console.log("[Setup] Step 3: Clearing existing market maker data...");
    const deletedHoldings = await db.delete(holdings).where(eq(holdings.userId, MARKET_MAKER_ID)).returning();
    const deletedLpPositions = await db.delete(lpPositions).where(eq(lpPositions.userId, MARKET_MAKER_ID)).returning();
    console.log(`[Setup] Cleared ${deletedHoldings.length} holdings and ${deletedLpPositions.length} LP positions`);
    migrationLog.push(`Cleared ${deletedHoldings.length} holdings and ${deletedLpPositions.length} LP positions`);

    // Step 4: Get all players
    console.log("[Setup] Step 4: Fetching all players...");
    const allPlayers = await db.select({ id: players.id }).from(players);
    console.log(`[Setup] Found ${allPlayers.length} players`);
    migrationLog.push(`Found ${allPlayers.length} players to process`);

    // Step 5: Process each player
    console.log("[Setup] Step 5: Processing players...");
    let processedCount = 0;
    let errorCount = 0;

    for (const player of allPlayers) {
      try {
        await db.transaction(async (tx) => {
          // Check if pool exists
          const existingPool = await tx
            .select()
            .from(playerPools)
            .where(eq(playerPools.playerId, player.id));

          if (existingPool.length > 0) {
            // Reset existing pool to new values
            await tx
              .update(playerPools)
              .set({
                shares: INITIAL_POOL_SHARES.toString(),
                playMoney: INITIAL_POOL_PLAY_MONEY.toString(),
                lpSharesTotal: INITIAL_POOL_SHARES.toString(),
                feesAccumulated: "0",
                totalVolume: "0",
                totalTrades: 0,
              })
              .where(eq(playerPools.playerId, player.id));
          } else {
            // Create new pool
            await tx.insert(playerPools).values({
              playerId: player.id,
              shares: INITIAL_POOL_SHARES.toString(),
              playMoney: INITIAL_POOL_PLAY_MONEY.toString(),
              lpSharesTotal: INITIAL_POOL_SHARES.toString(),
              feesAccumulated: "0",
              totalVolume: "0",
              totalTrades: 0,
            });
          }

          // Clear existing LP positions for this player (from any user)
          await tx.delete(lpPositions).where(eq(lpPositions.playerId, player.id));

          // Clear existing LP transactions for this player
          await tx.delete(lpTransactions).where(eq(lpTransactions.playerId, player.id));

          // Create holding for market maker
          await tx.insert(holdings).values({
            userId: MARKET_MAKER_ID,
            assetType: "player",
            assetId: player.id,
            quantity: INITIAL_POOL_SHARES.toString(),
            power: 1,
            powerLevel: INITIAL_POOL_SHARES.toString(),
            avgCostBasis: INITIAL_POOL_PRICE.toString(),
            totalCostBasis: INITIAL_POOL_PLAY_MONEY.toString(),
          });

          // Create LP position for market maker
          await tx.insert(lpPositions).values({
            userId: MARKET_MAKER_ID,
            playerId: player.id,
            lpShares: INITIAL_POOL_SHARES.toString(),
          });

          // Record LP transaction
          await tx.insert(lpTransactions).values({
            userId: MARKET_MAKER_ID,
            playerId: player.id,
            transactionType: "add",
            sharesAmount: INITIAL_POOL_SHARES.toString(),
            playMoneyAmount: INITIAL_POOL_PLAY_MONEY.toString(),
            lpShares: INITIAL_POOL_SHARES.toString(),
            poolSharesBefore: "0",
            poolPlayMoneyBefore: "0",
            poolLpSharesTotalBefore: "0",
          });
        });

        processedCount++;
        if (processedCount % 50 === 0) {
          console.log(`[Setup] Processed ${processedCount}/${allPlayers.length} players...`);
        }
      } catch (error) {
        console.error(`[Setup] Error processing player ${player.id}:`, error);
        errorCount++;
        migrationLog.push(`ERROR: Failed to process player ${player.id}`);
      }
    }

    // Step 6: Deduct total play money from market maker
    const totalPlayMoneyNeeded = allPlayers.length * INITIAL_POOL_PLAY_MONEY;
    await db
      .update(users)
      .set({
        balance: sql`${users.balance} - ${totalPlayMoneyNeeded.toString()}`,
      })
      .where(eq(users.id, MARKET_MAKER_ID));

    console.log(`[Setup] Deducted $${totalPlayMoneyNeeded.toLocaleString()} from market maker`);
    migrationLog.push(`Deducted $${totalPlayMoneyNeeded.toLocaleString()} for pool seeding`);

    console.log("\n[Setup] Migration Complete!");
    console.log(`[Setup] Players processed: ${processedCount}`);
    console.log(`[Setup] Errors: ${errorCount}`);

    // ============================================
    // POST-MIGRATION VERIFICATION
    // ============================================
    console.log("\n========================================");
    console.log("POST-MIGRATION VERIFICATION");
    console.log("========================================");

    let verificationPassed = true;

    // Check 1: Verify all pools have correct values
    console.log("\n[Verify] Check 1: Verifying pool values...");
    const allPools = await db.select().from(playerPools);
    const incorrectPools = allPools.filter(pool => {
      const shares = parseFloat(pool.shares);
      const playMoney = parseFloat(pool.playMoney);
      return shares !== INITIAL_POOL_SHARES || playMoney !== INITIAL_POOL_PLAY_MONEY;
    });

    if (incorrectPools.length === 0) {
      console.log(`✓ All ${allPools.length} pools have correct values (50K shares / $500K)`);
    } else {
      console.log(`✗ Found ${incorrectPools.length} pools with incorrect values:`);
      incorrectPools.forEach(pool => {
        console.log(`  - ${pool.playerId}: ${pool.shares} shares / $${pool.playMoney}`);
      });
      verificationPassed = false;
    }

    // Check 2: Verify market maker has LP positions for all players
    console.log("\n[Verify] Check 2: Verifying market maker LP positions...");
    const marketMakerPositions = await db
      .select()
      .from(lpPositions)
      .where(eq(lpPositions.userId, MARKET_MAKER_ID));

    if (marketMakerPositions.length === allPlayers.length) {
      console.log(`✓ Market maker has LP positions for all ${marketMakerPositions.length} players`);
    } else {
      console.log(`✗ Market maker has ${marketMakerPositions.length} positions, expected ${allPlayers.length}`);
      verificationPassed = false;
    }

    // Check 3: Verify market maker holdings
    console.log("\n[Verify] Check 3: Verifying market maker holdings...");
    const marketMakerHoldings = await db
      .select()
      .from(holdings)
      .where(eq(holdings.userId, MARKET_MAKER_ID));

    if (marketMakerHoldings.length === allPlayers.length) {
      console.log(`✓ Market maker has holdings for all ${marketMakerHoldings.length} players`);
    } else {
      console.log(`✗ Market maker has ${marketMakerHoldings.length} holdings, expected ${allPlayers.length}`);
      verificationPassed = false;
    }

    // Check 4: Verify market maker balance
    console.log("\n[Verify] Check 4: Verifying market maker balance...");
    const marketMaker = await db.select().from(users).where(eq(users.id, MARKET_MAKER_ID));
    if (marketMaker.length > 0) {
      const currentBalance = parseFloat(marketMaker[0].balance);
      const expectedBalance = MARKET_MAKER_STARTING_BALANCE - totalPlayMoneyNeeded;
      
      if (Math.abs(currentBalance - expectedBalance) < 1) {
        console.log(`✓ Market maker balance: $${currentBalance.toLocaleString()} (expected: $${expectedBalance.toLocaleString()})`);
      } else {
        console.log(`✗ Market maker balance: $${currentBalance.toLocaleString()} (expected: $${expectedBalance.toLocaleString()})`);
        verificationPassed = false;
      }
    } else {
      console.log("✗ Market maker user not found!");
      verificationPassed = false;
    }

    // Check 5: Verify no orphaned LP positions
    console.log("\n[Verify] Check 5: Checking for orphaned LP positions...");
    const orphanedPositions = await db
      .select()
      .from(lpPositions)
      .where(ne(lpPositions.userId, MARKET_MAKER_ID));

    if (orphanedPositions.length === 0) {
      console.log("✓ No orphaned LP positions found");
    } else {
      console.log(`⚠ Found ${orphanedPositions.length} non-market-maker LP positions (this may be expected if users already added liquidity)`);
    }

    // Check 6: Verify LP transactions recorded
    console.log("\n[Verify] Check 6: Verifying LP transactions...");
    const lpTxCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(lpTransactions)
      .where(eq(lpTransactions.userId, MARKET_MAKER_ID));

    if (lpTxCount[0].count === allPlayers.length) {
      console.log(`✓ All ${lpTxCount[0].count} LP transactions recorded`);
    } else {
      console.log(`⚠ Found ${lpTxCount[0].count} LP transactions, expected ${allPlayers.length}`);
    }

    // Final Summary
    console.log("\n========================================");
    console.log("MIGRATION SUMMARY");
    console.log("========================================");
    console.log(`Total Players: ${allPlayers.length}`);
    console.log(`Successfully Processed: ${processedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Total Play Money Allocated: $${totalPlayMoneyNeeded.toLocaleString()}`);
    console.log(`Remaining Market Maker Balance: $${(MARKET_MAKER_STARTING_BALANCE - totalPlayMoneyNeeded).toLocaleString()}`);
    console.log(`\nVerification Status: ${verificationPassed ? '✅ PASSED' : '❌ FAILED'}`);

    if (!verificationPassed) {
      console.log("\n⚠️  WARNING: Verification failed! Please review the errors above.");
      console.log("   You may need to run the migration again or fix issues manually.");
      process.exit(1);
    }

    console.log("\n✅ Migration successful! Ready for frontend deployment.");
    console.log("\nMigration Log:");
    migrationLog.forEach(log => console.log(`  - ${log}`));

  } catch (error) {
    console.error("\n[Setup] Fatal error:", error);
    console.error("\n❌ Migration failed! Database may be in an inconsistent state.");
    console.error("Please check the error above and consider restoring from backup.");
    process.exit(1);
  }
}

// Run if called directly
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  setupMarketMaker()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { setupMarketMaker };
