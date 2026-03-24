import { afterEach, describe, expect, it } from "vitest";
import {
  getDefaultManagedProviderKey,
  getManagedProviderRuntimeConfig,
  getManagedProviderStatus,
  getManagedProviderStatuses,
  isManagedProviderKey,
} from "./provider-registry";

const ORIGINAL_ENV = { ...process.env };

function resetProviderEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.USER_AGENT_MANAGED_PROVIDER;
  delete process.env.MINIMAX_API_KEY;
  delete process.env.MINIMAX_BASE_URL;
  delete process.env.MINIMAX_DEFAULT_MODEL;
  delete process.env.MINIMAX_MODELS;
}

afterEach(() => {
  resetProviderEnv();
});

describe("provider-registry", () => {
  it("builds MiniMax-only managed provider metadata with M2.7 defaults", () => {
    process.env.MINIMAX_API_KEY = "test-minimax";
    process.env.MINIMAX_DEFAULT_MODEL = "MiniMax-M2.7";

    const minimax = getManagedProviderStatus("minimax");

    expect(minimax.label).toBe("MiniMax");
    expect(minimax.configured).toBe(true);
    expect(minimax.baseUrl).toBe("https://api.minimax.io/v1");
    expect(minimax.defaultModel).toBe("MiniMax-M2.7");
    expect(minimax.models).toContain("MiniMax-M2.7");
    expect(minimax.supportsHermesToolLoop).toBe(true);
  });

  it("returns only minimax and validates provider keys", () => {
    const providers = getManagedProviderStatuses();

    expect(providers.map((provider) => provider.key)).toEqual(["minimax"]);
    expect(isManagedProviderKey("minimax")).toBe(true);
    expect(isManagedProviderKey("openrouter")).toBe(false);
  });

  it("always defaults Hermes managed provider to MiniMax", () => {
    expect(getDefaultManagedProviderKey()).toBe("minimax");

    process.env.USER_AGENT_MANAGED_PROVIDER = "openrouter";
    expect(getDefaultManagedProviderKey()).toBe("minimax");
  });

  it("uses minimax runtime settings with tool-loop-safe compatibility defaults", () => {
    process.env.MINIMAX_API_KEY = "test-minimax";

    const minimax = getManagedProviderRuntimeConfig("minimax");

    expect(minimax.api).toBe("openai-completions");
    expect(minimax.providerId).toBe("minimax");
    expect(minimax.authMode).toBe("standard");
    expect(minimax.compat).toEqual({
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      maxTokensField: "max_tokens",
      supportsStrictMode: false,
    });
    expect(minimax.payloadDefaults).toEqual({
      reasoning_split: true,
    });
  });
});
