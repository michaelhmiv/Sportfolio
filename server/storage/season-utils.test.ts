import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentCompetitiveSeasons } from "./season-utils";

describe("getCurrentCompetitiveSeasons", () => {
  afterEach(() => vi.useRealTimers());

  it("returns official-format compact NHL season IDs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));
    expect(getCurrentCompetitiveSeasons("NHL")).toEqual(["20252026", "20242025"]);
  });
});
