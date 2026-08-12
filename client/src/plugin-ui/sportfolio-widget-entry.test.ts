// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  snapshot: { toolOutput: undefined as unknown },
  handler: null as ((message: Record<string, unknown>) => void) | null,
  loads: [] as string[],
}));

vi.mock("./openai-host", () => ({
  asRecord(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  },
  getHostSnapshot: () => state.snapshot,
  initializeMcpApp: vi.fn(async () => undefined),
  subscribeHostMessages: (handler: (message: Record<string, unknown>) => void) => {
    state.handler = handler;
    return () => {
      state.handler = null;
    };
  },
}));

vi.mock("./sportfolio-action-widget", () => {
  state.loads.push("action");
  return {};
});
vi.mock("./sportfolio-sports-widget", () => {
  state.loads.push("sports");
  return {};
});
vi.mock("./sportfolio-market-portfolio-widget", () => {
  state.loads.push("market-portfolio");
  return {};
});
vi.mock("./sportfolio-gameplay-widget", () => {
  state.loads.push("gameplay");
  return {};
});
vi.mock("./sportfolio-overview-widget", () => {
  state.loads.push("overview");
  return {};
});
vi.mock("./sportfolio-widget-v2", () => {
  state.loads.push("legacy");
  return {};
});

beforeEach(() => {
  vi.resetModules();
  state.snapshot = { toolOutput: undefined };
  state.handler = null;
  state.loads.length = 0;
  document.body.innerHTML = '<div id="root"></div>';
});

describe("Sportfolio widget entry routing", () => {
  it("waits for ui/notifications/tool-result instead of locking into the generic widget", async () => {
    await import("./sportfolio-widget-entry");
    expect(state.loads).toEqual([]);
    expect(document.getElementById("root")?.textContent).toContain("Loading Sportfolio");

    state.snapshot.toolOutput = {
      structuredContent: {
        view: "scouting",
        asOf: "2026-08-11T20:00:00.000Z",
        data: { assignments: [] },
        warnings: [],
      },
    };
    state.handler?.({ method: "ui/notifications/tool-result", params: state.snapshot.toolOutput });

    await vi.waitFor(() => expect(state.loads).toEqual(["gameplay"]));
  });

  it("maps every current presentation view to its owning React surface", async () => {
    const { surfaceForView } = await import("./sportfolio-widget-entry");
    expect(surfaceForView("action_review")).toBe("action");
    for (const view of ["score_slate", "live_event", "game_insights"]) {
      expect(surfaceForView(view)).toBe("sports");
    }
    for (const view of ["player_market", "portfolio"]) {
      expect(surfaceForView(view)).toBe("market-portfolio");
    }
    for (const view of ["scouting", "boosts", "watchlist"]) {
      expect(surfaceForView(view)).toBe("gameplay");
    }
    for (const view of ["dashboard", "collections", "rankings"]) {
      expect(surfaceForView(view)).toBe("overview");
    }
    for (const view of ["trade_preview", "market_movers", "liquidity"]) {
      expect(surfaceForView(view)).toBe("legacy");
    }
  });

  it("extracts a view from the standard MCP structuredContent envelope", async () => {
    const { viewFromToolOutput } = await import("./sportfolio-widget-entry");
    expect(
      viewFromToolOutput({
        structuredContent: { view: "dashboard", data: {} },
      }),
    ).toBe("dashboard");
  });
});
