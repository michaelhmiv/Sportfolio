import { describe, expect, it } from "vitest";
import {
  BOOST_SLOT_MULTIPLIERS,
  POSTSEASON_TARGET_SB,
  REGULAR_SEASON_TARGET_SB,
  resolveEconomyClass,
  resolveEconomySeasonPhase,
} from "./config";
import { calculateBaseSharePayout, calculateBoostPayout, calculateGameEarnings } from "./math";

describe("Economy V2 normalization", () => {
  it("maps a benchmark regular season to 10,000 SB", () => {
    const result = calculateGameEarnings({
      fantasyPoints: 250,
      eligibleSingles: 1000,
      economyClass: "NFL_WR",
      seasonPhase: "regular",
    });
    expect(result.seasonTargetSb).toBe(REGULAR_SEASON_TARGET_SB);
    expect(result.gameBasePoolSb).toBe(10_000);
    expect(result.gameEpsSb).toBe(10);
  });

  it("maps a benchmark postseason to a separate 10,000 SB earning season", () => {
    const result = calculateGameEarnings({
      fantasyPoints: 70,
      eligibleSingles: 1000,
      economyClass: "NFL_WR",
      seasonPhase: "postseason",
    });
    expect(result.seasonTargetSb).toBe(POSTSEASON_TARGET_SB);
    expect(result.gameBasePoolSb).toBe(10_000);
  });

  it("dilutes EPS without changing the player game pool", () => {
    const small = calculateGameEarnings({
      fantasyPoints: 20,
      eligibleSingles: 50,
      economyClass: "NFL_WR",
      seasonPhase: "regular",
    });
    const large = calculateGameEarnings({
      fantasyPoints: 20,
      eligibleSingles: 50_000,
      economyClass: "NFL_WR",
      seasonPhase: "regular",
    });
    expect(small.gameBasePoolSb).toBe(large.gameBasePoolSb);
    expect(small.gameEpsSb).toBe(large.gameEpsSb * 1000);
    expect(calculateBaseSharePayout(50, small.gameEpsSb)).toBeCloseTo(small.gameBasePoolSb);
    expect(calculateBaseSharePayout(50_000, large.gameEpsSb)).toBeCloseTo(large.gameBasePoolSb);
  });

  it("does not mint when no Singles are eligible", () => {
    const result = calculateGameEarnings({
      fantasyPoints: 100,
      eligibleSingles: 0,
      economyClass: "NASCAR_CUP",
      seasonPhase: "regular",
    });
    expect(result.gameBasePoolSb).toBe(0);
    expect(result.gameEpsSb).toBe(0);
  });

  it("floors negative performance and disables preseason payouts", () => {
    expect(
      calculateGameEarnings({
        fantasyPoints: -10,
        eligibleSingles: 100,
        economyClass: "MLB_HITTER",
        seasonPhase: "regular",
      }).gameBasePoolSb,
    ).toBe(0);
    expect(
      calculateGameEarnings({
        fantasyPoints: 100,
        eligibleSingles: 100,
        economyClass: "NFL_QB",
        seasonPhase: "preseason",
      }).gameBasePoolSb,
    ).toBe(0);
  });

  it("normalizes the same raw performance differently across class scales", () => {
    const mlb = calculateGameEarnings({
      fantasyPoints: 20,
      eligibleSingles: 100,
      economyClass: "MLB_HITTER",
      seasonPhase: "regular",
    });
    const nfl = calculateGameEarnings({
      fantasyPoints: 20,
      eligibleSingles: 100,
      economyClass: "NFL_WR",
      seasonPhase: "regular",
    });
    expect(nfl.gameBasePoolSb).toBeGreaterThan(mlb.gameBasePoolSb);
  });
});

describe("direct-share Boost math", () => {
  it("uses exactly the five approved slots", () => {
    expect(BOOST_SLOT_MULTIPLIERS).toEqual([2, 3, 5, 7, 10]);
  });

  it("credits only the incremental bonus above the ordinary 1x base component", () => {
    const payout = calculateBoostPayout({
      sharesBurned: 20,
      gameEpsSb: 0.5,
      effectiveMultiplier: 5,
    });
    expect(payout.baseComponentSb).toBe(10);
    expect(payout.boostBonusSb).toBe(40);
    expect(payout.totalEconomicEarningsSb).toBe(50);
  });
});

describe("class and phase resolution", () => {
  it("classifies supported sport/position groups", () => {
    expect(resolveEconomyClass({ sport: "MLB", position: "RF" })).toBe("MLB_HITTER");
    expect(resolveEconomyClass({ sport: "MLB", position: "SP" })).toBe("MLB_STARTING_PITCHER");
    expect(resolveEconomyClass({ sport: "MLB", position: "RP" })).toBe("MLB_RELIEVER");
    expect(resolveEconomyClass({ sport: "NFL", position: "QB" })).toBe("NFL_QB");
    expect(resolveEconomyClass({ sport: "NHL", position: "G" })).toBe("NHL_GOALIE");
    expect(resolveEconomyClass({ sport: "NASCAR", statsJson: { seriesId: 2 } })).toBe(
      "NASCAR_XFINITY",
    );
  });

  it("recognizes regular, postseason and preseason metadata", () => {
    expect(resolveEconomySeasonPhase({ seasonType: "regular" })).toBe("regular");
    expect(resolveEconomySeasonPhase({ seasonType: "postseason" })).toBe("postseason");
    expect(resolveEconomySeasonPhase({ statsSeason: "2026-playoffs" })).toBe("postseason");
    expect(resolveEconomySeasonPhase({ seasonType: "preseason" })).toBe("preseason");
  });
});
