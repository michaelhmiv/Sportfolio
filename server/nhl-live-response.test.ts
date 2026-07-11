import { describe, expect, it } from "vitest";
import { buildNhlLiveResponse } from "./nhl-live-response";

describe("buildNhlLiveResponse", () => {
  it("uses game-stat homeAway rather than current roster team after a trade", () => {
    const response = buildNhlLiveResponse({
      gameId: "nhl_1", status: "completed", homeTeam: "BOS", awayTeam: "NYR", homeScore: 4, awayScore: 2,
    }, [{
      playerId: "nhl_7", homeAway: "away", fantasyPoints: "12.5", statsJson: { position: "C", goals: 1, liveState: { period: 3, clock: "00:00", periodType: "REG" } },
    }], new Map([["nhl_7", { id: "nhl_7", firstName: "Traded", lastName: "Player", team: "BOS" }]]));

    expect(response.awayPlayers).toEqual([expect.objectContaining({ playerId: "nhl_7", team: "NYR", name: "Traded Player" })]);
    expect(response.homePlayers).toEqual([]);
    expect(response.period).toBe(3);
  });

  it("returns null live fields safely when persisted state is absent", () => {
    const response = buildNhlLiveResponse({ gameId: "nhl_1", status: "scheduled", homeTeam: "BOS", awayTeam: "NYR", homeScore: null, awayScore: null }, [], new Map());
    expect(response).toMatchObject({ period: null, periodType: null, clock: null, homeScore: null, awayScore: null });
  });
});
