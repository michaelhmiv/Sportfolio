import { describe, expect, it } from "vitest";
import {
  getDefaultExposureTab,
  getGuestExposureRows,
  getMissingExposureRows,
  getOwnedExposureRowsFromGames,
  getOwnedExposureRowsFromRaces,
  getShowcaseExposureSummaryFromGames,
  getShowcaseExposureSummaryFromRaces,
  getSlateCountsFromGames,
  type DashboardShowcaseEligiblePlayer,
  type DashboardShowcaseGameEntry,
  type DashboardShowcaseRace,
  type DashboardShowcaseRaceHolding,
  type DashboardShowcaseSlatePlayer,
} from "@/components/dashboard-showcase-card.helpers";

function buildGameEntry(
  overrides: Partial<DashboardShowcaseGameEntry>,
): DashboardShowcaseGameEntry {
  return {
    effectiveStatus: overrides.effectiveStatus || "scheduled",
    game: {
      gameId: overrides.game?.gameId || "game-1",
      sport: overrides.game?.sport || "NBA",
      gameDay: overrides.game?.gameDay || "2026-03-09",
      status: overrides.game?.status || "scheduled",
      startTime: overrides.game?.startTime || "2026-03-09T19:00:00.000Z",
      homeTeam: overrides.game?.homeTeam || "BOS",
      awayTeam: overrides.game?.awayTeam || "NYK",
      homeScore: overrides.game?.homeScore ?? null,
      awayScore: overrides.game?.awayScore ?? null,
      venue: overrides.game?.venue ?? null,
      leaders: overrides.game?.leaders || {
        fantasy: null,
        shares: null,
        scouts: null,
      },
      liveMarketStatus: overrides.game?.liveMarketStatus ?? null,
      userContext: overrides.game?.userContext || null,
    },
  };
}

function buildEligiblePlayer(
  overrides: Partial<DashboardShowcaseEligiblePlayer>,
): DashboardShowcaseEligiblePlayer {
  return {
    playerId: overrides.playerId || "player-1",
    player:
      overrides.player ||
      ({
        id: overrides.playerId || "player-1",
        firstName: "Jayson",
        lastName: "Tatum",
        team: "BOS",
        sport: "NBA",
        position: "SF",
      } as any),
    sport: overrides.sport || "NBA",
    availableShares: overrides.availableShares ?? 1,
    effectiveShares: overrides.effectiveShares ?? "1.00",
    multiplier: overrides.multiplier ?? "1.00",
    bestShareMultiplier: overrides.bestShareMultiplier ?? 1,
    totalShares: overrides.totalShares ?? "1.00",
    hasStackedShare: overrides.hasStackedShare ?? false,
    regularShares: overrides.regularShares ?? 1,
    availableRegularShares: overrides.availableRegularShares ?? 1,
    stackedShares: overrides.stackedShares ?? 0,
    gameId: overrides.gameId ?? "game-1",
    gameStartTime: overrides.gameStartTime ?? "2026-03-09T19:00:00.000Z",
    hasGameToday: overrides.hasGameToday ?? true,
    gameStatus: overrides.gameStatus ?? "upcoming",
    gameDbStatus: overrides.gameDbStatus ?? "scheduled",
    isAlreadyBoosted: overrides.isAlreadyBoosted ?? false,
    communityBoostCount: overrides.communityBoostCount ?? 0,
    hasCommunityBoost: overrides.hasCommunityBoost ?? false,
    userPremiumShares: overrides.userPremiumShares ?? 0,
  };
}

function buildSlatePlayer(
  overrides: Partial<DashboardShowcaseSlatePlayer>,
): DashboardShowcaseSlatePlayer {
  return {
    playerId: overrides.playerId || "player-1",
    name: overrides.name || "Jayson Tatum",
    team: overrides.team || "BOS",
    gameId: overrides.gameId || "game-1",
    startTime: overrides.startTime || "2026-03-09T19:00:00.000Z",
    status: overrides.status || "scheduled",
    contextLabel: overrides.contextLabel || "NYK @ BOS",
    pregameValue: overrides.pregameValue ?? 31.2,
    liveValue: overrides.liveValue ?? null,
    finalValue: overrides.finalValue ?? null,
  };
}

