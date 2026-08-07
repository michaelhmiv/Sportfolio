import { describe, expect, it } from "vitest";
import { nflverseGameWeekCandidates } from "./sync-nflverse-stats";

describe("nflverse postseason week reconciliation", () => {
  it("keeps regular-season weeks unchanged", () => {
    expect(nflverseGameWeekCandidates("regular", 12)).toEqual([12]);
  });

  it("maps nflverse continuation playoff weeks to ESPN postseason rounds", () => {
    expect(nflverseGameWeekCandidates("postseason", 19)).toEqual([19, 1]);
    expect(nflverseGameWeekCandidates("postseason", 20)).toEqual([20, 2]);
    expect(nflverseGameWeekCandidates("postseason", 21)).toEqual([21, 3]);
    expect(nflverseGameWeekCandidates("postseason", 22)).toEqual([22, 5, 4]);
  });
});
