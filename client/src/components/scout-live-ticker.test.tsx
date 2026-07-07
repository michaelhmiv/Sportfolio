import { describe, expect, it, vi } from "vitest";
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
