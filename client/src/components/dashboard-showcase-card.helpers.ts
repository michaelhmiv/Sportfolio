import type { Player } from "@shared/schema";
import type { GameInsight, GameInsightSlatePlayer } from "@/types/game-insights";

export type DashboardShowcaseStatus = "scheduled" | "inprogress" | "completed" | "postponed";
export type DashboardShowcaseTab = "owned" | "missing" | "top";

export interface DashboardShowcaseGameEntry {
  game: GameInsight;
  effectiveStatus: DashboardShowcaseStatus;
}

export interface DashboardShowcaseRace {
  raceId: string;
  trackName: string;
  series: string;
  raceDate: string;
  status: "scheduled" | "inprogress" | "completed";
  liveEarned?: number | null;
  totalDrivers: number;
}

export interface DashboardShowcaseRaceHolding {
  playerId: string;
  name: string;
  team: string;
  availableShares: number;
  totalShares: number;
  multiplier: number;
  isBoosted: boolean;
  gameId: string;
}

export interface DashboardShowcaseEligiblePlayer {
  playerId: string;
  player: Player;
  sport: string;
  availableShares: number;
  effectiveShares: string | number;
  multiplier: string | number;
  bestShareMultiplier: number;
  totalShares: string | number;
  hasStackedShare?: boolean;
  regularShares?: number;
  availableRegularShares?: number;
  stackedShares?: number;
  gameId: string | null;
  gameStartTime: string | Date | null;
  hasGameToday: boolean;
  gameStatus: "none" | "upcoming" | "live" | "ended";
  gameDbStatus: string;
  isAlreadyBoosted: boolean;
  communityBoostCount: number;
  hasCommunityBoost: boolean;
  userPremiumShares: number;
}

export type DashboardShowcaseSlatePlayer = GameInsightSlatePlayer;

export interface DashboardShowcaseCounts {
  live: number;
  upcoming: number;
  completed: number;
  postponed: number;
}

export interface DashboardShowcaseExposureSummary {
  ownedCount: number;
  missingCount: number;
  earningCount: number;
  liveCount: number;
  upcomingCount: number;
  completedCount: number;
  postponedCount: number;
}

export interface DashboardShowcaseExposureRow {
  id: string;
  playerId: string;
  label: string;
  team: string;
  contextLabel: string;
  detail: string;
  status: DashboardShowcaseStatus;
  startTime: string;
  ownedShares: number;
  bestMultiplier: number;
  isEarning: boolean;
  isMissing: boolean;
  value: number | null;
  valueKind: "avg" | "live" | "final";
}

interface NormalizedOwnedPosition {
  playerId: string;
  label: string;
  team: string;
  contextLabel: string;
  status: DashboardShowcaseStatus;
  startTime: string;
  ownedShares: number;
  bestMultiplier: number;
}

const STATUS_PRIORITY: Record<DashboardShowcaseStatus, number> = {
  inprogress: 0,
  scheduled: 1,
  completed: 2,
  postponed: 3,
};

const TOP_BENCHMARK_COUNT = 12;

function compareStatus(left: DashboardShowcaseStatus, right: DashboardShowcaseStatus) {
  return STATUS_PRIORITY[left] - STATUS_PRIORITY[right];
}