describe("dashboard showcase exposure helpers", () => {
  it("counts live, upcoming, completed, and postponed slate states from game entries", () => {
    const entries: DashboardShowcaseGameEntry[] = [
      buildGameEntry({ effectiveStatus: "inprogress" }),
      buildGameEntry({ effectiveStatus: "scheduled", game: { gameId: "game-2" } as any }),
      buildGameEntry({ effectiveStatus: "completed", game: { gameId: "game-3" } as any }),
      buildGameEntry({ effectiveStatus: "postponed", game: { gameId: "game-4" } as any }),
    ];

    expect(getSlateCountsFromGames(entries)).toEqual({
      live: 1,
      upcoming: 1,
      completed: 1,
      postponed: 1,
    });
  });

  it("builds owned rows with earning detail and ranks live exposure first", () => {
    const entries: DashboardShowcaseGameEntry[] = [
      buildGameEntry({
        effectiveStatus: "scheduled",
        game: {
          gameId: "game-1",
          userContext: {
            eligibleCount: 1,
            liveEarned: null,
            topMultiplierPlayers: [],
            ownedPlayers: [
              {
                playerId: "player-1",
                name: "Jayson Tatum",
                team: "BOS",
                multiplier: 2,
                availableShares: 1,
                totalShares: 4,
                isBoosted: false,
              },
            ],
          },
        } as any,
      }),
      buildGameEntry({
        effectiveStatus: "inprogress",
        game: {
          gameId: "game-2",
          homeTeam: "DEN",
          awayTeam: "LAL",
          startTime: "2026-03-09T22:00:00.000Z",
          userContext: {
            eligibleCount: 1,
            liveEarned: 12,
            topMultiplierPlayers: [],
            ownedPlayers: [
              {
                playerId: "player-2",
                name: "Nikola Jokic",
                team: "DEN",
                multiplier: 1,
                availableShares: 0,
                totalShares: 6,
                isBoosted: true,
              },
            ],
          },
        } as any,
      }),
    ];

    const rows = getOwnedExposureRowsFromGames(
      entries,
      [
        buildEligiblePlayer({
          playerId: "player-2",
          isAlreadyBoosted: true,
          stackedShares: 0,
          player: {
            id: "player-2",
            firstName: "Nikola",
            lastName: "Jokic",
            team: "DEN",
            sport: "NBA",
            position: "C",
          } as any,
        }),
      ],
      [
        buildSlatePlayer({
          playerId: "player-1",
          name: "Jayson Tatum",
          pregameValue: 31.2,
        }),
        buildSlatePlayer({
          playerId: "player-2",
          name: "Nikola Jokic",
          team: "DEN",
          gameId: "game-2",
          contextLabel: "LAL @ DEN",
          status: "inprogress",
          liveValue: 44.8,
          pregameValue: 34.0,
          startTime: "2026-03-09T22:00:00.000Z",
        }),
      ],
      "NBA",
    );

    expect(rows[0]).toMatchObject({
      playerId: "player-2",
      valueKind: "live",
      detail: "6 sh | earn",
      isEarning: true,
    });
    expect(rows[1]).toMatchObject({
      playerId: "player-1",
      valueKind: "avg",
      detail: "4 sh | 2.0x",
    });
  });

  it("builds missing rows from the strongest uncovered slate players and counts benchmark gaps", () => {
    const entries: DashboardShowcaseGameEntry[] = [
      buildGameEntry({
        game: {
          userContext: {
            eligibleCount: 1,
            liveEarned: null,
            topMultiplierPlayers: [],
            ownedPlayers: [
              {
                playerId: "player-1",
                name: "Jayson Tatum",
                team: "BOS",
                multiplier: 2,
                availableShares: 1,
                totalShares: 4,
                isBoosted: false,
              },
            ],
          },
        } as any,
      }),
    ];

    const slatePlayers = [
      buildSlatePlayer({ playerId: "player-3", name: "Nikola Jokic", pregameValue: 34.5 }),
      buildSlatePlayer({ playerId: "player-2", name: "Luka Doncic", pregameValue: 33.1 }),
      buildSlatePlayer({ playerId: "player-1", name: "Jayson Tatum", pregameValue: 31.2 }),
    ];

    const ownedRows = getOwnedExposureRowsFromGames(entries, [], slatePlayers, "NBA");
    const missingRows = getMissingExposureRows(slatePlayers, ownedRows);
    const summary = getShowcaseExposureSummaryFromGames(entries, [], slatePlayers, "NBA");

    expect(missingRows.slice(0, 2).map((row) => row.playerId)).toEqual(["player-3", "player-2"]);
    expect(missingRows[0]).toMatchObject({
      detail: "Gap | no shares",
      isMissing: true,
      valueKind: "avg",
    });
    expect(summary.missingCount).toBe(2);
  });

  it("builds guest rows from top slate players and defaults guest tab to top", () => {
    const guestRows = getGuestExposureRows(
      [
        buildSlatePlayer({
          playerId: "player-2",
          name: "Nikola Jokic",
          status: "inprogress",
          liveValue: 46.2,
        }),
        buildSlatePlayer({
          playerId: "player-1",
          name: "Jayson Tatum",
          pregameValue: 31.2,
        }),
      ],
      2,
    );

    expect(guestRows[0]).toMatchObject({
      playerId: "player-2",
      detail: "Top slate | live",
      valueKind: "live",
    });
    expect(
      getDefaultExposureTab({
        isAuthenticated: false,
        ownedRows: [],
        missingRows: [],
      }),
    ).toBe("top");
  });

  it("supports NASCAR parity for owned and missing exposure summaries", () => {
    const races: DashboardShowcaseRace[] = [
      {
        raceId: "race-1",
        trackName: "Phoenix Raceway",
        series: "Cup",
        raceDate: "2026-03-09T20:00:00.000Z",
        status: "completed",
        totalDrivers: 36,
        liveEarned: 18,
      },
    ];
    const holdings: DashboardShowcaseRaceHolding[] = [
      {
        playerId: "driver-1",
        name: "Kyle Larson",
        team: "Hendrick",
        availableShares: 0,
        totalShares: 3,
        multiplier: 2,
        isBoosted: false,
        gameId: "race-1",
      },
    ];
    const slateDrivers = [
      buildSlatePlayer({
        playerId: "driver-2",
        name: "Ryan Blaney",
        team: "Ford",
        gameId: "race-1",
        contextLabel: "Cup | Phoenix Raceway",
        status: "completed",
        finalValue: 58.4,
      }),
      buildSlatePlayer({
        playerId: "driver-1",
        name: "Kyle Larson",
        team: "Chevy",
        gameId: "race-1",
        contextLabel: "Cup | Phoenix Raceway",
        status: "completed",
        finalValue: 51.6,
      }),
    ];

    const ownedRows = getOwnedExposureRowsFromRaces(
      races,
      holdings,
      [
        buildEligiblePlayer({
          sport: "NASCAR",
          playerId: "driver-1",
          player: {
            id: "driver-1",
            firstName: "Kyle",
            lastName: "Larson",
            team: "Hendrick",
            sport: "NASCAR",
            position: null,
          } as any,
          stackedShares: 2,
        }),
      ],
      slateDrivers,
      "NASCAR",
    );
    const summary = getShowcaseExposureSummaryFromRaces(
      races,
      holdings,
      [
        buildEligiblePlayer({
          sport: "NASCAR",
          playerId: "driver-1",
          player: {
            id: "driver-1",
            firstName: "Kyle",
            lastName: "Larson",
            team: "Hendrick",
            sport: "NASCAR",
            position: null,
          } as any,
          stackedShares: 2,
        }),
      ],
      slateDrivers,
      "NASCAR",
    );

    expect(ownedRows[0]).toMatchObject({
      playerId: "driver-1",
      valueKind: "final",
      detail: "3 sh | 2.0x | earn",
      isEarning: true,
    });
    expect(summary).toMatchObject({
      ownedCount: 1,
      missingCount: 1,
      earningCount: 1,
      completedCount: 1,
    });
  });
});
