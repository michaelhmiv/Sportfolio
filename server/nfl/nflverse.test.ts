import { describe, expect, it } from "vitest";
import { parseCsv, nflverseNumber, nflverseSeasonType } from "./nflverse";
import {
  buildNflIdentityMaps,
  createNflEspnAlias,
  createNflPlayerId,
  normalizeNflTeamAbbreviation,
} from "./identity";

describe("nflverse parsing and identities", () => {
  it("parses RFC4180 quoted commas, quotes, and newlines", () => {
    const rows = parseCsv(
      'gsis_id,display_name,note\r\n00-1,"Doe, John","said ""hello""\nand left"\r\n00-2,Jane Roe,plain\r\n',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      gsis_id: "00-1",
      display_name: "Doe, John",
      note: 'said "hello"\nand left',
    });
  });

  it("builds stable GSIS canonical ids and ESPN aliases", () => {
    expect(createNflPlayerId("00-0033873")).toBe("nfl_00-0033873");
    expect(createNflEspnAlias("3139477")).toBe("nfl_espn_3139477");
    const player = {
      gsisId: "00-0033873",
      espnId: "3139477",
      displayName: "Example Player",
      position: "QB",
      team: "KC",
      active: true,
    };
    const maps = buildNflIdentityMaps([player]);
    expect(maps.byEspnId.get("3139477")?.gsisId).toBe("00-0033873");
    expect(maps.byGsisId.get("00-0033873")?.espnId).toBe("3139477");
  });

  it("normalizes provider team aliases", () => {
    expect(normalizeNflTeamAbbreviation("WAS")).toBe("WSH");
    expect(normalizeNflTeamAbbreviation("LA")).toBe("LAR");
    expect(normalizeNflTeamAbbreviation("KC")).toBe("KC");
  });

  it("normalizes season types and numeric columns", () => {
    expect(nflverseSeasonType({ season_type: "REG" })).toBe("regular");
    expect(nflverseSeasonType({ season_type: "POST" })).toBe("postseason");
    expect(nflverseNumber({ passing_yards: "312.5" }, "passing_yards")).toBe(312.5);
  });
});
