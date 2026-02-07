import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer } from "ws";
import { performance } from "node:perf_hooks";
import { storage } from "./storage";
import { db } from "./db";
import { fetchActivePlayers, calculateFantasyPoints } from "./balldontlie-nba";
import type { InsertPlayer, Player, User, Holding, CommunityBoost } from "@shared/schema";
import { contestLineups, contestEntries, contests, holdings, marketSnapshots, premiumCheckoutSessions, tweetSettings, tweetHistory, users, scoutAssignments, scoutHistory, dailyGames, dailyBoosts, players, communityCheckoutSessions, userCollections, userMilestones, trades, whopPayments } from "@shared/schema";
import { sql, eq, desc, and, gte, lte, inArray, lt } from "drizzle-orm";
import { jobScheduler } from "./jobs/scheduler";
import { addClient, removeClient, broadcast } from "./websocket";
import { calculateAccrualUpdate } from "@shared/vesting-utils";
import { createContests } from "./jobs/create-contests";
import { calculateContestLeaderboard } from "./contest-scoring";
import { setupAuth, isAuthenticated, optionalAuth } from "./supabaseAuth";
import { getGameDay, getETDayBoundaries, getTodayETBoundaries, getTodayET } from "./lib/time";
import { getOrCompute } from "./cache";
import { registerAmmRoutes } from "./routes/amm";
import { registerLpRoutes } from "./routes/lp";
import { getOrCreatePool } from "./amm/pool";

/**
 * Get power/boosts data for the dashboard
 */
