import type { Express, Request } from "express";

import { optionalAuth } from "../auth/runtime-auth";
import { buildMobileMarketOverview } from "../market-mobile-overview";

function setPublicDataHeaders(res: { setHeader: (name: string, value: string) => void }, ttl = 60) {
  const generatedAt = new Date();
  res.setHeader("Cache-Control", `public, max-age=${ttl}, s-maxage=${ttl}`);
  res.setHeader("Last-Modified", generatedAt.toUTCString());
  res.setHeader("X-Data-Generated-At", generatedAt.toISOString());
}

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
        const userId = getOptionalUserId(req);
        const overview = await buildMobileMarketOverview({
          sport,
          userId,
        });

        if (!userId) {
          setPublicDataHeaders(res, 60);
        }

        res.json(overview);
      } catch (error: any) {
        console.error("[market/mobile-overview] Error:", error?.message || error);
        res.status(500).json({ error: "Failed to fetch mobile market overview" });
      }
    },
  );
}
