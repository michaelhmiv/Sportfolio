import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeSimple: vi.fn(),
  resolveManagedPiRuntime: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai", () => ({
  completeSimple: mocks.completeSimple,
}));

vi.mock("./agent/pi-provider", () => ({
  resolveManagedPiRuntime: mocks.resolveManagedPiRuntime,
}));

import { answerDocsQuestion } from "./docs-qa";

describe("docs-qa", () => {
  beforeEach(() => {
    mocks.completeSimple.mockReset();
    mocks.resolveManagedPiRuntime.mockReset();
  });

  it("falls back to handbook extracts when the managed runtime is unavailable", async () => {
    mocks.resolveManagedPiRuntime.mockRejectedValue(new Error("not configured"));

    const result = await answerDocsQuestion("how do i access the cli");

    expect(result.fallbackUsed).toBe(true);
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.answer.toLowerCase()).toContain("api token");
  });

  it("states the missing public MCP surface clearly in fallback mode", async () => {
    mocks.resolveManagedPiRuntime.mockRejectedValue(new Error("not configured"));

    const result = await answerDocsQuestion("how do i access the sportfolio mcp protocol");

    expect(result.fallbackUsed).toBe(true);
    expect(result.answer.toLowerCase()).toContain("does not document a repo-tracked mcp");
    expect(result.answer).toContain("/agent");
  });

  it("returns a model answer when the managed runtime succeeds", async () => {
    mocks.resolveManagedPiRuntime.mockResolvedValue({
      apiKey: "test-key",
      model: { id: "test-model" },
    });
    mocks.completeSimple.mockResolvedValue({
      content: [
        {
          type: "text",
          text: "Use the CLI with a profile API token, and treat MCP as undocumented until the tracked repo exposes it.",
        },
      ],
    });

    const result = await answerDocsQuestion("how do i access sportfolio from a terminal");

    expect(result.fallbackUsed).toBe(false);
    expect(result.answer).toContain("CLI");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(mocks.completeSimple).toHaveBeenCalledTimes(1);
  });
});
