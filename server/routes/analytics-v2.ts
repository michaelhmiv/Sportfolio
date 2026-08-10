import type { Express, Request, Response } from "express";
import {
  compareMarkets,
  getMarketCorrelations,
  getMarketOverview,
  getMarketSeries,
  getMarketTape,
  normalizeAnalyticsTimeRange,
  screenMarkets,
  type MarketSort,
  type MarketTapeSide,
} from "../analytics/market-research";

const MARKET_SORTS = new Set<MarketSort>([
  "marketCap",
  "volume",
  "turnover",
  "return",
  "netFlow",
  "tvl",
  "trades",
  "depth",
]);
const TAPE_SIDES = new Set<MarketTapeSide>(["all", "buy", "sell", "peer"]);

function sportFrom(req: Request) {
  return typeof req.query.sport === "string" ? req.query.sport : "ALL";
}

function rangeFrom(req: Request) {
  return normalizeAnalyticsTimeRange(
    typeof req.query.timeRange === "string" ? req.query.timeRange : "30d",
  );
}

function integerFrom(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function numberFrom(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function playerIdsFrom(req: Request) {
  const raw = typeof req.query.playerIds === "string" ? req.query.playerIds : "";
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).slice(0, 8);
}

function sendFailure(res: Response, error: unknown) {
  console.error("[analytics-v2] request failed", error);
  res.status(500).json({
    error: "analytics_request_failed",
    message: error instanceof Error ? error.message : "Sportfolio analytics could not be loaded.",
  });
}

export function registerAnalyticsV2Routes(app: Express): void {
  app.get("/api/analytics/v2/overview", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=45");
      res.json(await getMarketOverview({ sport: sportFrom(req), timeRange: rangeFrom(req) }));
    } catch (error) {
      sendFailure(res, error);
    }
  });

  app.get("/api/analytics/v2/markets", async (req, res) => {
    try {
      const requestedSort = typeof req.query.sort === "string" ? req.query.sort : "marketCap";
      const sort: MarketSort = MARKET_SORTS.has(requestedSort as MarketSort)
        ? (requestedSort as MarketSort)
        : "marketCap";
      const search = typeof req.query.search === "string" ? req.query.search : "";
      res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=45");
      res.json(
        await screenMarkets({
          sport: sportFrom(req),
          timeRange: rangeFrom(req),
          sort,
          search,
          limit: integerFrom(req.query.limit, 50, 1, 100),
        }),
      );
    } catch (error) {
      sendFailure(res, error);
    }
  });

  app.get("/api/analytics/v2/series", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=90");
      res.json(await getMarketSeries({ sport: sportFrom(req), timeRange: rangeFrom(req) }));
    } catch (error) {
      sendFailure(res, error);
    }
  });

  app.get("/api/analytics/v2/compare", async (req, res) => {
    try {
      const playerIds = playerIdsFrom(req);
      if (!playerIds.length) {
        res.status(400).json({ error: "player_ids_required", message: "Select at least one player." });
        return;
      }
      res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=45");
      res.json(await compareMarkets({ playerIds, timeRange: rangeFrom(req) }));
    } catch (error) {
      sendFailure(res, error);
    }
  });

  app.get("/api/analytics/v2/correlations", async (req, res) => {
    try {
      const playerIds = playerIdsFrom(req);
      if (playerIds.length < 2) {
        res.status(400).json({
          error: "player_ids_required",
          message: "Select at least two players for correlation research.",
        });
        return;
      }
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=180");
      res.json(
        await getMarketCorrelations({
          playerIds,
          timeRange: rangeFrom(req),
          minSamples: integerFrom(req.query.minSamples, 5, 3, 30),
        }),
      );
    } catch (error) {
      sendFailure(res, error);
    }
  });

  app.get("/api/analytics/v2/tape", async (req, res) => {
    try {
      const requestedSide = typeof req.query.side === "string" ? req.query.side : "all";
      const side: MarketTapeSide = TAPE_SIDES.has(requestedSide as MarketTapeSide)
        ? (requestedSide as MarketTapeSide)
        : "all";
      res.setHeader("Cache-Control", "public, max-age=5, stale-while-revalidate=15");
      res.json(
        await getMarketTape({
          sport: sportFrom(req),
          side,
          playerId: typeof req.query.playerId === "string" ? req.query.playerId : undefined,
          minNotional: Math.max(0, numberFrom(req.query.minNotional)),
          limit: integerFrom(req.query.limit, 40, 1, 100),
        }),
      );
    } catch (error) {
      sendFailure(res, error);
    }
  });
}
