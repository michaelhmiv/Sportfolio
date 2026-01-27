import { storage } from "./server/storage.js";

async function fixPoweredShares() {
  const userId = "dev_user";

  // Get all holdings for dev_user
  const allHoldings = await storage.getUserHoldings(userId);

  // Find Paolo Banchero holdings
  const banchero = allHoldings.filter(h =>
    h.assetId.toLowerCase().includes("paolo") ||
    h.assetId.toLowerCase().includes("banchero")
  );

  console.log("Paolo Banchero holdings:");
  console.log(JSON.stringify(banchero, null, 2));

  // Find any holdings with power > 1 that have quantity > 1 (these need fixing)
  const badHoldings = allHoldings.filter(h => h.power > 1 && h.quantity > 1);

  if (badHoldings.length > 0) {
    console.log("\nHoldings with quantity > 1 and power > 1 (need fixing):");
    console.log(JSON.stringify(badHoldings, null, 2));
  }
}

fixPoweredShares().catch(console.error);
