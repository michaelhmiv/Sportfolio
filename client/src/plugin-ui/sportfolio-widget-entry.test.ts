// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  vi.useFakeTimers();
  vi.resetModules();
  state.snapshot = { toolOutput: undefined };
  state.handler = null;
  state.loads.length = 0;
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Sportfolio widget entry routing", () => {
  it("waits for a delayed tool result and clears the hydration fallback", async () => {
    const module = await import("./sportfolio-widget-entry");
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

    await vi.runAllTicks();
    await Promise.resolve();
    expect(state.loads).toEqual(["gameplay"]);

    await vi.advanceTimersByTimeAsync(module.WIDGET_HYDRATION_TIMEOUT_MS + 1);
    expect(document.getElementById("root")?.getAttribute("role")).not.toBe("alert");
  });

  it("terminates loading when no presentation payload arrives", async () => {
    const module = await import("./sportfolio-widget-entry");

    await vi.advanceTimersByTimeAsync(module.WIDGET_HYDRATION_TIMEOUT_MS + 1);

    const root = document.getElementById("root");
    expect(root?.getAttribute("role")).toBe("alert");
    expect(root?.textContent).toContain("did not receive the data needed");
    expect(state.loads).toEqual([]);
  });

  it("terminates loading for malformed or raw stage output instead of spinning forever", async () => {
    state.snapshot.toolOutput = {
      structuredContent: {
        transactionId: "00000000-0000-4000-8000-000000000001",
        status: "pending_confirmation",
      },
    };
    const module = await import("./sportfolio-widget-entry");

    await vi.advanceTimersByTimeAsync(module.WIDGET_HYDRATION_TIMEOUT_MS + 1);

    const root = document.getElementById("root");
    expect(root?.getAttribute("role")).toBe("alert");
    expect(root?.textContent).toContain("cannot be displayed here");
    expect(state.loads).toEqual([]);
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
