import { describe, expect, it } from "vitest";

import {
  getEffectiveGameStatus,
  getMarketplaceGameStatus,
  hasGameStartedForBoost,
} from "./game-status";

describe("game status helpers", () => {
  const now = new Date("2026-03-10T20:00:00.000Z");

  it("keeps scheduled games upcoming without live evidence even after scheduled start", () => {
    const game = {
      status: "scheduled",
      startTime: "2026-03-10T19:30:00.000Z",
      homeScore: null,
      awayScore: null,
      liveMarketStatus: null,
    };

    expect(getEffectiveGameStatus(game, now)).toBe("scheduled");
    expect(getMarketplaceGameStatus(game, now)).toBe("upcoming");
    expect(hasGameStartedForBoost(game, now)).toBe(false);
  });

  it("treats scheduled games with live evidence as in progress", () => {
    const game = {
      status: "scheduled",
      startTime: "2026-03-10T19:30:00.000Z",
      homeScore: 10,
      awayScore: 8,
      liveMarketStatus: null,
    };

    expect(getEffectiveGameStatus(game, now)).toBe("inprogress");
    expect(getMarketplaceGameStatus(game, now)).toBe("live");
    expect(hasGameStartedForBoost(game, now)).toBe(true);
  });

  it("accepts live provider labels as live evidence even before scores arrive", () => {
    const game = {
      status: "scheduled",
      startTime: "2026-03-10T19:30:00.000Z",
      homeScore: null,
      awayScore: null,
      liveMarketStatus: "Q1 10:24",
    };

    expect(getEffectiveGameStatus(game, now)).toBe("inprogress");
    expect(getMarketplaceGameStatus(game, now)).toBe("live");
    expect(hasGameStartedForBoost(game, now)).toBe(true);
  });

  it("falls back stale scheduled games to completed", () => {
    const game = {
      status: "scheduled",
      startTime: "2026-03-10T15:00:00.000Z",
      homeScore: null,
      awayScore: null,
      liveMarketStatus: null,
    };

    expect(getEffectiveGameStatus(game, now)).toBe("completed");
    expect(getMarketplaceGameStatus(game, now)).toBe("ended");
    expect(hasGameStartedForBoost(game, now)).toBe(true);
  });

  it("maps postponed-like states out of the marketplace slate", () => {
    const game = {
      status: "postponed",
      startTime: "2026-03-10T19:30:00.000Z",
      homeScore: null,
      awayScore: null,
      liveMarketStatus: null,
    };

    expect(getEffectiveGameStatus(game, now)).toBe("postponed");
    expect(getMarketplaceGameStatus(game, now)).toBe("none");
    expect(hasGameStartedForBoost(game, now)).toBe(false);
  });
});
