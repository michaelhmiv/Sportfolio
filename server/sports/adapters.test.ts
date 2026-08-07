import { describe, expect, it } from "vitest";
import { createMlbAdapter } from "./mlb-adapter";
import { createNascarAdapter } from "./nascar-adapter";
import { createNhlAdapter } from "./nhl-adapter";
import { createDefaultSportsAdapterRegistry } from "./default-registry";

const now = () => new Date("2026-08-04T12:00:00.000Z");
describe("unified sports adapters", () => {
  it("normalizes MLB athletes, teams, schedules, and live state", async () => {
    const adapter = createMlbAdapter({
      now,
      fetchAllPlayers: async () => [
        {
          id: 1,
          fullName: "Test Player",
          firstName: "Test",
          lastName: "Player",
          active: true,
          primaryPosition: { code: "1", name: "Pitcher", type: "Pitcher", abbreviation: "P" },
        },
      ],
      fetchPlayer: async () => ({
        id: 1,
        fullName: "Test Player",
        firstName: "Test",
        lastName: "Player",
        active: true,
      }),
      fetchTeams: async () => [
        { id: 10, name: "Test Team", teamName: "Team", locationName: "Test", abbreviation: "TST" },
      ],
      fetchSchedule: async () => [
        {
          gamePk: 99,
          gameDate: "2026-08-04T17:00:00Z",
          status: {
            abstractGameState: "Preview",
            codedGameState: "S",
            detailedState: "Scheduled",
            statusCode: "S",
            startTimeTBD: false,
          },
          teams: {
            away: {
              team: { id: 10, name: "Away", abbreviation: "AWY" },
              score: null,
              isWinner: false,
            },
            home: {
              team: { id: 11, name: "Home", abbreviation: "HME" },
              score: null,
              isWinner: false,
            },
          },
        },
      ],
      fetchLinescore: async () => ({
        currentInning: 3,
        currentInningOrdinal: "3rd",
        inningHalf: "Top",
        teams: { home: { runs: 0, hits: 0, errors: 0 }, away: { runs: 1, hits: 2, errors: 0 } },
      }),
    });
    expect((await adapter.searchAthletes!("test"))[0]).toMatchObject({ id: "mlb_1", sport: "mlb" });
    expect((await adapter.getTeams!())[0].id).toBe("mlb_team_10");
    expect((await adapter.getSchedule!(new Date("2026-08-04"), new Date("2026-08-05")))[0].id).toBe(
      "mlb_game_99",
    );
    expect(await adapter.getLiveState!("mlb_game_99")).toMatchObject({
      status: "in_progress",
      period: "3rd",
      phase: { kind: "inning", number: 3, label: "3rd" },
      statusSource: "provider",
    });
  });

  it("normalizes NHL schedules and live score state", async () => {
    const game = {
      id: 7,
      startTimeUTC: "2026-08-04T19:00:00Z",
      gameState: "LIVE",
      homeTeam: { abbrev: "BOS" },
      awayTeam: { abbrev: "NYR" },
      periodDescriptor: { number: 2, periodType: "REG" },
      clock: { timeRemaining: "10:00" },
    };
    const adapter = createNhlAdapter({
      now,
      client: {
        getStandings: async () => ({
          standings: [{ id: 1, abbrev: "BOS", commonName: { default: "Bruins" } }],
        }),
        getSchedule: async () => ({ gameWeek: [{ games: [game] }] }),
        getScore: async () => ({ games: [game] }),
      } as any,
    });
    expect((await adapter.getTeams!())[0].id).toBe("nhl_team_BOS");
    expect(
      (await adapter.getSchedule!(new Date("2026-08-04"), new Date("2026-08-05")))[0].status,
    ).toBe("in_progress");
    expect(await adapter.getLiveState!("nhl_game_7")).toMatchObject({
      clock: "10:00",
      period: "2",
      phase: { kind: "period", number: 2, label: "REG" },
      statusSource: "provider",
    });
  });

  it("normalizes NASCAR schedules and live state without inventing teams", async () => {
    const adapter = createNascarAdapter({
      now,
      fetchRaceSchedule: async () => [
        {
          race_id: 5,
          series_id: 1,
          race_season: 2026,
          race_name: "Test 400",
          race_type_id: 1,
          restrictor_plate: false,
          track_id: 2,
          track_name: "Test",
          date_scheduled: "2026-08-04 14:00:00",
          race_date: "2026-08-04 14:00:00",
          qualifying_date: "",
          tunein_date: "",
          scheduled_distance: 400,
          actual_distance: 0,
          scheduled_laps: 200,
          actual_laps: 0,
          stage_1_laps: 50,
          stage_2_laps: 50,
          stage_3_laps: 100,
          number_of_cars_in_field: 36,
        },
      ],
      fetchLiveFeed: async () => ({
        race_id: 5,
        run_id: 1,
        series_id: 1,
        track_id: 2,
        track_name: "Test",
        track_length: 2,
        lap_number: 100,
        elapsed_time: 1,
        laps_in_race: 200,
        laps_to_go: 100,
        run_name: "Race",
        run_type: 3,
        flag_state: 1,
        number_of_caution_segments: 0,
        number_of_lead_changes: 0,
        number_of_leaders: 1,
        avg_diff_1to3: 0,
        stage: { stage_num: 2, finish_at_lap: 100, laps_in_stage: 50 },
        vehicles: [],
      }),
    });
    const schedule = await adapter.getSchedule!(
      new Date("2026-08-04T00:00:00Z"),
      new Date("2026-08-05T23:59:59Z"),
    );
    expect(schedule[0]).toMatchObject({ id: "nascar_race_5", homeTeamId: null, seriesId: "1" });
    expect(await adapter.getLiveState!("nascar_race_5")).toMatchObject({
      status: "in_progress",
      period: "Stage 2",
      phase: { kind: "stage", number: 2, label: "Stage 2" },
      progress: { current: 100, total: 200, remaining: 100, unit: "lap" },
    });
  });

  it("registers exactly one adapter for each supported sport", () => {
    const registry = createDefaultSportsAdapterRegistry();
    expect(registry.list()).toEqual(["mlb", "nascar", "nhl"]);
  });
});