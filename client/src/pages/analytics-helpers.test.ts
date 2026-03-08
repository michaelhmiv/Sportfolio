import { describe, expect, it } from "vitest";
import {
  buildCompareRadarData,
  filterCorrelationsBySport,
  getCorrelationPairKey,
  type CorrelationPair,
} from "@/pages/analytics-helpers";

describe("analytics helpers", () => {
  it("normalizes compare radar values against the largest player in each metric", () => {
    const radarData = buildCompareRadarData([
      {
        id: "a",
        price: 10,
        shares: 100,
        marketCap: 1000,
        ammVolume: 400,
        poolLiquidity: 800,
        boostUsagePercent: 25,
      },
      {
        id: "b",
        price: 20,
        shares: 50,
        marketCap: 500,
        ammVolume: 200,
        poolLiquidity: 400,
        boostUsagePercent: 50,
      },
    ]);

    expect(radarData.find((datum) => datum.key === "price")).toMatchObject({
      a: 50,
      b: 100,
      fullMark: 100,
    });
    expect(radarData.find((datum) => datum.key === "shares")).toMatchObject({
      a: 100,
      b: 50,
      fullMark: 100,
    });
    expect(radarData.find((datum) => datum.key === "boostUsagePercent")).toMatchObject({
      a: 50,
      b: 100,
      fullMark: 100,
    });
  });

  it("filters correlation pairs to the selected sport", () => {
    const pairs: CorrelationPair[] = [
      {
        player1: "A One",
        player1Id: "a",
        player2: "B Two",
        player2Id: "b",
        correlation: 0.82,
      },
      {
        player1: "C Three",
        player1Id: "c",
        player2: "D Four",
        player2Id: "d",
        correlation: 0.71,
      },
    ];
    const playerById = {
      a: { sport: "NBA" },
      b: { sport: "NBA" },
      c: { sport: "NFL" },
      d: { sport: "NFL" },
    };

    expect(filterCorrelationsBySport(pairs, playerById, "ALL")).toHaveLength(2);
    expect(filterCorrelationsBySport(pairs, playerById, "NBA")).toEqual([pairs[0]]);
    expect(filterCorrelationsBySport(pairs, playerById, "NFL")).toEqual([pairs[1]]);
  });

  it("builds stable correlation keys regardless of pair order", () => {
    expect(
      getCorrelationPairKey({
        player1Id: "player-b",
        player2Id: "player-a",
      }),
    ).toBe("player-a:player-b");
  });
});
