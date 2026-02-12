import { choosePreferredDailyGame } from "./daily-game-dedupe";

describe("choosePreferredDailyGame", () => {
  it("prefers canonical (non-18447) NBA gameIds over legacy MySportsFeeds ids", () => {
    const legacy = {
      gameId: "184471234",
      sport: "NBA",
      status: "completed",
      homeScore: 100,
      awayScore: 90,
      lastFetchedAt: new Date("2026-02-11T10:00:00.000Z"),
    };

    const canonical = {
      gameId: "123456",
      sport: "NBA",
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      lastFetchedAt: new Date("2026-02-11T00:00:00.000Z"),
    };

    expect(choosePreferredDailyGame(legacy, canonical)).toEqual(canonical);
    expect(choosePreferredDailyGame(canonical, legacy)).toEqual(canonical);
  });

  it("prefers completed status when both candidates are canonical", () => {
    const scheduled = {
      gameId: "123456",
      sport: "NBA",
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      lastFetchedAt: new Date("2026-02-11T00:00:00.000Z"),
    };

    const completed = {
      gameId: "123457",
      sport: "NBA",
      status: "completed",
      homeScore: 110,
      awayScore: 108,
      lastFetchedAt: new Date("2026-02-11T10:00:00.000Z"),
    };

    expect(choosePreferredDailyGame(scheduled, completed)).toEqual(completed);
  });
});
