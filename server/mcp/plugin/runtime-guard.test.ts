import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PluginDeadlineError,
  getPluginRuntimeState,
  resetPluginRuntimeStateForTests,
  withPluginDeadline,
} from "./runtime-guard";

afterEach(() => {
  resetPluginRuntimeStateForTests();
  vi.useRealTimers();
  delete process.env.PLUGIN_MCP_MAX_CONCURRENT_REQUESTS;
  delete process.env.PLUGIN_MCP_TOOL_TIMEOUT_MS;
});

describe("plugin runtime guard", () => {
  it("returns completed tool operations before the deadline", async () => {
    await expect(withPluginDeadline(Promise.resolve("ok"), 50)).resolves.toBe("ok");
  });

  it("rejects operations that exceed the deadline", async () => {
    vi.useFakeTimers();
    const pending = withPluginDeadline(new Promise<string>(() => undefined), 100);
    const assertion = expect(pending).rejects.toBeInstanceOf(PluginDeadlineError);
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
  });

  it("uses bounded defaults and environment overrides", () => {
    process.env.PLUGIN_MCP_MAX_CONCURRENT_REQUESTS = "7";
    process.env.PLUGIN_MCP_TOOL_TIMEOUT_MS = "9000";
    expect(getPluginRuntimeState()).toMatchObject({
      activeRequests: 0,
      rateLimitBuckets: 0,
      maxConcurrentRequests: 7,
      toolTimeoutMs: 9000,
    });
  });
});
