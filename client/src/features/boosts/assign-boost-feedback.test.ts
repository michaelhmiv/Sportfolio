import { describe, expect, it } from "vitest";

import { getBoostDisplayPlayerName, resolveAssignBoostFeedback } from "./assign-boost-feedback";

describe("getBoostDisplayPlayerName", () => {
  it("joins available name parts without rendering undefined", () => {
    expect(getBoostDisplayPlayerName({ firstName: "Stephen", lastName: "Curry" })).toBe(
      "Stephen Curry",
    );
    expect(getBoostDisplayPlayerName({ lastName: "Curry" })).toBe("Curry");
    expect(getBoostDisplayPlayerName({ firstName: "Stephen" })).toBe("Stephen");
    expect(getBoostDisplayPlayerName({})).toBe("Selected player");
  });
});

describe("resolveAssignBoostFeedback", () => {
  it("prefers the assigned player returned by the API", () => {
    expect(
      resolveAssignBoostFeedback({
        slotTier: 5,
        response: {
          boost: {
            player: { firstName: "Stephen", lastName: "Curry", team: "GSW" },
            shareMultiplier: "3.00",
          },
        },
        eligiblePlayer: {
          player: { lastName: "Fallback", team: "OLD" },
          communityBoostCount: 1,
          bestShareMultiplier: 2,
        },
      }),
    ).toEqual({
      playerName: "Stephen Curry",
      playerTeam: "GSW",
      shareMultiplier: 3,
      totalMultiplier: 6,
    });
  });

  it("falls back safely when player names are incomplete", () => {
    expect(
      resolveAssignBoostFeedback({
        slotTier: 3,
        response: {
          boost: {
            player: { firstName: null, lastName: null, team: null },
            shareMultiplier: null,
          },
        },
        eligiblePlayer: {
          player: { firstName: null, lastName: "Curry", team: "GSW" },
          communityBoostCount: 0,
          bestShareMultiplier: 2,
        },
      }),
    ).toEqual({
      playerName: "Curry",
      playerTeam: "GSW",
      shareMultiplier: 2,
      totalMultiplier: 3,
    });
  });

  it("uses a safe generic label only when no player source has a usable name", () => {
    expect(
      resolveAssignBoostFeedback({
        slotTier: 2,
        response: {
          boost: {
            player: { firstName: null, lastName: null, team: null },
            shareMultiplier: null,
          },
        },
        eligiblePlayer: {
          player: { firstName: null, lastName: null, team: null },
          communityBoostCount: 0,
          bestShareMultiplier: 1,
        },
      }),
    ).toEqual({
      playerName: "Selected player",
      playerTeam: "",
      shareMultiplier: 1,
      totalMultiplier: 2,
    });
  });
});
