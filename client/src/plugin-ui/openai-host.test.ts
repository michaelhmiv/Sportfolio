// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  delete (window as Window & { openai?: unknown }).openai;
});

describe("Sportfolio MCP Apps host bridge", () => {
  it("caches a delayed tool result for widgets imported after the notification", async () => {
    const host = await import("./openai-host");
    const handler = vi.fn();
    const unsubscribe = host.subscribeHostMessages(handler);
    const result = {
      structuredContent: {
        view: "scouting",
        asOf: "2026-08-11T20:00:00.000Z",
        data: { assignments: [{ playerId: "mlb_1", displayName: "Test Player" }] },
        warnings: [],
      },
    };

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: result,
        },
      }),
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(host.getHostSnapshot().toolOutput).toEqual(result);
    unsubscribe();
  });

  it("prefers fresh bridge results over an older window.openai compatibility snapshot", async () => {
    (window as Window & { openai?: unknown }).openai = {
      toolOutput: { structuredContent: { view: "portfolio", data: { stale: true } } },
    };
    const host = await import("./openai-host");
    const unsubscribe = host.subscribeHostMessages(() => undefined);
    const fresh = { structuredContent: { view: "dashboard", data: { fresh: true } } };

    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: fresh,
        },
      }),
    );

    expect(host.getHostSnapshot().toolOutput).toEqual(fresh);
    unsubscribe();
  });

  it("persists local widget state into the cached snapshot", async () => {
    const host = await import("./openai-host");
    host.persistWidgetState({ range: "7D", selectedPlayerId: "mlb_1" });
    expect(host.getHostSnapshot().widgetState).toEqual({
      range: "7D",
      selectedPlayerId: "mlb_1",
    });
  });
});
