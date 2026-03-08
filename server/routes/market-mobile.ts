import type { Express, Request } from "express";

import { optionalAuth } from "../supabaseAuth";
import { buildMobileMarketOverview } from "../market-mobile-overview";

function getOptionalUserId(req: Request & { user?: any }): string | null {
  const claimedUserId =
    typeof req.user?.claims?.sub === "string"
      ? req.user.claims.sub
      : typeof req.user?.id === "string"
        ? req.user.id
        : null;

  return claimedUserId;
}

export function registerMarketMobileRoutes(app: Express) {
  app.get(
    "/api/market/mobile-overview",
    optionalAuth,
    async (req: Request & { user?: any }, res) => {
      try {
        const sport = typeof req.query.sport === "string" ? req.query.sport : "ALL";
        const overview = await buildMobileMarketOverview({
          sport,
          userId: getOptionalUserId(req),
        });

        res.json(overview);
      } catch (error: any) {
        console.error("[market/mobile-overview] Error:", error?.message || error);
        res.status(500).json({ error: "Failed to fetch mobile market overview" });
      }
    },
  );
}