function compareStartTime(left: string, right: string) {
  return new Date(left).getTime() - new Date(right).getTime();
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function formatShareCount(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function normalizeSlatePlayerStatus(
  status: DashboardShowcaseStatus | DashboardShowcaseRace["status"],
): DashboardShowcaseStatus {
  return status === "scheduled" || status === "inprogress" || status === "completed"
    ? status
    : "postponed";
}

function getSlatePlayerValueKind(status: DashboardShowcaseStatus): "avg" | "live" | "final" {
  if (status === "inprogress") return "live";
  if (status === "completed") return "final";
  return "avg";
}

function getSlatePlayerValue(player: DashboardShowcaseSlatePlayer): number | null {
  if (player.status === "inprogress") {
    return player.liveValue ?? player.finalValue ?? player.pregameValue ?? null;
  }

  if (player.status === "completed") {
    return player.finalValue ?? player.liveValue ?? player.pregameValue ?? null;
  }

  return player.pregameValue ?? player.liveValue ?? player.finalValue ?? null;
}

function sortSlatePlayers(left: DashboardShowcaseSlatePlayer, right: DashboardShowcaseSlatePlayer) {
  const statusCompare = compareStatus(left.status, right.status);
  if (statusCompare !== 0) return statusCompare;

  const valueDelta = (getSlatePlayerValue(right) || 0) - (getSlatePlayerValue(left) || 0);
  if (valueDelta !== 0) return valueDelta;

  return left.name.localeCompare(right.name);
}

function getSlatePlayerMap(slatePlayers: DashboardShowcaseSlatePlayer[]) {
  const map = new Map<string, DashboardShowcaseSlatePlayer>();

  [...slatePlayers].sort(sortSlatePlayers).forEach((player) => {
    if (!map.has(player.playerId)) {
      map.set(player.playerId, player);
    }
  });

  return map;
}

function getEarningPlayerIds(
  eligiblePlayers: DashboardShowcaseEligiblePlayer[],
  sport: string,
): Set<string> {
  return new Set(
    eligiblePlayers
      .filter(
        (entry) =>
          entry.hasGameToday &&
          (sport === "ALL" || entry.sport === sport) &&
          entry.gameStatus !== "none" &&
          (Boolean(entry.isAlreadyBoosted) || toNumber(entry.stackedShares) > 0),
      )
      .map((entry) => entry.playerId),
  );
}

function getOwnedPositionsFromGames(
  entries: DashboardShowcaseGameEntry[],
): NormalizedOwnedPosition[] {
  const ownedByPlayerId = new Map<string, NormalizedOwnedPosition>();

  entries.forEach((entry) => {
    const ownedPlayers = entry.game.userContext?.ownedPlayers || [];

    ownedPlayers.forEach((player) => {
      const existing = ownedByPlayerId.get(player.playerId);
      const position: NormalizedOwnedPosition = {
        playerId: player.playerId,
        label: player.name,
        team: player.team,
        contextLabel: `${entry.game.awayTeam} @ ${entry.game.homeTeam}`,
        status: entry.effectiveStatus,
        startTime: entry.game.startTime,
        ownedShares: player.totalShares,
        bestMultiplier: player.multiplier,
      };

      if (!existing) {
        ownedByPlayerId.set(player.playerId, position);
        return;
      }

      existing.ownedShares += position.ownedShares;
      existing.bestMultiplier = Math.max(existing.bestMultiplier, position.bestMultiplier);

      if (compareStatus(position.status, existing.status) < 0) {
        existing.status = position.status;
        existing.startTime = position.startTime;
        existing.contextLabel = position.contextLabel;
      }
    });
  });

  return Array.from(ownedByPlayerId.values());
}

function getOwnedPositionsFromRaces(
  races: DashboardShowcaseRace[],
  holdings: DashboardShowcaseRaceHolding[],
): NormalizedOwnedPosition[] {
  const raceById = new Map(races.map((race) => [race.raceId, race]));
  const ownedByPlayerId = new Map<string, NormalizedOwnedPosition>();

  holdings.forEach((holding) => {
    const race = raceById.get(holding.gameId);
    if (!race) return;

    const existing = ownedByPlayerId.get(holding.playerId);
    const position: NormalizedOwnedPosition = {
      playerId: holding.playerId,
      label: holding.name,
      team: holding.team,
      contextLabel: `${race.series} | ${race.trackName}`,
      status: normalizeSlatePlayerStatus(race.status),
      startTime: race.raceDate,
      ownedShares: holding.totalShares,
      bestMultiplier: holding.multiplier,
    };

    if (!existing) {
      ownedByPlayerId.set(holding.playerId, position);
      return;
    }

    existing.ownedShares += position.ownedShares;
    existing.bestMultiplier = Math.max(existing.bestMultiplier, position.bestMultiplier);
  });

  return Array.from(ownedByPlayerId.values());
}

function getOwnedPlayerIds(positions: NormalizedOwnedPosition[]) {
  return new Set(positions.map((position) => position.playerId));
}

function buildOwnedRows(
  positions: NormalizedOwnedPosition[],
  slatePlayers: DashboardShowcaseSlatePlayer[],
  earningPlayerIds: Set<string>,
  limit: number,
): DashboardShowcaseExposureRow[] {
  const slateByPlayerId = getSlatePlayerMap(slatePlayers);

  return [...positions]
    .sort((left, right) => {
      const leftSlate = slateByPlayerId.get(left.playerId);
      const rightSlate = slateByPlayerId.get(right.playerId);
      const leftStatus = leftSlate?.status || left.status;
      const rightStatus = rightSlate?.status || right.status;
      const statusCompare = compareStatus(leftStatus, rightStatus);
      if (statusCompare !== 0) return statusCompare;

      const rightValue = rightSlate ? (getSlatePlayerValue(rightSlate) ?? 0) : 0;
      const leftValue = leftSlate ? (getSlatePlayerValue(leftSlate) ?? 0) : 0;
      const valueDelta = rightValue - leftValue;
      if (valueDelta !== 0) return valueDelta;

      if (right.ownedShares !== left.ownedShares) {
        return right.ownedShares - left.ownedShares;
      }

      if (right.bestMultiplier !== left.bestMultiplier) {
        return right.bestMultiplier - left.bestMultiplier;
      }

      return left.label.localeCompare(right.label);
    })
    .slice(0, limit)
    .map((position) => {
      const slatePlayer = slateByPlayerId.get(position.playerId);
      const status = slatePlayer?.status || position.status;
      const detailParts = [`${formatShareCount(position.ownedShares)} sh`];

      if (position.bestMultiplier > 1) {
        detailParts.push(`${position.bestMultiplier.toFixed(1)}x`);
      }

      if (earningPlayerIds.has(position.playerId)) {
        detailParts.push("earn");
      }

      return {
        id: `owned-${position.playerId}`,
        playerId: position.playerId,
        label: position.label,
        team: position.team,
        contextLabel: slatePlayer?.contextLabel || position.contextLabel,
        detail: detailParts.join(" | "),
        status,
        startTime: slatePlayer?.startTime || position.startTime,
        ownedShares: position.ownedShares,
        bestMultiplier: position.bestMultiplier,
        isEarning: earningPlayerIds.has(position.playerId),
        isMissing: false,
        value: slatePlayer ? getSlatePlayerValue(slatePlayer) : null,
        valueKind: getSlatePlayerValueKind(status),
      } satisfies DashboardShowcaseExposureRow;
    });
}

function buildMissingRows(
  slatePlayers: DashboardShowcaseSlatePlayer[],
  ownedPlayerIds: Set<string>,
  limit: number,
): DashboardShowcaseExposureRow[] {
  return [...slatePlayers]
    .sort(sortSlatePlayers)
    .filter((player) => !ownedPlayerIds.has(player.playerId))
    .slice(0, limit)
    .map((player) => ({
      id: `missing-${player.playerId}-${player.gameId}`,
      playerId: player.playerId,
      label: player.name,
      team: player.team,
      contextLabel: player.contextLabel,
      detail: "Gap | no shares",
      status: player.status,
      startTime: player.startTime,
      ownedShares: 0,
      bestMultiplier: 0,
      isEarning: false,
      isMissing: true,
      value: getSlatePlayerValue(player),
      valueKind: getSlatePlayerValueKind(player.status),
    }));
}

function buildGuestRows(
  slatePlayers: DashboardShowcaseSlatePlayer[],
  limit: number,
): DashboardShowcaseExposureRow[] {
  return [...slatePlayers]
    .sort(sortSlatePlayers)
    .slice(0, limit)
    .map((player) => ({
      id: `top-${player.playerId}-${player.gameId}`,
      playerId: player.playerId,
      label: player.name,
      team: player.team,
      contextLabel: player.contextLabel,
      detail:
        player.status === "inprogress"
          ? "Top slate | live"
          : player.status === "completed"
            ? "Top slate | final"
            : "Top slate | avg",
      status: player.status,
      startTime: player.startTime,
      ownedShares: 0,
      bestMultiplier: 0,
      isEarning: false,
      isMissing: false,
      value: getSlatePlayerValue(player),
      valueKind: getSlatePlayerValueKind(player.status),
    }));
}

function getMissingCount(
  slatePlayers: DashboardShowcaseSlatePlayer[],
  ownedPlayerIds: Set<string>,
): number {
  return [...slatePlayers]
    .sort(sortSlatePlayers)
    .slice(0, TOP_BENCHMARK_COUNT)
    .filter((player) => !ownedPlayerIds.has(player.playerId)).length;
}

export function getSlateCountsFromGames(
  entries: DashboardShowcaseGameEntry[],
): DashboardShowcaseCounts {
  return entries.reduce(
    (counts, entry) => {
      if (entry.effectiveStatus === "inprogress") counts.live += 1;
      else if (entry.effectiveStatus === "scheduled") counts.upcoming += 1;
      else if (entry.effectiveStatus === "completed") counts.completed += 1;
      else counts.postponed += 1;
      return counts;
    },
    {
      live: 0,
      upcoming: 0,
      completed: 0,
      postponed: 0,
    } satisfies DashboardShowcaseCounts,
  );
}

export function getSlateCountsFromRaces(races: DashboardShowcaseRace[]): DashboardShowcaseCounts {
  return races.reduce(
    (counts, race) => {
      if (race.status === "inprogress") counts.live += 1;
      else if (race.status === "scheduled") counts.upcoming += 1;
      else counts.completed += 1;
      return counts;
    },
    {
      live: 0,
      upcoming: 0,
      completed: 0,
      postponed: 0,
    } satisfies DashboardShowcaseCounts,
  );
}

export function getShowcaseExposureSummaryFromGames(
  entries: DashboardShowcaseGameEntry[],
  eligiblePlayers: DashboardShowcaseEligiblePlayer[],
  slatePlayers: DashboardShowcaseSlatePlayer[],
  sport: string,
): DashboardShowcaseExposureSummary {
  const ownedPositions = getOwnedPositionsFromGames(entries);
  const counts = getSlateCountsFromGames(entries);

  return {
    ownedCount: ownedPositions.length,
    missingCount: getMissingCount(slatePlayers, getOwnedPlayerIds(ownedPositions)),
    earningCount: getEarningPlayerIds(eligiblePlayers, sport).size,
    liveCount: counts.live,
    upcomingCount: counts.upcoming,
    completedCount: counts.completed,
    postponedCount: counts.postponed,
  };
}

export function getShowcaseExposureSummaryFromRaces(
  races: DashboardShowcaseRace[],
  holdings: DashboardShowcaseRaceHolding[],
  eligiblePlayers: DashboardShowcaseEligiblePlayer[],
  slatePlayers: DashboardShowcaseSlatePlayer[],
  sport: string,
): DashboardShowcaseExposureSummary {
  const ownedPositions = getOwnedPositionsFromRaces(races, holdings);
  const counts = getSlateCountsFromRaces(races);

  return {
    ownedCount: ownedPositions.length,
    missingCount: getMissingCount(slatePlayers, getOwnedPlayerIds(ownedPositions)),
    earningCount: getEarningPlayerIds(eligiblePlayers, sport).size,
    liveCount: counts.live,
    upcomingCount: counts.upcoming,
    completedCount: counts.completed,
    postponedCount: counts.postponed,
  };
}

export function getOwnedExposureRowsFromGames(
  entries: DashboardShowcaseGameEntry[],
  eligiblePlayers: DashboardShowcaseEligiblePlayer[],
  slatePlayers: DashboardShowcaseSlatePlayer[],
  sport: string,
  limit = 6,
): DashboardShowcaseExposureRow[] {
  return buildOwnedRows(
    getOwnedPositionsFromGames(entries),
    slatePlayers,
    getEarningPlayerIds(eligiblePlayers, sport),
    limit,
  );
}

export function getOwnedExposureRowsFromRaces(
  races: DashboardShowcaseRace[],
  holdings: DashboardShowcaseRaceHolding[],
  eligiblePlayers: DashboardShowcaseEligiblePlayer[],
  slatePlayers: DashboardShowcaseSlatePlayer[],
  sport: string,
  limit = 6,
): DashboardShowcaseExposureRow[] {
  return buildOwnedRows(
    getOwnedPositionsFromRaces(races, holdings),
    slatePlayers,
    getEarningPlayerIds(eligiblePlayers, sport),
    limit,
  );
}

export function getMissingExposureRows(
  slatePlayers: DashboardShowcaseSlatePlayer[],
  ownedRows: DashboardShowcaseExposureRow[],
  limit = 6,
): DashboardShowcaseExposureRow[] {
  return buildMissingRows(slatePlayers, new Set(ownedRows.map((row) => row.playerId)), limit);
}

export function getGuestExposureRows(
  slatePlayers: DashboardShowcaseSlatePlayer[],
  limit = 6,
): DashboardShowcaseExposureRow[] {
  return buildGuestRows(slatePlayers, limit);
}

export function getDefaultExposureTab({
  isAuthenticated,
  ownedRows,
  missingRows,
}: {
  isAuthenticated: boolean;
  ownedRows: DashboardShowcaseExposureRow[];
  missingRows: DashboardShowcaseExposureRow[];
}): DashboardShowcaseTab {
  if (!isAuthenticated) {
    return "top";
  }

  if (ownedRows.length > 0) {
    return "owned";
  }

  if (missingRows.length > 0) {
    return "missing";
  }

  return "owned";
}
