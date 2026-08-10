import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const surfaceSource = readFileSync(new URL("./surface.ts", import.meta.url), "utf8");

describe("market movers candidate window", () => {
  it("bounds change-sorted categories to the requested result limit", () => {
    expect(surfaceSource).toContain(
      'category === "gainers" || category === "decliners" || category === "watchlist"',
    );
    expect(surfaceSource).toMatch(/\? limit\s*:\s*100/);
  });

  it("keeps volume and most-traded on the broad candidate window", () => {
    expect(surfaceSource).toContain(
      'category === "volume" || category === "most_traded" ? "volume" : "change"',
    );
    expect(surfaceSource).toContain(": 100;");
  });
});
