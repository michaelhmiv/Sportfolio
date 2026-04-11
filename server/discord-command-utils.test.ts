import { describe, expect, it } from "vitest";
import {
  normalizeDiscordSport,
  normalizePortfolioView,
  parseAmountInput,
  resolveAmountInput,
} from "./discord-command-utils";

describe("discord-command-utils", () => {
  it("normalizes supported sport filters", () => {
    expect(normalizeDiscordSport("mlb")).toBe("MLB");
    expect(normalizeDiscordSport(undefined)).toBe("ALL");
    expect(normalizeDiscordSport("invalid")).toBeNull();
  });

  it("normalizes portfolio view filters", () => {
    expect(normalizePortfolioView("stacked")).toBe("stacked");
    expect(normalizePortfolioView("REGULAR")).toBe("regular");
    expect(normalizePortfolioView(undefined)).toBe("all");
    expect(normalizePortfolioView("unknown")).toBeNull();
  });

  it("parses absolute, percent, and max amount inputs", () => {
    expect(parseAmountInput("25")?.kind).toBe("absolute");
    expect(parseAmountInput("50%")?.kind).toBe("percent");
    expect(parseAmountInput("max")?.kind).toBe("max");
  });

  it("rejects invalid amount inputs", () => {
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput("0")).toBeNull();
    expect(parseAmountInput("-2")).toBeNull();
    expect(parseAmountInput("120%")).toBeNull();
    expect(parseAmountInput("abc")).toBeNull();
  });

  it("resolves currency amounts with floor-to-cents behavior", () => {
    expect(
      resolveAmountInput({
        rawInput: "50%",
        baseAmount: 123.45,
        kind: "currency",
        minimum: 0.01,
      }),
    ).toMatchObject({
      kind: "percent",
      value: 61.72,
      derivedFromBase: true,
    });
  });

  it("resolves whole-share amounts with floor behavior", () => {
    expect(
      resolveAmountInput({
        rawInput: "50%",
        baseAmount: 11,
        kind: "whole",
        minimum: 1,
      }),
    ).toMatchObject({
      kind: "percent",
      value: 5,
      derivedFromBase: true,
    });
  });

  it("resolves even-share amounts with even floor behavior", () => {
    expect(
      resolveAmountInput({
        rawInput: "50%",
        baseAmount: 11,
        kind: "evenWhole",
        minimum: 4,
      }),
    ).toMatchObject({
      kind: "percent",
      value: 4,
      derivedFromBase: true,
    });
  });

  it("returns null when resolved values fall below minimums", () => {
    expect(
      resolveAmountInput({
        rawInput: "1%",
        baseAmount: 1,
        kind: "currency",
        minimum: 0.02,
      }),
    ).toBeNull();
    expect(
      resolveAmountInput({
        rawInput: "10%",
        baseAmount: 12,
        kind: "whole",
        minimum: 2,
      }),
    ).toBeNull();
    expect(
      resolveAmountInput({
        rawInput: "20%",
        baseAmount: 10,
        kind: "evenWhole",
        minimum: 4,
      }),
    ).toBeNull();
  });
});
