import { describe, expect, it } from "vitest";
import { formatSportfolioBucks } from "./virtual-currency";

describe("Sportfolio virtual currency formatting", () => {
  it("renders canonical SB units instead of real-world or stale currency labels", () => {
    const value = formatSportfolioBucks(691947.95, "en-US");
    expect(value).toBe("691,947.95 SB");
    expect(value).not.toMatch(/\$|USD|RAX/);
  });
});
