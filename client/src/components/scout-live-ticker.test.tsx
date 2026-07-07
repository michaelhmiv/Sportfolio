import { describe, expect, it, vi } from "vitest";
import { getMsUntilNextShareTick } from "./scout-live-share-popup-host";
import { getInitialHourProgress } from "./scout-live-ticker";

describe("getInitialHourProgress", () => {
  it("seeds the ticker from elapsed time within the hour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T00:15:00.000Z"));

    expect(getInitialHourProgress(60)).toBe(15);
    expect(getInitialHourProgress(24)).toBe(6);

    vi.useRealTimers();
  });
});

describe("getMsUntilNextShareTick", () => {
  it("aligns popup ticks to :00, :15, :30, and :45 boundaries", () => {
    expect(getMsUntilNextShareTick(new Date("2026-07-07T00:00:00.000Z"))).toBe(15000);
    expect(getMsUntilNextShareTick(new Date("2026-07-07T00:00:14.900Z"))).toBe(100);
    expect(getMsUntilNextShareTick(new Date("2026-07-07T00:00:15.001Z"))).toBe(14999);
    expect(getMsUntilNextShareTick(new Date("2026-07-07T00:00:44.500Z"))).toBe(500);
    expect(getMsUntilNextShareTick(new Date("2026-07-07T00:00:59.000Z"))).toBe(1000);
  });
});