async function getDashboardPowerData(userId: string) {
  try {
    const { startOfDay } = getTodayETBoundaries();
    const today = startOfDay;

    // Fetch all boosts across sports for today
    const boosts = await storage.getDailyBoostsAllSports(userId, today);

    // Get community boosts count
    const communityBoosts = await storage.getCommunityBoostsAllSports(today);
    const communityBoostCount = communityBoosts.length;

    // Get user community shares (for premium share count)
    const userCommunityShares = await storage.getUserCommunityBoostShares(userId);

    // Calculate totals
    const activeBoosts = boosts.filter(b => b.status === "active").length;
    const lockedBoosts = boosts.filter(b => b.status === "locked").length;
    const processedBoosts = boosts.filter(b => b.status === "processed").length;

    // Get total estimated payout for live boosts
    let totalLivePayout = "0.00";
    if (lockedBoosts > 0) {
      for (const boost of boosts.filter(b => b.status === "locked")) {
        if (boost.fantasyPoints && boost.payout) {
          totalLivePayout = (parseFloat(totalLivePayout) + parseFloat(boost.payout)).toFixed(2);
        }
      }
    }

    // Get total processed payout
    let totalProcessedPayout = "0.00";
    if (processedBoosts > 0) {
      for (const boost of boosts.filter(b => b.status === "processed")) {
        if (boost.payout) {
          totalProcessedPayout = (parseFloat(totalProcessedPayout) + parseFloat(boost.payout)).toFixed(2);
        }
      }
    }

    // Get slots info
    const slotsRemaining = 4 - boosts.length;
    const availableSlots = [5, 4, 3, 2].filter(tier => !boosts.some(b => b.slotTier === tier));

    return {
      activeBoosts,
      lockedBoosts,
      processedBoosts,
      totalBoosts: boosts.length,
      slotsRemaining,
      availableSlots,
      communityBoostCount,
      userCommunityShares,
      totalLivePayout,
      totalProcessedPayout,
      boosts: boosts.slice(0, 4), // Include top boosts for preview
    };
  } catch (error: any) {
    console.error("[getDashboardPowerData] Error:", error.message);
    return {
      activeBoosts: 0,
      lockedBoosts: 0,
      processedBoosts: 0,
      totalBoosts: 0,
      slotsRemaining: 4,
      availableSlots: [5, 4, 3, 2],
      communityBoostCount: 0,
      userCommunityShares: 0,
      totalLivePayout: "0.00",
      totalProcessedPayout: "0.00",
      boosts: [],
    };
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup authentication middleware
  await setupAuth(app);

  // Legacy player order-book mode is archived; player trading is AMM-only.
  const isAmmOnlyMode = true;

  // Scout Status Endpoint (Placed early to avoid shadowing)
  app.get("/api/scouts/status", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const status = await storage.getScoutStatus(userId);
      res.json(status);
    } catch (err: any) {
      console.error("[Scout API] Error getting status:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/market/scanners", async (req, res) => {
    try {
      const sport = (req.query.sport as string) || "ALL"; // Default to ALL if not specified
      const scanners = await storage.getFinancialMarketScanners(sport);
      res.json(scanners);
    } catch (error) {
      console.error("Error fetching market scanners:", error);
      res.status(500).json({ error: "Failed to fetch market scanners" });
    }
  });

  // DEBUG: Diagnostic endpoint for player query issues
  app.get("/api/debug/players", async (req, res) => {
    try {
      const sport = (req.query.sport as string) || "ALL";

      // Test 1: Simple count from players table
      const allPlayers = await storage.getPlayersBySport(sport);

      // Test 2: Paginated query (used by main list)
      const paginated = await storage.getPlayersPaginated({ sport, limit: 5 });

      res.json({
        sport,
        simpleQueryCount: allPlayers.length,
        paginatedQueryCount: paginated.total,
        paginatedSample: paginated.players.slice(0, 2).map(p => ({ id: p.id, name: `${p.firstName} ${p.lastName}`, sport: p.sport }))
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  const httpServer = createServer(app);

  // Initialize WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    addClient(ws);
    ws.on('close', () => removeClient(ws));
  });

  // Helper: Get authenticated user ID from session
  const getUserId = (req: any): string => {
    if (!req.user?.claims?.sub) {
      throw new Error("User not authenticated");
    }
    return req.user.claims.sub;
  };

  // Helper: Enrich player data with last trade price (market value)
  // Now just returns the cached lastTradePrice from database - no additional queries needed
  function enrichPlayerWithMarketValue(player: Player): Player & { lastTradePrice: string | null } {
    return {
      ...player,
      lastTradePrice: player.lastTradePrice || null, // Cached value from database
    };
  }

  // Helper: Calculate P&L for holdings - returns null values if no market price exists
  function calculatePnL(quantity: number, avgCost: string, lastTradePrice: string | null) {
    // If no market price exists (no trades), return null values
    if (!lastTradePrice) {
      return {
        currentValue: null,
        pnl: null,
        pnlPercent: null,
      };
    }

    const cost = parseFloat(avgCost);
    const price = parseFloat(lastTradePrice);
    const totalValue = quantity * price;
    const totalCost = quantity * cost;
    const pnl = totalValue - totalCost;
    const pnlPercent = totalCost > 0 ? (pnl / totalCost) * 100 : 0;

    return {
      currentValue: totalValue.toFixed(2),
      pnl: pnl.toFixed(2),
      pnlPercent: pnlPercent.toFixed(2),
    };
  }

  // Helper: Accrue vesting shares based on elapsed time
  async function accrueVestingShares(userId: string) {
    const user = await storage.getUser(userId);
    if (!user) return;

    const vestingData = await storage.getVesting(userId);
    if (!vestingData) return;

    const now = new Date();
    // Premium users get double rate (200 shares/hour) and double cap (4800)
    const isPremium = user.isPremium || false;
    const capLimit = isPremium ? 4800 : 2400;
    const totalSharesPerHour = isPremium ? 200 : 100;

    // If already at cap, don't accrue more - clear residual time
    if (vestingData.sharesAccumulated >= capLimit) {
      if (!vestingData.capReachedAt || vestingData.residualMs !== 0) {
        await storage.updateVesting(userId, {
          capReachedAt: now,
          residualMs: 0,
          updatedAt: now,
        });
      }
      return;
    }

    // Initialize lastAccruedAt if missing (fallback to updatedAt or now)
    const effectiveLastAccruedAt = vestingData.lastAccruedAt || vestingData.updatedAt || now;

    // If we had to initialize, update the database immediately
    if (!vestingData.lastAccruedAt) {
      await storage.updateVesting(userId, {
        lastAccruedAt: effectiveLastAccruedAt,
        updatedAt: now,
      });
    }

    // Use shared utility to calculate accrual update
    const update = calculateAccrualUpdate({
      sharesAccumulated: vestingData.sharesAccumulated,
      residualMs: vestingData.residualMs || 0,
      lastAccruedAt: effectiveLastAccruedAt,
      sharesPerHour: totalSharesPerHour,
      capLimit,
    }, now);

    // Only update if shares were actually earned
    const sharesEarned = update.sharesAccumulated - vestingData.sharesAccumulated;
    if (sharesEarned > 0) {
      await storage.updateVesting(userId, {
        sharesAccumulated: update.sharesAccumulated,
        residualMs: update.residualMs,
        lastAccruedAt: update.lastAccruedAt,
        updatedAt: now,
        capReachedAt: update.capReached ? now : null,
      });
    }
    // If no shares earned yet, DON'T update anything - leave baseline unchanged
  }

  // Helper: Sync Whop payments for a user and credit premium shares
  async function syncWhopPaymentsForUser(userId: string, userEmail: string): Promise<{
    credited: number;
    revoked: number;
    synced: number;
  }> {
    const result = { credited: 0, revoked: 0, synced: 0 };

    try {
      const apiKey = process.env.WHOP_API_KEY;
      const companyId = process.env.WHOP_COMPANY_ID;

      if (!apiKey) {
        console.log("[WHOP SYNC] No API key configured");
        return result;
      }

      if (!companyId) {
        console.log("[WHOP SYNC] No Company ID configured");
        return result;
      }

      // Use Whop v1 API directly - the SDK uses v5 which returns empty results
      // v1 API: GET https://api.whop.com/api/v1/payments?company_id=...
      const payments: any[] = [];

      try {
        let page = 1;
        let hasMore = true;
        const maxPages = 10; // Safety limit to prevent infinite loops

        while (hasMore && page <= maxPages) {
          const response = await fetch(
            `https://api.whop.com/api/v1/payments?company_id=${companyId}&per_page=100&page=${page}&include=line_items`,
            {
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`[WHOP SYNC] API error ${response.status}: ${errorText}`);
            return result;
          }

          const data = await response.json();
          const pagePayments = data.data || [];

          console.log(`[WHOP SYNC] Page ${page}: fetched ${pagePayments.length} payments`);

          // Filter payments matching this user's email (case-insensitive)
          const userPayments = pagePayments.filter((p: any) =>
            p.user?.email?.toLowerCase() === userEmail.toLowerCase()
          );

          payments.push(...userPayments);

          // Check if there are more pages
          hasMore = pagePayments.length === 100;
          page++;
        }

        console.log(`[WHOP SYNC] Found ${payments.length} payments for ${userEmail} (${page - 1} pages)`);
      } catch (err: any) {
        console.error(`[WHOP SYNC] Error querying Whop v1 API:`, err.message);
        return result;
      }

      // Process each payment
      for (const payment of payments) {
        result.synced++;

        const paymentId = payment.id;
        const status = payment.status || "unknown";

        // Check if payment already credited BEFORE any processing
        // Only skip if status is still "paid" (to allow refund/chargeback processing)
        const existingPayment = await storage.getWhopPaymentByPaymentId(paymentId);
        if (existingPayment?.creditedAt && status === "paid") {
          console.log(`[WHOP SYNC] Payment ${paymentId} already credited and still paid, skipping`);
          continue;
        }

        // Detect if this is a community or premium purchase
        const planId = payment.plan_id;
        const totalDollars = payment.total || 0;

        const amountCents = Math.round(totalDollars * 100);
        const classification = classifyWhopPurchase(planId, amountCents);
        if (!classification.assetType) {
          console.warn(`[WHOP SYNC] Skipping payment ${paymentId}: unclassified purchase (${classification.reason})`);
          continue;
        }

        const assetType = classification.assetType;
        const pricePerShare = assetType === "community" ? 1 : 5;

        // Extract quantity from line_items first (preferred), fallback to total/price
        let quantity = 0;
        if (payment.line_items && Array.isArray(payment.line_items)) {
          quantity = payment.line_items.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0);
        }
        // Fallback to total/price if no line_items or zero quantity
        if (quantity === 0 && totalDollars >= pricePerShare) {
          quantity = Math.floor(totalDollars / pricePerShare);
        }

        // Skip payments with no value (refunds, zero-dollar invoices)
        if (quantity === 0 && status === "paid") {
          console.log(`[WHOP SYNC] Skipping zero-value payment ${paymentId}`);
          continue;
        }

        // Upsert the payment record
        await storage.upsertWhopPayment({
          paymentId,
          email: userEmail.toLowerCase(),
          userId: null, // Will be set on credit
          quantity,
          amountCents,
          currency: payment.currency || "usd",
          whopStatus: status,
          rawPayload: payment,
        });

        // Re-fetch the payment record after upsert to get latest state
        const currentPayment = await storage.getWhopPaymentByPaymentId(paymentId);

        // Credit paid payments that haven't been credited yet
        // Use atomic credit-first approach: creditWhopPayment returns undefined if already credited
        // This prevents race conditions where multiple syncs credit the same payment
        if (status === "paid" && quantity > 0 && currentPayment &&
          !currentPayment.creditedAt && !currentPayment.revokedAt) {

          const avgCost = assetType === "community" ? "1.0000" : "5.0000";
          const creditResult = await creditPaymentAndHoldingAtomic(paymentId, userId, assetType, quantity, avgCost);

          if (creditResult) {
            result.credited += quantity;
            console.log(`[WHOP SYNC] Credited ${quantity} ${assetType} shares to user ${userId} from payment ${paymentId} (${creditResult.previousQuantity} -> ${creditResult.newQuantity})`);
          } else {
            console.log(`[WHOP SYNC] Payment ${paymentId} already credited by another process, skipping`);
          }
        }

        // Handle refunds/chargebacks - only if there's a previously credited payment
        if ((status === "refunded" || status === "disputed" || status === "chargedback") &&
          currentPayment && currentPayment.creditedAt && !currentPayment.revokedAt) {
          // Revoke the shares from holdings - preserve avgCost
          const existingHolding = await storage.getHolding(userId, assetType, assetType);
          const currentShares = parseFloat(existingHolding?.quantity || "0");
          const currentAvgCost = existingHolding?.avgCostBasis || (assetType === "community" ? "1.0000" : "5.0000");

          if (currentShares >= quantity) {
            // User has enough shares to fully revoke
            const newQuantity = currentShares - quantity;
            await storage.updateHolding(userId, assetType, assetType, newQuantity, currentAvgCost);
            await storage.revokeWhopPayment(paymentId, quantity, 0);
            result.revoked += quantity;
            console.log(`[WHOP SYNC] Revoked ${quantity} ${assetType} shares from user ${userId} for payment ${paymentId} (${currentShares} -> ${newQuantity})`);
          } else {
            // User doesn't have enough shares - revoke what we can and create liability
            const toRevoke = currentShares;
            const liability = quantity - currentShares;
            await storage.updateHolding(userId, assetType, assetType, 0, currentAvgCost);
            await storage.revokeWhopPayment(paymentId, toRevoke, liability);
            result.revoked += toRevoke;
            console.log(`[WHOP SYNC] Partially revoked ${toRevoke} ${assetType} shares, ${liability} liability for user ${userId}`);
          }
        }
      }

      return result;
    } catch (err: any) {
      console.error("[WHOP SYNC] Error syncing payments:", err.message);
      return result;
    }
  }


  function extractWhopPaymentFields(payment: any): { planId: string | null; amountCents: number; metadata: any; email: string | null; status: string } {
    const planId = payment?.plan_id || payment?.plan?.id || null;

    const toNumber = (v: any): number | null => {
      if (v === null || v === undefined) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const amountFromFinal = toNumber(payment?.final_amount);
    const amountFromTotalDollars = toNumber(payment?.total);
    const amountFromUsdTotal = toNumber(payment?.usd_total);
    const amountCents = amountFromFinal ??
      (amountFromTotalDollars !== null ? Math.round(amountFromTotalDollars * 100) : null) ??
      (amountFromUsdTotal !== null ? Math.round(amountFromUsdTotal * 100) : null) ??
      0;

    const metadata = payment?.metadata || {};
    const email = payment?.user?.email || null;
    const status = payment?.status || "unknown";

    return { planId, amountCents, metadata, email, status };
  }


  function classifyWhopPurchase(planId: string | null | undefined, amountCents: number | null | undefined): { assetType: "community" | "premium" | null; reason: string } {
    const communityPlanId = process.env.WHOP_COMMUNITY_PLAN_ID;
    const premiumPlanId = process.env.WHOP_PLAN_ID;

    if (planId) {
      if (communityPlanId && planId === communityPlanId) return { assetType: "community", reason: "plan_id:community" };
      if (premiumPlanId && planId === premiumPlanId) return { assetType: "premium", reason: "plan_id:premium" };
      return { assetType: null, reason: "plan_id:unknown" };
    }

    if (amountCents && amountCents >= 100) {
      return { assetType: amountCents < 500 ? "community" : "premium", reason: "amount_fallback" };
    }

    return { assetType: null, reason: "insufficient_data" };
  }

  async function creditPaymentAndHoldingAtomic(paymentId: string, userId: string, assetType: "community" | "premium", quantity: number, avgCost: string) {
    return await db.transaction(async (tx) => {
      const [creditedPayment] = await tx
        .update(whopPayments)
        .set({ userId, creditedAt: new Date() })
        .where(and(
          eq(whopPayments.paymentId, paymentId),
          sql`${whopPayments.creditedAt} IS NULL`
        ))
        .returning();

      if (!creditedPayment) return null;

      const [existingHolding] = await tx
        .select()
        .from(holdings)
        .where(and(
          eq(holdings.userId, userId),
          eq(holdings.assetType, assetType),
          eq(holdings.assetId, assetType)
        ));

      const currentQty = parseFloat(existingHolding?.quantity || "0");
      const newQty = currentQty + quantity;
      const resolvedAvgCost = existingHolding?.avgCostBasis || avgCost;
      const totalCostBasis = (parseFloat(resolvedAvgCost) * newQty).toFixed(2);

      if (existingHolding) {
        await tx
          .update(holdings)
          .set({
            quantity: newQty.toString(),
            powerLevel: (newQty * (existingHolding.power || 1)).toFixed(2),
            avgCostBasis: resolvedAvgCost,
            totalCostBasis,
            lastUpdated: new Date(),
          })
          .where(eq(holdings.id, existingHolding.id));
      } else {
        await tx.insert(holdings).values({
          userId,
          assetType,
          assetId: assetType,
          quantity: newQty.toString(),
          power: 1,
          powerLevel: newQty.toFixed(2),
          avgCostBasis: resolvedAvgCost,
          totalCostBasis,
          lastUpdated: new Date(),
        });
      }

      return { creditedPayment, previousQuantity: currentQty, newQuantity: newQty };
    });
  }

  async function findDeterministicSessionMatch(
    assetType: "community" | "premium",
    metadata: any,
    receiptId?: string,
    userEmail?: string | null,
    planId?: string | null,
  ) {
    const sessionId = metadata?.sessionId;
    if (sessionId) {
      if (assetType === "community") {
        const session = await storage.getCommunityCheckoutSession(sessionId);
        if (session) return { type: "community" as const, session };
      } else {
        const session = await storage.getPremiumCheckoutSession(sessionId);
        if (session) return { type: "premium" as const, session };
      }
    }

    if (receiptId) {
      if (assetType === "community") {
        const session = await storage.getCommunityCheckoutSessionByReceipt(receiptId);
        if (session) return { type: "community" as const, session };
      } else {
        const session = await storage.getPremiumCheckoutSessionByReceipt(receiptId);
        if (session) return { type: "premium" as const, session };
      }
    }

    // Strict fallback only when metadata is missing: match by email + plan + recent pending session.
    const metadataEmpty = !metadata || Object.keys(metadata).length === 0;
    if (metadataEmpty && userEmail) {
      const lookback = new Date(Date.now() - 30 * 60 * 1000);
      const pending = assetType === "community"
        ? await storage.getPendingCommunityCheckoutSessions()
        : await storage.getPendingPremiumCheckoutSessions();

      const matchedByEmail = [] as any[];
      for (const s of pending) {
        if (new Date(s.createdAt) < lookback) continue;
        if (planId && s.planId !== planId) continue;
        const u = await storage.getUser(s.userId);
        if (u?.email?.toLowerCase() === userEmail.toLowerCase()) {
          matchedByEmail.push(s);
        }
      }

      if (matchedByEmail.length === 1) {
        return { type: assetType, session: matchedByEmail[0] };
      }
    }

    return null;
  }

  // Ezoic ads.txt redirect
  app.get("/ads.txt", (_req, res) => {
    res.redirect(301, "https://srv.adstxtmanager.com/19390/sportfolio.market");
  });

  // SEO: Dynamic Sitemap XML
  app.get("/sitemap.xml", async (_req, res) => {
    try {
      const baseUrl = "https://sportfolio.replit.app";
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

      // Fetch limited dynamic content for performance
      const [topPlayersByVolume, activeContests, blogPosts] = await Promise.all([
        storage.getTopPlayersByVolume(200), // Top 200 players only
        storage.getContests(), // Active contests
        storage.getBlogPosts({ limit: 100, offset: 0, publishedOnly: true }),
      ]);

      // Static pages with realistic lastmod dates
      const staticPages = [
        { url: "", lastmod: today, changefreq: "daily", priority: "1.0" },
        { url: "marketplace", lastmod: today, changefreq: "hourly", priority: "0.9" },
        { url: "contests", lastmod: today, changefreq: "daily", priority: "0.9" },
        { url: "leaderboards", lastmod: today, changefreq: "daily", priority: "0.8" },
        { url: "blog", lastmod: today, changefreq: "weekly", priority: "0.8" },
        { url: "how-it-works", lastmod: "2025-11-23", changefreq: "monthly", priority: "0.7" },
        { url: "about", lastmod: "2025-11-23", changefreq: "monthly", priority: "0.6" },
        { url: "contact", lastmod: "2025-11-23", changefreq: "monthly", priority: "0.6" },
        { url: "privacy", lastmod: "2025-11-23", changefreq: "yearly", priority: "0.4" },
        { url: "terms", lastmod: "2025-11-23", changefreq: "yearly", priority: "0.4" },
      ];

      // Build sitemap XML
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
      xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

      // Add static pages
      staticPages.forEach(page => {
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/${page.url}</loc>\n`;
        xml += `    <lastmod>${page.lastmod}</lastmod>\n`;
        xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
        xml += `    <priority>${page.priority}</priority>\n`;
        xml += `  </url>\n`;
      });

      // Add player pages (already sorted by volume from storage)
      topPlayersByVolume.forEach((player: Player) => {
        const playerLastMod = player.lastUpdated ? new Date(player.lastUpdated).toISOString().split('T')[0] : today;
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/player/${player.id}</loc>\n`;
        xml += `    <lastmod>${playerLastMod}</lastmod>\n`;
        xml += `    <changefreq>daily</changefreq>\n`;
        xml += `    <priority>0.7</priority>\n`;
        xml += `  </url>\n`;
      });

      // Add contest detail and leaderboard pages
      activeContests.forEach((contest: typeof activeContests[0]) => {
        // Main contest detail page
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/contest/${contest.id}</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>hourly</changefreq>\n`;
        xml += `    <priority>0.6</priority>\n`;
        xml += `  </url>\n`;

        // Contest leaderboard page
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/contest/${contest.id}/leaderboard</loc>\n`;
        xml += `    <lastmod>${today}</lastmod>\n`;
        xml += `    <changefreq>hourly</changefreq>\n`;
        xml += `    <priority>0.6</priority>\n`;
        xml += `  </url>\n`;
      });

      // Add blog posts with actual update dates
      blogPosts.posts.forEach((post: typeof blogPosts.posts[0]) => {
        const postLastMod = post.updatedAt || post.publishedAt;
        const formattedDate = new Date(postLastMod).toISOString().split('T')[0];
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/blog/${post.slug}</loc>\n`;
        xml += `    <lastmod>${formattedDate}</lastmod>\n`;
        xml += `    <changefreq>weekly</changefreq>\n`;
        xml += `    <priority>0.7</priority>\n`;
        xml += `  </url>\n`;
      });

      xml += '</urlset>';

      res.header('Content-Type', 'application/xml');
      res.send(xml);
    } catch (error) {
      console.error("Error generating sitemap:", error);
      res.status(500).send("Error generating sitemap");
    }
  });

  // API ROUTES

  // Auth endpoints
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);

      // Log successful auth
      console.log(`[AUTH:USER] Authenticated user: ${user?.username} (${userId.substring(0, 8)}...)`);

      // Return user data immediately - don't block on Whop sync or vesting
      res.json(user);

      // Fire-and-forget: Trigger vesting accrual in background on login
      if (user) {
        accrueVestingShares(userId).catch(err => console.error('[Vesting] Login accrual error:', err));
        // Scout Engine: Update activity timestamp for 24h kill-switch
        storage.updateLastActive(userId).catch(err => console.error('[Scout] Activity update error:', err));
      }

      // Fire-and-forget: Trigger Whop sync in background if user has email and sync is requested
      if (user?.email && req.query.sync === "true") {
        syncWhopPaymentsForUser(userId, user.email)
          .then((whopSync) => {
            console.log(`[AUTH] Whop sync for ${user.username}: ${whopSync.credited} credited, ${whopSync.synced} synced`);
          })
          .catch((syncErr: any) => {
            console.error(`[AUTH] Whop sync error:`, syncErr.message);
          });
      }
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  // Whop payment sync endpoint - manual sync for logged-in users
  app.post("/api/whop/sync", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!user.email) {
        return res.status(400).json({
          error: "No email associated with your account. Please update your profile with the email used on Whop."
        });
      }

      const result = await syncWhopPaymentsForUser(userId, user.email);

      // Get updated user data
      const updatedUser = await storage.getUser(userId);
      const premiumHolding = await storage.getHolding(userId, "premium", "premium");

      res.json({
        success: true,
        credited: result.credited,
        revoked: result.revoked,
        synced: result.synced,
        premiumShares: premiumHolding?.quantity || 0,
      });
    } catch (error: any) {
      console.error("Error syncing Whop payments:", error);
      res.status(500).json({ error: "Failed to sync with Whop" });
    }
  });

  // Admin endpoint to sync Whop payments for any user
  app.post("/api/admin/whop/sync", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const currentUser = await storage.getUser(userId);

      // Check if user is admin
      if (!currentUser?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const { email, username } = req.body;

      if (!email && !username) {
        return res.status(400).json({ error: "Email or username required" });
      }

      // Find target user
      let targetUser;
      if (username) {
        targetUser = await storage.getUserByUsername(username);
      } else if (email) {
        // Find user by email
        const allUsers = await storage.getUsers();
        targetUser = allUsers.find(u => u.email?.toLowerCase() === email.toLowerCase());
      }

      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!targetUser.email) {
        return res.status(400).json({ error: "Target user has no email configured" });
      }

      const result = await syncWhopPaymentsForUser(targetUser.id, targetUser.email);

      // Get updated user data
      const updatedUser = await storage.getUser(targetUser.id);
      const premiumHolding = await storage.getHolding(targetUser.id, "premium", "premium");

      res.json({
        success: true,
        user: {
          id: updatedUser?.id,
          username: updatedUser?.username,
          email: updatedUser?.email,
          premiumShares: premiumHolding?.quantity || 0,
        },
        credited: result.credited,
        revoked: result.revoked,
        synced: result.synced,
      });
    } catch (error: any) {
      console.error("Error in admin Whop sync:", error);
      res.status(500).json({ error: "Failed to sync with Whop" });
    }
  });

  // Admin endpoint to manually grant premium shares
  app.post("/api/admin/premium/grant", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const currentUser = await storage.getUser(userId);

      // Check if user is admin
      if (!currentUser?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const { username, quantity } = req.body;

      if (!username) {
        return res.status(400).json({ error: "Username is required" });
      }

      const parsedQuantity = parseInt(quantity, 10);
      if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
        return res.status(400).json({ error: "Quantity must be a positive number" });
      }

      // Find target user by username
      const targetUser = await storage.getUserByUsername(username);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      // Get existing premium holding
      const existingHolding = await storage.getHolding(targetUser.id, "premium", "premium");
      const currentQuantity = parseFloat(existingHolding?.quantity || "0");
      const newQuantity = currentQuantity + parsedQuantity;

      // Preserve existing avgCost or use $5 default for new holdings
      const currentAvgCost = existingHolding?.avgCostBasis || "5.0000";

      // Update holding with new quantity
      await storage.updateHolding(targetUser.id, "premium", "premium", newQuantity, currentAvgCost);

      console.log(`[ADMIN] Granted ${parsedQuantity} premium shares to user ${targetUser.username} (${currentQuantity} -> ${newQuantity}) by admin ${currentUser.username}`);

      res.json({
        success: true,
        user: {
          id: targetUser.id,
          username: targetUser.username,
        },
        granted: parsedQuantity,
        previousQuantity: currentQuantity,
        newQuantity: newQuantity,
      });
    } catch (error: any) {
      console.error("Error granting premium shares:", error);
      res.status(500).json({ error: "Failed to grant premium shares" });
    }
  });

  // Dashboard - Now public for unauthenticated users (with limited data)
  app.get("/api/dashboard", optionalAuth, async (req, res) => {
    try {
      const startTime = performance.now();
      const timings: Record<string, number> = {};

      // Check if user is authenticated
      const isUserAuthenticated = !!req.user;
      const userId = isUserAuthenticated ? getUserId(req) : null;

      // Fetch public data (always available)
      const publicStart = performance.now();
      const [recentTrades, hotPlayersRaw] = await Promise.all([
        storage.getRecentTrades(undefined, 10),
        storage.getTopPlayersByVolume(5), // Get top 5 players by 24h volume directly from DB
      ]);
      timings.publicData = performance.now() - publicStart;

      // If not authenticated, return public data only
      if (!isUserAuthenticated || !userId) {
        // Collect player IDs from public data
        const playerIds = new Set<string>();
        recentTrades.forEach(t => playerIds.add(t.playerId));

        // Batch fetch needed players
        const batchStart = performance.now();
        const players = await storage.getPlayersByIds(Array.from(playerIds));
        timings.playerBatch = performance.now() - batchStart;
        const playerMap = new Map(players.map(p => [p.id, p]));

        // Enrich hot players (sync operation, no await needed)
        const hotPlayers = hotPlayersRaw.map(enrichPlayerWithMarketValue);

        timings.total = performance.now() - startTime;
        console.log(`[Dashboard] Unauthenticated: ${timings.total.toFixed(0)}ms (public: ${timings.publicData.toFixed(0)}ms, playerBatch: ${timings.playerBatch.toFixed(0)}ms)`);

        return res.json({
          user: null, // No user data for anonymous visitors
          hotPlayers,
          vesting: null,
          recentTrades: recentTrades.map(trade => ({
            ...trade,
            player: playerMap.get(trade.playerId),
          })),
          topHoldings: [],
          portfolioHistory: [],
          power: null, // Power/boosts require authentication
        });
      }

      // Authenticated user - fetch full dashboard data
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Accrue vesting shares in background (fire-and-forget for dashboard speed)
      // Vesting is also triggered by: cron job, vesting modal, claim, redeem, login
      accrueVestingShares(user.id).catch(err => console.error('[Vesting] Background accrual error:', err));

      // Fetch user-specific data in parallel
      const [userHoldings, vestingData, vestingSplits, powerData] = await Promise.all([
        storage.getUserHoldings(user.id),
        storage.getVesting(user.id),
        storage.getVestingSplits(user.id),
        getDashboardPowerData(user.id), // Fetch power/boosts data
      ]);

      // Collect all unique player IDs we need to fetch
      const playerIds = new Set<string>();

      // Add holdings player IDs
      userHoldings.forEach(h => {
        if (h.assetType === "player") playerIds.add(h.assetId);
      });

      // Add recent trades player IDs
      recentTrades.forEach(t => playerIds.add(t.playerId));

      // Add vesting player IDs
      if (vestingData?.playerId) playerIds.add(vestingData.playerId);
      vestingSplits.forEach(s => playerIds.add(s.playerId));

      // Parallel fetch: players, ranks, and yesterday's snapshot
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const [players, latestRanks, yesterdaySnapshot] = await Promise.all([
        storage.getPlayersByIds(Array.from(playerIds)),
        storage.getLatestSnapshotRanks(),
        storage.getPortfolioSnapshot(user.id, yesterday),
      ]);
      const playerMap = new Map(players.map(p => [p.id, p]));

      // Calculate portfolio value using pre-fetched players
      // Only count holdings with real market prices (skip placeholder prices)
      let portfolioValue = 0;
      for (const holding of userHoldings) {
        if (holding.assetType === "player") {
          const player = playerMap.get(holding.assetId);
          if (player && player.lastTradePrice) {
            portfolioValue += parseFloat(holding.quantity) * parseFloat(player.lastTradePrice);
          }
        }
      }

      // Enrich hot players with market values (sync operation using pre-fetched data)
      const hotPlayers = hotPlayersRaw.map(enrichPlayerWithMarketValue);

      // Get top 3 holdings by value using pre-fetched players
      const topHoldings = [];
      for (const holding of userHoldings) {
        if (holding.assetType === "player") {
          const player = playerMap.get(holding.assetId);
          if (player) {
            const enrichedPlayer = enrichPlayerWithMarketValue(player);
            const { currentValue, pnl, pnlPercent } = calculatePnL(
              parseFloat(holding.quantity),
              holding.avgCostBasis,
              enrichedPlayer.lastTradePrice
            );
            topHoldings.push({
              player: enrichedPlayer,
              quantity: holding.quantity,
              value: currentValue,
              pnl,
              pnlPercent,
            });
          }
        }
      }
      // Sort by value, putting null values at the end
      topHoldings.sort((a, b) => {
        if (a.value === null && b.value === null) return 0;
        if (a.value === null) return 1;
        if (b.value === null) return -1;
        return parseFloat(b.value) - parseFloat(a.value);
      });

      // Get vesting data using pre-fetched players
      let vestingPlayer = undefined;
      let vestingPlayers: Array<{ player: Player | undefined; sharesPerHour: number }> = [];

      if (vestingSplits.length > 0) {
        // Multi-player vesting
        vestingPlayers = vestingSplits.map(split => ({
          player: playerMap.get(split.playerId),
          sharesPerHour: split.sharesPerHour,
        }));
      } else if (vestingData?.playerId) {
        // Legacy single-player vesting
        vestingPlayer = playerMap.get(vestingData.playerId);
      }

      // Get ranks from cached snapshot or calculate real-time
      const cachedRank = latestRanks.get(user.id);

      let currentCashRank = cachedRank?.cashRank || 1;
      let currentPortfolioRank = cachedRank?.portfolioRank || 1;

      // If no cached ranks, fallback to real-time calculation
      if (!cachedRank) {
        const allUsersRankData = await storage.getAllUsersForRanking();

        const cashSorted = [...allUsersRankData].sort((a, b) =>
          parseFloat(b.balance) - parseFloat(a.balance)
        );
        currentCashRank = cashSorted.findIndex(u => u.userId === user.id) + 1;

        const portfolioSorted = [...allUsersRankData].sort((a, b) =>
          b.portfolioValue - a.portfolioValue
        );
        currentPortfolioRank = portfolioSorted.findIndex(u => u.userId === user.id) + 1;
      }

      const cashRankChange = yesterdaySnapshot?.cashRank
        ? yesterdaySnapshot.cashRank - currentCashRank
        : null;
      const portfolioRankChange = yesterdaySnapshot?.portfolioRank
        ? yesterdaySnapshot.portfolioRank - currentPortfolioRank
        : null;

      res.json({
        user: {
          balance: user.balance,
          portfolioValue: portfolioValue.toFixed(2),
          cashRank: currentCashRank,
          portfolioRank: currentPortfolioRank,
          cashRankChange,
          portfolioRankChange,
        },
        hotPlayers,
        vesting: vestingData ? {
          ...vestingData,
          player: vestingPlayer,
          players: vestingPlayers,
          capLimit: user.isPremium ? 4800 : 2400,
          sharesPerHour: user.isPremium ? 200 : 100,
        } : null,
        power: powerData,
        recentTrades: recentTrades.map(trade => ({
          ...trade,
          player: playerMap.get(trade.playerId),
        })),
        topHoldings: topHoldings.slice(0, 3),
        portfolioHistory: [], // Placeholder
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Today's games (in ET timezone where NBA games are scheduled)
  app.get("/api/games/today", async (req, res) => {
    try {
      const sport = (req.query.sport as string) || "NBA";
      const { startOfDay, endOfDay } = getTodayETBoundaries();
      const games = await storage.getDailyGamesBySport(sport, startOfDay, endOfDay);

      // Add gameDay to each game for frontend display
      const gamesWithDay = games.map(game => ({
        ...game,
        gameDay: getGameDay(game.startTime),
      }));

      res.json(gamesWithDay);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Games for a specific date (YYYY-MM-DD format in Eastern Time)
  app.get("/api/games/date/:date", async (req, res) => {
    try {
      const { date } = req.params;
      const sport = (req.query.sport as string) || "NBA";

      // Validate date format (YYYY-MM-DD)
      const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!dateMatch) {
        return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
      }

      const { startOfDay, endOfDay } = getETDayBoundaries(date);
      const games = await storage.getDailyGamesBySport(sport, startOfDay, endOfDay);

      // Add gameDay to each game for frontend display
      const gamesWithDay = games.map(game => ({
        ...game,
        gameDay: getGameDay(game.startTime),
      }));

      res.json(gamesWithDay);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Game stats - get player box scores for a specific game
  app.get("/api/games/:gameId/stats", async (req, res) => {
    try {
      const { gameId } = req.params;
      const gameIdNum = parseInt(gameId);

      if (isNaN(gameIdNum)) {
        return res.status(400).json({ error: "Invalid game ID" });
      }

      // Get all player stats for this game
      const stats = await storage.getGameStatsByGameId(gameId);

      if (!stats || stats.length === 0) {
        return res.json({
          gameId,
          homeTeam: { players: [], totals: null },
          awayTeam: { players: [], totals: null },
          topPerformers: null,
          message: "No stats available yet"
        });
      }

      // Get player details for all stats
      const statsWithPlayers = await Promise.all(
        stats.map(async (stat) => {
          const player = await storage.getPlayer(stat.playerId);
          return {
            playerId: stat.playerId,
            playerName: player ? `${player.firstName} ${player.lastName}` : 'Unknown',
            team: player?.team || stat.opponentTeam,
            minutes: stat.minutes,
            points: stat.points,
            threePointersMade: stat.threePointersMade,
            rebounds: stat.rebounds,
            assists: stat.assists,
            steals: stat.steals,
            blocks: stat.blocks,
            turnovers: stat.turnovers,
            fantasyPoints: parseFloat(stat.fantasyPoints),
            homeAway: stat.homeAway,
          };
        })
      );

      // Group by home/away
      const homeStats = statsWithPlayers.filter(s => s.homeAway === "home");
      const awayStats = statsWithPlayers.filter(s => s.homeAway === "away");

      const calculateTeamTotals = (teamStats: typeof statsWithPlayers) => ({
        points: teamStats.reduce((sum, s) => sum + s.points, 0),
        rebounds: teamStats.reduce((sum, s) => sum + s.rebounds, 0),
        assists: teamStats.reduce((sum, s) => sum + s.assists, 0),
        steals: teamStats.reduce((sum, s) => sum + s.steals, 0),
        blocks: teamStats.reduce((sum, s) => sum + s.blocks, 0),
        turnovers: teamStats.reduce((sum, s) => sum + s.turnovers, 0),
      });

      // Find top performers across both teams
      const allStats = [...homeStats, ...awayStats];
      const topScorer = allStats.reduce((max, s) => s.points > max.points ? s : max, allStats[0]);
      const topRebounder = allStats.reduce((max, s) => s.rebounds > max.rebounds ? s : max, allStats[0]);
      const topAssister = allStats.reduce((max, s) => s.assists > max.assists ? s : max, allStats[0]);

      res.json({
        gameId,
        homeTeam: {
          players: homeStats,
          totals: homeStats.length > 0 ? calculateTeamTotals(homeStats) : null,
        },
        awayTeam: {
          players: awayStats,
          totals: awayStats.length > 0 ? calculateTeamTotals(awayStats) : null,
        },
        topPerformers: allStats.length > 0 ? {
          topScorer,
          topRebounder,
          topAssister,
        } : null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Live game stats - fetches real-time player stats from Ball Don't Lie API
  app.get("/api/games/:gameId/live-stats", async (req, res) => {
    try {
      const { gameId } = req.params;
      const gameIdNum = parseInt(gameId);

      if (isNaN(gameIdNum)) {
        return res.status(400).json({ error: "Invalid game ID" });
      }

      // Get the game from our database to determine sport
      const game = await storage.getDailyGameByGameId(gameId);
      if (!game) {
        return res.status(404).json({ error: "Game not found" });
      }

      // Import here to avoid circular dependency issues
      const { fetchPlayerGameStats } = await import("./balldontlie-nba");
      const { fetchGameStats } = await import("./balldontlie-nfl");

      if (game.sport === "NBA") {
        console.log(`[live-stats] Fetching NBA player stats for game ${gameId}`);

        // Fetch player stats for this specific game using /stats endpoint with game_ids[]
        const playerStats = await fetchPlayerGameStats(gameIdNum);
        console.log(`[live-stats] Found ${playerStats.length} NBA player stats`);

        if (playerStats.length > 0) {
          // Group stats by team
          const homeStats = playerStats.filter(s => s.team.abbreviation === game.homeTeam);
          const awayStats = playerStats.filter(s => s.team.abbreviation === game.awayTeam);

          // Get top 3 scorers for each team
          const getTopPerformers = (stats: typeof playerStats) => {
            return [...stats]
              .sort((a, b) => (b.pts || 0) - (a.pts || 0))
              .slice(0, 3)
              .map(s => ({
                name: `${s.player.first_name.charAt(0)}. ${s.player.last_name}`,
                team: s.team.abbreviation,
                pts: s.pts || 0,
                reb: s.reb || 0,
                ast: s.ast || 0,
                min: s.min || "0",
              }));
          };

          return res.json({
            gameId,
            status: game.status,
            homeTeam: game.homeTeam,
            homeScore: game.homeScore,
            awayTeam: game.awayTeam,
            awayScore: game.awayScore,
            homePlayers: homeStats.map(s => ({
              id: s.player.id,
              name: `${s.player.first_name} ${s.player.last_name}`,
              position: s.player.position,
              min: s.min,
              pts: s.pts,
              reb: s.reb,
              ast: s.ast,
              stl: s.stl,
              blk: s.blk,
              fg_pct: s.fg_pct,
            })),
            awayPlayers: awayStats.map(s => ({
              id: s.player.id,
              name: `${s.player.first_name} ${s.player.last_name}`,
              position: s.player.position,
              min: s.min,
              pts: s.pts,
              reb: s.reb,
              ast: s.ast,
              stl: s.stl,
              blk: s.blk,
              fg_pct: s.fg_pct,
            })),
            homeTopPerformers: getTopPerformers(homeStats),
            awayTopPerformers: getTopPerformers(awayStats),
          });
        }

        console.log(`[live-stats] No NBA player stats available for ${gameId}`);

        // Return cached scores if no player stats available
        return res.json({
          gameId,
          status: game.status,
          homeTeam: game.homeTeam,
          homeScore: game.homeScore,
          awayTeam: game.awayTeam,
          awayScore: game.awayScore,
          homePlayers: [],
          awayPlayers: [],
          homeTopPerformers: [],
          awayTopPerformers: [],
          message: "No live stats available yet"
        });
      } else if (game.sport === "NFL") {
        console.log(`[live-stats] Fetching NFL stats for game ${gameId}`);

        // Fetch NFL player stats
        const nflStats = await fetchGameStats([gameIdNum]);
        console.log(`[live-stats] Found ${nflStats.length} NFL player stats`);

        if (nflStats.length > 0) {
          // Group by team
          const homeStats = nflStats.filter(s => s.team.abbreviation === game.homeTeam);
          const awayStats = nflStats.filter(s => s.team.abbreviation === game.awayTeam);

          return res.json({
            gameId,
            status: game.status,
            homeTeam: game.homeTeam,
            homeScore: game.homeScore,
            awayTeam: game.awayTeam,
            awayScore: game.awayScore,
            homePlayers: homeStats.map(s => ({
              id: s.player.id,
              name: `${s.player.first_name} ${s.player.last_name}`,
              position: s.player.position,
              passingYards: s.passing_yards,
              passingTDs: s.passing_touchdowns,
              rushingYards: s.rushing_yards,
              rushingTDs: s.rushing_touchdowns,
              receivingYards: s.receiving_yards,
              receivingTDs: s.receiving_touchdowns,
              receptions: s.receiving_receptions,
            })),
            awayPlayers: awayStats.map(s => ({
              id: s.player.id,
              name: `${s.player.first_name} ${s.player.last_name}`,
              position: s.player.position,
              passingYards: s.passing_yards,
              passingTDs: s.passing_touchdowns,
              rushingYards: s.rushing_yards,
              rushingTDs: s.rushing_touchdowns,
              receivingYards: s.receiving_yards,
              receivingTDs: s.receiving_touchdowns,
              receptions: s.receiving_receptions,
            })),
            homeTopPerformers: [],
            awayTopPerformers: [],
          });
        }

        console.log(`[live-stats] No NFL live stats available for ${gameId}`);

        // Return cached scores if no player stats available
        return res.json({
          gameId,
          status: game.status,
          homeTeam: game.homeTeam,
          homeScore: game.homeScore,
          awayTeam: game.awayTeam,
          awayScore: game.awayScore,
          homePlayers: [],
          awayPlayers: [],
          homeTopPerformers: [],
          awayTopPerformers: [],
          message: "No live stats available yet"
        });
      }

      return res.status(400).json({ error: "Unsupported sport" });
    } catch (error: any) {
      console.error("[live-stats] Error fetching live stats:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Add cash to user balance ($1) - DEVELOPMENT ONLY
  // This endpoint is disabled in production to prevent abuse
  app.post("/api/user/add-cash", isAuthenticated, async (req, res) => {
    try {
      // SECURITY: Disable in production
      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: "This feature is disabled in production" });
      }

      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const updatedUser = await storage.addUserBalance(user.id, 1.00);

      if (updatedUser) {
        broadcast({ type: "portfolio", userId: user.id, balance: updatedUser.balance });
        res.json({ balance: updatedUser.balance });
      } else {
        res.status(500).json({ error: "Failed to update balance" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update username
  app.post("/api/user/update-username", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { username } = req.body;

      // Validate username
      if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: "Username is required" });
      }

      // Check length (3-20 characters)
      if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: "Username must be between 3 and 20 characters" });
      }

      // Check format (alphanumeric, underscores, hyphens only)
      if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        return res.status(400).json({ error: "Username can only contain letters, numbers, underscores, and hyphens" });
      }

      // Check if username is already taken by another user
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser && existingUser.id !== userId) {
        return res.status(409).json({ error: "Username is already taken" });
      }

      const updatedUser = await storage.updateUsername(userId, username);
      if (updatedUser) {
        res.json({ username: updatedUser.username });
      } else {
        res.status(500).json({ error: "Failed to update username" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update profile image
  app.post("/api/user/update-profile-image", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { profileImageUrl } = req.body;

      // Validate URL
      if (!profileImageUrl || typeof profileImageUrl !== 'string') {
        return res.status(400).json({ error: "Profile image URL is required" });
      }

      // Basic URL validation
      try {
        new URL(profileImageUrl);
      } catch {
        return res.status(400).json({ error: "Invalid URL format" });
      }

      const updatedUser = await storage.updateProfileImage(userId, profileImageUrl);
      if (updatedUser) {
        res.json({ profileImageUrl: updatedUser.profileImageUrl });
      } else {
        res.status(500).json({ error: "Failed to update profile image" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Mark onboarding as complete
  app.post("/api/user/onboarding/complete", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      await storage.markOnboardingComplete(userId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint to clean up duplicate game records (legacy MySportsFeeds data)
  app.post("/api/admin/games/cleanup-duplicates", isAuthenticated, async (req: any, res) => {
    try {
      // Check if user is admin
      const currentUser = await storage.getUser(req.user?.claims?.sub);
      if (!currentUser?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      console.log("[ADMIN] Starting duplicate game cleanup...");

      // Find all legacy MySportsFeeds records (gameId starting with 18447)
      const legacyRecords = await db
        .select({ id: dailyGames.id, gameId: dailyGames.gameId, awayTeam: dailyGames.awayTeam, homeTeam: dailyGames.homeTeam, startTime: dailyGames.startTime })
        .from(dailyGames)
        .where(sql`${dailyGames.gameId} LIKE '18447%' AND ${dailyGames.sport} = 'NBA'`)
        .limit(500);

      let deletedCount = 0;
      let keptCount = 0;
      const details: { deleted: string[]; kept: string[] } = { deleted: [], kept: [] };

      for (const legacy of legacyRecords) {
        // Check if there's a BallDontLie equivalent for the same teams at the same time
        const startTime = new Date(legacy.startTime);
        const minTime = new Date(startTime.getTime() - 5 * 60 * 1000);
        const maxTime = new Date(startTime.getTime() + 5 * 60 * 1000);

        const [match] = await db
          .select()
          .from(dailyGames)
          .where(and(
            eq(dailyGames.sport, 'NBA'),
            sql`${dailyGames.gameId} NOT LIKE '18447%'`,
            sql`${dailyGames.awayTeam} = ${legacy.awayTeam}`,
            sql`${dailyGames.homeTeam} = ${legacy.homeTeam}`,
            sql`${dailyGames.startTime} >= ${minTime}`,
            sql`${dailyGames.startTime} <= ${maxTime}`
          ))
          .limit(1);

        if (match) {
          // Delete the legacy record
          await db.delete(dailyGames).where(eq(dailyGames.id, legacy.id));
          deletedCount++;
          details.deleted.push(`${legacy.gameId} (${legacy.awayTeam}@${legacy.homeTeam})`);
        } else {
          // No equivalent - keep this record
          keptCount++;
          details.kept.push(`${legacy.gameId} (${legacy.awayTeam}@${legacy.homeTeam})`);
        }
      }

      const result = {
        success: true,
        message: `Cleanup complete: ${deletedCount} duplicates deleted, ${keptCount} records kept (no BDL equivalent)`,
        deletedCount,
        keptCount,
        details: {
          deleted: details.deleted.slice(0, 50), // Limit response size
          kept: details.kept.slice(0, 10),
        },
      };

      console.log(`[ADMIN] Duplicate cleanup: ${deletedCount} deleted, ${keptCount} kept`);
      res.json(result);
    } catch (error: any) {
      console.error("[ADMIN] Error cleaning up duplicates:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint to manually trigger sync jobs
  app.post("/api/admin/sync/:jobName", isAuthenticated, async (req, res) => {
    try {
      const { jobName } = req.params;
      const result = await jobScheduler.triggerJob(jobName);
      res.json({
        success: true,
        jobName,
        ...result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Players / Marketplace
  app.get("/api/teams", async (req, res) => {
    try {
      const teams = await storage.getDistinctTeams();
      res.json(teams);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Top risers (24h) - players with highest priceChange24h
  app.get("/api/players/spotlight/top-risers", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      const sport = (req.query.sport as string) || "NBA";
      const players = await storage.getPlayersBySport(sport);

      // Filter to players with positive price change and actual trade prices
      const risers = players
        .filter(p => p.lastTradePrice && parseFloat(p.priceChange24h) > 0)
        .sort((a, b) => parseFloat(b.priceChange24h) - parseFloat(a.priceChange24h))
        .slice(0, limit)
        .map(p => ({
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          team: p.team,
          position: p.position,
          currentPrice: p.currentPrice ? parseFloat(p.currentPrice) : (p.lastTradePrice ? parseFloat(p.lastTradePrice) : null),
          priceChange24h: parseFloat(p.priceChange24h),
        }));

      res.json(risers);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Top market cap players
  app.get("/api/players/spotlight/top-market-cap", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      const sport = (req.query.sport as string) || "NBA";
      const players = await storage.getPlayersBySport(sport);

      // Filter to players with established market prices and sort by marketCap
      const topMarketCap = players
        .filter(p => (p.lastTradePrice || p.currentPrice) && parseFloat(p.marketCap) > 0)
        .sort((a, b) => parseFloat(b.marketCap) - parseFloat(a.marketCap))
        .slice(0, limit)
        .map(p => ({
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          team: p.team,
          position: p.position,
          currentPrice: p.currentPrice ? parseFloat(p.currentPrice) : (p.lastTradePrice ? parseFloat(p.lastTradePrice) : null),
          marketCap: parseFloat(p.marketCap),
          totalShares: p.totalShares,
        }));

      res.json(topMarketCap);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Top player pools by liquidity (k value)
  app.get("/api/players/spotlight/top-pools", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      const sport = (req.query.sport as string) || "NBA";
      
      // Get players for the sport first
      const players = await storage.getPlayersBySport(sport);
      const playerIds = players.map(p => p.id);
      
      // Get pools for these players, sorted by k value
      const pools = await storage.getPlayerPoolsByPlayerIds(playerIds);
      
      // Sort by k value descending and take top N
      const topPools = pools
        .sort((a, b) => parseFloat(b.k) - parseFloat(a.k))
        .slice(0, limit)
        .map(pool => {
          const player = players.find(p => p.id === pool.playerId);
          return {
            player: {
              id: pool.playerId,
              firstName: player?.firstName || "Unknown",
              lastName: player?.lastName || "Unknown",
              team: player?.team || "",
              position: player?.position || "",
              currentPrice: player?.currentPrice ? parseFloat(player.currentPrice) : null,
            },
            k: parseFloat(pool.k),
            shares: parseFloat(pool.shares),
            playMoney: parseFloat(pool.playMoney),
          };
        });

      res.json(topPools);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get distinct teams for a sport
  app.get("/api/teams", async (req, res) => {
    try {
      const { sport } = req.query;
      const sportFilter = (sport as string) || "NBA";
      const teams = await storage.getDistinctTeamsBySport(sportFilter);
      res.json(teams);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });



  // Get all players with advanced filtering
  app.get("/api/players", async (req, res) => {
    try {
      const { search, team, position, limit, offset, page, sortBy, sortOrder, teamsPlayingOnDate, sport, isWatchlist, watchlistId } = req.query;

      // Handle watchlist filtering
      // If isWatchlist=true or a specific watchlistId is provided, we need authentication
      let watchlistUserId: string | undefined = undefined;
      let scopedWatchlistId: string | undefined = undefined;
      if (isWatchlist === 'true' || typeof watchlistId === 'string') {
        // Support both Passport session user (req.user.id) and raw Auth0 profile (req.user.claims.sub)
        const user = req.user as any;
        const userId = user?.id || user?.claims?.sub;

        if (!userId) {
          // If asking for watchlist but not logged in, return empty
          return res.json({ players: [], total: 0 });
        }
        watchlistUserId = userId;
        if (typeof watchlistId === 'string' && watchlistId !== 'all') {
          scopedWatchlistId = watchlistId;
        }
      }

      // Parse and validate pagination params
      const parsedLimit = limit ? parseInt(limit as string) : 50;
      // Guard against invalid numeric input (NaN) - allow up to 5000 for high-volume list views
      const safeLimit = isNaN(parsedLimit) ? 50 : Math.max(1, Math.min(parsedLimit, 5000));

      // Support both explicit offset and page-based pagination (offset takes precedence)
      const parsedPage = page ? parseInt(page as string) : NaN;
      const pageDerivedOffset = !isNaN(parsedPage) && parsedPage > 0 ? (parsedPage - 1) * safeLimit : 0;
      const parsedOffset = offset ? parseInt(offset as string) : pageDerivedOffset;
      const safeOffset = isNaN(parsedOffset) ? 0 : Math.max(0, parsedOffset);

      // Parse sorting and filter params
      const validSortBy = ['price', 'volume', 'change', 'marketCap', 'sentiment', 'undervalued', 'fantasyPoints', 'name', 'team'];
      const safeSortBy = sortBy && validSortBy.includes(sortBy as string)
        ? sortBy as 'price' | 'volume' | 'change' | 'marketCap' | 'sentiment' | 'undervalued' | 'fantasyPoints' | 'name' | 'team'
        : 'volume';
      const safeSortOrder = sortOrder === 'asc' ? 'asc' : 'desc';

      // Handle teams playing on date filter
      let teamsPlayingFilter: string[] | undefined = undefined;
      if (teamsPlayingOnDate && typeof teamsPlayingOnDate === 'string') {
        // Parse the date string (expected format: YYYY-MM-DD)
        const dateMatch = (teamsPlayingOnDate as string).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (dateMatch) {
          const [, year, month, day] = dateMatch;
          const etOffset = -5; // ET is UTC-5 (EST) or UTC-4 (EDT), using -5 for simplicity

          // Create date in ET timezone
          const startOfDayET = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0);
          const endOfDayET = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 23, 59, 59);

          // Convert ET boundaries to UTC for database query
          const startOfDayUTC = new Date(startOfDayET.getTime() - (etOffset * 60 * 60 * 1000));
          const endOfDayUTC = new Date(endOfDayET.getTime() - (etOffset * 60 * 60 * 1000));

          // Fetch games for that date
          const games = await storage.getDailyGames(startOfDayUTC, endOfDayUTC);

          // Extract unique team codes
          const teamsSet = new Set<string>();
          games.forEach(game => {
            teamsSet.add(game.homeTeam);
            teamsSet.add(game.awayTeam);
          });
          teamsPlayingFilter = Array.from(teamsSet);
        }
      }

      const { players: playersRaw, total } = await storage.getPlayersPaginated({
        search: search as string,
        team: team as string,
        position: position as string,
        sport: sport as string,
        limit: safeLimit,
        offset: safeOffset,
        sortBy: safeSortBy,
        sortOrder: safeSortOrder,
        teamsPlayingOnDate: teamsPlayingFilter,
        watchlistUserId: watchlistUserId,
        watchlistId: scopedWatchlistId,
      });

      // Enrich only the returned page to keep response latency bounded.
      const playerIds = playersRaw.map(p => p.id);
      const [seasonStatsMap, sentimentMap, avgFantasyPointsMap, globalScoutMap, poolDataMap] = await Promise.all([
        storage.getBatchPlayerSeasonStatsFromLogs(playerIds),
        storage.getBatchSentiment(playerIds),
        storage.getBatchAllTimeAvgFantasyPoints(playerIds),
        storage.getBatchActiveScoutCounts(playerIds),
        storage.getBatchPoolData(playerIds),
      ]);

      const players = playersRaw.map((player: any) => {
        const enriched = enrichPlayerWithMarketValue(player);
        const seasonStats = seasonStatsMap.get(player.id) || {
          gamesPlayed: 0,
          avgFantasyPointsPerGame: "0.0",
        };
        const sentimentData = sentimentMap.get(player.id) || {
          buyPressure: 50,
          totalVolume24h: 0,
        };
        const poolData = poolDataMap.get(player.id);
        const ammSpotPrice = poolData && poolData.shares > 0 ? (poolData.playMoney / poolData.shares) : null;

        const LEAGUE_AVG_PE = 0.43;
        const price = parseFloat((isAmmOnlyMode && ammSpotPrice !== null ? ammSpotPrice.toFixed(2) : player.lastTradePrice) || "0");
        const avgFP = avgFantasyPointsMap.get(player.id) || 0;
        const peRatio = avgFP > 0 ? price / avgFP : 0;
        const derivedValueIndex = LEAGUE_AVG_PE > 0 ? (peRatio / LEAGUE_AVG_PE) * 100 : 0;

        const metricBuyPressure = player._metricBuyPressure != null ? parseFloat(player._metricBuyPressure) : null;
        const metricValueIndex = player._metricValueIndex != null ? parseFloat(player._metricValueIndex) : null;
        const metricAvgFantasyPoints = player._metricAvgFantasyPoints != null ? parseFloat(player._metricAvgFantasyPoints) : null;

        return {
          ...enriched,
          ...(isAmmOnlyMode && ammSpotPrice !== null ? {
            lastTradePrice: ammSpotPrice.toFixed(2),
            currentPrice: ammSpotPrice.toFixed(2),
          } : {}),
          bestBid: null,
          bestAsk: null,
          bidSize: 0,
          askSize: 0,
          avgFantasyPointsPerGame: (metricAvgFantasyPoints ?? parseFloat(seasonStats.avgFantasyPointsPerGame || "0")).toFixed(1),
          buyPressure: metricBuyPressure ?? sentimentData.buyPressure,
          valueIndex: metricValueIndex ?? derivedValueIndex,
          globalScoutCount: globalScoutMap.get(player.id) || 0,
          poolLiquidity: poolData?.playMoney || 0,
          poolShares: poolData?.shares || 0,
          poolTotalTrades: poolData?.totalTrades || 0,
        };
      });

      res.json({ players, total });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Market activity feed
  app.get("/api/market/activity", async (req, res) => {
    try {
      const { playerId, userId, playerSearch, limit, sport } = req.query;

      const parsedLimit = limit ? parseInt(limit as string) : 50;
      const safeLimit = isNaN(parsedLimit) ? 50 : Math.max(1, Math.min(parsedLimit, 200));

      const activity = await storage.getMarketActivity({
        playerId: playerId as string,
        userId: userId as string,
        playerSearch: playerSearch as string,
        limit: safeLimit,
        sport: sport as string,
      });

      // Enrich with player metrics (priceChange24h)
      const uniquePlayerIds = Array.from(new Set(activity.map((a: any) => a.playerId)));
      const players = await storage.getPlayersByIds(uniquePlayerIds);
      const playerMap = new Map(players.map(p => [p.id, p]));

      const enrichedActivity = activity.map((item: any) => {
        const player = playerMap.get(item.playerId);
        return {
          ...item,
          priceChange24h: player?.priceChange24h || "0",
          currentPrice: player?.currentPrice || "0", // Ensure we have the latest reference price
        };
      });

      res.json(enrichedActivity);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Market activity level endpoint for Market Pulse
  app.get("/api/market/activity-level", async (req, res) => {
    try {
      // Calculate activity level based on trades in last 15 minutes
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      
      const recentTrades = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(trades)
        .where(gte(trades.executedAt, fifteenMinutesAgo));
      
      const tradeCount = recentTrades[0]?.count || 0;
      
      // Normalize to 0-100 scale (assume 100 trades = max activity)
      const activityLevel = Math.min((tradeCount / 100) * 100, 100);
      
      res.json({
        activityLevel,
        tradeCount,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // User collections endpoint
  app.get("/api/collections", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const collections = await db
        .select()
        .from(userCollections)
        .where(eq(userCollections.userId, userId))
        .orderBy(desc(userCollections.completed), desc(userCollections.updatedAt));
      res.json(collections);
    } catch (error: any) {
      // If migrations haven't been applied yet, keep the app usable.
      if (error?.code === "42P01") {
        return res.json([]);
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Get specific collection details
  app.get("/api/collections/:type/:targetId", isAuthenticated, async (req, res) => {
    try {
      const { type, targetId } = req.params;
      const userId = getUserId(req);
      
      const collection = await db
        .select()
        .from(userCollections)
        .where(
          and(
            eq(userCollections.userId, userId),
            eq(userCollections.collectionType, type),
            eq(userCollections.targetId, targetId)
          )
        )
        .limit(1);

      if (collection.length === 0) {
        return res.status(404).json({ error: "Collection not found" });
      }

      // Get owned players in this collection
      let ownedPlayers: any[] = [];
      
      if (type === "team") {
        // Get all active players from this team that user owns
        const teamPlayers = await db
          .select({
            playerId: players.id,
            firstName: players.firstName,
            lastName: players.lastName,
            position: players.position,
            team: players.team,
            quantity: holdings.quantity,
          })
          .from(players)
          .leftJoin(
            holdings,
            and(
              eq(holdings.assetId, players.id),
              eq(holdings.userId, userId),
              eq(holdings.assetType, "player")
            )
          )
          .where(
            and(
              eq(players.team, targetId),
              eq(players.isActive, true)
            )
          );
        
        ownedPlayers = teamPlayers.filter(p => (parseFloat(p.quantity || "0")) > 0);
      }

      res.json({
        collection: collection[0],
        ownedPlayers,
      });
    } catch (error: any) {
      if (error?.code === "42P01") {
        return res.status(404).json({ error: "Collection not found" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // User milestones endpoint
  app.get("/api/milestones", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const milestones = await db
        .select()
        .from(userMilestones)
        .where(eq(userMilestones.userId, userId))
        .orderBy(desc(userMilestones.achievedAt));
      res.json(milestones);
    } catch (error: any) {
      if (error?.code === "42P01") {
        return res.json([]);
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Mark milestone as celebrated
  app.post("/api/milestones/:id/celebrate", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = getUserId(req);
      
      const milestone = await db
        .select()
        .from(userMilestones)
        .where(
          and(
            eq(userMilestones.id, id),
            eq(userMilestones.userId, userId)
          )
        )
        .limit(1);

      if (milestone.length === 0) {
        return res.status(404).json({ error: "Milestone not found" });
      }

      await db
        .update(userMilestones)
        .set({ celebrated: true })
        .where(eq(userMilestones.id, id));

      res.json({ success: true });
    } catch (error: any) {
      if (error?.code === "42P01") {
        return res.status(503).json({ error: "Milestones unavailable - database migrations not applied" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // User trade history (for checklist/onboarding and portfolio)
  app.get("/api/trades/history", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const trades = await storage.getMarketActivity({ userId, limit: 100 });
      res.json(trades);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Watch List - Legacy endpoint (returns all player IDs across all watchlists)
  app.get("/api/watchlist", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const playerIds = await storage.getWatchList(userId);
      res.json(playerIds);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Multi-watchlist endpoints
  app.get("/api/watchlists", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const watchlists = await storage.getWatchlists(userId);
      res.json(watchlists);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/watchlists", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { name, color } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Watchlist name is required" });
      }
      const watchlist = await storage.createWatchlist(userId, name, false, color);
      res.json(watchlist);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/watchlists/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, color } = req.body;
      await storage.updateWatchlist(id, { name, color });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/watchlists/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteWatchlist(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get items in a specific watchlist
  app.get("/api/watchlists/:id/items", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const playerIds = await storage.getWatchlistItems(id);
      res.json(playerIds);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Add player to watchlist (with optional watchlistId, defaults to Favorites)
  app.post("/api/watchlist/:playerId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { playerId } = req.params;
      const { watchlistId } = req.body || {};
      await storage.addToWatchList(userId, playerId, watchlistId);

      // Get the watchlist name for response
      const watchlistDetails = watchlistId
        ? (await storage.getWatchlists(userId)).find(w => w.id === watchlistId)
        : (await storage.getWatchlists(userId)).find(w => w.isDefault);

      res.json({
        success: true,
        watchlistId: watchlistDetails?.id,
        watchlistName: watchlistDetails?.name || 'Favorites'
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove player from watchlist (with optional watchlistId)
  app.delete("/api/watchlist/:playerId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { playerId } = req.params;
      const watchlistId = req.query.watchlistId as string | undefined;
      await storage.removeFromWatchList(userId, playerId, watchlistId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get which watchlists contain a specific player
  app.get("/api/player/:playerId/watchlists", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { playerId } = req.params;
      const watchlistIds = await storage.getPlayerWatchlists(userId, playerId);
      res.json(watchlistIds);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Player detail page
  app.get("/api/player/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const playerRaw = await storage.getPlayer(req.params.id);

      if (!playerRaw) {
        return res.status(404).json({ error: "Player not found" });
      }

      // Enrich with market value
      const player = await enrichPlayerWithMarketValue(playerRaw);

      // AMM-only parity: player page price should match pool spot price
      if (isAmmOnlyMode) {
        const pool = await getOrCreatePool(player.id);
        player.lastTradePrice = pool.currentPrice.toFixed(2);
      }

      // Parse time range for chart data (1D, 1W, 1M, 1Y)
      const range = (req.query.range as string) || "1D";
      const rangeHours: Record<string, number> = {
        "1D": 24,
        "1W": 24 * 7,
        "1M": 24 * 30,
        "1Y": 24 * 365,
      };
      const hoursBack = rangeHours[range] || 24;
      const cutoffDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

      // Get trades within time range for chart (more trades for longer ranges)
      const tradesLimit = range === "1Y" ? 500 : range === "1M" ? 200 : range === "1W" ? 100 : 50;
      const recentTradesRaw = await storage.getRecentTrades(player.id, tradesLimit);

      // In AMM-only mode, only chart/list AMM-executed trades (pool is one side of the trade).
      const allTrades = isAmmOnlyMode
        ? recentTradesRaw.filter((t: any) => t.buyerId === "pool" || t.sellerId === "pool")
        : recentTradesRaw;

      // Filter trades within time range
      const tradesInRange = allTrades.filter(t => new Date(t.executedAt) >= cutoffDate);

      // Build priceHistory from actual trades (sorted oldest to newest for chart)
      const priceHistory = tradesInRange
        .map(trade => ({
          timestamp: trade.executedAt.toISOString(),
          price: parseFloat(trade.price),
        }))
        .reverse(); // Oldest first for proper chart display

      const orderBook = { bids: [], asks: [] };
      const recentTrades = allTrades.slice(0, 20); // Always show 20 most recent trades in the list
      const userHolding = await storage.getHolding(user.id, "player", player.id);

      // Calculate available balance (excluding locked cash for buy orders)
      const availableBalance = await storage.getAvailableBalance(user.id);

      res.json({
        player,
        priceHistory,
        orderBook: {
          bids: orderBook.bids.slice(0, 10).map((o: any) => ({
            price: o.limitPrice,
            quantity: o.quantity - o.filledQuantity,
          })),
          asks: orderBook.asks.slice(0, 10).map((o: any) => ({
            price: o.limitPrice,
            quantity: o.quantity - o.filledQuantity,
          })),
        },
        recentTrades: await Promise.all(
          recentTrades.map(async (trade) => ({
            ...trade,
            buyer: await storage.getUser(trade.buyerId),
            seller: await storage.getUser(trade.sellerId),
          }))
        ),
        userBalance: availableBalance.toFixed(2),
        userHolding,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Player season stats (PPG, RPG, APG, etc.)
  app.get("/api/player/:id/stats", async (req, res) => {
    try {
      const player = await storage.getPlayer(req.params.id);

      if (!player) {
        return res.status(404).json({ error: "Player not found" });
      }

      // Fetch season stats from cached game logs (no API call)
      const seasonStats = await storage.getPlayerSeasonStatsFromLogs(player.id);

      if (!seasonStats) {
        return res.json({
          player: { firstName: player.firstName, lastName: player.lastName, sport: player.sport },
          team: { abbreviation: player.team },
          stats: null
        });
      }

      if (seasonStats.sport === 'NFL') {
        res.json({
          player: { firstName: player.firstName, lastName: player.lastName, sport: player.sport },
          team: { abbreviation: player.team },
          stats: seasonStats
        });
      } else {
        res.json({
          player: { firstName: player.firstName, lastName: player.lastName, sport: player.sport },
          team: { abbreviation: player.team },
          stats: {
            // Pass sport through
            sport: seasonStats.sport,
            gamesPlayed: seasonStats.gamesPlayed,
            // Fantasy scoring
            avgFantasyPointsPerGame: seasonStats.avgFantasyPointsPerGame,
            // Scoring
            points: Math.round(parseFloat(seasonStats.pointsPerGame) * seasonStats.gamesPlayed),
            pointsPerGame: seasonStats.pointsPerGame,
            fieldGoalPct: seasonStats.fieldGoalPct,
            threePointPct: seasonStats.threePointPct,
            freeThrowPct: seasonStats.freeThrowPct,
            // Rebounding
            rebounds: Math.round(parseFloat(seasonStats.reboundsPerGame) * seasonStats.gamesPlayed),
            reboundsPerGame: seasonStats.reboundsPerGame,
            offensiveRebounds: 0, // Not tracked in simplified cache
            defensiveRebounds: 0, // Not tracked in simplified cache
            // Playmaking
            assists: Math.round(parseFloat(seasonStats.assistsPerGame) * seasonStats.gamesPlayed),
            assistsPerGame: seasonStats.assistsPerGame,
            turnovers: 0, // Not tracked in summary
            // Defense
            steals: seasonStats.steals,
            blocks: seasonStats.blocks,
            // Minutes
            minutes: Math.round(parseFloat(seasonStats.minutesPerGame) * seasonStats.gamesPlayed),
            minutesPerGame: seasonStats.minutesPerGame,
          },
        });
      }
    } catch (error: any) {
      console.error("[API] Error fetching player stats:", error.message);
      // Return graceful fallback instead of 500 error
      res.json({
        stats: null,
        error: "Stats temporarily unavailable"
      });
    }
  });

  // Player recent games (last 10 games)
  app.get("/api/player/:id/recent-games", async (req, res) => {
    try {
      const player = await storage.getPlayer(req.params.id);

      if (!player) {
        return res.status(404).json({ error: "Player not found" });
      }

      // Fetch last 10 games from cached game logs (no API call)
      const recentGames = await storage.getPlayerRecentGamesFromLogs(player.id, 10);

      res.json({ recentGames });
    } catch (error: any) {
      console.error("[API] Error fetching player game logs:", error.message);
      // Return graceful fallback instead of 500 error
      res.json({
        recentGames: [],
        error: "Game logs temporarily unavailable"
      });
    }
  });

  // Player contest earnings and performance
  app.get("/api/player/:id/contest-earnings", async (req, res) => {
    try {
      const player = await storage.getPlayer(req.params.id);

      if (!player) {
        return res.status(404).json({ error: "Player not found" });
      }

      // Query contest lineups for this player across all completed contests
      const playerContestLineups = await db
        .select({
          contestId: contests.id,
          entryId: contestLineups.entryId,
          sharesEntered: contestLineups.sharesEntered,
          fantasyPoints: contestLineups.fantasyPoints,
          earnedScore: contestLineups.earnedScore,
          contestName: contests.name,
          contestDate: contests.gameDate,
          contestStatus: contests.status,
          entryRank: contestEntries.rank,
          entryPayout: contestEntries.payout,
          totalEntries: contests.entryCount,
        })
        .from(contestLineups)
        .innerJoin(contestEntries, eq(contestLineups.entryId, contestEntries.id))
        .innerJoin(contests, eq(contestEntries.contestId, contests.id))
        .where(eq(contestLineups.playerId, player.id))
        .orderBy(desc(contests.gameDate));

      // Calculate aggregate stats
      const totalAppearances = playerContestLineups.length;
      const completedContests = playerContestLineups.filter((c: any) => c.contestStatus === 'completed');

      // Calculate total earnings (sum of payouts from entries where this player was used)
      // Note: This counts the full entry payout, which might include other players
      const totalEarnings = completedContests.reduce((sum: number, c: any) => {
        return sum + parseFloat(c.entryPayout || "0");
      }, 0);

      // Calculate average fantasy points from contest performances
      const avgFantasyPoints = completedContests.length > 0
        ? completedContests.reduce((sum: number, c: any) => sum + parseFloat(c.fantasyPoints || "0"), 0) / completedContests.length
        : 0;

      // Calculate win rate (entries that finished in the top 50%)
      const winningEntries = completedContests.filter((c: any) => {
        if (!c.entryRank || !c.totalEntries) return false;
        return c.entryRank <= Math.ceil(c.totalEntries / 2);
      });
      const winRate = completedContests.length > 0
        ? (winningEntries.length / completedContests.length) * 100
        : 0;

      res.json({
        player: {
          id: player.id,
          firstName: player.firstName,
          lastName: player.lastName,
        },
        contestPerformance: {
          totalAppearances,
          completedContests: completedContests.length,
          totalEarnings: totalEarnings.toFixed(2),
          avgFantasyPoints: avgFantasyPoints.toFixed(2),
          winRate: winRate.toFixed(1),
        },
        recentContests: playerContestLineups.slice(0, 10).map((c: any) => ({
          contestName: c.contestName,
          contestDate: c.contestDate,
          status: c.contestStatus,
          fantasyPoints: c.fantasyPoints,
          earnedScore: c.earnedScore,
          sharesEntered: c.sharesEntered,
          entryRank: c.entryRank,
          entryPayout: c.entryPayout,
        })),
      });
    } catch (error: any) {
      console.error("[API] Error fetching contest earnings:", error.message);
      res.json({
        contestPerformance: null,
        recentContests: [],
        error: "Contest data temporarily unavailable"
      });
    }
  });

  // Player shares info (total shares outstanding and market cap)
  app.get("/api/player/:id/shares-info", async (req, res) => {
    try {
      const player = await storage.getPlayer(req.params.id);

      if (!player) {
        return res.status(404).json({ error: "Player not found" });
      }

      // Calculate total shares outstanding across all users
      const totalSharesResult = await db
        .select({ total: sql<number>`COALESCE(SUM(${holdings.quantity}), 0)` })
        .from(holdings)
        .where(
          and(
            eq(holdings.assetType, "player"),
            eq(holdings.assetId, player.id)
          )
        );

      const totalShares = Number(totalSharesResult[0]?.total || 0);

      // Use ONLY last trade price - never fall back to placeholder currentPrice
      // If no trades have occurred, price and market cap are null
      const sharePrice = player.lastTradePrice ? parseFloat(player.lastTradePrice) : null;
      const marketCap = sharePrice !== null ? totalShares * sharePrice : null;

      // Get number of unique holders
      const holdersResult = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${holdings.userId})` })
        .from(holdings)
        .where(
          and(
            eq(holdings.assetType, "player"),
            eq(holdings.assetId, player.id),
            sql`${holdings.quantity} > 0`
          )
        );

      const totalHolders = Number(holdersResult[0]?.count || 0);

      res.json({
        player: {
          id: player.id,
          firstName: player.firstName,
          lastName: player.lastName,
          team: player.team,
        },
        sharesInfo: {
          totalSharesOutstanding: totalShares,
          currentSharePrice: sharePrice !== null ? sharePrice.toFixed(2) : null,
          marketCap: marketCap !== null ? marketCap.toFixed(2) : null,
          totalHolders,
          volume24h: player.volume24h,
          priceChange24h: player.priceChange24h,
        },
      });
    } catch (error: any) {
      console.error("[API] Error fetching shares info:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Get player financial metrics (Gamified Stats)
  app.get("/api/player/:id/financials", async (req, res) => {
    try {
      const metrics = await storage.getPlayerFinancialMetrics(req.params.id);
      res.json(metrics);
    } catch (error: any) {
      console.error("[API] Error fetching financial metrics:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Legacy player order-book endpoints (archived)
  app.get("/api/orders/:playerId/preview", optionalAuth, async (req, res) => {
    return res.status(410).json({
      error: "Legacy player order-book preview is archived. Use AMM quote endpoint.",
      ammQuoteEndpoint: `/api/amm/${req.params.playerId}/quote?type=buy|sell&amount=...`,
    });
  });

  app.post("/api/orders/:playerId", isAuthenticated, async (req, res) => {
    return res.status(410).json({
      error: "Legacy player order-book trading is archived. Use AMM buy/sell endpoints.",
      ammBuyEndpoint: `/api/amm/${req.params.playerId}/buy`,
      ammSellEndpoint: `/api/amm/${req.params.playerId}/sell`,
    });
  });

  app.post("/api/orders/:orderId/cancel", isAuthenticated, async (_req, res) => {
    return res.status(410).json({
      error: "Legacy player order-book cancel endpoint is archived in AMM-only mode.",
    });
  });

  // Portfolio
  app.get("/api/portfolio", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Optimized: Single JOIN query to get holdings + players + locks
      const holdingsWithData = await storage.getUserHoldingsWithPlayers(user.id);
      const openOrders = await storage.getUserOrders(user.id, "open");

      let totalValue = 0;
      let totalPnL = 0;
      let totalCost = 0;

      // Batch fetch all players for orders in one query
      const orderPlayerIds = openOrders.map(o => o.playerId);
      const orderPlayers = orderPlayerIds.length > 0
        ? await storage.getPlayersByIds(orderPlayerIds)
        : [];
      const orderPlayersMap = new Map(orderPlayers.map(p => [p.id, p]));

      const playerHoldingIds = holdingsWithData
        .filter((item: any) => item.holding.assetType === "player" && item.player)
        .map((item: any) => item.player.id.toString());
      const globalScoutMap = playerHoldingIds.length > 0
        ? await storage.getBatchActiveScoutCounts(playerHoldingIds)
        : new Map();

      // Group holdings by player to calculate total power
      const playerPowerMap = new Map<string, number>();
      holdingsWithData
        .filter((item: any) => item.holding.assetType === "player")
        .forEach((item: any) => {
          const playerId = item.holding.assetId;
          const currentPower = playerPowerMap.get(playerId) || 0;
          const holdingPower = parseFloat(item.holding.powerLevel || "0");
          playerPowerMap.set(playerId, currentPower + holdingPower);
        });

      const enrichedHoldings = holdingsWithData.map((item: any) => {
        const holding = item.holding;
        const player = item.player;
        const lockedQuantity = Number(item.totalLocked || 0);

        if (holding.assetType === "player" && player) {
          // Use real market price only - never fall back to placeholder currentPrice
          const { currentValue, pnl, pnlPercent } = calculatePnL(
            holding.quantity,
            holding.avgCostBasis,
            player.lastTradePrice
          );

          if (currentValue !== null) {
            totalValue += parseFloat(currentValue);
            totalPnL += parseFloat(pnl!);
            totalCost += parseFloat(holding.totalCostBasis);
          }

          const globalScoutCount = globalScoutMap.get(player.id.toString()) || 0;
          const totalPlayerPower = playerPowerMap.get(player.id) || 0;

          return {
            ...holding,
            player,
            currentValue,
            pnl,
            pnlPercent,
            lockedQuantity,
            availableQuantity: Math.max(0, holding.quantity - lockedQuantity),
            // Power fields
            power: holding.power ?? 1,
            powerLevel: holding.powerLevel ?? "0.00",
            totalPlayerPower: totalPlayerPower.toFixed(2),
            bestBid: null,
            bestAsk: null,
            bidSize: 0,
            askSize: 0,
            globalScoutCount,
          };
        }
        return holding;
      });

      const enrichedOrders = openOrders.map((order) => ({
        ...order,
        player: orderPlayersMap.get(order.playerId),
      }));

      const premiumShares = holdingsWithData.find((item: any) => item.holding.assetType === "premium")?.holding.quantity || 0;

      res.json({
        balance: user.balance,
        portfolioValue: totalValue.toFixed(2),
        totalPnL: totalPnL.toFixed(2),
        totalPnLPercent: totalCost > 0 ? ((totalPnL / totalCost) * 100).toFixed(2) : "0.00",
        holdings: enrichedHoldings,
        openOrders: enrichedOrders,
        premiumShares,
        isPremium: user.isPremium,
        premiumExpiresAt: user.premiumExpiresAt,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Activity feed - user transactions and activity timeline
  app.get("/api/activity", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { types, limit, offset } = req.query;

      // Parse types filter (comma-separated string to array)
      let typesArray: string[] | undefined;
      if (types && typeof types === 'string') {
        typesArray = types.split(',').filter(t => ['vesting', 'market', 'contest', 'scout'].includes(t));
      }

      const filters = {
        types: typesArray,
        limit: limit ? parseInt(limit as string) : 50,
        offset: offset ? parseInt(offset as string) : 0,
      };

      const activities = await storage.getUserActivity(userId, filters);

      res.json({
        activities,
        total: activities.length,
        limit: filters.limit,
        offset: filters.offset,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get vesting status with fresh accrual (for vesting modal)
  app.get("/api/vesting/status", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Trigger fresh accrual calculation
      await accrueVestingShares(userId);

      // Fetch updated vesting data
      const [vestingData, vestingSplits] = await Promise.all([
        storage.getVesting(userId),
        storage.getVestingSplits(userId),
      ]);

      // Get player data for splits
      const playerIds = new Set<string>();
      if (vestingData?.playerId) playerIds.add(vestingData.playerId);
      vestingSplits.forEach(s => playerIds.add(s.playerId));

      const players = await storage.getPlayersByIds(Array.from(playerIds));
      const playerMap = new Map(players.map(p => [p.id, p]));

      const isPremiumUser = user.premiumExpiresAt && user.premiumExpiresAt > new Date();

      res.json({
        vesting: vestingData ? {
          ...vestingData,
          player: vestingData.playerId ? playerMap.get(vestingData.playerId) : null,
          splits: vestingSplits.map(s => ({
            ...s,
            player: playerMap.get(s.playerId),
          })),
          sharesPerHour: isPremiumUser ? 200 : 100,
          capLimit: isPremiumUser ? 4800 : 2400,
        } : null,
      });
    } catch (error: any) {
      console.error("Error fetching vesting status:", error);
      res.status(500).json({ error: "Failed to fetch vesting status" });
    }
  });

  // Start/select vesting for player(s)
  app.post("/api/vesting/start", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const { playerIds } = req.body; // Array of player IDs (1-10)

      if (!playerIds || !Array.isArray(playerIds) || playerIds.length === 0) {
        return res.status(400).json({ error: "playerIds array required (1-10 players)" });
      }

      if (playerIds.length > 10) {
        return res.status(400).json({ error: "Maximum 10 players allowed" });
      }

      // PERFORMANCE OPTIMIZATION: Batch fetch all players in ONE query instead of N queries
      const playersArray = await storage.getPlayersByIds(playerIds);

      // Validate all players exist and are eligible
      if (playersArray.length !== playerIds.length) {
        const foundIds = new Set(playersArray.map(p => p.id));
        const missingId = playerIds.find(id => !foundIds.has(id));
        return res.status(404).json({ error: `Player ${missingId} not found` });
      }

      for (const player of playersArray) {
        if (!player.isEligibleForVesting) {
          return res.status(400).json({ error: `${player.firstName} ${player.lastName} is not eligible for vesting` });
        }
      }

      const players = playersArray;

      // AUTO-CLAIM: Check if user has unclaimed shares and claim them automatically
      await accrueVestingShares(user.id);
      const currentVesting = await storage.getVesting(user.id);
      let claimedData = null;

      if (currentVesting && currentVesting.sharesAccumulated > 0) {
        const totalAccumulated = currentVesting.sharesAccumulated;
        const splits = await storage.getVestingSplits(user.id);
        const usingSplits = splits.length > 0;

        if (usingSplits) {
          // Multi-player vesting: distribute shares proportionally
          const totalRate = 100;
          const claimedPlayers = [];
          let totalDistributed = 0;

          const distributions = splits.map(split => {
            const proportion = split.sharesPerHour / totalRate;
            const shares = Math.floor(proportion * totalAccumulated);
            return { ...split, shares };
          });

          // Distribute remainder deterministically
          const remainder = totalAccumulated - distributions.reduce((sum, d) => sum + d.shares, 0);
          const sortedByRate = [...distributions].sort((a, b) => b.sharesPerHour - a.sharesPerHour);
          for (let i = 0; i < remainder; i++) {
            sortedByRate[i].shares += 1;
          }

          // PERFORMANCE OPTIMIZATION: Batch fetch players and holdings in parallel
          const playerIdsForClaim = distributions.filter(d => d.shares > 0).map(d => d.playerId);
          const [claimPlayers, claimHoldings] = await Promise.all([
            storage.getPlayersByIds(playerIdsForClaim),
            storage.getBatchHoldings(user.id, "player", playerIdsForClaim),
          ]);

          // Create lookup maps for fast access
          const playersMap = new Map(claimPlayers.map(p => [p.id, p]));

          // Add shares to holdings for each player
          for (const dist of distributions) {
            if (dist.shares === 0) continue;

            const player = playersMap.get(dist.playerId);
            if (!player) continue;

            const holding = claimHoldings.get(dist.playerId);
            if (holding) {
              const newQuantity = parseFloat(holding.quantity) + dist.shares;
              const newTotalCost = parseFloat(holding.totalCostBasis);
              const newAvgCost = newTotalCost / newQuantity;
              await storage.updateHolding(user.id, "player", dist.playerId, newQuantity, newAvgCost.toFixed(4));
            } else {
              await storage.updateHolding(user.id, "player", dist.playerId, dist.shares, "0.0000");
            }

            await storage.createVestingClaim({
              userId: user.id,
              playerId: dist.playerId,
              sharesClaimed: dist.shares,
            });

            claimedPlayers.push({
              playerId: dist.playerId,
              playerName: `${player.firstName} ${player.lastName}`,
              sharesClaimed: dist.shares,
            });
            totalDistributed += dist.shares;
          }

          await storage.incrementTotalSharesVested(user.id, totalDistributed);
          claimedData = { players: claimedPlayers, totalSharesClaimed: totalDistributed };
        } else {
          // Legacy single-player vesting - use batched queries for consistency
          if (currentVesting.playerId) {
            const [players, holdings] = await Promise.all([
              storage.getPlayersByIds([currentVesting.playerId]),
              storage.getBatchHoldings(user.id, "player", [currentVesting.playerId]),
            ]);

            const player = players[0];
            if (player) {
              const holding = holdings.get(currentVesting.playerId);
              if (holding) {
                const newQuantity = parseFloat(holding.quantity) + currentVesting.sharesAccumulated;
                const newTotalCost = parseFloat(holding.totalCostBasis);
                const newAvgCost = newTotalCost / newQuantity;
                await storage.updateHolding(user.id, "player", currentVesting.playerId, newQuantity, newAvgCost.toFixed(4));
              } else {
                await storage.updateHolding(user.id, "player", currentVesting.playerId, currentVesting.sharesAccumulated, "0.0000");
              }

              await storage.incrementTotalSharesVested(user.id, currentVesting.sharesAccumulated);
              await storage.createVestingClaim({
                userId: user.id,
                playerId: currentVesting.playerId,
                sharesClaimed: currentVesting.sharesAccumulated,
              });

              claimedData = {
                sharesClaimed: currentVesting.sharesAccumulated,
                player,
              };
            }
          }
        }

        broadcast({ type: "portfolio", userId: user.id });
        broadcast({ type: "vesting", userId: user.id, claimed: totalAccumulated });
      }

      // Calculate shares per hour for each player (equal distribution)
      const totalRate = 100;
      const baseSharesPerHour = Math.floor(totalRate / playerIds.length);
      const remainder = totalRate % playerIds.length;

      // Create new splits
      const newSplits = playerIds.map((playerId, index) => ({
        userId: user.id,
        playerId,
        // Distribute remainder to first N players
        sharesPerHour: baseSharesPerHour + (index < remainder ? 1 : 0),
      }));

      // Update vesting state: clear playerId (using splits now), reset timestamps
      const now = new Date();
      await storage.setVestingSplits(user.id, newSplits);
      await storage.updateVesting(user.id, {
        playerId: null, // Clear single player ID since using splits
        sharesAccumulated: 0,
        residualMs: 0,
        lastAccruedAt: now,
        lastClaimedAt: null,
        capReachedAt: null,
        updatedAt: now,
      });

      broadcast({ type: "vesting", userId: user.id, playerIds });

      res.json({
        success: true,
        players,
        splits: newSplits,
        claimed: claimedData, // Include auto-claim data if shares were claimed
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vesting claim
  app.post("/api/vesting/claim", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Accrue any final shares before claiming
      await accrueVestingShares(user.id);

      const vestingData = await storage.getVesting(user.id);

      if (!vestingData || vestingData.sharesAccumulated === 0) {
        return res.status(400).json({ error: "No shares to claim" });
      }

      // Check if using multi-player vesting (splits)
      const splits = await storage.getVestingSplits(user.id);
      const usingSplits = splits.length > 0;

      if (!usingSplits) {
        // Legacy single-player vesting - use batched queries for consistency
        if (!vestingData.playerId) {
          return res.status(400).json({ error: "No player selected for vesting" });
        }

        const [players, holdings] = await Promise.all([
          storage.getPlayersByIds([vestingData.playerId]),
          storage.getBatchHoldings(user.id, "player", [vestingData.playerId]),
        ]);

        const player = players[0];
        if (!player) {
          return res.status(400).json({ error: "Player not found" });
        }

        // Add shares to holdings (cost basis $0)
        const holding = holdings.get(vestingData.playerId);
        if (holding) {
          const newQuantity = parseFloat(holding.quantity) + vestingData.sharesAccumulated;
          const newTotalCost = parseFloat(holding.totalCostBasis); // Vested shares have $0 cost
          const newAvgCost = newTotalCost / newQuantity;
          await storage.updateHolding(user.id, "player", vestingData.playerId, newQuantity, newAvgCost.toFixed(4));
        } else {
          await storage.updateHolding(user.id, "player", vestingData.playerId, vestingData.sharesAccumulated, "0.0000");
        }

        // Increment total shares vested counter
        await storage.incrementTotalSharesVested(user.id, vestingData.sharesAccumulated);

        // Record vesting claim for activity timeline
        await storage.createVestingClaim({
          userId: user.id,
          playerId: vestingData.playerId,
          sharesClaimed: vestingData.sharesAccumulated,
        });

        // Reset vesting
        const now = new Date();
        await storage.updateVesting(user.id, {
          sharesAccumulated: 0,
          lastClaimedAt: now,
          lastAccruedAt: now,
          updatedAt: now,
          residualMs: 0,
          capReachedAt: null,
        });

        broadcast({ type: "portfolio", userId: user.id });
        broadcast({ type: "vesting", userId: user.id, claimed: vestingData.sharesAccumulated });

        return res.json({
          success: true,
          sharesClaimed: vestingData.sharesAccumulated,
          player,
        });
      }

      // Multi-player vesting: distribute shares proportionally
      const totalAccumulated = vestingData.sharesAccumulated;
      const totalRate = 100;
      const claimedPlayers = [];
      let totalDistributed = 0;

      // Calculate shares for each player proportionally
      const distributions = splits.map(split => {
        const proportion = split.sharesPerHour / totalRate;
        const shares = Math.floor(proportion * totalAccumulated);
        return { ...split, shares };
      });

      // Distribute remainder deterministically (to players with highest sharesPerHour)
      const remainder = totalAccumulated - distributions.reduce((sum, d) => sum + d.shares, 0);
      const sortedByRate = [...distributions].sort((a, b) => b.sharesPerHour - a.sharesPerHour);
      for (let i = 0; i < remainder; i++) {
        sortedByRate[i].shares += 1;
      }

      // PERFORMANCE OPTIMIZATION: Batch fetch players and holdings in parallel
      const playerIdsForClaim = distributions.filter(d => d.shares > 0).map(d => d.playerId);
      const [claimPlayers, claimHoldings] = await Promise.all([
        storage.getPlayersByIds(playerIdsForClaim),
        storage.getBatchHoldings(user.id, "player", playerIdsForClaim),
      ]);

      // Create lookup maps for fast access
      const playersMap = new Map(claimPlayers.map(p => [p.id, p]));

      // Add shares to holdings for each player
      for (const dist of distributions) {
        if (dist.shares === 0) continue;

        const player = playersMap.get(dist.playerId);
        if (!player) continue;

        const holding = claimHoldings.get(dist.playerId);
        if (holding) {
          const newQuantity = parseFloat(holding.quantity) + dist.shares;
          const newTotalCost = parseFloat(holding.totalCostBasis); // Mined shares have $0 cost
          const newAvgCost = newTotalCost / newQuantity;
          await storage.updateHolding(user.id, "player", dist.playerId, newQuantity, newAvgCost.toFixed(4));
        } else {
          await storage.updateHolding(user.id, "player", dist.playerId, dist.shares, "0.0000");
        }

        // Record vesting claim for activity timeline
        await storage.createVestingClaim({
          userId: user.id,
          playerId: dist.playerId,
          sharesClaimed: dist.shares,
        });

        claimedPlayers.push({
          playerId: dist.playerId,
          playerName: `${player.firstName} ${player.lastName}`,
          sharesClaimed: dist.shares,
        });
        totalDistributed += dist.shares;
      }

      // Increment total shares vested counter
      await storage.incrementTotalSharesVested(user.id, totalDistributed);

      // Reset vesting (keep splits intact)
      const now = new Date();
      await storage.updateVesting(user.id, {
        sharesAccumulated: 0,
        lastClaimedAt: now,
        lastAccruedAt: now,
        updatedAt: now,
        residualMs: 0,
        capReachedAt: null,
      });

      broadcast({ type: "portfolio", userId: user.id });
      broadcast({ type: "vesting", userId: user.id, claimed: totalDistributed });

      res.json({
        success: true,
        totalSharesClaimed: totalDistributed,
        players: claimedPlayers,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // NEW: Pool-based vesting redeem endpoint
  // Users choose which players to assign their pooled shares to
  app.post("/api/vesting/redeem", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Accrue any final shares before redeeming
      await accrueVestingShares(user.id);

      const vestingData = await storage.getVesting(user.id);
      if (!vestingData || vestingData.sharesAccumulated === 0) {
        return res.status(400).json({ error: "No shares to redeem" });
      }

      // distributions: [{ playerId: string, shares: number }, ...]
      const { distributions } = req.body;

      if (!distributions || !Array.isArray(distributions) || distributions.length === 0) {
        return res.status(400).json({ error: "distributions array required" });
      }

      // Validate total shares don't exceed available
      const totalRequested = distributions.reduce((sum: number, d: any) => sum + (d.shares || 0), 0);
      if (totalRequested > vestingData.sharesAccumulated) {
        return res.status(400).json({
          error: `Cannot redeem ${totalRequested} shares. Only ${vestingData.sharesAccumulated} available.`
        });
      }

      if (totalRequested === 0) {
        return res.status(400).json({ error: "Must redeem at least 1 share" });
      }

      // Validate all players exist and get their data
      const playerIds = distributions.map((d: any) => d.playerId);
      const playersData = await storage.getPlayersByIds(playerIds);
      const playerMap = new Map(playersData.map(p => [p.id, p]));

      for (const dist of distributions) {
        if (!playerMap.has(dist.playerId)) {
          return res.status(400).json({ error: `Player ${dist.playerId} not found` });
        }
        if (!Number.isInteger(dist.shares) || dist.shares < 0) {
          return res.status(400).json({ error: "Shares must be non-negative integers" });
        }
      }

      // Get existing holdings for batch update
      const existingHoldings = await storage.getBatchHoldings(user.id, "player", playerIds);
      const redeemedPlayers = [];
      let totalRedeemed = 0;

      // Distribute shares to players
      for (const dist of distributions) {
        if (dist.shares === 0) continue;

        const player = playerMap.get(dist.playerId);
        const holding = existingHoldings.get(dist.playerId);

        if (holding) {
          const newQuantity = parseFloat(holding.quantity) + dist.shares;
          const newTotalCost = parseFloat(holding.totalCostBasis); // Vested shares have $0 cost
          const newAvgCost = newQuantity > 0 ? newTotalCost / newQuantity : 0;
          await storage.updateHolding(user.id, "player", dist.playerId, newQuantity, newAvgCost.toFixed(4));
        } else {
          await storage.updateHolding(user.id, "player", dist.playerId, dist.shares, "0.0000");
        }

        // Record claim for activity timeline
        await storage.createVestingClaim({
          userId: user.id,
          playerId: dist.playerId,
          sharesClaimed: dist.shares,
        });

        redeemedPlayers.push({
          playerId: dist.playerId,
          playerName: `${player!.firstName} ${player!.lastName}`,
          sharesRedeemed: dist.shares,
        });
        totalRedeemed += dist.shares;
      }

      // Increment total shares mined counter
      await storage.incrementTotalSharesVested(user.id, totalRedeemed);

      // Update vesting - subtract redeemed shares, keep remaining in pool
      // CRITICAL: Reset lastAccruedAt to prevent frontend from projecting phantom shares
      const now = new Date();
      const remainingShares = vestingData.sharesAccumulated - totalRedeemed;
      await storage.updateVesting(user.id, {
        sharesAccumulated: remainingShares,
        lastClaimedAt: now,
        updatedAt: now,
        // Reset accrual baseline so frontend projections start fresh
        lastAccruedAt: now,
        // Only reset residualMs on full redemption - preserve fractional progress for partial redemptions
        residualMs: remainingShares === 0 ? 0 : vestingData.residualMs,
        // Only clear cap if we have room now
        capReachedAt: remainingShares < (user.isPremium ? 4800 : 2400) ? null : vestingData.capReachedAt,
      });

      broadcast({ type: "portfolio", userId: user.id });
      broadcast({ type: "vesting", userId: user.id, redeemed: totalRedeemed, remaining: remainingShares });

      res.json({
        success: true,
        totalSharesRedeemed: totalRedeemed,
        remainingShares,
        players: redeemedPlayers,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vesting presets CRUD
  app.get("/api/vesting/presets", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const presets = await storage.getVestingPresets(userId);

      // Enrich with player data
      const allPlayerIds = Array.from(new Set(presets.flatMap(p => p.playerIds)));
      const players = await storage.getPlayersByIds(allPlayerIds);
      const playerMap = new Map(players.map(p => [p.id, p]));

      const enrichedPresets = presets.map(preset => ({
        ...preset,
        players: preset.playerIds.map(id => playerMap.get(id)).filter(Boolean),
      }));

      res.json({ presets: enrichedPresets });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/vesting/presets", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { name, playerIds } = req.body;

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({ error: "Preset name required" });
      }

      if (!playerIds || !Array.isArray(playerIds) || playerIds.length === 0) {
        return res.status(400).json({ error: "At least one player required" });
      }

      if (playerIds.length > 20) {
        return res.status(400).json({ error: "Maximum 20 players per preset" });
      }

      // Check preset limit
      const existingCount = await storage.countVestingPresets(userId);
      if (existingCount >= 20) {
        return res.status(400).json({ error: "Maximum 20 presets allowed" });
      }

      // Validate all players exist
      const players = await storage.getPlayersByIds(playerIds);
      if (players.length !== playerIds.length) {
        return res.status(400).json({ error: "One or more players not found" });
      }

      const preset = await storage.createVestingPreset({
        userId,
        name: name.trim(),
        playerIds,
      });

      res.json({
        preset: {
          ...preset,
          players,
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/vesting/presets/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const presetId = req.params.id;
      const { name, playerIds } = req.body;

      const existing = await storage.getVestingPreset(presetId);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Preset not found" });
      }

      const updates: any = {};
      if (name && typeof name === "string") {
        updates.name = name.trim();
      }
      if (playerIds && Array.isArray(playerIds)) {
        if (playerIds.length === 0) {
          return res.status(400).json({ error: "At least one player required" });
        }
        if (playerIds.length > 20) {
          return res.status(400).json({ error: "Maximum 20 players per preset" });
        }
        const players = await storage.getPlayersByIds(playerIds);
        if (players.length !== playerIds.length) {
          return res.status(400).json({ error: "One or more players not found" });
        }
        updates.playerIds = playerIds;
      }

      const updated = await storage.updateVestingPreset(presetId, updates);
      if (!updated) {
        return res.status(500).json({ error: "Failed to update preset" });
      }

      const players = await storage.getPlayersByIds(updated.playerIds);
      res.json({
        preset: {
          ...updated,
          players,
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/vesting/presets/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const presetId = req.params.id;

      const existing = await storage.getVestingPreset(presetId);
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: "Preset not found" });
      }

      const deleted = await storage.deleteVestingPreset(presetId);
      res.json({ success: deleted });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // =====================
  // Scout Engine API Routes
  // =====================

  // Get user's scout assignments and capacity
  app.get("/api/scouts", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Keep-Alive: Update activity timestamp to ensure user remains eligible for payouts
      await storage.updateLastActive(userId);

      const [assignments, totalScouts] = await Promise.all([
        storage.getUserScoutAssignments(userId),
        storage.getTotalScoutsForUser(userId),
      ]);

      const maxScouts = user.isPremium ? 10 : 5;

      // Enrich assignments with player data
      const playerIds = assignments.map(a => a.playerId);
      const [players, globalScoutCounts, seasonStatsMap] = playerIds.length > 0
        ? await Promise.all([
          storage.getPlayersByIds(playerIds),
          storage.getBatchActiveScoutCounts(playerIds),
          storage.getBatchPlayerSeasonStatsFromLogs(playerIds),
        ])
        : [[], new Map<string, number>(), new Map<string, any>()];

      const playerMap = new Map(players.map(p => [p.id, p]));

      const enrichedAssignments = assignments.map(a => {
        const player = playerMap.get(a.playerId);
        const seasonStats = seasonStatsMap.get(a.playerId) || { avgFantasyPointsPerGame: "0.0" };

        return {
          ...a,
          player: player ? {
            ...player,
            avgFantasyPointsPerGame: seasonStats.avgFantasyPointsPerGame,
          } : null,
          globalScoutCount: globalScoutCounts.get(a.playerId) || 0,
        };
      });

      res.json({
        assignments: enrichedAssignments,
        totalScouts,
        maxScouts,
        remaining: maxScouts - totalScouts,
        isPremium: user.isPremium,
      });
    } catch (error: any) {
      console.error("[Scout API] Error fetching scouts:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Assign scouts to a player
  app.post("/api/scouts/assign", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { playerId, count } = req.body;

      if (!playerId || typeof playerId !== "string") {
        return res.status(400).json({ error: "playerId is required" });
      }

      const parsedCount = parseInt(count, 10);
      if (isNaN(parsedCount) || parsedCount < 0) {
        return res.status(400).json({ error: "count must be a non-negative integer" });
      }

      // Verify player exists
      const player = await storage.getPlayer(playerId);
      if (!player) {
        return res.status(404).json({ error: "Player not found" });
      }

      // In AMM mode, scouting is allowed for any player at any time.
      // assignScouts throws if limit exceeded.
      await storage.assignScouts(userId, playerId, parsedCount);

      // Return updated scout data
      const [assignments, totalScouts] = await Promise.all([
        storage.getUserScoutAssignments(userId),
        storage.getTotalScoutsForUser(userId),
      ]);

      const user = await storage.getUser(userId);
      const maxScouts = user?.isPremium ? 10 : 5;

      console.log(`[Scout API] User ${userId} assigned ${parsedCount} scouts to player ${playerId}`);

      // Broadcast real-time update to all clients
      broadcast({
        type: "scout_update",
        data: {
          playerId,
          count: parsedCount,
          userId // Optional: helps client ignore self-echo if optimistically updated
        }
      });

      res.json({
        success: true,
        assignments,
        totalScouts,
        maxScouts,
        remaining: maxScouts - totalScouts,
      });
    } catch (error: any) {
      console.error("[Scout API] Error assigning scouts:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get scout roster for a specific player (Leaderboard)
  app.get("/api/scouts/roster/:playerId", isAuthenticated, async (req, res) => {
    try {
      const { playerId } = req.params;
      const roster = await storage.getScoutRoster(playerId);
      res.json(roster);
    } catch (error: any) {
      console.error("[Scout API] Error fetching roster:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // DEBUG: DB Connection Check
  app.get("/api/debug/db-check", async (req, res) => {
    try {
      const count = await db
        .select({ count: sql<number>`count(*)` })
        .from(scoutAssignments)
        .where(eq(scoutAssignments.playerId, 'nba_31030'));

      res.json({
        host: 'masked',
        database: 'masked',
        scoutAssignmentsCount: count[0].count
      });
    } catch (err: any) {
      console.error("Debug check failed:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // =====================
  // Watchlist Routes
  app.get("/api/contests/entries", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const entries = await storage.getUserContestEntries(userId);
      res.json(entries);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Contests (public - anyone can view, optionalAuth to check for user entries)
  app.get("/api/contests", optionalAuth, async (req: any, res) => {
    try {
      const { date, sport } = req.query;

      // Fetch ALL contests when date filter is provided, otherwise just open ones
      const allContests = date ? await storage.getContests() : await storage.getContests("open");

      // Filter contests based on date
      const now = new Date();
      let filteredContests = allContests;

      if (date && typeof date === 'string') {
        // Filter by gameDate (the actual day of the games, not when contest starts)
        // Filter contests where gameDate matches the selected date
        filteredContests = allContests.filter(contest => {
          const gameDate = new Date(contest.gameDate);
          const gameDateStr = gameDate.toISOString().split('T')[0];
          return gameDateStr === date;
        });
      }

      // Filter by sport if provided (case-insensitive check for "ALL")
      if (sport && typeof sport === 'string' && sport.toUpperCase() !== 'ALL') {
        filteredContests = filteredContests.filter(contest =>
          contest.sport.toUpperCase() === sport.toUpperCase()
        );
      }

      // If user is authenticated, include their entries
      let enrichedEntries: any[] = [];
      if (req.user?.claims?.sub) {
        try {
          const userId = (req.user as any).claims.sub;
          const user = await storage.getUser(userId);
          if (user) {
            const myEntries = await storage.getUserContestEntries(user.id);
            enrichedEntries = await Promise.all(
              myEntries.map(async (entry) => ({
                ...entry,
                contest: await storage.getContest(entry.contestId),
              }))
            );
          }
        } catch (error) {
          // Ignore auth errors, just don't include entries
          console.log("[contests] Could not fetch user entries:", error);
        }
      }

      res.json({
        contests: filteredContests,
        myEntries: enrichedEntries,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint to manually trigger contest creation (for testing)
  app.post("/api/admin/create-contests", isAuthenticated, async (req, res) => {
    try {
      console.log("[admin] Manually triggering contest creation...");
      const result = await createContests();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint to re-score a contest without redistributing payouts
  app.post("/api/admin/contests/:id/rescore", adminAuth, async (req, res) => {
    try {
      const contestId = req.params.id;
      console.log(`[admin] Manually re-scoring contest ${contestId}...`);

      const contest = await storage.getContest(contestId);
      if (!contest) {
        return res.status(404).json({ error: "Contest not found" });
      }

      // Only allow re-scoring of completed contests
      if (contest.status !== "completed") {
        return res.status(400).json({
          error: `Cannot re-score contest with status "${contest.status}". Only completed contests can be re-scored.`
        });
      }

      // Recalculate leaderboard (updates scores, ranks, and lineup fantasy points)
      // This does NOT redistribute payouts
      const leaderboard = await calculateContestLeaderboard(contestId);

      console.log(`[admin] Contest ${contestId} re-scored successfully. ${leaderboard.length} entries processed.`);

      res.json({
        success: true,
        contestId,
        contestName: contest.name,
        entriesProcessed: leaderboard.length,
        leaderboard: leaderboard.slice(0, 10), // Return top 10 for verification
      });
    } catch (error: any) {
      console.error("[admin] Error re-scoring contest:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Contest entry form
  app.get("/api/contest/:id/entry", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const contest = await storage.getContest(req.params.id);

      if (!contest) {
        return res.status(404).json({ error: "Contest not found" });
      }

      const userHoldings = await storage.getUserHoldings(user.id);
      const eligiblePlayers = (await Promise.all(
        userHoldings
          .filter(h => h.assetType === "player")
          .map(async (holding) => {
            const player = await storage.getPlayer(holding.assetId);
            // Skip players not matching contest sport
            if (!player || player.sport.toUpperCase() !== contest.sport.toUpperCase()) {
              return null;
            }
            const availableShares = await storage.getAvailableShares(user.id, "player", holding.assetId);
            return {
              ...holding,
              availableShares, // Available shares (unlocked)
              player,
              isEligible: true, // Simplified - would check game schedule
            };
          })
      )).filter(Boolean);

      res.json({
        contest: {
          id: contest.id,
          name: contest.name,
          sport: contest.sport,
          startsAt: contest.startsAt,
          gameDate: contest.gameDate,
        },
        eligiblePlayers,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Submit contest entry
  app.post("/api/contest/:id/enter", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const contest = await storage.getContest(req.params.id);

      if (!contest) {
        return res.status(404).json({ error: "Contest not found" });
      }

      // Check if contest is locked (started)
      if (new Date() >= new Date(contest.startsAt)) {
        return res.status(400).json({ error: "Contest has already started and is locked" });
      }

      const { lineup } = req.body;

      if (!lineup || lineup.length === 0) {
        return res.status(400).json({ error: "Lineup cannot be empty" });
      }

      // VALIDATE: Ensure all player IDs are in valid format
      // Accept both pure numeric IDs and sport-prefixed IDs (e.g., nba_12345)
      for (const item of lineup) {
        if (!/^(nba_|nfl_)?\d+$/.test(item.playerId)) {
          return res.status(400).json({
            error: `Invalid player ID format: ${item.playerId}. Expected numeric or sport-prefixed format (e.g., nba_12345).`
          });
        }
      }

      // VALIDATE: Check user has enough available shares BEFORE creating entry
      // Available shares = total - locked (in orders, other contests, vesting)
      const playerIds = lineup.map((item: any) => item.playerId);
      const players = await storage.getPlayersByIds(playerIds);
      const playerMap = new Map(players.map(p => [p.id, p]));

      // VALIDATE: All players must match contest sport
      for (const item of lineup) {
        const player = playerMap.get(item.playerId);
        if (!player) {
          return res.status(400).json({ error: `Player ${item.playerId} not found` });
        }
        if (player.sport.toUpperCase() !== contest.sport.toUpperCase()) {
          return res.status(400).json({
            error: `Player ${player.firstName} ${player.lastName} is a ${player.sport} player and cannot be entered in a ${contest.sport} contest`
          });
        }
      }


      for (const item of lineup) {
        const availableShares = await storage.getAvailableShares(user.id, "player", item.playerId);
        if (availableShares < item.sharesEntered) {
          const player = playerMap.get(item.playerId);
          const playerName = player ? `${player.firstName} ${player.lastName}` : item.playerId;
          return res.status(400).json({
            error: `Insufficient available shares for ${playerName}. Required: ${item.sharesEntered}, Available: ${availableShares}`
          });
        }
      }

      // Calculate total shares
      const totalShares = lineup.reduce((sum: number, item: any) => sum + item.sharesEntered, 0);

      // Create entry
      const entry = await storage.createContestEntry({
        contestId: req.params.id,
        userId: user.id,
        totalSharesEntered: totalShares,
      });

      // Create lineup items and burn shares from holdings
      for (const item of lineup) {
        await storage.createContestLineup({
          entryId: entry.id,
          playerId: item.playerId,
          sharesEntered: item.sharesEntered,
        });

        const holding = await storage.getHolding(user.id, "player", item.playerId);
        // Safe to burn now - already validated above
        if (holding) {
          await storage.updateHolding(
            user.id,
            "player",
            item.playerId,
            parseFloat(holding.quantity) - item.sharesEntered,
            holding.avgCostBasis
          );
        }
      }

      // Update contest metrics atomically
      await storage.updateContestMetrics(req.params.id, totalShares, contest.entryFee);

      // Broadcast contest update
      broadcast({ type: "contestUpdate", contestId: req.params.id });

      res.json({ success: true, entry });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get existing contest entry for editing
  app.get("/api/contest/:contestId/entry/:entryId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const { contestId, entryId } = req.params;

      const contest = await storage.getContest(contestId);
      if (!contest) {
        return res.status(404).json({ error: "Contest not found" });
      }

      // Check if contest is locked
      if (new Date() >= new Date(contest.startsAt)) {
        return res.status(400).json({ error: "Contest has started and is locked for editing" });
      }

      const result = await storage.getContestEntryWithLineup(entryId, user.id);
      if (!result) {
        return res.status(404).json({ error: "Entry not found or unauthorized" });
      }

      // Get player details for lineup
      const enrichedLineup = await Promise.all(
        result.lineup.map(async (item: any) => ({
          ...item,
          player: await storage.getPlayer(item.playerId),
        }))
      );

      // Get ALL eligible players: current holdings (including new acquisitions) + lineup players
      const userHoldings = await storage.getUserHoldings(user.id);
      const holdingsMap = new Map(
        userHoldings
          .filter(h => h.assetType === "player")
          .map(h => [h.assetId, h])
      );

      // Build eligible players from all holdings and lineup players
      const allPlayerIds = new Set([
        ...userHoldings.filter(h => h.assetType === "player").map(h => h.assetId),
        ...result.lineup.map((l: any) => l.playerId)
      ]);

      const eligiblePlayers = (await Promise.all(
        Array.from(allPlayerIds).map(async (playerId) => {
          const holding = holdingsMap.get(playerId);
          const lineupItem = result.lineup.find((l: any) => l.playerId === playerId);
          const player = await storage.getPlayer(playerId);

          // Skip players not matching contest sport
          if (!player || player.sport.toUpperCase() !== contest.sport.toUpperCase()) {
            return null;
          }

          // Total available = current holding + shares in lineup
          const currentQuantity = holding?.quantity || 0;
          const lineupShares = lineupItem?.sharesEntered || 0;
          const totalAvailable = currentQuantity + lineupShares;

          return {
            assetId: playerId,
            assetType: "player" as const,
            quantity: totalAvailable,
            userId: user.id,
            avgCostBasis: holding?.avgCostBasis || "0.0000",
            player,
            isEligible: true,
          };
        })
      )).filter(Boolean);

      res.json({
        contest: {
          id: contest.id,
          name: contest.name,
          sport: contest.sport,
          startsAt: contest.startsAt,
          gameDate: contest.gameDate,
        },
        entry: result.entry,
        lineup: enrichedLineup,
        eligiblePlayers,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update contest entry (edit lineup before lock)
  app.put("/api/contest/:contestId/entry/:entryId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const { contestId, entryId } = req.params;
      const { lineup } = req.body;

      const contest = await storage.getContest(contestId);
      if (!contest) {
        return res.status(404).json({ error: "Contest not found" });
      }

      // Check if contest is locked
      if (new Date() >= new Date(contest.startsAt)) {
        return res.status(400).json({ error: "Contest has started and is locked for editing" });
      }

      if (!lineup || lineup.length === 0) {
        return res.status(400).json({ error: "Lineup cannot be empty" });
      }

      // VALIDATE: Ensure all player IDs are in valid format
      // Accept both pure numeric IDs and sport-prefixed IDs (e.g., nba_12345)
      for (const item of lineup) {
        if (!/^(nba_|nfl_)?\d+$/.test(item.playerId)) {
          return res.status(400).json({
            error: `Invalid player ID format: ${item.playerId}. Expected numeric or sport-prefixed format (e.g., nba_12345).`
          });
        }
      }

      // Get existing entry
      const existing = await storage.getContestEntryWithLineup(entryId, user.id);
      if (!existing) {
        return res.status(404).json({ error: "Entry not found or unauthorized" });
      }

      // Get current user holdings for validation
      const userHoldings = await storage.getUserHoldings(user.id);
      const holdingsMap = new Map(
        userHoldings
          .filter(h => h.assetType === "player")
          .map(h => [h.assetId, h.quantity])
      );

      // Calculate share differences and validate
      const oldLineupMap = new Map<string, number>(existing.lineup.map((item: any) => [item.playerId, item.sharesEntered]));
      const newLineupMap = new Map<string, number>(lineup.map((item: any) => [item.playerId, item.sharesEntered]));

      // Fetch player data for error messages
      const allPlayerIds = Array.from(newLineupMap.keys());
      const playersForUpdate = await storage.getPlayersByIds(allPlayerIds);
      const playerMapForUpdate = new Map(playersForUpdate.map(p => [p.id, p]));

      // VALIDATE: All players must match contest sport
      for (const [playerId] of Array.from(newLineupMap.entries())) {
        const player = playerMapForUpdate.get(playerId);
        if (!player) {
          return res.status(400).json({ error: `Player ${playerId} not found` });
        }
        if (player.sport.toUpperCase() !== contest.sport.toUpperCase()) {
          return res.status(400).json({
            error: `Player ${player.firstName} ${player.lastName} is a ${player.sport} player and cannot be entered in a ${contest.sport} contest`
          });
        }
      }


      // Validate that user has sufficient shares for the new lineup
      for (const [playerId, newShares] of Array.from(newLineupMap.entries())) {
        const oldShares = oldLineupMap.get(playerId) || 0;
        const currentHolding = holdingsMap.get(playerId) || 0;
        const availableShares = Number(currentHolding) + Number(oldShares); // Current holdings + shares currently in lineup

        if (newShares > availableShares) {
          const player = playerMapForUpdate.get(playerId);
          const playerName = player ? `${player.firstName} ${player.lastName}` : playerId;
          return res.status(400).json({
            error: `Insufficient shares for ${playerName}. Available: ${availableShares}, Requested: ${newShares}`
          });
        }
      }

      // Return shares that were removed or reduced
      for (const [playerId, oldShares] of Array.from(oldLineupMap.entries())) {
        const newShares = newLineupMap.get(playerId) || 0;
        if (newShares < oldShares) {
          const sharesToReturn = Number(oldShares) - Number(newShares);
          const holding = await storage.getHolding(user.id, "player", playerId);
          if (holding) {
            await storage.updateHolding(
              user.id,
              "player",
              playerId,
              parseFloat(holding.quantity) + sharesToReturn,
              holding.avgCostBasis
            );
          } else {
            // Create new holding if user didn't have any
            await storage.updateHolding(user.id, "player", playerId, sharesToReturn, "0.0000");
          }
        }
      }

      // VALIDATE AND BURN: Check holdings AFTER returns, then burn additional shares
      for (const [playerId, newShares] of Array.from(newLineupMap.entries())) {
        const oldShares = oldLineupMap.get(playerId) || 0;
        if (newShares > oldShares) {
          const sharesToBurn = Number(newShares) - Number(oldShares);
          // Re-fetch holding after share returns to get current state
          const holding = await storage.getHolding(user.id, "player", playerId);

          // CRITICAL: Validate user has enough shares AFTER returns
          if (!holding || parseFloat(holding.quantity) < sharesToBurn) {
            return res.status(400).json({
              error: `Insufficient shares for player ${playerId}. Required: ${sharesToBurn}, Available: ${holding?.quantity || 0}`
            });
          }

          // Safe to burn now - validated above
          await storage.updateHolding(
            user.id,
            "player",
            playerId,
            parseFloat(holding.quantity) - sharesToBurn,
            holding.avgCostBasis
          );
        }
      }

      // Calculate new total shares
      const totalShares = lineup.reduce((sum: number, item: any) => sum + item.sharesEntered, 0);
      const oldTotalShares = existing.entry.totalSharesEntered;

      // Delete old lineup and create new one
      await storage.deleteContestLineup(entryId);
      for (const item of lineup) {
        await storage.createContestLineup({
          entryId,
          playerId: item.playerId,
          sharesEntered: item.sharesEntered,
        });
      }

      // Update entry total shares
      await storage.updateContestEntry(entryId, { totalSharesEntered: totalShares });

      // Update contest metrics with the share difference (not entry count)
      const shareDifference = totalShares - oldTotalShares;
      if (shareDifference !== 0) {
        // Fetch current contest to calculate new total shares
        const currentContest = await storage.getContest(contestId);
        if (currentContest) {
          const newTotalShares = currentContest.totalSharesEntered + shareDifference;
          await storage.updateContest(contestId, {
            totalSharesEntered: newTotalShares,
          });
        }
      }

      // Broadcast contest update
      broadcast({ type: "contestUpdate", contestId });

      // Fetch updated entry to return fresh data
      const updatedEntry = await storage.getContestEntryWithLineup(entryId, user.id);

      res.json({
        success: true,
        entry: updatedEntry?.entry,
        totalShares
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get detailed contest entry information (public - anyone can view)
  app.get("/api/contest/:contestId/entries/:entryId", async (req, res) => {
    try {
      const { contestId, entryId } = req.params;
      const entryDetails = await storage.getContestEntryDetail(contestId, entryId);

      if (!entryDetails) {
        return res.status(404).json({ error: "Entry not found" });
      }

      res.json(entryDetails);
    } catch (error: any) {
      console.error("[entry-detail] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Contest leaderboard with proportional scoring (public - anyone can view)
  app.get("/api/contest/:id/leaderboard", optionalAuth, async (req: any, res) => {
    try {
      const contest = await storage.getContest(req.params.id);

      if (!contest) {
        return res.status(404).json({ error: "Contest not found" });
      }

      // Calculate real-time leaderboard with proportional scoring
      const { calculateContestLeaderboard } = await import("./contest-scoring");
      const leaderboard = await calculateContestLeaderboard(req.params.id);

      // If user is authenticated, find their entry
      let myEntry = undefined;
      if (req.user?.claims?.sub) {
        try {
          const userId = (req.user as any).claims.sub;
          const user = await storage.getUser(userId);
          if (user) {
            myEntry = leaderboard.find(e => e.userId === user.id);
          }
        } catch (error) {
          // Ignore auth errors
          console.log("[leaderboard] Could not fetch user entry:", error);
        }
      }

      res.json({
        contest,
        leaderboard,
        myEntry,
      });
    } catch (error: any) {
      console.error("[leaderboard] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Global leaderboards (public) - cached for 60s
  app.get("/api/leaderboards", async (req, res) => {
    try {
      const category = req.query.category as string || "netWorth";
      const cacheKey = `leaderboard:${category}`;

      // Use cache for all leaderboard categories (60s TTL)
      const result = await getOrCompute(cacheKey, async () => {
        if (category === "sharesVested") {
          const allUsers = await storage.getUsers();
          return {
            category: "sharesVested",
            leaderboard: allUsers
              .sort((a: User, b: User) => b.totalSharesVested - a.totalSharesVested)
              .map((u: User, index: number) => ({
                rank: index + 1,
                userId: u.id,
                username: u.username,
                profileImageUrl: u.profileImageUrl,
                value: u.totalSharesVested,
              })),
          };
        }

        if (category === "marketOrders") {
          const allUsers = await storage.getUsers();
          return {
            category: "marketOrders",
            leaderboard: allUsers
              .sort((a: User, b: User) => b.totalMarketOrders - a.totalMarketOrders)
              .map((u: User, index: number) => ({
                rank: index + 1,
                userId: u.id,
                username: u.username,
                profileImageUrl: u.profileImageUrl,
                value: u.totalMarketOrders,
              })),
          };
        }

        if (category === "cashBalance" || category === "portfolioValue" || category === "netWorth") {
          const [usersWithPortfolio, allUsers] = await Promise.all([
            storage.getAllUsersForRanking(),
            storage.getUsers(),
          ]);
          const userMap = new Map(allUsers.map(u => [u.id, u]));

          let sortedUsers: any[];

          if (category === "cashBalance") {
            sortedUsers = usersWithPortfolio
              .sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance))
              .map((data, index) => {
                const user = userMap.get(data.userId);
                return {
                  rank: index + 1,
                  userId: data.userId,
                  username: user?.username || "Unknown",
                  profileImageUrl: user?.profileImageUrl || null,
                  value: parseFloat(data.balance).toFixed(2),
                };
              });
          } else if (category === "portfolioValue") {
            sortedUsers = usersWithPortfolio
              .sort((a, b) => b.portfolioValue - a.portfolioValue)
              .map((data, index) => {
                const user = userMap.get(data.userId);
                return {
                  rank: index + 1,
                  userId: data.userId,
                  username: user?.username || "Unknown",
                  profileImageUrl: user?.profileImageUrl || null,
                  value: data.portfolioValue.toFixed(2),
                };
              });
          } else {
            // netWorth
            sortedUsers = usersWithPortfolio
              .map(data => ({
                ...data,
                netWorth: parseFloat(data.balance) + data.portfolioValue,
              }))
              .sort((a, b) => b.netWorth - a.netWorth)
              .map((data, index) => {
                const user = userMap.get(data.userId);
                return {
                  rank: index + 1,
                  userId: data.userId,
                  username: user?.username || "Unknown",
                  profileImageUrl: user?.profileImageUrl || null,
                  value: data.netWorth.toFixed(2),
                };
              });
          }

          return { category, leaderboard: sortedUsers };
        }

        return null;
      }, 60_000);

      if (result === null) {
        return res.status(400).json({ error: "Invalid category" });
      }

      res.json(result);
    } catch (error: any) {
      console.error("[leaderboards] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Blog posts - public listing (published posts only)
  app.get("/api/blog", async (req, res) => {
    try {
      const { limit, offset } = req.query;
      const parsedLimit = limit ? parseInt(limit as string) : 20;
      const parsedOffset = offset ? parseInt(offset as string) : 0;

      const safeLimit = isNaN(parsedLimit) ? 20 : Math.max(1, Math.min(parsedLimit, 100));
      const safeOffset = isNaN(parsedOffset) ? 0 : Math.max(0, parsedOffset);

      const { posts, total } = await storage.getBlogPosts({
        limit: safeLimit,
        offset: safeOffset,
        publishedOnly: true,
      });

      res.json({ posts, total, limit: safeLimit, offset: safeOffset });
    } catch (error: any) {
      console.error("[blog] Error fetching posts:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Blog post detail - public (by slug)
  app.get("/api/blog/:slug", async (req, res) => {
    try {
      const post = await storage.getBlogPostBySlug(req.params.slug);

      if (!post) {
        return res.status(404).json({ error: "Blog post not found" });
      }

      // Only return published posts to public
      if (!post.publishedAt) {
        return res.status(404).json({ error: "Blog post not found" });
      }

      // Get author information
      const author = await storage.getUser(post.authorId);

      res.json({
        post,
        author: author ? {
          id: author.id,
          username: author.username,
          firstName: author.firstName,
          lastName: author.lastName,
          profileImageUrl: author.profileImageUrl,
        } : null,
      });
    } catch (error: any) {
      console.error("[blog] Error fetching post:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Sitemap.xml for Google Search Console
  app.get("/sitemap.xml", async (req, res) => {
    try {
      const baseUrl = req.protocol + '://' + req.get('host');

      // Get all published blog posts
      const { posts } = await storage.getBlogPosts({
        limit: 1000,
        offset: 0,
        publishedOnly: true
      });

      // Generate sitemap XML
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/blog</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${baseUrl}/about</loc>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${baseUrl}/how-it-works</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${baseUrl}/contact</loc>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
  <url>
    <loc>${baseUrl}/privacy</loc>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>${baseUrl}/terms</loc>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
${posts.map(post => `  <url>
    <loc>${baseUrl}/blog/${post.slug}</loc>
    <lastmod>${new Date(post.publishedAt || post.createdAt).toISOString()}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`).join('\n')}
</urlset>`;

      res.header('Content-Type', 'application/xml');
      res.send(sitemap);
    } catch (error: any) {
      console.error("[sitemap] Error generating sitemap:", error);
      res.status(500).send('Error generating sitemap');
    }
  });

  // Admin: List all blog posts (including drafts)
  app.get("/api/admin/blog", adminAuth, async (req, res) => {
    try {
      const { limit, offset } = req.query;
      const parsedLimit = limit ? parseInt(limit as string) : 50;
      const parsedOffset = offset ? parseInt(offset as string) : 0;

      const safeLimit = isNaN(parsedLimit) ? 50 : Math.max(1, Math.min(parsedLimit, 200));
      const safeOffset = isNaN(parsedOffset) ? 0 : Math.max(0, parsedOffset);

      const { posts, total } = await storage.getBlogPosts({
        limit: safeLimit,
        offset: safeOffset,
        publishedOnly: false, // Show drafts for admin
      });

      res.json({ posts, total, limit: safeLimit, offset: safeOffset });
    } catch (error: any) {
      console.error("[admin/blog] Error fetching posts:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Create blog post
  app.post("/api/admin/blog", adminAuth, async (req, res) => {
    try {
      const userId = getUserId(req);

      // Validate request body
      const { title, slug, excerpt, content, publishedAt } = req.body;

      if (!title?.trim() || !slug?.trim() || !excerpt?.trim() || !content?.trim()) {
        return res.status(400).json({ error: "title, slug, excerpt, and content are required and cannot be empty" });
      }

      // Validate slug format (alphanumeric and hyphens only)
      if (!/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ error: "slug must contain only lowercase letters, numbers, and hyphens" });
      }

      const post = await storage.createBlogPost({
        title: title.trim(),
        slug: slug.trim(),
        excerpt: excerpt.trim(),
        content: content.trim(),
        authorId: userId,
        publishedAt: publishedAt ? new Date(publishedAt) : null,
      });

      res.json({ post });
    } catch (error: any) {
      console.error("[admin/blog] Error creating post:", error);

      // Handle duplicate slug error
      if (error.message && error.message.includes('duplicate key') || error.code === '23505') {
        return res.status(409).json({ error: "A blog post with this slug already exists" });
      }

      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Update blog post
  app.patch("/api/admin/blog/:id", adminAuth, async (req, res) => {
    try {
      const { title, slug, excerpt, content, publishedAt } = req.body;

      const updates: any = {};

      // Validate and trim provided fields
      if (title !== undefined) {
        if (!title.trim()) {
          return res.status(400).json({ error: "title cannot be empty" });
        }
        updates.title = title.trim();
      }

      if (slug !== undefined) {
        if (!slug.trim()) {
          return res.status(400).json({ error: "slug cannot be empty" });
        }
        // Validate slug format
        if (!/^[a-z0-9-]+$/.test(slug)) {
          return res.status(400).json({ error: "slug must contain only lowercase letters, numbers, and hyphens" });
        }
        updates.slug = slug.trim();
      }

      if (excerpt !== undefined) {
        if (!excerpt.trim()) {
          return res.status(400).json({ error: "excerpt cannot be empty" });
        }
        updates.excerpt = excerpt.trim();
      }

      if (content !== undefined) {
        if (!content.trim()) {
          return res.status(400).json({ error: "content cannot be empty" });
        }
        updates.content = content.trim();
      }

      if (publishedAt !== undefined) {
        updates.publishedAt = publishedAt ? new Date(publishedAt) : null;
      }

      updates.updatedAt = new Date();

      const post = await storage.updateBlogPost(req.params.id, updates);

      if (!post) {
        return res.status(404).json({ error: "Blog post not found" });
      }

      res.json({ post });
    } catch (error: any) {
      console.error("[admin/blog] Error updating post:", error);

      // Handle duplicate slug error
      if (error.message && error.message.includes('duplicate key') || error.code === '23505') {
        return res.status(409).json({ error: "A blog post with this slug already exists" });
      }

      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Delete blog post
  app.delete("/api/admin/blog/:id", adminAuth, async (req, res) => {
    try {
      await storage.deleteBlogPost(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[admin/blog] Error deleting post:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Portfolio history with time range support
  app.get("/api/user/portfolio-history", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const timeRange = (req.query.timeRange as string) || "1M";

      // Calculate date range based on timeRange parameter
      const now = new Date();
      let startDate = new Date();

      switch (timeRange) {
        case "1D":
          startDate.setDate(now.getDate() - 1);
          break;
        case "7D":
          startDate.setDate(now.getDate() - 7);
          break;
        case "1M":
          startDate.setMonth(now.getMonth() - 1);
          break;
        case "1Y":
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        case "ALL":
          // Set to a very early date to get all snapshots
          startDate = new Date(2020, 0, 1);
          break;
        default:
          return res.status(400).json({ error: "Invalid timeRange. Use: 1D, 7D, 1M, 1Y, or ALL" });
      }

      // Query snapshots from the database
      const snapshots = await storage.getPortfolioSnapshotsInRange(userId, startDate, now);

      // Transform snapshots into chart-friendly format with ISO string dates
      const history = snapshots.map(snapshot => ({
        date: snapshot.snapshotDate.toISOString(),
        cashBalance: parseFloat(snapshot.cashBalance),
        portfolioValue: parseFloat(snapshot.portfolioValue),
        netWorth: parseFloat(snapshot.totalNetWorth),
        cashRank: snapshot.cashRank,
        portfolioRank: snapshot.portfolioRank,
      }));

      res.json({ history, timeRange });
    } catch (error: any) {
      console.error("[portfolio-history] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Public user profile (anyone can view)
  app.get("/api/user/:userId/profile", async (req, res) => {
    try {
      const requestedUserId = req.params.userId;

      // Dev mode bypass: create dev user if requesting the mock user and it doesn't exist
      const isDev = process.env.NODE_ENV === 'development';
      if (isDev && requestedUserId === 'dev-user-12345678') {
        const existingUser = await storage.getUser(requestedUserId);
        if (!existingUser) {
          await storage.upsertUser({
            id: requestedUserId,
            email: 'dev@example.com',
            firstName: 'Dev',
            lastName: 'User',
            username: 'dev_user',
          });
          console.log('[DEV_BYPASS] Auto-created dev user for profile fetch');
        }
      }

      const user = await storage.getUser(requestedUserId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Get user holdings with market values
      const userHoldings = await storage.getUserHoldings(user.id);

      // Batch fetch all players for holdings (avoids N+1 queries)
      const playerIds = userHoldings
        .filter(h => h.assetType === "player")
        .map(h => h.assetId);
      const playersMap = new Map<string, any>();
      if (playerIds.length > 0) {
        const playersList = await storage.getPlayersByIds(playerIds);
        for (const player of playersList) {
          playersMap.set(player.id, player);
        }
      }

      const enrichedHoldings = userHoldings.map((holding) => {
        if (holding.assetType === "player") {
          const player = playersMap.get(holding.assetId);
          if (player) {
            const marketValue = player.lastTradePrice
              ? (parseFloat(player.lastTradePrice) * parseFloat(holding.quantity)).toFixed(2)
              : null;
            return {
              ...holding,
              player,
              lastTradePrice: player.lastTradePrice,
              marketValue,
            };
          }
        }
        return holding;
      });

      // Calculate net worth (balance + total market value of holdings)
      const holdingsValue = enrichedHoldings.reduce((sum: number, h: any) => {
        return sum + (h.marketValue ? parseFloat(h.marketValue as string) : 0);
      }, 0);
      const netWorth = (parseFloat(user.balance) + holdingsValue).toFixed(2);

      // Get leaderboard rankings
      const allUsers = await storage.getUsers();

      // Calculate simple rankings (fields directly on user row)
      const sharesVestedRank = allUsers
        .sort((a, b) => b.totalSharesVested - a.totalSharesVested)
        .findIndex((u) => u.id === user.id) + 1;

      const marketOrdersRank = allUsers
        .sort((a, b) => b.totalMarketOrders - a.totalMarketOrders)
        .findIndex((u) => u.id === user.id) + 1;

      // Calculate net worth ranking (requires holdings + prices)
      // Optimized: Single SQL query handles the aggregation
      const usersWithNetWorthRaw = await storage.getAllUsersForRanking();
      const usersWithNetWorth = usersWithNetWorthRaw.map(u => ({
        userId: u.userId,
        netWorth: parseFloat(u.balance) + u.portfolioValue
      }));

      const netWorthRank = usersWithNetWorth
        .sort((a, b) => b.netWorth - a.netWorth)
        .findIndex((u) => u.userId === user.id) + 1;

      res.json({
        user: {
          id: user.id,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImageUrl: user.profileImageUrl,
          isAdmin: user.isAdmin || false,
          isPremium: user.isPremium,
          createdAt: user.createdAt,
        },
        stats: {
          netWorth,
          totalSharesVested: user.totalSharesVested,
          totalMarketOrders: user.totalMarketOrders,
          totalTradesExecuted: user.totalTradesExecuted,
          holdingsCount: enrichedHoldings.length,
        },
        rankings: {
          sharesVested: sharesVestedRank,
          marketOrders: marketOrdersRank,
          netWorth: netWorthRank,
        },
        holdings: enrichedHoldings.filter(h => h.assetType === "player" && parseFloat(h.quantity) > 0),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Premium redeem
  app.post("/api/premium/redeem", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const premiumHolding = await storage.getHolding(user.id, "premium", "premium");

      if (!premiumHolding || parseFloat(premiumHolding.quantity) < 1) {
        return res.status(400).json({ error: "No premium shares to redeem" });
      }

      // Burn 1 premium share
      await storage.updateHolding(user.id, "premium", "premium", parseFloat(premiumHolding.quantity) - 1, "0.0000");

      // Grant premium access for 30 days
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      // Update user premium status in database
      await storage.updateUserPremiumStatus(user.id, true, expiresAt);

      res.json({
        success: true,
        isPremium: true,
        premiumExpiresAt: expiresAt.toISOString(),
        remainingShares: parseFloat(premiumHolding.quantity) - 1
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Premium checkout - create a checkout session and redirect to Whop
  // Note: We use direct checkout URL since Whop API requires higher-tier permissions
  app.post("/api/premium/checkout-session", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const { quantity = 1 } = req.body;
      const planId = process.env.WHOP_PLAN_ID;

      if (!planId) {
        return res.status(500).json({ error: "Whop plan ID not configured" });
      }

      const PRICE_PER_SHARE_CENTS = 500; // $5.00 per premium share
      const amountCents = quantity * PRICE_PER_SHARE_CENTS;

      // Create a local checkout session record to track this purchase
      const localSession = await storage.createPremiumCheckoutSession({
        userId: user.id,
        planId,
        quantity,
        amountCents,
      });

      console.log(`[WHOP] Created checkout session ${localSession.id} for user ${userId}, qty: ${quantity}`);

      // Use direct checkout URL - Whop API requires permissions we don't have
      // Include metadata so webhook can identify the user and session
      const directUrl = `https://whop.com/checkout/${planId}/?d2c=true&metadata[sessionId]=${localSession.id}&metadata[userId]=${userId}&metadata[quantity]=${quantity}`;

      res.json({
        sessionId: localSession.id,
        purchaseUrl: directUrl,
        planId,
        quantity,
        amountCents,
        email: user.email,
      });
    } catch (error: any) {
      console.error("[WHOP] Error creating checkout session:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Community shares checkout - create a checkout session and redirect to Whop
  // Community shares are used to create community boosts (+1x multiplier for all holders)
  app.post("/api/community/checkout-session", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const { quantity = 1 } = req.body;
      const planId = process.env.WHOP_COMMUNITY_PLAN_ID;

      if (!planId) {
        return res.status(500).json({ error: "Whop community plan ID not configured" });
      }

      const PRICE_PER_SHARE_CENTS = 100; // $1.00 per community share
      const amountCents = quantity * PRICE_PER_SHARE_CENTS;

      // Create a local checkout session record to track this purchase
      const localSession = await storage.createCommunityCheckoutSession({
        userId: user.id,
        planId,
        quantity,
        amountCents,
      });

      console.log(`[COMMUNITY] Created checkout session ${localSession.id} for user ${userId}, qty: ${quantity}`);

      // Include metadata so webhook can identify the user and session
      const directUrl = `https://whop.com/checkout/${planId}/?d2c=true&metadata[sessionId]=${localSession.id}&metadata[userId]=${userId}&metadata[quantity]=${quantity}`;

      res.json({
        sessionId: localSession.id,
        purchaseUrl: directUrl,
        planId,
        quantity,
        amountCents,
        email: user.email,
      });
    } catch (error: any) {
      console.error("[COMMUNITY] Error creating checkout session:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Checkout success finalization - deterministic/idempotent reconciliation for authenticated user
  app.post("/api/checkout/finalize", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const receiptId = req.body?.receipt_id || req.body?.payment_id;

      if (!receiptId || typeof receiptId !== "string") {
        return res.status(400).json({ error: "receipt_id (or payment_id) is required" });
      }

      const payment = await storage.getWhopPaymentByPaymentId(receiptId);
      if (!payment) {
        return res.status(202).json({ success: false, state: "pending", reason: "payment_not_synced" });
      }

      if (payment.creditedAt) {
        if (payment.userId && payment.userId !== userId) {
          return res.status(409).json({ success: false, state: "error", reason: "credited_to_other_user" });
        }
        return res.json({ success: true, state: "credited", alreadyCredited: true, quantity: payment.quantity });
      }

      const raw: any = payment.rawPayload || {};
      const extracted = extractWhopPaymentFields(raw);
      const metadata = extracted.metadata || {};
      const classification = classifyWhopPurchase(extracted.planId, payment.amountCents || extracted.amountCents);
      if (!classification.assetType) {
        return res.status(202).json({ success: false, state: "unresolved", reason: classification.reason });
      }

      const matched = await findDeterministicSessionMatch(
        classification.assetType,
        metadata,
        receiptId,
        payment.email,
        extracted.planId,
      );
      if (!matched || matched.session.userId !== userId) {
        return res.status(202).json({ success: false, state: "unresolved", reason: "deterministic_mapping_missing" });
      }

      const quantity = matched.session.quantity || payment.quantity || Number(metadata.quantity) || 1;
      const avgCost = classification.assetType === "community" ? "1.0000" : "5.0000";
      const creditResult = await creditPaymentAndHoldingAtomic(receiptId, userId, classification.assetType, quantity, avgCost);

      if (!creditResult) {
        return res.json({ success: true, state: "credited", alreadyCredited: true, quantity });
      }

      if (matched.type === "community" && matched.session.status !== "completed") {
        await storage.completeCommunityCheckoutSession(matched.session.id, receiptId);
      }
      if (matched.type === "premium" && matched.session.status !== "completed") {
        await storage.completePremiumCheckoutSession(matched.session.id, receiptId);
      }

      broadcast({ type: "portfolio" });
      return res.json({ success: true, state: "credited", quantity, newBalance: creditResult.newQuantity });
    } catch (error: any) {
      console.error("[CHECKOUT FINALIZE] Error:", error);
      return res.status(500).json({ error: error.message });
    }
  });

  // Dev endpoint to grant premium shares for testing (only in development)
  app.post("/api/dev/grant-premium-shares", async (req, res) => {
    const isDev = process.env.NODE_ENV === 'development';
    if (!isDev) {
      return res.status(403).json({ error: "This endpoint is only available in development" });
    }

    try {
      const { userId, quantity = 1 } = req.body;

      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Grant premium shares
      const existingHolding = await storage.getHolding(userId, "premium", "premium");
      const currentQuantity = existingHolding?.quantity || 0;
      const newQuantity = currentQuantity + quantity;

      await storage.updateHolding(userId, "premium", "premium", newQuantity, "5.0000");

      console.log(`[DEV] Granted ${quantity} premium shares to user ${userId}. Total: ${newQuantity}`);

      res.json({
        success: true,
        userId,
        quantity,
        totalShares: newQuantity,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get premium status and shares
  app.get("/api/premium/status", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const premiumHolding = await storage.getHolding(user.id, "premium", "premium");
      const recentSessions = await storage.getUserPremiumCheckoutSessions(user.id);

      res.json({
        isPremium: user.isPremium,
        premiumExpiresAt: user.premiumExpiresAt,
        premiumShares: premiumHolding?.quantity || 0,
        recentPurchases: recentSessions.filter(s => s.status === "completed").slice(0, 5),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get premium trading data (order book, holdings, etc.)
  app.get("/api/premium/trade", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const premiumHolding = await storage.getHolding(user.id, "premium", "premium");

      // Get order book for premium shares
      const orderBook = await storage.getPremiumOrderBook();

      // Get recent premium trades
      const recentTrades = await storage.getRecentPremiumTrades(10);

      res.json({
        premiumShares: premiumHolding?.quantity || 0,
        userBalance: user.balance,
        orderBook,
        recentTrades,
        isPremium: user.isPremium,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get premium share market data with price history and circulation
  // CRITICAL: Only returns actual trade data - never fabricates prices
  app.get("/api/premium/market-data", async (req, res) => {
    try {
      const period = (req.query.period as string) || "1M";

      // Calculate time range based on period
      let startDate: Date;
      const now = new Date();
      switch (period) {
        case "1D":
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case "1W":
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "1M":
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case "3M":
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case "ALL":
        default:
          startDate = new Date("2020-01-01");
          break;
      }

      // Get premium trades within the time range
      const trades = await storage.getPremiumTradesInRange(startDate, now);

      // Get order book for current bid/ask (only show if orders exist)
      const orderBook = await storage.getPremiumOrderBook();
      const bestBid = orderBook.bids.length > 0
        ? orderBook.bids.sort((a, b) => parseFloat(b.price) - parseFloat(a.price))[0]
        : null;
      const bestAsk = orderBook.asks.length > 0
        ? orderBook.asks.sort((a, b) => parseFloat(a.price) - parseFloat(b.price))[0]
        : null;

      // Get total circulation (sum of all premium holdings) - ensure it's a number
      const circulationRaw = await storage.getTotalPremiumCirculation();
      const circulation = typeof circulationRaw === 'string' ? parseInt(circulationRaw, 10) : (circulationRaw || 0);

      // Get last trade price (market value is ONLY the most recent trade)
      const lastTrade = trades.length > 0 ? trades[0] : null;
      const lastTradePrice = lastTrade ? parseFloat(lastTrade.price) : null;

      // Build price history from actual trades only
      const priceHistory = trades.map(trade => ({
        timestamp: trade.executedAt,
        price: parseFloat(trade.price),
        volume: trade.quantity,
      })).reverse(); // Oldest first for charting

      res.json({
        // Only show prices that are based on actual data - all numbers, no strings
        lastTradePrice, // null if no trades, number otherwise
        bestBid: bestBid ? { price: parseFloat(bestBid.price), quantity: bestBid.quantity } : null,
        bestAsk: bestAsk ? { price: parseFloat(bestAsk.price), quantity: bestAsk.quantity } : null,
        circulation,
        priceHistory,
        totalTrades: trades.length,
        period,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Place premium share order
  app.post("/api/premium/orders", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const { side, quantity, orderType, limitPrice } = req.body;

      if (!side || !quantity || !orderType) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      if (quantity <= 0) {
        return res.status(400).json({ error: "Quantity must be positive" });
      }

      const price = orderType === "limit" ? parseFloat(limitPrice) : 5.00;
      const orderValue = quantity * price;

      if (side === "buy") {
        // Check balance
        if (parseFloat(user.balance) < orderValue) {
          return res.status(400).json({ error: "Insufficient balance" });
        }

        // Lock funds
        await storage.updateUserBalance(user.id, (parseFloat(user.balance) - orderValue).toFixed(2));

        // Create buy order
        const order = await storage.createPremiumOrder({
          userId: user.id,
          side: "buy",
          quantity,
          price: price.toFixed(4),
          orderType,
          status: "open",
        });

        // Try to match with existing sell orders
        await matchPremiumOrders();

        res.json({ success: true, order });
      } else if (side === "sell") {
        // Check holdings
        const premiumHolding = await storage.getHolding(user.id, "premium", "premium");
        if (!premiumHolding || premiumHolding.quantity < quantity) {
          return res.status(400).json({ error: "Insufficient shares" });
        }

        // Lock shares
        await storage.updateHolding(user.id, "premium", "premium", parseFloat(premiumHolding.quantity) - quantity, "5.0000");

        // Create sell order
        const order = await storage.createPremiumOrder({
          userId: user.id,
          side: "sell",
          quantity,
          price: price.toFixed(4),
          orderType,
          status: "open",
        });

        // Try to match with existing buy orders
        await matchPremiumOrders();

        res.json({ success: true, order });
      } else {
        return res.status(400).json({ error: "Invalid order side" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Helper function to match premium orders
  async function matchPremiumOrders() {
    const orderBook = await storage.getPremiumOrderBook();

    for (const bid of orderBook.bids) {
      for (const ask of orderBook.asks) {
        // Match if bid price >= ask price
        if (parseFloat(bid.price) >= parseFloat(ask.price)) {
          const matchQuantity = Math.min(bid.quantity, ask.quantity);
          const matchPrice = ask.price; // Use ask price for execution
          const matchValue = matchQuantity * parseFloat(matchPrice);

          // Execute trade - transfer shares to buyer
          const buyerHolding = await storage.getHolding(bid.userId, "premium", "premium");
          const buyerQuantity = parseFloat(buyerHolding?.quantity || "0");
          await storage.updateHolding(bid.userId, "premium", "premium", buyerQuantity + matchQuantity, "5.0000");

          // Give seller the cash
          const seller = await storage.getUser(ask.userId);
          if (seller) {
            await storage.updateUserBalance(seller.id, (parseFloat(seller.balance) + matchValue).toFixed(2));
          }

          // Update or remove orders
          await storage.updatePremiumOrderQuantity(bid.orderId, bid.quantity - matchQuantity);
          await storage.updatePremiumOrderQuantity(ask.orderId, ask.quantity - matchQuantity);

          // Record trade with order IDs for full audit trail
          await storage.createPremiumTrade({
            buyerId: bid.userId,
            sellerId: ask.userId,
            buyOrderId: bid.orderId,
            sellOrderId: ask.orderId,
            quantity: matchQuantity,
            price: matchPrice,
          });

          console.log(`[PREMIUM] Matched ${matchQuantity} shares at $${matchPrice}`);
        }
      }
    }
  }

  // Whop webhook handler - receives payment.succeeded events
  // Uses official @whop/sdk for signature verification
  // NOTE: We use req.rawBody captured by express.json verify callback in index.ts
  // This ensures we get the original raw body before JSON parsing
  app.post("/api/webhooks/whop", async (req, res) => {
    try {
      const webhookSecret = process.env.WHOP_WEBHOOK_SECRET;

      // Use rawBody captured by express.json verify callback (see index.ts)
      // This is the actual raw body string needed for signature verification
      const rawBodyBuffer = (req as any).rawBody;
      const rawBody = Buffer.isBuffer(rawBodyBuffer) ? rawBodyBuffer.toString('utf8') : String(rawBodyBuffer || '');

      // Log that we received a request (helps diagnose if webhook is reaching us)
      console.log("[WHOP WEBHOOK] ========== INCOMING REQUEST ==========");
      console.log("[WHOP WEBHOOK] Timestamp:", new Date().toISOString());
      console.log("[WHOP WEBHOOK] Method:", req.method);
      console.log("[WHOP WEBHOOK] Content-Type:", req.headers['content-type']);
      console.log("[WHOP WEBHOOK] Body length:", rawBody.length);
      console.log("[WHOP WEBHOOK] Has webhook-id header:", !!req.headers['webhook-id']);
      console.log("[WHOP WEBHOOK] Has webhook-timestamp header:", !!req.headers['webhook-timestamp']);
      console.log("[WHOP WEBHOOK] Has webhook-signature header:", !!req.headers['webhook-signature']);
      console.log("[WHOP WEBHOOK] Raw body preview:", rawBody.length > 200 ? rawBody.substring(0, 200) + "..." : rawBody);

      if (!webhookSecret) {
        console.error("[WHOP WEBHOOK] WHOP_WEBHOOK_SECRET not configured");
        return res.status(500).json({ error: "Webhook secret not configured" });
      }

      // Enhanced debugging - log all relevant info
      const webhookId = req.headers['webhook-id'] as string;
      const webhookTimestamp = req.headers['webhook-timestamp'] as string;
      const webhookSignature = req.headers['webhook-signature'] as string;

      console.log("[WHOP WEBHOOK] === VERIFICATION DEBUG ===");
      console.log("[WHOP WEBHOOK] webhook-id:", webhookId);
      console.log("[WHOP WEBHOOK] webhook-timestamp:", webhookTimestamp);
      console.log("[WHOP WEBHOOK] webhook-signature:", webhookSignature);
      console.log("[WHOP WEBHOOK] secret first 10 chars:", webhookSecret.substring(0, 10) + "...");
      console.log("[WHOP WEBHOOK] secret length:", webhookSecret.length);
      console.log("[WHOP WEBHOOK] body first 100 chars:", rawBody.substring(0, 100));

      // Convert Express headers to plain object for SDK (filter out undefined values)
      const headersObj: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) {
          headersObj[key] = Array.isArray(value) ? value[0] : value;
        }
      }

      let payload: any;
      let verificationSucceeded = false;

      // Standard Webhooks spec requires the secret to be base64 encoded with "whsec_" prefix removed
      // But Whop uses "ws_" prefix - let's try multiple formats
      const keyFormats = [
        { name: "base64-of-raw", key: Buffer.from(webhookSecret).toString('base64') },
        { name: "raw-secret", key: webhookSecret },
        { name: "base64-without-prefix", key: Buffer.from(webhookSecret.replace(/^ws_/, '')).toString('base64') },
        { name: "raw-without-prefix", key: webhookSecret.replace(/^ws_/, '') },
      ];

      // Try using standardwebhooks library directly first for better error messages
      try {
        const { Webhook } = await import("standardwebhooks");

        for (const format of keyFormats) {
          try {
            const wh = new Webhook(format.key);
            // standardwebhooks expects specific header format
            const headers = {
              "webhook-id": webhookId,
              "webhook-timestamp": webhookTimestamp,
              "webhook-signature": webhookSignature,
            };
            wh.verify(rawBody, headers);
            payload = JSON.parse(rawBody);
            console.log(`[WHOP WEBHOOK] standardwebhooks verification SUCCESS with ${format.name}!`);
            verificationSucceeded = true;
            break;
          } catch (err: any) {
            console.log(`[WHOP WEBHOOK] standardwebhooks ${format.name} failed:`, err.message);
          }
        }
      } catch (importErr: any) {
        console.log("[WHOP WEBHOOK] Could not import standardwebhooks:", importErr.message);
      }

      // If standardwebhooks didn't work, try Whop SDK
      if (!verificationSucceeded) {
        const { Whop } = await import("@whop/sdk");

        for (const format of keyFormats) {
          try {
            const whopsdk = new Whop({
              apiKey: process.env.WHOP_API_KEY,
              webhookKey: format.key,
            });

            payload = whopsdk.webhooks.unwrap(rawBody, { headers: headersObj });
            console.log(`[WHOP WEBHOOK] SDK verification SUCCESS with ${format.name}! Event type:`, payload.type);
            verificationSucceeded = true;
            break;
          } catch (err: any) {
            console.log(`[WHOP WEBHOOK] SDK ${format.name} failed:`, err.message);
          }
        }
      }

      if (!verificationSucceeded) {
        console.error("[WHOP WEBHOOK] === ALL VERIFICATION ATTEMPTS FAILED ===");
        console.error("[WHOP WEBHOOK] This is likely a secret mismatch issue.");
        console.error("[WHOP WEBHOOK] Please verify WHOP_WEBHOOK_SECRET matches the secret in Whop dashboard.");

        // Return 401 immediately - do not process unverified payloads
        return res.status(401).json({ error: "Webhook signature verification failed" });
      }

      // Log the full payload structure for debugging
      console.log("[WHOP WEBHOOK] === PAYLOAD DEBUG ===");
      console.log("[WHOP WEBHOOK] Full payload keys:", Object.keys(payload));
      console.log("[WHOP WEBHOOK] payload.action:", payload.action);
      console.log("[WHOP WEBHOOK] payload.type:", payload.type);
      if (payload.data) {
        console.log("[WHOP WEBHOOK] payload.data keys:", Object.keys(payload.data));
        console.log("[WHOP WEBHOOK] payload.data.id:", payload.data.id);
        console.log("[WHOP WEBHOOK] payload.data.checkout_id:", payload.data.checkout_id);
        console.log("[WHOP WEBHOOK] payload.data.plan_id:", payload.data.plan_id);
        console.log("[WHOP WEBHOOK] payload.data.user_id:", payload.data.user_id);
        console.log("[WHOP WEBHOOK] payload.data.final_amount:", payload.data.final_amount);
        console.log("[WHOP WEBHOOK] payload.data.metadata:", JSON.stringify(payload.data.metadata));
      }

      // Whop uses "action" field, not "type" - check both for compatibility
      const eventAction = payload.action || payload.type;
      console.log("[WHOP WEBHOOK] Event action:", eventAction);

      // Handle payment.succeeded event
      if (eventAction === "payment.succeeded") {
        const payment = payload.data;
        const receiptId = payment.id;

        console.log("[WHOP WEBHOOK] Processing payment.succeeded for:", receiptId);

        // Check if payment already exists in whop_payments table
        const existingPayment = await storage.getWhopPaymentByPaymentId(receiptId);
        if (existingPayment?.creditedAt) {
          console.log("[WHOP WEBHOOK] Payment already credited:", receiptId);
          return res.json({ success: true, message: "Already credited" });
        }

        const extracted = extractWhopPaymentFields(payment);
        const metadata = extracted.metadata || {};
        const planId = extracted.planId;
        const amountCents = extracted.amountCents;

        const classification = classifyWhopPurchase(planId, amountCents);
        if (!classification.assetType) {
          console.error("[WHOP WEBHOOK] Unclassified purchase type; marked unresolved", {
            receiptId,
            planId,
            amountCents,
            reason: classification.reason,
          });

          await storage.upsertWhopPayment({
            paymentId: receiptId,
            email: (extracted.email || "unknown@webhook.local").toLowerCase(),
            userId: null,
            quantity: Number(metadata.quantity) || 1,
            amountCents: amountCents || 0,
            currency: payment.currency || "usd",
            whopStatus: "paid",
            rawPayload: payment,
          });

          return res.status(200).json({ success: false, state: "unresolved", reason: classification.reason });
        }

        const assetType = classification.assetType;
        const matched = await findDeterministicSessionMatch(
          assetType,
          metadata,
          receiptId,
          extracted.email,
          planId,
        );
        if (!matched) {
          console.error("[WHOP WEBHOOK] Deterministic mapping failed; marking unresolved", { receiptId, assetType });
          await storage.upsertWhopPayment({
            paymentId: receiptId,
            email: (extracted.email || "unknown@webhook.local").toLowerCase(),
            userId: null,
            quantity: Number(metadata.quantity) || 1,
            amountCents: amountCents || 0,
            currency: payment.currency || "usd",
            whopStatus: "paid",
            rawPayload: payment,
          });
          return res.status(200).json({ success: false, state: "unresolved", reason: "deterministic_mapping_missing" });
        }

        const userId = matched.session.userId;
        const quantity = matched.session.quantity || Number(metadata.quantity) || 1;

        const user = await storage.getUser(userId);
        const userEmail = user?.email || payment.user?.email || "unknown@webhook.local";

        await storage.upsertWhopPayment({
          paymentId: receiptId,
          email: userEmail,
          userId: null,
          quantity,
          amountCents: amountCents || (quantity * (assetType === "community" ? 100 : 500)),
          currency: payment.currency || "usd",
          whopStatus: "paid",
          rawPayload: payment,
        });

        const avgCost = assetType === "community" ? "1.0000" : "5.0000";
        const creditResult = await creditPaymentAndHoldingAtomic(receiptId, userId, assetType, quantity, avgCost);

        if (!creditResult) {
          console.log("[WHOP WEBHOOK] Payment already credited by another process, skipping:", receiptId);
          return res.json({ success: true, message: "Already credited" });
        }

        if (matched.type === "community" && matched.session.status !== "completed") {
          await storage.completeCommunityCheckoutSession(matched.session.id, receiptId);
        }
        if (matched.type === "premium" && matched.session.status !== "completed") {
          await storage.completePremiumCheckoutSession(matched.session.id, receiptId);
        }

        const newQuantity = creditResult.newQuantity;
        console.log(`[WHOP WEBHOOK] Credited ${quantity} ${assetType} shares to user ${userId} (${creditResult.previousQuantity} -> ${newQuantity})`);

        // Broadcast portfolio update via WebSocket
        broadcast({ type: "portfolio" });

        return res.json({ success: true, quantity, userId, newBalance: newQuantity });
      }

      // Other event types - just acknowledge
      console.log("[WHOP WEBHOOK] Unhandled event type:", eventAction);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[WHOP WEBHOOK] Error processing webhook:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin middleware - validates ADMIN_API_TOKEN (for external cron) OR isAdmin flag (for logged-in users)
  async function adminAuth(req: any, res: any, next: any) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const expectedToken = process.env.ADMIN_API_TOKEN;

    // Check 1: Token-based auth (for external cron jobs - using ADMIN_API_TOKEN)
    if (token && expectedToken && token === expectedToken) {
      return next();
    }

    // Check 2: Dev mode bypass - allow all admin requests in development
    const isDev = process.env.NODE_ENV === 'development';
    const bypassAuth = process.env.DEV_BYPASS_AUTH !== 'false';

    if (isDev && bypassAuth) {
      console.log(`[ADMIN] Dev bypass: ${req.method} ${req.path}`);
      return next();
    }

    // Check 3: Verify Supabase JWT token and check isAdmin flag
    if (token) {
      try {
        // Import supabase admin client to verify JWT tokens
        const { createClient } = await import('@supabase/supabase-js');
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (supabaseUrl && supabaseServiceRoleKey) {
          const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false }
          });

          const { data: { user: supabaseUser }, error } = await supabaseAdmin.auth.getUser(token);

          if (!error && supabaseUser) {
            // Token is valid, check if user is admin
            const user = await storage.getUser(supabaseUser.id);
            if (user?.isAdmin) {
              // Set req.user for downstream use
              req.user = {
                claims: {
                  sub: supabaseUser.id,
                  email: supabaseUser.email,
                }
              };
              console.log(`[ADMIN] Admin access granted for user ${supabaseUser.email} (${supabaseUser.id})`);
              return next();
            } else {
              console.warn(`[ADMIN] User ${supabaseUser.email} is not an admin (isAdmin: ${user?.isAdmin})`);
            }
          } else if (error) {
            console.log(`[ADMIN] Supabase token verification failed: ${error.message}`);
          }
        }
      } catch (error: any) {
        console.error('[ADMIN] Error verifying Supabase token:', error.message);
      }
    }

    // Check 4: Fallback - check if req.user is already set (from session or other middleware)
    try {
      let userId: string | null = null;

      if (req.user?.claims?.sub) {
        userId = req.user.claims.sub;
      } else if (req.user?.id) {
        userId = req.user.id;
      }

      if (userId) {
        const user = await storage.getUser(userId);
        if (user?.isAdmin) {
          return next();
        }
      }
    } catch (error) {
      console.error('[ADMIN] Error checking admin status:', error);
    }

    const clientIp = req.ip || req.connection.remoteAddress;
    console.warn(`[ADMIN] Unauthorized access attempt from ${clientIp} to ${req.path}`);
    return res.status(401).json({ error: 'Unauthorized - admin access required' });
  }

  // Admin endpoint: Get system statistics
  app.get("/api/admin/stats", adminAuth, async (req, res) => {
    try {
      // All scheduled job types in the system
      const jobTypes = [
        'roster_sync',
        'sync_player_game_logs',
        'schedule_sync',
        'stats_sync',
        'stats_sync_live',
        'create_contests',
        'update_contest_statuses',
        'settle_contests',
        'daily_snapshot',
        'weekly_roundup',
      ];

      const [users, players, allContests, recentLogs, latestJobLogs] = await Promise.all([
        storage.getUsers(),
        storage.getPlayers(),
        storage.getContests(),
        storage.getRecentJobLogs(undefined, 200), // For today's API request count
        storage.getLatestJobLogPerType(jobTypes),
      ]);
      const openContests = allContests.filter((c: any) => c.status === 'open').length;
      const liveContests = allContests.filter((c: any) => c.status === 'live').length;
      const completedContests = allContests.filter((c: any) => c.status === 'completed').length;

      // Get today's API request count from recent logs
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayLogs = recentLogs.filter((log: any) => {
        const logDate = new Date(log.scheduledFor);
        logDate.setHours(0, 0, 0, 0);
        return logDate.getTime() === today.getTime();
      });
      const apiRequestsToday = todayLogs.reduce((sum: number, log: any) => sum + (log.requestCount || 0), 0);

      // Build last job runs from the per-type query results
      const lastJobRuns = jobTypes.map(jobName => {
        const lastLog = latestJobLogs.get(jobName);
        return {
          jobName,
          status: lastLog?.status || 'never_run',
          finishedAt: lastLog?.finishedAt || null,
          recordsProcessed: lastLog?.recordsProcessed || 0,
          errorCount: lastLog?.errorCount || 0,
        };
      });

      res.json({
        totalUsers: users.length,
        totalPlayers: players.length,
        totalContests: allContests.length,
        openContests,
        liveContests,
        completedContests,
        apiRequestsToday,
        lastJobRuns,
      });
    } catch (error: any) {
      console.error('[ADMIN] Failed to get stats:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Manually trigger cron jobs
  app.post("/api/admin/jobs/trigger", adminAuth, async (req, res) => {
    try {
      const { jobName, operationId } = req.body;
      const clientIp = req.ip || req.connection.remoteAddress;

      if (!jobName) {
        return res.status(400).json({ error: 'jobName required' });
      }

      const validJobs = ['roster_sync', 'sync_player_game_logs', 'schedule_sync', 'stats_sync', 'create_contests', 'settle_contests', 'daily_snapshot', 'backfill_market_snapshots', 'refresh_player_metrics'];
      if (!validJobs.includes(jobName)) {
        return res.status(400).json({ error: `Invalid jobName. Must be one of: ${validJobs.join(', ')}` });
      }

      console.log(`[ADMIN] Job trigger requested by ${clientIp}: ${jobName}${operationId ? ` (operation: ${operationId})` : ''}`);

      // Create progress callback if operationId provided
      let progressCallback;
      if (operationId) {
        const { createProgressCallback } = await import('./lib/admin-stream');
        progressCallback = createProgressCallback(operationId);

        // Emit initial event
        progressCallback({
          type: 'info',
          timestamp: new Date().toISOString(),
          message: `Starting job: ${jobName}`,
          data: { jobName },
        });
      }

      // Trigger job with optional progress callback
      const result = await jobScheduler.triggerJob(jobName, progressCallback);

      console.log(`[ADMIN] Job ${jobName} completed - ${result.recordsProcessed} records, ${result.errorCount} errors, ${result.requestCount} requests`);

      // Emit completion event if callback exists
      if (progressCallback) {
        progressCallback({
          type: 'complete',
          timestamp: new Date().toISOString(),
          message: result.errorCount > 0
            ? `Job ${jobName} completed with ${result.errorCount} errors`
            : `Job ${jobName} completed successfully`,
          data: {
            success: result.errorCount === 0,
            jobName,
            recordsProcessed: result.recordsProcessed,
            errorCount: result.errorCount,
            requestCount: result.requestCount,
          },
        });
      }

      res.json({
        success: true,
        jobName,
        result,
        status: result.errorCount > 0 ? 'degraded' : 'success',
      });
    } catch (error: any) {
      console.error('[ADMIN] Job trigger failed:', error.message);

      // Emit error event if callback exists (create it from body if available)
      const { operationId } = req.body;
      if (operationId) {
        try {
          const { createProgressCallback } = await import('./lib/admin-stream');
          const progressCallback = createProgressCallback(operationId);
          progressCallback({
            type: 'error',
            timestamp: new Date().toISOString(),
            message: `Job failed: ${error.message}`,
            data: { error: error.message, stack: error.stack },
          });
          progressCallback({
            type: 'complete',
            timestamp: new Date().toISOString(),
            message: 'Job failed',
            data: { success: false },
          });
        } catch (streamError) {
          console.error('[ADMIN] Failed to emit error event:', streamError);
        }
      }

      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: SSE stream for operation logs
  app.get("/api/admin/stream/:operationId", adminAuth, async (req, res) => {
    const { operationId } = req.params;

    try {
      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      // Send initial connection message
      res.write(`data: ${JSON.stringify({
        type: 'info',
        timestamp: new Date().toISOString(),
        message: `Connected to operation ${operationId}`,
      })}\n\n`);

      // Register this client with the stream manager
      const { adminStreamManager } = await import('./lib/admin-stream');
      adminStreamManager.registerClient(operationId, res);

      console.log(`[SSE] Client connected to operation ${operationId}`);

      // Handle client disconnect
      req.on('close', () => {
        console.log(`[SSE] Client disconnected from operation ${operationId}`);
        adminStreamManager.unregisterClient(operationId, res);
      });

      // Prevent error handler from trying to send JSON response
      req.on('error', (err) => {
        console.error(`[SSE] Stream error for ${operationId}:`, err);
        if (!res.writableEnded) {
          res.end();
        }
      });
    } catch (error: any) {
      console.error(`[SSE] Failed to setup stream for ${operationId}:`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      } else {
        res.end();
      }
    }
  });

  // Admin endpoint: Backfill game logs for date range
  app.post("/api/admin/backfill", adminAuth, async (req, res) => {
    try {
      const { startDate, endDate, operationId } = req.body;
      const clientIp = req.ip || req.connection.remoteAddress;

      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate required (YYYY-MM-DD format)' });
      }

      // Validate date format (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }

      // Parse and normalize dates to UTC midnight
      const start = new Date(startDate + 'T00:00:00.000Z');
      const end = new Date(endDate + 'T00:00:00.000Z');

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ error: 'Invalid date values' });
      }

      if (start > end) {
        return res.status(400).json({ error: 'startDate must be before or equal to endDate' });
      }

      // Enforce max range (90 days to prevent abuse and rate limit exhaustion)
      const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      const MAX_DAYS = 90;
      if (daysDiff > MAX_DAYS) {
        return res.status(400).json({
          error: `Date range too large. Maximum ${MAX_DAYS} days allowed. You requested ${daysDiff} days.`
        });
      }

      // Validate dates are not in the future
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      if (start > now || end > now) {
        return res.status(400).json({ error: 'Cannot backfill future dates' });
      }

      // Validate dates are within current season range (Oct 1 to now)
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      const seasonStartYear = currentMonth >= 6 ? currentYear : currentYear - 1;
      const seasonStart = new Date(seasonStartYear, 9, 1); // Oct 1

      if (start < seasonStart) {
        return res.status(400).json({
          error: `startDate must be on or after season start (${seasonStart.toISOString().split('T')[0]})`
        });
      }

      console.log(`[ADMIN] Backfill requested by ${clientIp}: ${startDate} to ${endDate} (${daysDiff + 1} days)`);

      // Create progress callback if operationId provided
      let progressCallback;
      if (operationId) {
        const { createProgressCallback } = await import('./lib/admin-stream');
        progressCallback = createProgressCallback(operationId);
      }

      // Import syncPlayerGameLogs here to avoid circular dependency
      const { syncPlayerGameLogs } = await import('./jobs/sync-player-game-logs');
      const result = await syncPlayerGameLogs({
        mode: 'backfill',
        startDate: start,
        endDate: end,
        progressCallback,
      });

      // Determine status based on errors
      const status = result.errorCount > 0 ? 'degraded' : 'success';

      console.log(`[ADMIN] Backfill ${status} - ${result.recordsProcessed} game logs cached, ${result.errorCount} errors, ${result.requestCount} API requests`);

      // Only send response if headers haven't been sent yet (streaming case)
      if (!res.headersSent) {
        res.json({
          success: status === 'success',
          status,
          result,
          message: result.errorCount > 0
            ? `Backfill completed with ${result.errorCount} errors. Check logs for details.`
            : 'Backfill completed successfully',
        });
      }
    } catch (error: any) {
      console.error('[ADMIN] Backfill failed:', error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  });

  // Admin endpoint: Bot statistics and recent actions
  app.get("/api/admin/bots", adminAuth, async (_req, res) => {
    return res.status(410).json({
      error: "Bot order-book engine is archived. AMM player market has no bot trigger endpoint.",
    });
  });

  // Admin endpoint: Manually trigger bot engine (archived)
  app.post("/api/admin/bots/trigger", adminAuth, async (_req, res) => {
    return res.status(410).json({
      error: "Bot order-book engine trigger is archived in AMM-only mode.",
    });
  });

  // Admin endpoint: Manually credit premium shares (for failed Whop purchases)
  app.post("/api/admin/premium/credit", adminAuth, async (req, res) => {
    try {
      const { userId, quantity, reason } = req.body;

      if (!userId || !quantity) {
        return res.status(400).json({ error: "userId and quantity are required" });
      }

      const qty = parseInt(quantity);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: "quantity must be a positive integer" });
      }

      // Verify user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Get current premium holding
      const existingHolding = await storage.getHolding(userId, "premium", "premium");
      const currentQuantity = parseFloat(existingHolding?.quantity || "0");
      const newQuantity = currentQuantity + qty;

      // Credit the shares
      await storage.updateHolding(userId, "premium", "premium", newQuantity, "5.0000");

      console.log(`[ADMIN] Manually credited ${qty} premium shares to user ${userId}. Reason: ${reason || 'No reason provided'}`);

      // Broadcast portfolio update
      broadcast({ type: "portfolio" });

      res.json({
        success: true,
        userId,
        previousQuantity: currentQuantity,
        creditedQuantity: qty,
        newQuantity,
        reason: reason || 'Manual credit by admin',
      });
    } catch (error: any) {
      console.error('[ADMIN] Failed to credit premium shares:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: View pending premium checkout sessions
  app.get("/api/admin/premium/sessions", adminAuth, async (req, res) => {
    try {
      const sessions = await db
        .select()
        .from(premiumCheckoutSessions)
        .orderBy(desc(premiumCheckoutSessions.createdAt))
        .limit(50);

      res.json({ sessions });
    } catch (error: any) {
      console.error('[ADMIN] Failed to get premium sessions:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ========== TWEET MANAGEMENT ENDPOINTS ==========

  // Admin endpoint: Get tweet settings and history
  app.get("/api/admin/tweets", adminAuth, async (req, res) => {
    try {
      // Get settings (create default if none exist)
      let settings = await db.select().from(tweetSettings).limit(1);
      if (settings.length === 0) {
        const [newSettings] = await db.insert(tweetSettings).values({
          enabled: false,
        }).returning();
        settings = [newSettings];
      }

      // Get recent tweet history
      const history = await db
        .select()
        .from(tweetHistory)
        .orderBy(desc(tweetHistory.createdAt))
        .limit(20);

      // Get service status
      const { twitterService } = await import("./services/twitter");
      const { perplexityService } = await import("./services/perplexity");

      res.json({
        settings: settings[0],
        history,
        status: {
          twitter: twitterService.getStatus(),
          perplexity: perplexityService.getStatus(),
        },
      });
    } catch (error: any) {
      console.error('[ADMIN] Failed to get tweet settings:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Update tweet settings
  app.patch("/api/admin/tweets/settings", adminAuth, async (req, res) => {
    try {
      const { enabled, promptTemplate, includeRisers, includeVolume, includeMarketCap, maxPlayers } = req.body;

      // Get existing settings or create new
      let settings = await db.select().from(tweetSettings).limit(1);

      if (settings.length === 0) {
        const [newSettings] = await db.insert(tweetSettings).values({
          enabled: enabled ?? false,
          promptTemplate: promptTemplate ?? undefined,
          includeRisers: includeRisers ?? true,
          includeVolume: includeVolume ?? true,
          includeMarketCap: includeMarketCap ?? true,
          maxPlayers: maxPlayers ?? 3,
        }).returning();
        return res.json({ settings: newSettings });
      }

      // Update existing settings
      const updates: any = { updatedAt: new Date() };
      if (enabled !== undefined) updates.enabled = enabled;
      if (promptTemplate !== undefined) updates.promptTemplate = promptTemplate;
      if (includeRisers !== undefined) updates.includeRisers = includeRisers;
      if (includeVolume !== undefined) updates.includeVolume = includeVolume;
      if (includeMarketCap !== undefined) updates.includeMarketCap = includeMarketCap;
      if (maxPlayers !== undefined) updates.maxPlayers = maxPlayers;

      const [updated] = await db
        .update(tweetSettings)
        .set(updates)
        .where(eq(tweetSettings.id, settings[0].id))
        .returning();

      res.json({ settings: updated });
    } catch (error: any) {
      console.error('[ADMIN] Failed to update tweet settings:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Verify Twitter credentials
  app.post("/api/admin/tweets/verify", adminAuth, async (req, res) => {
    try {
      const { twitterService } = await import("./services/twitter");

      if (!twitterService.isReady()) {
        return res.status(400).json({
          success: false,
          error: "Twitter service not configured - missing API credentials",
          status: twitterService.getStatus(),
        });
      }

      const verification = await twitterService.verifyCredentials();

      if (verification.valid) {
        res.json({
          success: true,
          username: verification.username,
          message: `Successfully connected to Twitter account @${verification.username}`,
        });
      } else {
        res.status(400).json({
          success: false,
          error: verification.error,
          hint: "Make sure your Twitter Developer App has 'Read and Write' permissions enabled, and you've regenerated your Access Token & Secret AFTER enabling those permissions.",
        });
      }
    } catch (error: any) {
      console.error('[ADMIN] Failed to verify Twitter credentials:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Preview a tweet (without posting)
  app.post("/api/admin/tweets/preview", adminAuth, async (req, res) => {
    try {
      const { generateTweetPreview } = await import("./jobs/daily-tweet");
      const preview = await generateTweetPreview();

      res.json({
        content: preview.content,
        playerData: preview.playerData,
        aiSummary: preview.aiSummary,
        characterCount: preview.content.length,
        settings: preview.settings,
      });
    } catch (error: any) {
      console.error('[ADMIN] Failed to generate tweet preview:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Post a tweet immediately (supports custom content)
  app.post("/api/admin/tweets/post", adminAuth, async (req, res) => {
    try {
      const { customContent } = req.body;

      if (customContent) {
        // Post custom content directly
        const { twitterService } = await import("./services/twitter");
        const tweetResult = await twitterService.postTweet(customContent);

        if (tweetResult.success) {
          // Log to tweet history
          await db.insert(tweetHistory).values({
            content: customContent,
            tweetId: tweetResult.tweetId,
            status: "posted",
          });

          res.json({
            success: true,
            tweetId: tweetResult.tweetId,
            content: customContent,
          });
        } else {
          res.status(400).json({
            success: false,
            error: tweetResult.error,
          });
        }
      } else {
        // Use daily tweet generator
        const { postDailyTweet } = await import("./jobs/daily-tweet");
        const result = await postDailyTweet();

        if (result.success) {
          res.json({
            success: true,
            tweetId: result.tweetId,
            content: result.content,
          });
        } else {
          res.status(400).json({
            success: false,
            error: result.error,
          });
        }
      }
    } catch (error: any) {
      console.error('[ADMIN] Failed to post tweet:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Test Twitter connection
  app.post("/api/admin/tweets/test-twitter", adminAuth, async (req, res) => {
    try {
      const { twitterService } = await import("./services/twitter");
      const result = await twitterService.verifyCredentials();
      res.json(result);
    } catch (error: any) {
      console.error('[ADMIN] Failed to test Twitter:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Test Perplexity connection
  app.post("/api/admin/tweets/test-perplexity", adminAuth, async (req, res) => {
    try {
      const { perplexityService } = await import("./services/perplexity");
      const result = await perplexityService.testConnection();
      res.json(result);
    } catch (error: any) {
      console.error('[ADMIN] Failed to test Perplexity:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Get market context for custom tweet drafting
  app.get("/api/admin/tweets/context", adminAuth, async (req, res) => {
    try {
      const { getFullMarketContext } = await import("./jobs/daily-tweet");
      const context = await getFullMarketContext();
      res.json(context);
    } catch (error: any) {
      console.error('[ADMIN] Failed to get market context:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Draft a custom tweet using Perplexity
  app.post("/api/admin/tweets/draft", adminAuth, async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ error: "Prompt is required" });
      }

      const { draftCustomTweet } = await import("./jobs/daily-tweet");
      const result = await draftCustomTweet(prompt);

      if (result.success) {
        res.json({
          success: true,
          content: result.content,
          context: result.context,
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error,
        });
      }
    } catch (error: any) {
      console.error('[ADMIN] Failed to draft custom tweet:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Cron endpoint: Daily tweet (for external cron services like cron-job.net)
  app.post("/api/cron/daily-tweet", adminAuth, async (req, res) => {
    try {
      console.log("[CRON] Daily tweet triggered");
      const { postDailyTweet } = await import("./jobs/daily-tweet");
      const result = await postDailyTweet();

      if (result.success) {
        console.log("[CRON] Daily tweet posted successfully:", result.tweetId);
        res.json({
          success: true,
          tweetId: result.tweetId,
        });
      } else {
        console.warn("[CRON] Daily tweet failed:", result.error);
        res.status(400).json({
          success: false,
          error: result.error,
        });
      }
    } catch (error: any) {
      console.error("[CRON] Daily tweet error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ========== END TWEET MANAGEMENT ==========

  // ========== NEWS HUB ENDPOINTS ==========

  // Get general news feed (last 7 days)
  app.get("/api/news", optionalAuth, async (req, res) => {
    try {
      const { newsFeed } = await import("@shared/schema");

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const news = await db
        .select()
        .from(newsFeed)
        .where(gte(newsFeed.createdAt, sevenDaysAgo))
        .orderBy(desc(newsFeed.createdAt))
        .limit(50);

      res.json({ news });
    } catch (error: any) {
      console.error("[news] Error fetching news:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Get lightweight player name lookup (for auto-hyperlinking player names)
  app.get("/api/players/lookup", async (req, res) => {
    try {
      const allPlayers = await storage.getPlayers();

      // Return only active players with minimal data needed for name matching
      const players = allPlayers
        .filter((p: Player) => p.isActive)
        .map((p: Player) => ({
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          fullName: `${p.firstName} ${p.lastName}`,
          priceChange24h: p.priceChange24h || null,
        }));

      res.json({ players });
    } catch (error: any) {
      console.error("[players/lookup] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Get personalized daily digest for authenticated user
  app.get("/api/news/digest", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { compileUserDigest } = await import("./jobs/compile-digest");

      const digest = await compileUserDigest(userId);

      res.json({ digest });
    } catch (error: any) {
      console.error("[news/digest] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Mark news as read (updates last_news_viewed_at timestamp)
  app.post("/api/news/mark-read", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);

      await db
        .update(users)
        .set({ lastNewsViewedAt: new Date() })
        .where(eq(users.id, userId));

      res.json({ success: true });
    } catch (error: any) {
      console.error("[news/mark-read] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Get unread news count for notification badge
  app.get("/api/news/unread-count", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { newsFeed } = await import("@shared/schema");

      // Get user's last viewed timestamp
      const user = await storage.getUser(userId);
      const lastViewed = user?.lastNewsViewedAt || new Date(0);

      // Count news items created after last viewed
      const result = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(newsFeed)
        .where(gte(newsFeed.createdAt, lastViewed));

      const count = result[0]?.count || 0;

      res.json({ count });
    } catch (error: any) {
      console.error("[news/unread-count] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin endpoint: Trigger a specific job manually (e.g., news_fetch)
  app.post("/api/admin/jobs/:jobName/trigger", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);

      if (!user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const { jobName } = req.params;

      // Only allow specific jobs to be triggered from this endpoint
      const allowedJobs = ['news_fetch', 'compile_digest'];
      if (!allowedJobs.includes(jobName)) {
        return res.status(400).json({ error: `Job '${jobName}' not allowed via this endpoint` });
      }

      console.log(`[Admin] User ${userId} triggering job: ${jobName}`);

      const result = await jobScheduler.triggerJob(jobName);

      res.json({
        success: true,
        jobName,
        ...result,
      });
    } catch (error: any) {
      console.error("[admin/jobs/trigger] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ========== END NEWS HUB ==========

  // Analytics API - market insights and player analysis
  app.get("/api/analytics", async (req, res) => {
    try {
      const timeRange = (req.query.timeRange as string) || "24H";

      // Calculate date range based on timeRange
      const now = new Date();
      let startDate = new Date();
      switch (timeRange) {
        case "24H": startDate.setDate(now.getDate() - 1); break;
        case "7D": startDate.setDate(now.getDate() - 7); break;
        case "30D": startDate.setDate(now.getDate() - 30); break;
        case "3M": startDate.setMonth(now.getMonth() - 3); break;
        case "1Y": startDate.setFullYear(now.getFullYear() - 1); break;
        case "All": startDate = new Date(2020, 0, 1); break; // From start
        default: startDate.setDate(now.getDate() - 1);
      }

      // Get market health stats and share economy stats from storage
      const [marketHealth, shareEconomy, timeSeries, shareEconomyTimeSeries] = await Promise.all([
        storage.getMarketHealthStats(startDate, now),
        storage.getShareEconomyStats(startDate, now),
        storage.getMarketHealthTimeSeries(startDate, now),
        storage.getShareEconomyTimeSeries(startDate, now),
      ]);

      // Calculate percentage changes
      const transactionChange = marketHealth.prevTransactionCount > 0
        ? ((marketHealth.transactionCount - marketHealth.prevTransactionCount) / marketHealth.prevTransactionCount) * 100
        : 0;
      const volumeChange = marketHealth.prevTotalVolume > 0
        ? ((marketHealth.totalVolume - marketHealth.prevTotalVolume) / marketHealth.prevTotalVolume) * 100
        : 0;
      const marketCapChange = marketHealth.prevTotalMarketCap > 0
        ? ((marketHealth.totalMarketCap - marketHealth.prevTotalMarketCap) / marketHealth.prevTotalMarketCap) * 100
        : 0;

      // Get power rankings
      const powerRankingsData = await storage.getPowerRankings(50);
      const powerRankings = powerRankingsData.map((r, idx) => ({
        rank: idx + 1,
        player: {
          id: r.playerId,
          firstName: r.name.split(' ')[0],
          lastName: r.name.split(' ').slice(1).join(' '),
          team: r.team,
          position: r.position,
          lastTradePrice: r.price.toFixed(2),
          volume24h: r.volume,
          priceChange24h: r.priceChange7d.toFixed(2),
        },
        compositeScore: r.compositeScore,
        priceChange7d: r.priceChange7d,
        avgFantasyPoints: r.avgFantasyPoints,
      }));

      // Get position rankings using power rankings data
      const positions = ["PG", "SG", "SF", "PF", "C"];
      const positionRankings = positions.map((position: string) => {
        const posPlayers = powerRankingsData
          .filter(p => p.position.includes(position))
          .slice(0, 10)
          .map((p, idx) => ({
            rank: idx + 1,
            player: {
              id: p.playerId,
              firstName: p.name.split(' ')[0],
              lastName: p.name.split(' ').slice(1).join(' '),
              team: p.team,
              position: p.position,
              lastTradePrice: p.price.toFixed(2),
              volume24h: p.volume,
              priceChange24h: p.priceChange7d.toFixed(2),
            },
            avgFantasyPoints: p.avgFantasyPoints,
            priceChange7d: p.priceChange7d,
          }));

        return { position, players: posPlayers };
      });

      // Calculate avg price change from active players
      const allPlayers = await storage.getPlayers();
      const activePlayers = allPlayers.filter((p: Player) => p.isActive);
      const priceChanges = activePlayers.map((p: Player) => parseFloat(p.priceChange24h || "0"));
      const avgPriceChange = priceChanges.length > 0
        ? priceChanges.reduce((sum: number, c: number) => sum + c, 0) / priceChanges.length
        : 0;

      // Most active team by volume
      const teamVolumes: Record<string, number> = {};
      activePlayers.forEach((p: Player) => {
        teamVolumes[p.team] = (teamVolumes[p.team] || 0) + (p.volume24h || 0);
      });
      const mostActiveTeam = Object.entries(teamVolumes).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";

      res.json({
        marketHealth: {
          transactions: marketHealth.transactionCount,
          transactionChange,
          volume: marketHealth.totalVolume,
          volumeChange,
          marketCap: marketHealth.totalMarketCap,
          marketCapChange,
          sharesMined: shareEconomy.totalSharesVested,
          sharesVested: shareEconomy.totalSharesVested,
          sharesBurned: shareEconomy.totalSharesBurned,
          totalShares: shareEconomy.totalSharesInEconomy,
          periodSharesMined: shareEconomy.periodSharesVested,
          periodSharesVested: shareEconomy.periodSharesVested,
          periodsharesVested: shareEconomy.periodSharesVested,
          periodSharesBurned: shareEconomy.periodSharesBurned,
          timeSeries,
          shareEconomyTimeSeries: shareEconomyTimeSeries.map((point) => ({
            ...point,
            sharesMined: point.sharesVested,
          })),
        },
        powerRankings,
        positionRankings,
        marketStats: {
          totalVolume24h: marketHealth.totalVolume,
          totalTrades24h: marketHealth.transactionCount,
          avgPriceChange,
          mostActiveTeam,
        },
      });
    } catch (error: any) {
      console.error("[analytics] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Market snapshots API - daily metrics for analytics charts
  app.get("/api/analytics/snapshots", async (req, res) => {
    try {
      const timeRange = (req.query.timeRange as string) || "30D";

      // Calculate date range based on timeRange
      const now = new Date();
      let startDate = new Date();
      switch (timeRange) {
        case "7D": startDate.setDate(now.getDate() - 7); break;
        case "30D": startDate.setDate(now.getDate() - 30); break;
        case "3M": startDate.setMonth(now.getMonth() - 3); break;
        case "1Y": startDate.setFullYear(now.getFullYear() - 1); break;
        case "All": startDate = new Date(2020, 0, 1); break;
        default: startDate.setDate(now.getDate() - 30);
      }

      // Query market snapshots from database
      const snapshots = await db
        .select()
        .from(marketSnapshots)
        .where(and(
          gte(marketSnapshots.snapshotDate, startDate),
          lte(marketSnapshots.snapshotDate, now)
        ))
        .orderBy(marketSnapshots.snapshotDate);

      res.json({
        timeRange,
        startDate: startDate.toISOString(),
        endDate: now.toISOString(),
        snapshots: snapshots.map(s => ({
          date: s.snapshotDate,
          marketCap: parseFloat(s.marketCap),
          transactions: s.transactionsCount,
          volume: parseFloat(s.volume),
          sharesMined: s.sharesVested,
          sharesVested: s.sharesVested,
          sharesBurned: s.sharesBurned,
          totalShares: s.totalShares,
        })),
      });
    } catch (error: any) {
      console.error("[analytics/snapshots] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Player comparison with full metrics
  app.get("/api/analytics/compare", async (req, res) => {
    try {
      const playerIds = (req.query.playerIds as string || "").split(",").filter(Boolean);
      const timeRange = (req.query.timeRange as string) || "30D";

      if (playerIds.length < 1) {
        return res.json({ players: [] });
      }

      // Calculate date range
      const now = new Date();
      let startDate = new Date();
      switch (timeRange) {
        case "7D": startDate.setDate(now.getDate() - 7); break;
        case "30D": startDate.setDate(now.getDate() - 30); break;
        case "3M": startDate.setMonth(now.getMonth() - 3); break;
        case "1Y": startDate.setFullYear(now.getFullYear() - 1); break;
        case "All": startDate = new Date(2020, 0, 1); break;
        default: startDate.setDate(now.getDate() - 30);
      }

      // Get AMM-first comparison data
      const [sharesMap, poolDataMap, totalBoostsResult, boostUsageRows, ammStatsRows, ammHistoryRows] = await Promise.all([
        storage.getPlayerSharesOutstanding(playerIds),
        storage.getBatchPoolData(playerIds),
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(dailyBoosts)
          .where(and(
            gte(dailyBoosts.boostDate, startDate),
            lte(dailyBoosts.boostDate, now)
          )),
        db
          .select({
            playerId: dailyBoosts.playerId,
            timesUsed: sql<number>`COUNT(*)`,
          })
          .from(dailyBoosts)
          .where(and(
            inArray(dailyBoosts.playerId, playerIds),
            gte(dailyBoosts.boostDate, startDate),
            lte(dailyBoosts.boostDate, now)
          ))
          .groupBy(dailyBoosts.playerId),
        db
          .select({
            playerId: trades.playerId,
            ammVolume: sql<string>`COALESCE(SUM(${trades.price} * ${trades.quantity}), 0)`,
            ammTrades: sql<number>`COUNT(*)`,
          })
          .from(trades)
          .where(and(
            inArray(trades.playerId, playerIds),
            gte(trades.executedAt, startDate),
            lte(trades.executedAt, now),
            sql`(${trades.buyerId} = 'pool' OR ${trades.sellerId} = 'pool')`
          ))
          .groupBy(trades.playerId),
        db
          .select({
            playerId: trades.playerId,
            date: sql<string>`DATE(${trades.executedAt})`.as("date"),
            volume: sql<string>`COALESCE(SUM(${trades.price} * ${trades.quantity}), 0)`.as("volume"),
          })
          .from(trades)
          .where(and(
            inArray(trades.playerId, playerIds),
            gte(trades.executedAt, startDate),
            lte(trades.executedAt, now),
            sql`(${trades.buyerId} = 'pool' OR ${trades.sellerId} = 'pool')`
          ))
          .groupBy(trades.playerId, sql`DATE(${trades.executedAt})`)
          .orderBy(trades.playerId, sql`DATE(${trades.executedAt})`),
      ]);

      const totalBoosts = totalBoostsResult[0]?.count || 0;
      const boostUsageMap = new Map<string, { timesUsed: number; usagePercent: number }>();
      for (const row of boostUsageRows) {
        const timesUsed = row.timesUsed || 0;
        boostUsageMap.set(row.playerId, {
          timesUsed,
          usagePercent: totalBoosts > 0 ? (timesUsed / totalBoosts) * 100 : 0,
        });
      }

      const ammStatsMap = new Map<string, { ammVolume: number; ammTrades: number }>();
      for (const row of ammStatsRows) {
        ammStatsMap.set(row.playerId, {
          ammVolume: parseFloat(row.ammVolume || "0"),
          ammTrades: row.ammTrades || 0,
        });
      }

      const ammHistoryMap = new Map<string, Array<{ timestamp: string; volume: number }>>();
      for (const row of ammHistoryRows) {
        if (!ammHistoryMap.has(row.playerId)) {
          ammHistoryMap.set(row.playerId, []);
        }
        ammHistoryMap.get(row.playerId)!.push({
          timestamp: `${row.date}T00:00:00.000Z`,
          volume: parseFloat(row.volume || "0"),
        });
      }

      const playersData = await Promise.all(
        playerIds.slice(0, 5).map(async (id: string) => {
          const player = await storage.getPlayer(id);
          if (!player) return null;

          const shares = sharesMap.get(id) || 0;
          const price = parseFloat(player.lastTradePrice || player.currentPrice || "0");
          const marketCap = shares * price;
          const boostUsage = boostUsageMap.get(id) || { timesUsed: 0, usagePercent: 0 };
          const poolData = poolDataMap.get(id) || { shares: 0, playMoney: 0, totalVolume: 0, totalTrades: 0 };
          const ammStats = ammStatsMap.get(id) || { ammVolume: 0, ammTrades: 0 };
          const ammVolumeHistory = ammHistoryMap.get(id) || [];

          return {
            id: player.id,
            name: `${player.firstName} ${player.lastName}`,
            team: player.team,
            position: player.position,
            shares,
            marketCap,
            price,
            volume: player.volume24h || 0,
            priceChange24h: parseFloat(player.priceChange24h || "0"),
            boostUsagePercent: boostUsage.usagePercent,
            timesUsedInBoosts: boostUsage.timesUsed,
            ammVolume: ammStats.ammVolume,
            ammTrades: ammStats.ammTrades,
            poolLiquidity: poolData.playMoney,
            poolShares: poolData.shares,
            ammVolumeHistory,
          };
        })
      );

      res.json({ players: playersData.filter(Boolean) });
    } catch (error: any) {
      console.error("[analytics/compare] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Price correlations between players
  app.get("/api/analytics/correlations", async (req, res) => {
    try {
      const allPlayers = await storage.getPlayers();
      const topPlayers = allPlayers
        .filter((p: Player) => p.isActive && p.volume24h && p.volume24h > 0)
        .sort((a: Player, b: Player) => (b.volume24h || 0) - (a.volume24h || 0))
        .slice(0, 20);

      // Calculate correlations based on price change patterns
      const correlations: { player1: string; player2: string; player1Id: string; player2Id: string; correlation: number }[] = [];

      for (let i = 0; i < topPlayers.length; i++) {
        for (let j = i + 1; j < topPlayers.length; j++) {
          const p1 = topPlayers[i];
          const p2 = topPlayers[j];

          const change1 = parseFloat(p1.priceChange24h || "0");
          const change2 = parseFloat(p2.priceChange24h || "0");

          // Correlation based on direction and magnitude similarity
          let correlation = 0;
          if ((change1 > 0 && change2 > 0) || (change1 < 0 && change2 < 0)) {
            // Same direction - higher correlation
            const magnitudeDiff = Math.abs(Math.abs(change1) - Math.abs(change2));
            correlation = Math.max(0.5, 1 - magnitudeDiff / 20);
          } else if (change1 === 0 || change2 === 0) {
            correlation = 0.3;
          } else {
            // Opposite direction - lower correlation
            correlation = Math.max(0, 0.3 - Math.abs(change1 + change2) / 40);
          }

          // Team boost: players on same team tend to correlate
          if (p1.team === p2.team) {
            correlation = Math.min(1, correlation + 0.15);
          }

          correlations.push({
            player1: `${p1.firstName} ${p1.lastName}`,
            player2: `${p2.firstName} ${p2.lastName}`,
            player1Id: p1.id,
            player2Id: p2.id,
            correlation: Math.round(correlation * 100) / 100,
          });
        }
      }

      // Sort by correlation strength
      correlations.sort((a, b) => b.correlation - a.correlation);

      res.json(correlations.slice(0, 20));
    } catch (error: any) {
      console.error("[analytics/correlations] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // POWER LEVEL / CONDENSE ROUTES
  // ============================================

  // Condense raw shares into Power Level (5:1 ratio)
  // Power Level shares can be used in Daily Boost slots but don't earn scout dividends
  app.post("/api/holdings/condense", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { playerId, sharesToCondense } = req.body;

      // Validate input
      if (!playerId) {
        return res.status(400).json({ error: "playerId is required" });
      }

      const shares = parseInt(sharesToCondense);
      if (isNaN(shares) || shares < 5) {
        return res.status(400).json({ error: "Minimum 5 shares required to condense" });
      }

      if (shares % 5 !== 0) {
        return res.status(400).json({ error: "Share count must be divisible by 5" });
      }

      // Perform the condense operation
      const result = await storage.condenseShares(userId, playerId, shares);

      // Get updated holding info
      const holdingInfo = await storage.getHoldingWithPowerLevel(userId, playerId);
      const player = await storage.getPlayer(playerId);

      res.json({
        success: true,
        newPowerLevel: result.newPowerLevel,
        sharesCondensed: result.sharesCondensed,
        powerLevelGained: (shares / 5).toFixed(2),
        holding: holdingInfo,
        player: player ? {
          id: player.id,
          firstName: player.firstName,
          lastName: player.lastName,
          team: player.team,
        } : null,
        message: `Successfully condensed ${shares} shares into ${(shares / 5).toFixed(1)} Power Level for ${player?.firstName} ${player?.lastName}`
      });
    } catch (error: any) {
      console.error("[holdings/condense] Error:", error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get holding with power level info for a specific player
  app.get("/api/holdings/:playerId/power-level", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { playerId } = req.params;

      const holdingInfo = await storage.getHoldingWithPowerLevel(userId, playerId);

      if (!holdingInfo) {
        return res.json({
          hasHolding: false,
          quantity: 0,
          powerLevel: "0.00",
          availableShares: 0,
          canCondense: false,
        });
      }

      const canCondense = holdingInfo.availableShares >= 5;

      res.json({
        hasHolding: true,
        ...holdingInfo,
        canCondense,
        maxCondensable: Math.floor(holdingInfo.availableShares / 5) * 5,
      });
    } catch (error: any) {
      console.error("[holdings/power-level] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // DAILY BOOSTS ROUTES
  // ============================================

  // Get all daily boosts across all sports (sport-agnostic)
  app.get("/api/daily-boosts/all", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);

      const todayET = getTodayET();
      let dateStr = todayET;
      if (req.query.date && typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
        dateStr = req.query.date;
      }

      const { startOfDay } = getETDayBoundaries(dateStr);
      const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

      const boosts = await storage.getDailyBoostsAllSports(userId, targetDate);

      // Enrich with player data (powerLevel is now stored on the boost)
      const playerIds = boosts.map(b => b.playerId);
      const players = await storage.getPlayersByIds(playerIds);
      const playerMap = new Map(players.map(p => [p.id, p]));

      // Get all community boosts across all sports
      const communityBoosts = await storage.getCommunityBoostsAllSports(targetDate);
      const communityBoostMap = new Map<string, number>();
      communityBoosts.forEach(cb => {
        const current = communityBoostMap.get(cb.playerId) || 0;
        communityBoostMap.set(cb.playerId, current + 1);
      });

      // Fetch live player game stats for each boost (for live fantasy points display)
      const enrichedBoosts = await Promise.all(boosts.map(async (boost) => {
        let liveFantasyPoints: number | null = null;
        let liveGameStats: any = null;

        // Only fetch live stats if the boost has a gameId
        if (boost.gameId) {
          try {
            // First try direct playerId lookup
            let gameStats = await storage.getPlayerGameStats(boost.playerId, boost.gameId);

            // If not found, try fallback by home/away (handles mismatched player IDs)
            if (!gameStats || !gameStats.fantasyPoints) {
              const player = playerMap.get(boost.playerId);
              if (player?.team) {
                // Get the game to determine home/away
                const game = await storage.getDailyGameByGameId(boost.gameId);
                if (game) {
                  const isHome = player.team === game.homeTeam;
                  const homeAway = isHome ? "home" : "away";

                  // Get all stats for this game and home/away
                  const teamStats = await storage.getPlayerGameStatsByGameAndHomeAway(boost.gameId, homeAway);

                  // Find stats for this player by looking at their team
                  // (The stats playerId might differ from our DB playerId, so we match by team)
                  gameStats = teamStats.find(s => s.points > 0 || s.rebounds > 0 || s.assists > 0) || undefined;
                }
              }
            }

            if (gameStats && gameStats.fantasyPoints) {
              liveFantasyPoints = parseFloat(gameStats.fantasyPoints);
              liveGameStats = {
                points: gameStats.points,
                rebounds: gameStats.rebounds,
                assists: gameStats.assists,
                threePointersMade: gameStats.threePointersMade,
                minutes: gameStats.minutes,
              };
            }
          } catch (err) {
            // Stats might not exist yet for in-progress games
            console.debug(`[daily-boosts/all] No live stats for player ${boost.playerId} game ${boost.gameId}`);
          }
        }

        return {
          ...boost,
          player: playerMap.get(boost.playerId),
          communityBoostCount: communityBoostMap.get(boost.playerId) || 0,
          liveFantasyPoints,
          liveGameStats,
        };
      }));

      res.json({
        date: dateStr,
        boosts: enrichedBoosts,
        slotsRemaining: 4 - boosts.length,
        availableSlots: [5, 4, 3, 2].filter(tier => !boosts.some(b => b.slotTier === tier)),
      });
    } catch (error: any) {
      console.error("[daily-boosts/all] Error fetching boosts:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get community boosts across all sports (for the community list)
  app.get("/api/community-boosts/all", isAuthenticated, async (req: any, res) => {
    try {
      const todayET = getTodayET();
      let dateStr = todayET;
      if (req.query.date && typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
        dateStr = req.query.date;
      }

      const { startOfDay } = getETDayBoundaries(dateStr);
      const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

      const communityBoosts = await storage.getCommunityBoostsAllSports(targetDate);

      // Group by player to count how many community boosts each player has
      const playerBoostCounts = new Map<string, { count: number; players: typeof communityBoosts }>();
      communityBoosts.forEach(cb => {
        const existing = playerBoostCounts.get(cb.playerId);
        if (existing) {
          existing.count += 1;
          existing.players.push(cb);
        } else {
          playerBoostCounts.set(cb.playerId, { count: 1, players: [cb] });
        }
      });

      const result = Array.from(playerBoostCounts.entries()).map(([playerId, data]) => ({
        playerId,
        player: data.players[0].player,
        communityBoostCount: data.count,
        creators: data.players.map(p => p.creator),
        sport: data.players[0].sport,
        boostDate: data.players[0].boostDate,
      }));

      res.json({
        date: dateStr,
        communityBoosts: result,
      });
    } catch (error: any) {
      console.error("[community-boosts/all] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Debug endpoint to test storage
  app.get("/api/daily-boosts/debug", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      console.log("[DEBUG] userId:", userId);

      const allUsers = await storage.getUsers();
      console.log("[DEBUG] total users:", allUsers.length);

      if (allUsers.length === 0) {
        res.json({ error: "No users found" });
        return;
      }

      const holdings = await storage.getAllHoldingsWithPlayers(userId);
      console.log("[DEBUG] holdings count:", holdings.length);

      res.json({
        userId,
        userCount: allUsers.length,
        holdingsCount: holdings.length,
        holdings: holdings.slice(0, 5).map(h => ({
          playerId: h.player.id,
          name: `${h.player.firstName} ${h.player.lastName}`,
          team: h.player.team,
          sport: h.player.sport,
          quantity: h.quantity,
          powerLevel: h.powerLevel
        }))
      });
    } catch (error: any) {
      console.error("[DEBUG] Error:", error);
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  // Get all holdings with players (for boost selector) - shows all held players regardless of game status
  app.get("/api/daily-boosts/eligible-all", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);

      // Parse date query param (YYYY-MM-DD), default to today in ET
      const todayET = getTodayET();
      let dateStr = todayET;
      if (req.query.date && typeof req.query.date === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
          dateStr = req.query.date;
        }
      }

      const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);
      const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

      // Get all holdings with players
      const allHoldings = await storage.getAllHoldingsWithPlayers(userId);

      // Get all games today for all sports
      const todaysGames = await db.select().from(dailyGames)
        .where(and(
          gte(dailyGames.date, startOfDay),
          lt(dailyGames.date, endOfDay)
        ));

      // Build a map of team -> game info (include status)
      const teamGameMap = new Map<string, { gameId: string; startTime: Date; sport: string; status: string }>();
      for (const game of todaysGames) {
        teamGameMap.set(game.homeTeam, { gameId: game.gameId, startTime: new Date(game.startTime), sport: game.sport, status: game.status });
        teamGameMap.set(game.awayTeam, { gameId: game.gameId, startTime: new Date(game.startTime), sport: game.sport, status: game.status });
      }

      const now = new Date();

      // Get current boosts to show which players are already boosted
      const currentBoosts = await storage.getDailyBoostsAllSports(userId, targetDate);
      const boostedPlayerIds = new Set(currentBoosts.map(b => b.playerId));

      // Get community boosts for this sport/date (add +1 to multiplier for each)
      const communityBoosts = await storage.getCommunityBoostsAllSports(targetDate);
      const communityBoostMap = new Map<string, number>();
      communityBoosts.forEach(cb => {
        const current = communityBoostMap.get(cb.playerId) || 0;
        communityBoostMap.set(cb.playerId, current + 1);
      });

      // Get user's premium shares for community boost option
      const userHoldings = await storage.getUserHoldings(userId);
      const premiumHolding = userHoldings.find((h: Holding) => h.assetType === "premium");
      const userPremiumShares = premiumHolding?.quantity || 0;

      // Pre-fetch all locked quantities to avoid await inside map
      const lockedQuantities = new Map<string, number>();
      for (const holding of allHoldings) {
        try {
          const totalLocked = await storage.getTotalLockedQuantity(userId, "player", holding.player.id);
          lockedQuantities.set(holding.player.id, totalLocked);
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.error(`[eligible-all] Error getting locked qty for ${holding.player.id}:`, errMsg);
          lockedQuantities.set(holding.player.id, 0);
        }
      }

      const result = allHoldings.map(holding => {
        if (!holding.player) {
          console.error(`[eligible-all] Holding ${holding.id} has no player!`);
        }
        const teamGame = teamGameMap.get(holding.player?.team);
        const totalLocked = lockedQuantities.get(holding.player?.id) || 0;
        const availableShares = parseFloat(holding.quantity) - totalLocked;
        const powerLevel = holding.powerLevel || "0.00";
        const hasPowerLevel = parseFloat(powerLevel) > 0;

        const gameStartTime = teamGame?.startTime;
        const gameStarted = gameStartTime ? gameStartTime <= now : false;
        const hasGameToday = !!teamGame;
        const gameDbStatus = teamGame?.status || 'scheduled';

        // Game status: 'none' | 'upcoming' | 'live' | 'ended'
        // Trust DB status from BallDon'tLie API - see https://docs.balldontlie.io/#games
        // Status values: 'scheduled', 'inprogress', 'completed', 'ended', 'postponed', 'cancelled'
        // Time-based fallback only used when status is 'scheduled' and sync may be delayed (>3hrs since start)
        let gameStatus: 'none' | 'upcoming' | 'live' | 'ended' = 'none';
        if (teamGame) {
          if (gameDbStatus === 'completed' || gameDbStatus === 'ended') {
            gameStatus = 'ended';
          } else if (gameDbStatus === 'inprogress') {
            gameStatus = 'live';  // Trust API: inprogress = live
          } else if (gameStartTime) {
            // scheduled or unknown - check time
            const timeSinceStart = now.getTime() - gameStartTime.getTime();
            const threeHoursInMs = 3 * 60 * 60 * 1000;
            if (timeSinceStart >= threeHoursInMs) {
              gameStatus = 'ended'; // Likely ended but sync hasn't caught up
            } else {
              gameStatus = 'upcoming';
            }
          } else {
            gameStatus = 'upcoming';
          }
        }

        return {
          holdingId: holding.id,
          playerId: holding.player.id,
          player: holding.player,
          sport: holding.player.sport,
          availableShares,
          powerLevel,
          totalShares: holding.quantity,
          gameId: teamGame?.gameId || null,
          gameStartTime: gameStartTime || null,
          hasGameToday,
          gameStatus,
          gameDbStatus,
          isAlreadyBoosted: boostedPlayerIds.has(holding.player.id),
          communityBoostCount: communityBoostMap.get(holding.player.id) || 0,
          hasCommunityBoost: communityBoostMap.has(holding.player.id),
          userPremiumShares,
        };
      });

      res.json({
        date: dateStr,
        eligiblePlayers: result,
        totalEligible: result.filter((_, i, arr) => arr.findIndex(a => a.playerId === _.playerId) === i).length, // Unique players count
      });
    } catch (error: any) {
      console.error("[daily-boosts/eligible-all] Error:", error.message);
      console.error("[daily-boosts/eligible-all] Stack:", error.stack);
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  // Get eligible players for boosting (holdings with games today)
  app.get("/api/daily-boosts/eligible/:sport", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const sport = req.params.sport.toUpperCase();

      // Parse date query param (YYYY-MM-DD), default to today in ET
      // Use getETDayBoundaries to get proper UTC boundaries for the ET date
      const todayET = getTodayET();
      let dateStr = todayET;
      if (req.query.date && typeof req.query.date === 'string') {
        // Validate format YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
          dateStr = req.query.date;
        }
      }

      // Create a Date object in the middle of the ET day (noon) to avoid timezone edge cases
      const { startOfDay } = getETDayBoundaries(dateStr);
      const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000); // Noon on the ET day

      const eligiblePlayers = await storage.getEligiblePlayersForBoost(userId, sport, targetDate);

      // Get current boosts to show which players are already boosted
      const currentBoosts = await storage.getDailyBoosts(userId, sport, targetDate);
      const boostedPlayerIds = new Set(currentBoosts.map(b => b.playerId));

      // Get community boosts for this sport/date (add +1 to multiplier for each)
      const communityBoosts = await storage.getCommunityBoostsForDate(sport, targetDate);
      const communityBoostMap = new Map<string, number>();
      communityBoosts.forEach(cb => {
        const current = communityBoostMap.get(cb.playerId) || 0;
        communityBoostMap.set(cb.playerId, current + 1);
      });

      // Get user's premium shares for community boost option
      const userHoldings = await storage.getUserHoldings(userId);
      const premiumHolding = userHoldings.find((h: Holding) => h.assetType === "premium");
      const userPremiumShares = premiumHolding?.quantity || 0;

      const result = eligiblePlayers.map(ep => ({
        playerId: ep.player.id,
        player: ep.player,
        availableShares: ep.availableShares,
        powerLevel: ep.powerLevel,
        totalShares: ep.quantity,
        gameId: ep.gameId,
        gameStartTime: ep.gameStartTime,
        isAlreadyBoosted: boostedPlayerIds.has(ep.player.id),
        gameStarted: ep.gameStartTime ? new Date(ep.gameStartTime) <= new Date() : false,
        communityBoostCount: communityBoostMap.get(ep.player.id) || 0,
        hasCommunityBoost: communityBoostMap.has(ep.player.id),
        userPremiumShares,
      }));

      res.json({
        sport,
        date: dateStr,
        eligiblePlayers: result,
        totalEligible: result.length,
      });
    } catch (error: any) {
      console.error("[daily-boosts/eligible] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Assign a player to a boost slot
  app.post("/api/daily-boosts/assign", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { playerId, slotTier, sharesEntered, sport, date } = req.body;

      // Validate input
      if (!playerId || !slotTier || !sharesEntered || !sport) {
        return res.status(400).json({ error: "playerId, slotTier, sharesEntered, and sport are required" });
      }

      const tierNum = parseInt(slotTier);
      if (![2, 3, 4, 5].includes(tierNum)) {
        return res.status(400).json({ error: "slotTier must be 2, 3, 4, or 5" });
      }

      const shares = parseInt(sharesEntered);
      if (shares <= 0) {
        return res.status(400).json({ error: "sharesEntered must be positive" });
      }

      const sportUpper = sport.toUpperCase();

      const todayET = getTodayET();
      let dateStr = todayET;
      if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        dateStr = date;
      }
      const { startOfDay } = getETDayBoundaries(dateStr);
      const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

      // Check if slot is already taken
      const currentBoosts = await storage.getDailyBoosts(userId, sportUpper, targetDate);
      if (currentBoosts.some(b => b.slotTier === tierNum)) {
        return res.status(400).json({ error: `Slot ${tierNum}x is already occupied` });
      }

      // Check if player is already boosted
      if (currentBoosts.some(b => b.playerId === playerId)) {
        return res.status(400).json({ error: "This player is already in a boost slot" });
      }

      // Check max 4 boosts
      if (currentBoosts.length >= 4) {
        return res.status(400).json({ error: "All 4 boost slots are already filled" });
      }

      // Verify player has game today and get game info
      const game = await storage.getPlayerGameForDate(playerId, sportUpper, targetDate);
      if (!game) {
        return res.status(400).json({ error: "This player doesn't have a game today" });
      }

      // Check if game has already started
      if (new Date(game.startTime) <= new Date()) {
        return res.status(400).json({ error: "Cannot add boost - player's game has already started" });
      }

      // Verify user has enough available shares
      const availableShares = await storage.getAvailableShares(userId, "player", playerId);
      if (availableShares < shares) {
        return res.status(400).json({
          error: `Not enough available shares. You have ${availableShares} available.`
        });
      }

      // Verify only 1 share is entered per boost slot
      // Power is added to the single share to increase its value
      if (shares !== 1) {
        return res.status(400).json({
          error: `Only 1 share can be placed in a boost slot. You entered ${shares} shares. Use the Power feature to add more power to a single share.`
        });
      }

      // Get the holding to capture power (per-share power) before boost is created
      const holding = await storage.getHolding(userId, "player", playerId);
      if (!holding || parseFloat(holding.quantity) < 1) {
        return res.status(400).json({ error: "No shares available for this player" });
      }
      // Capture the total power level (quantity × per-share power) for the boost
      // This represents the effective share power for payout calculations
      const power = holding.powerLevel.toString();

      // Create the boost on ET game day
      const boostDate = startOfDay;

      const boost = await storage.createDailyBoost({
        userId,
        playerId,
        sport: sportUpper,
        slotTier: tierNum,
        boostDate,
        sharesEntered: shares,
        powerLevel: power, // Use total power level for payout calculations
        gameId: game.gameId,
      });

      // Get player info for response
      const player = await storage.getPlayer(playerId);

      res.json({
        success: true,
        boost: {
          ...boost,
          player,
        },
        estimatedPayout: `Estimated based on season average`,
      });
    } catch (error: any) {
      console.error("[daily-boosts/assign] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Remove a player from boost slot (only if game hasn't started)
  app.delete("/api/daily-boosts/:boostId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const boostId = req.params.boostId;

      // Get the boost and verify ownership
      const boosts = await storage.getDailyBoostsByStatus("active");
      const boost = boosts.find(b => b.id === boostId && b.userId === userId);

      if (!boost) {
        return res.status(404).json({ error: "Boost not found or not owned by you" });
      }

      // Check if boost is still active (not locked)
      if (boost.status !== "active") {
        return res.status(400).json({
          error: `Cannot remove boost - status is ${boost.status}. Boosts are locked when the game starts.`
        });
      }

      // Double-check game hasn't started
      if (boost.gameId) {
        const game = await storage.getDailyGameByGameId(boost.gameId);
        if (game && new Date(game.startTime) <= new Date()) {
          return res.status(400).json({ error: "Cannot remove boost - game has already started" });
        }
      }

      // Delete the boost
      await storage.deleteDailyBoost(boostId);

      res.json({ success: true, message: "Boost removed successfully" });
    } catch (error: any) {
      console.error("[daily-boosts/delete] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get live updates for boosts
  app.get("/api/daily-boosts/live/:sport", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const sport = req.params.sport.toUpperCase();

      const todayET = getTodayET();
      let dateStr = todayET;
      if (req.query.date && typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
        dateStr = req.query.date;
      }
      const { startOfDay } = getETDayBoundaries(dateStr);
      const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

      const boosts = await storage.getDailyBoosts(userId, sport, targetDate);

      // Get all relevant games for these players to fetch live stats
      const gameIds = boosts.map(b => b.gameId).filter(id => !!id) as string[];

      // We need to fetch the dailyGames again to get fresh fantasyPoints data if available
      const games = await db.select().from(dailyGames)
        .where(and(
          inArray(dailyGames.gameId, gameIds.length > 0 ? gameIds : ["PLACEHOLDER"]),
          eq(dailyGames.sport, sport)
        ));

      const gameMap = new Map(games.map(g => [g.gameId, g]));

      const liveBoosts = boosts.map(boost => {
        const game = boost.gameId ? gameMap.get(boost.gameId) : null;

        let liveFantasyPoints = 0;
        let gameStatus = "scheduled"; // scheduled, live, finished

        if (game) {
          const now = new Date();
          const startTime = new Date(game.startTime);

          if (now < startTime) {
            gameStatus = "scheduled";
          } else {
            gameStatus = "live";

            // Use fantasyPoints from boost if settled, OR from game record if available
            if (boost.fantasyPoints) {
              liveFantasyPoints = parseFloat(boost.fantasyPoints);
              gameStatus = "finished";
            }
            // If we had a live feed updating dailyGames, we'd check game.homeScore etc, 
            // but for specific player fantasy points we need a player_stats table or similar.
            // For now, allow reading from boost which is our settlement record.
          }
        }

        const estimatedPayout = (boost.sharesEntered * liveFantasyPoints * boost.slotTier).toFixed(2);

        return {
          ...boost,
          liveFantasyPoints,
          estimatedPayout,
          gameStatus
        };
      });

      const totalEstimatedEarnings = liveBoosts.reduce((sum, b) => sum + parseFloat(b.estimatedPayout), 0).toFixed(2);

      res.json({
        boosts: liveBoosts,
        totalEstimatedEarnings
      });
    } catch (error: any) {
      console.error("[daily-boosts/live] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get boost payout history
  app.get("/api/daily-boosts/history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const limit = parseInt(req.query.limit as string) || 50;

      const payouts = await storage.getBoostPayoutHistory(userId, limit);

      // Enrich with player data
      const playerIds = [...new Set(payouts.map(p => p.playerId))];
      const players = await storage.getPlayersByIds(playerIds);
      const playerMap = new Map(players.map(p => [p.id, p]));

      const enrichedPayouts = payouts.map(payout => ({
        ...payout,
        player: playerMap.get(payout.playerId),
      }));

      // Calculate totals
      const totalEarned = payouts.reduce((sum, p) => sum + parseFloat(p.payoutAmount), 0);

      res.json({
        payouts: enrichedPayouts,
        totalEarned: totalEarned.toFixed(2),
        totalBoosts: payouts.length,
      });
    } catch (error: any) {
      console.error("[daily-boosts/history] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get daily boosts state (generic :sport route - MUST be last)
  app.get("/api/daily-boosts/:sport", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const sport = req.params.sport.toUpperCase();

      const todayET = getTodayET();
      let dateStr = todayET;
      if (req.query.date && typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
        dateStr = req.query.date;
      }
      const { startOfDay } = getETDayBoundaries(dateStr);
      const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

      const boosts = await storage.getDailyBoosts(userId, sport, targetDate);

      // Enrich with player data (powerLevel is now stored on the boost)
      const playerIds = boosts.map(b => b.playerId);
      const players = await storage.getPlayersByIds(playerIds);
      const playerMap = new Map(players.map(p => [p.id, p]));

      // Get community boosts for this sport/date (each adds +1 to multiplier)
      const communityBoosts = await storage.getCommunityBoostsForDate(sport, targetDate);
      const communityBoostMap = new Map<string, number>();
      communityBoosts.forEach(cb => {
        const current = communityBoostMap.get(cb.playerId) || 0;
        communityBoostMap.set(cb.playerId, current + 1);
      });

      const enrichedBoosts = boosts.map(boost => ({
        ...boost,
        player: playerMap.get(boost.playerId),
        communityBoostCount: communityBoostMap.get(boost.playerId) || 0,
      }));

      res.json({
        sport,
        date: dateStr,
        boosts: enrichedBoosts,
        slotsRemaining: 4 - boosts.length,
        availableSlots: [5, 4, 3, 2].filter(tier => !boosts.some(b => b.slotTier === tier)),
      });
    } catch (error: any) {
      console.error("[daily-boosts] Error fetching boosts:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Community Boosts API
  // Get active community boosts for a sport
  app.get("/api/community-boosts/:sport", isAuthenticated, async (req: any, res, next) => {
    try {
      const rawSport = String(req.params.sport || "").toLowerCase();
      if (rawSport === "history" || rawSport === "eligible-players" || rawSport === "all") {
        return next();
      }

      const sport = req.params.sport.toUpperCase();
      const todayET = getTodayET();
      let dateStr = todayET;
      if (req.query.date && typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
        dateStr = req.query.date;
      }
      const { startOfDay } = getETDayBoundaries(dateStr);
      const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

      const boosts = await storage.getCommunityBoostsForDate(sport, targetDate);

      res.json(boosts);
    } catch (error: any) {
      console.error("[community-boosts/list] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new community boost (requires premium share)
  app.post("/api/community-boosts/create", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { playerId, sport, date } = req.body;

      if (!playerId || !sport) {
        return res.status(400).json({ error: "playerId and sport are required" });
      }

      // 1. Verify player has a game today that hasn't started
      const sportUpper = sport.toUpperCase();
      const todayET = getTodayET();
      let dateStr = todayET;
      if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        dateStr = date;
      }
      const { startOfDay } = getETDayBoundaries(dateStr);
      const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

      const game = await storage.getPlayerGameForDate(playerId, sportUpper, targetDate);

      if (!game) {
        return res.status(400).json({ error: "This player does not have a game today" });
      }

      if (new Date(game.startTime) <= new Date()) {
        return res.status(400).json({ error: "Cannot boost - game has already started" });
      }

      // 2. Check if player already has an active community boost
      const existingBoosts = await storage.getCommunityBoostsForDate(sportUpper, targetDate);
      if (existingBoosts.some(b => b.playerId === playerId)) {
        return res.status(400).json({ error: "This player already has a Community Boost!" });
      }

      // 3. Create boost (storage method handles premium share deduction)
      const boostDate = startOfDay;

      const boost = await storage.createCommunityBoost({
        creatorId: userId,
        playerId,
        sport: sportUpper,
        boostDate,
        gameId: game.gameId,
      });

      res.json({
        success: true,
        boost,
        message: "Community Boost activated! 1 Community Share redeemed."
      });
    } catch (error: any) {
      console.error("[community-boosts/create] Error:", error);
      res.status(400).json({ error: error.message });
    }
  });

  // Get user's community boost history (created by them)
  app.get("/api/community-boosts/history", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const today = new Date();
      // Simple fetch for now - in future could add dedicated history method
      // For now, filter active ones or we need a specific history query
      // Let's implement a simple query in route or add to storage later if needed.
      // Re-using specific status fetch isn't efficient for user history.
      // Let's rely on frontend to show current active ones, and maybe later add full history.
      // For MVP, returning empty or todo. Actually, let's skip history endpoint for MVP
      // and just show active boosts on the dashboard.
      res.json([]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get all players eligible for community boost (all players with games today, regardless of ownership)
  app.get("/api/community-boosts/eligible-players", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);

      // Parse date query param (YYYY-MM-DD), default to today in ET
      const todayET = getTodayET();
      let dateStr = todayET;
      if (req.query.date && typeof req.query.date === 'string') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
          dateStr = req.query.date;
        }
      }

      console.log(`[community-boosts/eligible-players] User ${userId}, date: ${dateStr}`);

      const { startOfDay, endOfDay } = getETDayBoundaries(dateStr);
      const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

      // Get all games today for all sports
      const todaysGames = await db.select().from(dailyGames)
        .where(and(
          gte(dailyGames.date, startOfDay),
          lt(dailyGames.date, endOfDay)
        ));

      console.log(`[community-boosts/eligible-players] Found ${todaysGames.length} games for date ${dateStr}`);

      // Get all active community boosts for today
      const communityBoosts = await storage.getCommunityBoostsAllSports(targetDate);
      console.log(`[community-boosts/eligible-players] Found ${communityBoosts.length} community boosts`);
      const communityBoostMap = new Map<string, number>();
      communityBoosts.forEach(cb => {
        const current = communityBoostMap.get(cb.playerId) || 0;
        communityBoostMap.set(cb.playerId, current + 1);
      });

      // Get user's community boosts for today (to show which ones they already created)
      const userCommunityBoosts = communityBoosts.filter(cb => cb.creatorId === userId);
      const userBoostedPlayerIds = new Set(userCommunityBoosts.map(cb => cb.playerId));

      // Get user's community shares (used for community boosts)
      const userHoldings = await storage.getUserHoldings(userId);
      const communityHolding = userHoldings.find((h: Holding) => h.assetType === "community");
      const userCommunityShares = communityHolding?.quantity || 0;

      // Build team -> game map
      const teamGameMap = new Map<string, { gameId: string; startTime: Date; sport: string; homeTeam: string; awayTeam: string; status: string }>();
      for (const game of todaysGames) {
        teamGameMap.set(game.homeTeam, { gameId: game.gameId, startTime: new Date(game.startTime), sport: game.sport, homeTeam: game.homeTeam, awayTeam: game.awayTeam, status: game.status });
        teamGameMap.set(game.awayTeam, { gameId: game.gameId, startTime: new Date(game.startTime), sport: game.sport, homeTeam: game.homeTeam, awayTeam: game.awayTeam, status: game.status });
      }

      // Get all players whose teams have games today
      const teamsWithGames = new Set([...todaysGames.map(g => g.homeTeam), ...todaysGames.map(g => g.awayTeam)]);
      console.log(`[community-boosts/eligible-players] Teams with games: ${teamsWithGames.size}`);

      let playersWithGames: typeof players.$inferSelect[] = [];
      if (teamsWithGames.size > 0) {
        playersWithGames = await db.select().from(players)
          .where(inArray(players.team, Array.from(teamsWithGames)));
      }
      console.log(`[community-boosts/eligible-players] Found ${playersWithGames.length} players with games`);

      const now = new Date();

      const result = playersWithGames.map(player => {
        const teamGame = teamGameMap.get(player.team);
        const gameStartTime = teamGame?.startTime;
        const gameStarted = gameStartTime ? gameStartTime <= now : false;
        const hasGameToday = !!teamGame;
        const communityBoostCount = communityBoostMap.get(player.id) || 0;
        const alreadyBoostedByUser = userBoostedPlayerIds.has(player.id);

        // Game status
        let gameStatus: 'upcoming' | 'live' | 'ended' = 'upcoming';
        if (teamGame) {
          const dbStatus = teamGame.status;
          if (dbStatus === 'completed' || dbStatus === 'ended') {
            gameStatus = 'ended';
          } else if (dbStatus === 'inprogress') {
            gameStatus = 'live';
          } else if (gameStartTime) {
            // scheduled - check if should have started
            const timeSinceStart = now.getTime() - gameStartTime.getTime();
            const threeHoursInMs = 3 * 60 * 60 * 1000;
            if (timeSinceStart >= threeHoursInMs) {
              gameStatus = 'ended';
            }
          }
        }

        return {
          playerId: player.id,
          player: {
            id: player.id,
            firstName: player.firstName,
            lastName: player.lastName,
            team: player.team,
            sport: player.sport,
          },
          sport: player.sport,
          gameId: teamGame?.gameId || null,
          gameStartTime: gameStartTime || null,
          gameStatus,
          hasGameToday,
          communityBoostCount,
          alreadyBoostedByUser,
          opponent: teamGame ? (teamGame.homeTeam === player.team ? `vs ${teamGame.awayTeam}` : `@ ${teamGame.homeTeam}`) : null,
        };
      });

      // Sort by community boost count descending, then by name
      result.sort((a, b) => {
        if (b.communityBoostCount !== a.communityBoostCount) {
          return b.communityBoostCount - a.communityBoostCount;
        }
        const nameA = `${a.player.firstName} ${a.player.lastName}`;
        const nameB = `${b.player.firstName} ${b.player.lastName}`;
        return nameA.localeCompare(nameB);
      });

      console.log(`[community-boosts/eligible-players] Returning ${result.length} players, ${userCommunityShares} user shares`);
      res.json({
        date: dateStr,
        players: result,
        userCommunityShares,
        totalPlayers: result.length,
      });
    } catch (error: any) {
      console.error("[community-boosts/eligible-players] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Initialize players on first run by triggering roster sync
  async function initializePlayers() {
    try {
      const existingPlayers = await storage.getPlayers();

      if (existingPlayers.length === 0) {
        console.log("No players found. Triggering roster_sync to fetch real NBA data from BallDontLie...");
        const result = await jobScheduler.triggerJob("roster_sync");
        console.log(`Roster sync completed: ${result.recordsProcessed} players loaded, ${result.errorCount} errors`);
      }
    } catch (error: any) {
      console.error("Failed to initialize players:", error.message);
    }
  }

  // Scout Velocity Tracking Endpoints
  // Get scout velocity for a specific player
  app.get("/api/scouts/velocity/:playerId", async (req, res) => {
    try {
      const { playerId } = req.params;
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      
      // Get current scout count
      const currentScouts = await db
        .select({ total: sql<number>`COALESCE(SUM(${scoutAssignments.scoutCount}), 0)` })
        .from(scoutAssignments)
        .where(eq(scoutAssignments.playerId, playerId));
      
      const totalScouts = Number(currentScouts[0]?.total || 0);
      
      // Get scout count from 1 hour ago using scout history
      const previousScouts = await db
        .select({ 
          total: sql<number>`COALESCE(SUM(${scoutHistory.scoutCount}), 0)`,
          maxStartedAt: sql<Date>`MAX(${scoutHistory.startedAt})`
        })
        .from(scoutHistory)
        .where(and(
          eq(scoutHistory.playerId, playerId),
          lt(scoutHistory.startedAt, oneHourAgo),
          sql`${scoutHistory.endedAt} IS NULL OR ${scoutHistory.endedAt} > ${oneHourAgo}`
        ));
      
      const previousTotal = Number(previousScouts[0]?.total || 0);
      
      // Calculate velocity (scouts per hour)
      const velocity = totalScouts - previousTotal;
      const isTrending = velocity >= 10;
      
      res.json({
        playerId,
        velocity,
        totalScouts,
        previousTotal,
        isTrending,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[scouts/velocity] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Get trending players (players with scout velocity >= 10/hour)
  app.get("/api/scouts/trending", async (req, res) => {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      
      // Get all players with active scouts
      const playersWithScouts = await db
        .select({ 
          playerId: scoutAssignments.playerId,
          totalScouts: sql<number>`SUM(${scoutAssignments.scoutCount})`,
        })
        .from(scoutAssignments)
        .groupBy(scoutAssignments.playerId);
      
      // Calculate velocity for each player
      const trendingPlayers: string[] = [];
      
      for (const player of playersWithScouts) {
        const previousScouts = await db
          .select({ 
            total: sql<number>`COALESCE(SUM(${scoutHistory.scoutCount}), 0)`
          })
          .from(scoutHistory)
          .where(and(
            eq(scoutHistory.playerId, player.playerId),
            lt(scoutHistory.startedAt, oneHourAgo),
            sql`${scoutHistory.endedAt} IS NULL OR ${scoutHistory.endedAt} > ${oneHourAgo}`
          ));
        
        const previousTotal = Number(previousScouts[0]?.total || 0);
        const currentTotal = Number(player.totalScouts || 0);
        const velocity = currentTotal - previousTotal;
        
        if (velocity >= 10) {
          trendingPlayers.push(player.playerId);
        }
      }
      
      res.json({
        playerIds: trendingPlayers,
        count: trendingPlayers.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error("[scouts/trending] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Initialize data
  await initializePlayers();

  // Register AMM routes for instant trading
  registerAmmRoutes(app);
  
  // Register LP routes for liquidity provider functionality
  registerLpRoutes(app);

  return httpServer;
}

