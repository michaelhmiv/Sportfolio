import type { Express } from "express";
import { storage } from "../storage";
import {
  fetchLiveFeed,
  fetchWeekendFeed,
  NASCAR_SERIES,
  type NascarSeriesId,
} from "../nascar-api";
import {
  buildNascarWeekendDriverContexts,
  deriveNascarPerformance,
  type NascarPerformanceMetrics,
  type NascarWeekendDriverContext,
} from "../nascar-performance";

const SERIES_BY_CODE: Record<string, NascarSeriesId> = {
  NCS: NASCAR_SERIES.CUP,
  NXS: NASCAR_SERIES.XFINITY,
  NTS: NASCAR_SERIES.TRUCKS,
};

function parseNascarGameId(gameId: string): { raceId: number; seriesId: NascarSeriesId } | null {
  const match = /^nascar_(NCS|NXS|NTS)_(\d+)$/i.exec(gameId);
  if (!match) return null;

  const seriesId = SERIES_BY_CODE[match[1].toUpperCase()];
  const raceId = Number(match[2]);
  if (!seriesId || !Number.isFinite(raceId) || raceId <= 0) return null;
  return { raceId, seriesId };
}

function normalizeYear(value: unknown): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100) return parsed;
  return new Date().getFullYear();
}

interface DriverContextResponse extends NascarWeekendDriverContext {
  performance: NascarPerformanceMetrics | null;
  performanceState: "live" | "final" | null;
}

/**
 * NASCAR-only context endpoint. Practice/qualifying data is intentionally read from
 * the weekend feed and never written through the race/live scoring pipeline.
 */
export function registerNascarContextRoutes(app: Express): void {
  app.get("/api/nascar/races/:gameId/context", async (req, res) => {
    const gameId = String(req.params.gameId || "");
    const parsed = parseNascarGameId(gameId);
    if (!parsed) {
      return res.status(400).json({ error: "Invalid NASCAR game ID" });
    }

    const year = normalizeYear(req.query.year);

    try {
      const [weekend, liveFeed] = await Promise.all([
        fetchWeekendFeed(year, parsed.seriesId, parsed.raceId).catch(() => null),
        fetchLiveFeed(parsed.seriesId).catch(() => null),
      ]);

      const weekendContexts = buildNascarWeekendDriverContexts(weekend);
      const byPlayerId = new Map<string, DriverContextResponse>();

      for (const context of weekendContexts) {
        byPlayerId.set(context.playerId, {
          ...context,
          performance: null,
          performanceState: null,
        });
      }

      const matchingLiveFeed =
        liveFeed && liveFeed.race_id === parsed.raceId && liveFeed.run_type === 3 ? liveFeed : null;

      if (matchingLiveFeed) {
        for (const vehicle of matchingLiveFeed.vehicles || []) {
          const driverId = Number(vehicle.driver?.driver_id);
          if (!Number.isFinite(driverId) || driverId <= 0) continue;
          const playerId = `nascar_${driverId}`;
          const existing = byPlayerId.get(playerId);
          byPlayerId.set(playerId, {
            playerId,
            driverId,
            driverName:
              existing?.driverName || vehicle.driver?.full_name || `Driver ${driverId}`,
            practice: existing?.practice || null,
            qualifying: existing?.qualifying || null,
            startingPosition:
              existing?.startingPosition ||
              (Number(vehicle.starting_position) > 0 ? Number(vehicle.starting_position) : null),
            performance: deriveNascarPerformance(vehicle),
            performanceState: "live",
          });
        }
      }

      const contexts = Array.from(byPlayerId.values());

      // For non-live drivers, use the finalized/local race row when available. This
      // reads context only; it does not participate in scoring or settlement.
      await Promise.all(
        contexts.map(async (context) => {
          if (context.performanceState === "live") return;
          try {
            const stored = await storage.getPlayerGameStats(context.playerId, gameId);
            if (!stored) return;
            const statsJson = (stored.statsJson || {}) as Record<string, any>;
            const hasFinalResult = Number(statsJson.finishPosition) > 0;
            if (!hasFinalResult) return;
            context.performance = deriveNascarPerformance(statsJson);
            context.performanceState = "final";
          } catch {
            // Analytics context is best-effort and must never break the core slate.
          }
        }),
      );

      contexts.sort((a, b) => {
        const aPos = a.performance?.resultPosition ?? a.startingPosition ?? Number.MAX_SAFE_INTEGER;
        const bPos = b.performance?.resultPosition ?? b.startingPosition ?? Number.MAX_SAFE_INTEGER;
        if (aPos !== bPos) return aPos - bPos;
        return a.driverName.localeCompare(b.driverName);
      });

      return res.json({
        gameId,
        raceId: parsed.raceId,
        seriesId: parsed.seriesId,
        year,
        trackName: weekend?.trackName || matchingLiveFeed?.track_name || null,
        raceName: weekend?.raceName || null,
        drivers: contexts,
      });
    } catch (error: any) {
      console.error(`[nascar_context] Failed to build context for ${gameId}:`, error.message);
      return res.status(502).json({ error: "NASCAR context unavailable" });
    }
  });
}
