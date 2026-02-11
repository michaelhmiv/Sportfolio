import "dotenv/config";
import { storage } from "../server/storage";

async function runTests() {
  console.log("🚀 STARTING FULL SCOUT FEATURE VERIFICATION");

  const sortFields = [
    "price",
    "volume",
    "change",
    "bid",
    "ask",
    "marketCap",
    "sentiment",
    "undervalued",
    "fantasyPoints",
    "name",
    "team",
  ];
  let failCount = 0;

  for (const field of sortFields) {
    try {
      console.log(`[SORT] Testing ${field}...`);
      const result = await storage.getPlayersPaginated({
        sortBy: field as any,
        sortOrder: "desc",
        limit: 5,
      });

      console.log(`[SORT] ${field}: ✅ SUCCESS (Found ${result.players.length} players)`);
      if (result.players.length > 0) {
        console.log(`      Example: ${result.players[0].firstName} ${result.players[0].lastName}`);
      }
    } catch (e: any) {
      console.log(`[SORT] ${field}: ❌ ERROR: ${e.message}`);
      failCount++;
    }
  }

  try {
    console.log(`[FILTER] Testing search (James)...`);
    const searchResult = await storage.getPlayersPaginated({ search: "James", limit: 5 });
    console.log(`[FILTER] search: ✅ SUCCESS (${searchResult.players.length} found)`);
  } catch (e: any) {
    console.log(`[FILTER] search: ❌ ERROR: ${e.message}`);
    failCount++;
  }

  try {
    console.log(`[API] Testing Scout Enrichment...`);
    await storage.getUserScoutAssignments("test-user-id");
    console.log(`[API] enrichment: ✅ SUCCESS`);
  } catch (e: any) {
    console.log(`[API] enrichment: ❌ ERROR: ${e.message}`);
    failCount++;
  }

  if (failCount > 0) {
    console.log(`\n❌ VERIFICATION FAILED WITH ${failCount} ERRORS`);
    process.exit(1);
  } else {
    console.log("\n✨ ALL TESTS PASSED SUCCESSFULLY");
    process.exit(0);
  }
}

runTests();
