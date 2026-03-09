import { describe, expect, it } from "vitest";

import { getUserActivitySourceFetchWindow } from "./activity-feed";

describe("getUserActivitySourceFetchWindow", () => {
  it("does not cap deep offsets", () => {
    expect(getUserActivitySourceFetchWindow(40, 0)).toBe(80);
    expect(getUserActivitySourceFetchWindow(40, 300)).toBe(364);
  });
});
