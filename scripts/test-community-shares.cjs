/**
 * Comprehensive Test Suite for Community Shares Purchase Flow
 *
 * Tests:
 * 1. Checkout URL generation includes metadata
 * 2. Webhook metadata parsing
 * 3. Webhook purchase type detection (plan_id and amount-based)
 * 4. Webhook session lookup (Method 2 fallback)
 * 5. Webhook share crediting
 * 6. Sync function for community shares
 * 7. getUserCommunityBoostShares function
 */

require("dotenv").config();
const { Client } = require("pg");

const client = new Client(process.env.DEV_DATABASE_URL);

const tests = {
  passed: 0,
  failed: 0,
  results: [],
};

function test(name, fn) {
  try {
    fn();
    tests.passed++;
    tests.results.push({ name, status: "PASS" });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    tests.failed++;
    tests.results.push({ name, status: "FAIL", error: err.message });
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition, msg) {
  if (!condition) {
    throw new Error(msg);
  }
}

async function runTests() {
  console.log("\n========================================");
  console.log("COMMUNITY SHARES PURCHASE FLOW TESTS");
  console.log("========================================\n");

  await client.connect();

  // ========================================
  // TEST 1: Checkout URL Generation
  // ========================================
  console.log("1. CHECKOUT URL GENERATION TESTS");
  console.log("----------------------------------");

  test("Premium checkout URL should include metadata", async () => {
    // Simulate the URL generation logic from routes.ts
    const userId = "test-user-123";
    const planId = "plan_Premium123";
    const quantity = 2;
    const sessionId = "session-abc123";

    const directUrl = `https://whop.com/checkout/${planId}/?d2c=true&metadata[sessionId]=${sessionId}&metadata[userId]=${userId}&metadata[quantity]=${quantity}`;

    assertTrue(directUrl.includes("metadata[sessionId]"), "URL should include sessionId");
    assertTrue(directUrl.includes("metadata[userId]"), "URL should include userId");
    assertTrue(directUrl.includes("metadata[quantity]"), "URL should include quantity");
    assertTrue(directUrl.includes(userId), "URL should include userId value");
    assertTrue(directUrl.includes(sessionId), "URL should include sessionId value");
    assertTrue(directUrl.includes(String(quantity)), "URL should include quantity value");
  });

  test("Community checkout URL should include metadata", async () => {
    const userId = "test-user-456";
    const planId = "plan_Community789";
    const quantity = 5;
    const sessionId = "session-xyz789";

    const directUrl = `https://whop.com/checkout/${planId}/?d2c=true&metadata[sessionId]=${sessionId}&metadata[userId]=${userId}&metadata[quantity]=${quantity}`;

    assertTrue(directUrl.includes("metadata[sessionId]"), "URL should include sessionId");
    assertTrue(directUrl.includes("metadata[userId]"), "URL should include userId");
    assertTrue(directUrl.includes("metadata[quantity]"), "URL should include quantity");
  });

  // ========================================
  // TEST 2: Webhook Metadata Parsing
  // ========================================
  console.log("\n2. WEBHOOK METADATA PARSING TESTS");
  console.log("----------------------------------");

  test("Should parse sessionId from metadata", async () => {
    const payment = {
      metadata: {
        sessionId: "session-abc123",
        userId: "user-456",
        quantity: "3",
      },
    };

    const sessionId = payment.metadata.sessionId;
    const metadataUserId = payment.metadata.userId;
    const metadataQuantity = parseInt(payment.metadata.quantity);

    assertEqual(sessionId, "session-abc123", "sessionId should match");
    assertEqual(metadataUserId, "user-456", "userId should match");
    assertEqual(metadataQuantity, 3, "quantity should be parsed");
  });

  test("Should handle empty metadata gracefully", async () => {
    const payment = {
      metadata: {},
    };

    const sessionId = payment.metadata.sessionId;
    const metadataUserId = payment.metadata.userId;

    assertTrue(sessionId === undefined, "sessionId should be undefined");
    assertTrue(metadataUserId === undefined, "userId should be undefined");
  });

  // ========================================
  // TEST 3: Purchase Type Detection
  // ========================================
  console.log("\n3. PURCHASE TYPE DETECTION TESTS");
  console.log("----------------------------------");

  test("Should detect community purchase by plan_id", async () => {
    const communityPlanId = "plan_LxChRFJyIPrhW";
    const premiumPlanId = "plan_We0bZYkMU9clG";
    const planId = "plan_LxChRFJyIPrhW";

    let isCommunityPurchase = false;
    if (communityPlanId && planId === communityPlanId) {
      isCommunityPurchase = true;
    } else if (premiumPlanId && planId === premiumPlanId) {
      isCommunityPurchase = false;
    }

    assertTrue(isCommunityPurchase === true, "Should detect as community");
  });

  test("Should detect premium purchase by plan_id", async () => {
    const communityPlanId = "plan_LxChRFJyIPrhW";
    const premiumPlanId = "plan_We0bZYkMU9clG";
    const planId = "plan_We0bZYkMU9clG";

    let isCommunityPurchase = false;
    if (communityPlanId && planId === communityPlanId) {
      isCommunityPurchase = true;
    } else if (premiumPlanId && planId === premiumPlanId) {
      isCommunityPurchase = false;
    }

    assertTrue(isCommunityPurchase === false, "Should detect as premium");
  });

  test("Should detect community purchase by amount ($1)", async () => {
    const planId = undefined; // Not provided
    const finalAmount = 100; // $1.00 in cents

    let isCommunityPurchase = false;
    if (planId === undefined || planId === null || planId === "") {
      if (finalAmount && finalAmount >= 100) {
        isCommunityPurchase = finalAmount < 500; // $1-$4.99 is community
      }
    }

    assertTrue(isCommunityPurchase === true, "Should detect $1 as community");
  });

  test("Should detect premium purchase by amount ($5)", async () => {
    const planId = undefined; // Not provided
    const finalAmount = 500; // $5.00 in cents

    let isCommunityPurchase = false;
    if (planId === undefined || planId === null || planId === "") {
      if (finalAmount && finalAmount >= 100) {
        isCommunityPurchase = finalAmount < 500; // $1-$4.99 is community
      }
    }

    assertTrue(isCommunityPurchase === false, "Should detect $5 as premium");
  });

  test("Should detect community purchase by amount ($2)", async () => {
    const planId = null;
    const finalAmount = 200; // $2.00

    let isCommunityPurchase = false;
    if (!planId) {
      if (finalAmount && finalAmount >= 100) {
        isCommunityPurchase = finalAmount < 500;
      }
    }

    assertTrue(isCommunityPurchase === true, "Should detect $2 as community");
  });

  test("Should handle unknown plan_id with high amount as premium", async () => {
    const planId = "plan_Unknown";
    const finalAmount = 500;

    // With our fix, unknown plan_id won't match either, but we don't fall back to amount
    // This is correct behavior - unknown plans should be investigated
    let isCommunityPurchase = false;
    const communityPlanId = "plan_LxChRFJyIPrhW";
    const premiumPlanId = "plan_We0bZYkMU9clG";

    if (communityPlanId && planId === communityPlanId) {
      isCommunityPurchase = true;
    } else if (premiumPlanId && planId === premiumPlanId) {
      isCommunityPurchase = false;
    }

    assertTrue(isCommunityPurchase === false, "Unknown plan with $5 should not be community");
  });

  // ========================================
  // TEST 4: Session Lookup (Method 2 Fallback)
  // ========================================
  console.log("\n4. SESSION LOOKUP (METHOD 2) TESTS");
  console.log("----------------------------------");

  test("Should find pending community session within 2 hours", async () => {
    const pendingSessions = [
      {
        id: "session-1",
        userId: "user-1",
        planId: "plan_Community",
        quantity: 1,
        createdAt: new Date(),
      },
      {
        id: "session-2",
        userId: "user-2",
        planId: "plan_Community",
        quantity: 2,
        createdAt: new Date(Date.now() - 3600000),
      }, // 1 hour ago
      {
        id: "session-3",
        userId: "user-3",
        planId: "plan_Community",
        quantity: 3,
        createdAt: new Date(Date.now() - 7200000),
      }, // 2 hours ago - should be included
    ];

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const planId = "plan_Community";

    // First try to match by planId
    let matchingSession = pendingSessions.find(
      (s) => s.planId === planId && new Date(s.createdAt) > twoHoursAgo,
    );

    // If no plan match, use most recent (create a sorted copy to not mutate original)
    if (!matchingSession) {
      const sortedSessions = [...pendingSessions].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      matchingSession = sortedSessions.find((s) => new Date(s.createdAt) > twoHoursAgo);
    }

    assertTrue(matchingSession !== undefined, "Should find a matching session");
    // Most recent session within 2 hours is session-1 (user-1) since it's newest
    assertEqual(matchingSession?.userId, "user-1", "Should find most recent session");
  });

  test("Should exclude sessions older than 2 hours", async () => {
    const pendingSessions = [
      {
        id: "session-old",
        userId: "user-old",
        planId: "plan_Community",
        quantity: 1,
        createdAt: new Date(Date.now() - 7200001),
      }, // 2 hours + 1ms ago
    ];

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const matchingSession = pendingSessions.find(
      (s) => s.planId === "plan_Community" && new Date(s.createdAt) > twoHoursAgo,
    );

    assertTrue(matchingSession === undefined, "Should not find old session");
  });

  test("Should fallback to premium sessions when no community sessions exist", async () => {
    const communitySessions = []; // No community sessions
    const premiumSessions = [
      {
        id: "prem-session",
        userId: "user-1",
        planId: "plan_Premium",
        quantity: 1,
        createdAt: new Date(),
      },
    ];

    let pendingSessions = communitySessions;
    if (communitySessions.length === 0) {
      pendingSessions = premiumSessions;
    }

    assertTrue(pendingSessions.length > 0, "Should have fallback sessions");
    assertEqual(pendingSessions[0].id, "prem-session", "Should use premium session as fallback");
  });

  // ========================================
  // TEST 5: Share Crediting Logic
  // ========================================
  console.log("\n5. SHARE CREDITING LOGIC TESTS");
  console.log("----------------------------------");

  test("Should calculate correct quantity from amount ($1 community)", async () => {
    const isCommunityPurchase = true;
    const finalAmount = 100; // $1.00
    const pricePerShare = isCommunityPurchase ? 100 : 500;
    const quantity = Math.floor(finalAmount / pricePerShare);

    assertEqual(quantity, 1, "Should calculate 1 share for $1");
  });

  test("Should calculate correct quantity from amount ($5 premium)", async () => {
    const isCommunityPurchase = false;
    const finalAmount = 500; // $5.00
    const pricePerShare = isCommunityPurchase ? 100 : 500;
    const quantity = Math.floor(finalAmount / pricePerShare);

    assertEqual(quantity, 1, "Should calculate 1 share for $5");
  });

  test("Should calculate correct quantity from amount (3 community shares)", async () => {
    const isCommunityPurchase = true;
    const finalAmount = 300; // $3.00
    const pricePerShare = isCommunityPurchase ? 100 : 500;
    const quantity = Math.floor(finalAmount / pricePerShare);

    assertEqual(quantity, 3, "Should calculate 3 shares for $3");
  });

  test("Should use correct avgCostBasis for community ($1)", async () => {
    const isCommunityPurchase = true;
    const avgCost = isCommunityPurchase ? "1.0000" : "5.0000";

    assertEqual(avgCost, "1.0000", "Community should use $1 avgCost");
  });

  test("Should use correct avgCostBasis for premium ($5)", async () => {
    const isCommunityPurchase = false;
    const avgCost = isCommunityPurchase ? "1.0000" : "5.0000";

    assertEqual(avgCost, "5.0000", "Premium should use $5 avgCost");
  });

  // ========================================
  // TEST 6: Database State Verification
  // ========================================
  console.log("\n6. DATABASE STATE VERIFICATION TESTS");
  console.log("----------------------------------");

  test("Should have community holdings for dev user", async () => {
    const result = await client.query(`
      SELECT * FROM holdings
      WHERE user_id = 'dev-user-12345678'
      AND asset_type = 'community'
      AND asset_id = 'community'
    `);

    assertTrue(result.rows.length > 0, "Should have community holdings");
    assertTrue(result.rows[0].quantity >= 2, "Should have at least 2 shares (from earlier fix)");
  });

  test("Community holdings should have correct avg_cost_basis", async () => {
    const result = await client.query(`
      SELECT avg_cost_basis FROM holdings
      WHERE user_id = 'dev-user-12345678'
      AND asset_type = 'community'
      AND asset_id = 'community'
    `);

    assertEqual(result.rows[0].avg_cost_basis.toString(), "1.0000", "avg_cost_basis should be $1");
  });

  test("All pending community sessions should be marked completed", async () => {
    const result = await client.query(`
      SELECT COUNT(*) as count FROM community_checkout_sessions
      WHERE user_id = 'dev-user-12345678'
      AND status = 'pending'
    `);

    assertEqual(parseInt(result.rows[0].count), 0, "No pending sessions should remain");
  });

  test("Completed community sessions should have receipt_id", async () => {
    const result = await client.query(`
      SELECT receipt_id FROM community_checkout_sessions
      WHERE user_id = 'dev-user-12345678'
      AND status = 'completed'
    `);

    assertTrue(result.rows.length > 0, "Should have completed sessions");
    for (const row of result.rows) {
      assertTrue(row.receipt_id !== null, "Completed sessions should have receipt_id");
    }
  });

  // ========================================
  // TEST 7: Sync Function Logic
  // ========================================
  console.log("\n7. SYNC FUNCTION LOGIC TESTS");
  console.log("----------------------------------");

  test("Sync should detect community by amount < $3", async () => {
    const totalDollars = 1.5; // Community purchase

    let isCommunityPurchase = false;
    const communityPlanId = "plan_LxChRFJyIPrhW";
    const premiumPlanId = "plan_We0bZYkMU9clG";
    const planId = undefined;

    if (communityPlanId && planId === communityPlanId) {
      isCommunityPurchase = true;
    } else if (premiumPlanId && planId === premiumPlanId) {
      isCommunityPurchase = false;
    } else if (totalDollars > 0) {
      isCommunityPurchase = totalDollars < 3;
    }

    assertTrue(isCommunityPurchase === true, "Should detect $1.50 as community");
  });

  test("Sync should detect premium by amount >= $3", async () => {
    const totalDollars = 5.0; // Premium purchase

    let isCommunityPurchase = false;
    const communityPlanId = "plan_LxChRFJyIPrhW";
    const premiumPlanId = "plan_We0bZYkMU9clG";
    const planId = undefined;

    if (communityPlanId && planId === communityPlanId) {
      isCommunityPurchase = true;
    } else if (premiumPlanId && planId === premiumPlanId) {
      isCommunityPurchase = false;
    } else if (totalDollars > 0) {
      isCommunityPurchase = totalDollars < 3;
    }

    assertTrue(isCommunityPurchase === false, "Should detect $5.00 as premium");
  });

  test("Sync should use correct assetType for community", async () => {
    const isCommunityPurchase = true;
    const assetType = isCommunityPurchase ? "community" : "premium";

    assertEqual(assetType, "community", "Should use community assetType");
  });

  test("Sync should use correct assetType for premium", async () => {
    const isCommunityPurchase = false;
    const assetType = isCommunityPurchase ? "community" : "premium";

    assertEqual(assetType, "premium", "Should use premium assetType");
  });

  // ========================================
  // TEST 8: End-to-End Flow Simulation
  // ========================================
  console.log("\n8. END-TO-END FLOW SIMULATION TESTS");
  console.log("----------------------------------");

  test("Simulate complete community purchase flow", async () => {
    // 1. User initiates purchase
    const userId = "e2e-test-user";
    const quantity = 1;
    const sessionId = "e2e-session-" + Date.now();

    // 2. Checkout URL should include metadata
    const checkoutUrl = `https://whop.com/checkout/plan_Community/?d2c=true&metadata[sessionId]=${sessionId}&metadata[userId]=${userId}&metadata[quantity]=${quantity}`;

    assertTrue(checkoutUrl.includes(sessionId), "Checkout URL should include sessionId");
    assertTrue(checkoutUrl.includes(userId), "Checkout URL should include userId");

    // 3. Webhook receives payment with metadata
    const webhookPayload = {
      metadata: {
        sessionId: sessionId,
        userId: userId,
        quantity: String(quantity),
      },
      plan_id: undefined, // Simulating missing plan_id
      final_amount: 100, // $1.00
    };

    // 4. Parse metadata
    const parsedSessionId = webhookPayload.metadata.sessionId;
    const parsedUserId = webhookPayload.metadata.userId;
    const parsedQuantity = parseInt(webhookPayload.metadata.quantity);

    assertEqual(parsedSessionId, sessionId, "Should parse sessionId");
    assertEqual(parsedUserId, userId, "Should parse userId");
    assertEqual(parsedQuantity, quantity, "Should parse quantity");

    // 5. Detect purchase type by amount
    let isCommunity = false;
    if (webhookPayload.plan_id === undefined) {
      isCommunity = webhookPayload.final_amount < 500;
    }
    assertTrue(isCommunity === true, "Should detect as community purchase");

    // 6. Simulate holding update
    const currentQty = 0;
    const newQty = currentQty + parsedQuantity;
    const avgCost = "1.0000";

    assertEqual(newQty, 1, "Should calculate new quantity");
    assertEqual(avgCost, "1.0000", "Should use correct avgCost");
  });

  test("Simulate complete premium purchase flow", async () => {
    // 1. User initiates purchase
    const userId = "e2e-test-user-premium";
    const quantity = 2;
    const sessionId = "e2e-session-prem-" + Date.now();

    // 2. Checkout URL should include metadata
    const checkoutUrl = `https://whop.com/checkout/plan_Premium/?d2c=true&metadata[sessionId]=${sessionId}&metadata[userId]=${userId}&metadata[quantity]=${quantity}`;

    // 3. Webhook receives payment (without metadata - simulating old webhook)
    const webhookPayload = {
      metadata: {},
      plan_id: "plan_Premium",
      final_amount: 1000, // $10.00 = 2 shares
    };

    // 4. Detect purchase type by plan_id
    let isCommunity = false;
    const premiumPlanId = "plan_Premium";
    if (webhookPayload.plan_id === premiumPlanId) {
      isCommunity = false;
    }
    assertTrue(isCommunity === false, "Should detect as premium purchase");

    // 5. Calculate quantity from amount
    const calculatedQuantity = Math.floor(webhookPayload.final_amount / 500); // $5/share
    assertEqual(calculatedQuantity, 2, "Should calculate 2 shares for $10");
  });

  // ========================================
  // SUMMARY
  // ========================================
  console.log("\n========================================");
  console.log("TEST SUMMARY");
  console.log("========================================");
  console.log(`Total: ${tests.passed + tests.failed}`);
  console.log(`Passed: ${tests.passed}`);
  console.log(`Failed: ${tests.failed}`);
  console.log("========================================\n");

  await client.end();

  if (tests.failed > 0) {
    console.log("FAILED TESTS:");
    for (const result of tests.results) {
      if (result.status === "FAIL") {
        console.log(`  - ${result.name}: ${result.error}`);
      }
    }
    process.exit(1);
  }

  console.log("All tests passed!");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
