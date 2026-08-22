// @vitest-environment jsdom
import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  snapshot: {
    toolInput: {} as unknown,
    toolOutput: undefined as unknown,
  },
  handler: null as ((message: Record<string, unknown>) => void) | null,
  callTool: vi.fn(),
}));

vi.mock("./openai-host", () => ({
  asRecord(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  },
  callTool: state.callTool,
  getHostSnapshot: () => state.snapshot,
  initializeMcpApp: vi.fn(async () => undefined),
  notifyIntrinsicHeight: vi.fn(),
  subscribeHostMessages: (handler: (message: Record<string, unknown>) => void) => {
    state.handler = handler;
    return () => {
      state.handler = null;
    };
  },
}));

vi.mock("./action-review-panel", () => ({
  ACTION_REVIEW_CSS: "",
  ActionReviewPanel: ({ review }: { review: Record<string, unknown> }) => (
    <div data-testid="review">{String(review.transactionId || review.status || "review")}</div>
  ),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  state.snapshot = { toolInput: {}, toolOutput: undefined };
  state.handler = null;
  state.callTool.mockReset();
  document.body.innerHTML = '<div id="root"></div>';
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0),
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: (id: number) => window.clearTimeout(id),
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Sportfolio action widget recovery", () => {
  it("uses the exact server-issued transaction id from raw staged output", async () => {
    const transactionId = "00000000-0000-4000-8000-000000000001";
    state.snapshot.toolOutput = {
      structuredContent: {
        transactionId,
        status: "pending_confirmation",
      },
    };
    state.callTool.mockResolvedValue({
      structuredContent: {
        view: "action_review",
        asOf: "2026-08-12T12:00:00.000Z",
        data: { transactionId, status: "pending_confirmation" },
      },
    });

    let module: typeof import("./sportfolio-action-widget");
    await act(async () => {
      module = await import("./sportfolio-action-widget");
      await Promise.resolve();
    });

    expect(module!.transactionIdFromSnapshot()).toBe(transactionId);
    expect(state.callTool).toHaveBeenCalledWith("render_action_review", { transactionId });
    expect(document.getElementById("root")?.textContent).toContain(transactionId);
  });

  it("renders an alert when render_action_review rejects without leaking the raw exception", async () => {
    state.snapshot.toolInput = {
      transactionId: "00000000-0000-4000-8000-000000000002",
    };
    state.callTool.mockRejectedValue(new Error("database password and internal stack"));

    await act(async () => {
      await import("./sportfolio-action-widget");
      await Promise.resolve();
    });

    const root = document.getElementById("root");
    expect(root?.querySelector('[role="alert"]')).not.toBeNull();
    expect(root?.textContent).toContain("could not be loaded");
    expect(root?.textContent).not.toContain("database password");
  });

  it("renders an alert when recovery never settles instead of loading forever", async () => {
    state.snapshot.toolInput = {
      transactionId: "00000000-0000-4000-8000-000000000003",
    };
    state.callTool.mockReturnValue(new Promise(() => undefined));

    let module: typeof import("./sportfolio-action-widget");
    await act(async () => {
      module = await import("./sportfolio-action-widget");
      await Promise.resolve();
    });
    expect(document.getElementById("root")?.querySelector('[role="status"]')).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(module!.ACTION_REVIEW_RECOVERY_TIMEOUT_MS + 1);
    });

    const root = document.getElementById("root");
    expect(root?.querySelector('[role="alert"]')).not.toBeNull();
    expect(root?.querySelector('[role="status"]')).toBeNull();
    expect(root?.textContent).toContain("could not be loaded");
  });

  it("renders a canonical action_review payload without recovery", async () => {
    const transactionId = "00000000-0000-4000-8000-000000000004";
    state.snapshot.toolOutput = {
      structuredContent: {
        view: "action_review",
        asOf: "2026-08-12T12:00:00.000Z",
        data: { transactionId, status: "cancelled", confirmationRequired: false },
      },
    };

    await act(async () => {
      await import("./sportfolio-action-widget");
      await Promise.resolve();
    });

    expect(state.callTool).not.toHaveBeenCalled();
    expect(document.getElementById("root")?.textContent).toContain(transactionId);
  });
});
