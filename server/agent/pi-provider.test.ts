import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getModelsMock = vi.fn((provider: string) => {
  if (provider === "minimax") {
    return [
      {
        id: "MiniMax-M2.7",
        name: "MiniMax-M2.7",
        api: "openai-completions",
        provider: "minimax",
        baseUrl: "https://api.minimax.io/v1",
        reasoning: true,
        input: ["text"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 204800,
        maxTokens: 131072,
      },
    ];
  }

  return [];
});
const getActiveManagedProviderSelectionMock = vi.fn();

vi.mock("@mariozechner/pi-ai", () => ({
  complete: vi.fn(),
  getModels: getModelsMock,
}));

vi.mock("./system-settings", () => ({
  getActiveManagedProviderSelection: getActiveManagedProviderSelectionMock,
}));

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MINIMAX_API_KEY;
  delete process.env.MINIMAX_DEFAULT_MODEL;
}

beforeEach(() => {
  resetEnv();
  getModelsMock.mockClear();
  getActiveManagedProviderSelectionMock.mockReset();
  vi.resetModules();
});

afterEach(() => {
  resetEnv();
});

describe("pi-provider", () => {
  it("normalizes BYOK base URLs when resolving the runtime", async () => {
    const { resolveOpenAICompatiblePiRuntime } = await import("./pi-provider");
    const runtime = resolveOpenAICompatiblePiRuntime({
      apiKey: "test-key",
      baseUrl: "https://example.com/v1/chat/completions",
      model: "custom-model",
    });

    expect(runtime.model.baseUrl).toBe("https://example.com/v1");
    expect(runtime.apiKey).toBe("test-key");
  });

  it("uses openai-compatible transport with minimax-specific payload defaults", async () => {
    process.env.MINIMAX_API_KEY = "test-minimax";
    process.env.MINIMAX_DEFAULT_MODEL = "MiniMax-M2.7";
    getActiveManagedProviderSelectionMock.mockResolvedValue({
      provider: "minimax",
      modelOverride: null,
    });

    const { resolveManagedPiRuntime } = await import("./pi-provider");
    const runtime = await resolveManagedPiRuntime({
      model: "MiniMax-M2.7",
    });

    expect(runtime.model.provider).toBe("minimax");
    expect(runtime.model.api).toBe("openai-completions");
    expect(runtime.apiKey).toBe("test-minimax");
    expect(runtime.headers).toBeUndefined();
    expect(runtime.model.baseUrl).toBe("https://api.minimax.io/v1");
    expect(runtime.model.compat).toEqual({
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      maxTokensField: "max_tokens",
      supportsStrictMode: false,
    });

    const payload: Record<string, unknown> = {};
    runtime.onPayload?.(payload);

    expect(payload).toEqual({
      reasoning_split: true,
    });
  });
});
