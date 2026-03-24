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
  delete process.env.CHUTES_API_KEY;
  delete process.env.CHUTES_BASE_URL;
  delete process.env.CHUTES_DEFAULT_MODEL;
  delete process.env.CHUTES_MODELS;
  delete process.env.MINIMAX_API_KEY;
  delete process.env.MINIMAX_BASE_URL;
  delete process.env.MINIMAX_DEFAULT_MODEL;
  delete process.env.MINIMAX_MODELS;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_BASE_URL;
  delete process.env.OPENROUTER_DEFAULT_MODEL;
  delete process.env.OPENROUTER_MODELS;
  delete process.env.OPENROUTER_SITE_URL;
  delete process.env.OPENROUTER_APP_NAME;
}

afterEach(() => {
  resetProviderEnv();
});

describe("provider-registry", () => {
  it("builds provider metadata for chutes, minimax, and openrouter", () => {
    process.env.CHUTES_API_KEY = "test-chutes";
    process.env.CHUTES_DEFAULT_MODEL = "kimi-test";
    process.env.MINIMAX_API_KEY = "test-minimax";
    process.env.MINIMAX_DEFAULT_MODEL = "MiniMax-M2.5";
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    process.env.OPENROUTER_DEFAULT_MODEL = "openai/gpt-4o-mini";
    process.env.OPENROUTER_MODELS = "openai/gpt-4o-mini,anthropic/claude-3.5-sonnet";

    const chutes = getManagedProviderStatus("chutes");
    const minimax = getManagedProviderStatus("minimax");
    const openrouter = getManagedProviderStatus("openrouter");

    expect(chutes.label).toBe("Chutes");
    expect(chutes.configured).toBe(true);
    expect(chutes.defaultModel).toBe("kimi-test");
    expect(chutes.supportsHermesToolLoop).toBe(false);

    expect(minimax.label).toBe("MiniMax");
    expect(minimax.configured).toBe(true);
    expect(minimax.baseUrl).toBe("https://api.minimax.io/v1");
    expect(minimax.models).toEqual(["MiniMax-M2.5"]);
    expect(minimax.supportsHermesToolLoop).toBe(true);

    expect(openrouter.label).toBe("OpenRouter");
    expect(openrouter.configured).toBe(true);
    expect(openrouter.models).toContain("anthropic/claude-3.5-sonnet");
    expect(openrouter.supportsHermesToolLoop).toBe(true);
  });

  it("treats openrouter model selection as configurable even without a preset model list", () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter";

    const openrouter = getManagedProviderStatus("openrouter");

    expect(openrouter.configured).toBe(true);
    expect(openrouter.defaultModel).toBeNull();
    expect(openrouter.models).toEqual([]);
  });

  it("returns all managed providers and validates provider keys", () => {
    const providers = getManagedProviderStatuses();

    expect(providers.map((provider) => provider.key)).toEqual(["chutes", "minimax", "openrouter"]);
    expect(isManagedProviderKey("minimax")).toBe(true);
    expect(isManagedProviderKey("not-real")).toBe(false);
  });

  it("defaults Hermes to OpenRouter unless explicitly overridden", () => {
    expect(getDefaultManagedProviderKey()).toBe("openrouter");

    process.env.USER_AGENT_MANAGED_PROVIDER = "minimax";
    expect(getDefaultManagedProviderKey()).toBe("minimax");
  });

  it("ignores an unsafe or unusable env default when a configured Hermes-safe provider exists", () => {
    process.env.USER_AGENT_MANAGED_PROVIDER = "chutes";
    process.env.CHUTES_API_KEY = "test-chutes";
    process.env.CHUTES_DEFAULT_MODEL = "kimi-test";
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    process.env.OPENROUTER_DEFAULT_MODEL = "openai/gpt-4o-mini";

    expect(getDefaultManagedProviderKey()).toBe("openrouter");
  });

  it("uses pi-ai compatible provider runtime settings", () => {
    process.env.CHUTES_API_KEY = "test-chutes";
    process.env.MINIMAX_API_KEY = "test-minimax";
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    process.env.OPENROUTER_SITE_URL = "https://www.sportfolio.market";
    process.env.OPENROUTER_APP_NAME = "Sportfolio";

    const chutes = getManagedProviderRuntimeConfig("chutes");
    const minimax = getManagedProviderRuntimeConfig("minimax");
    const openrouter = getManagedProviderRuntimeConfig("openrouter");

    expect(chutes.api).toBe("openai-completions");
    expect(chutes.providerId).toBe("chutes");
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
    expect(openrouter.api).toBe("openai-completions");
    expect(openrouter.providerId).toBe("openrouter");
    expect(openrouter.headers).toEqual({
      "HTTP-Referer": "https://www.sportfolio.market",
      "X-Title": "Sportfolio",
    });
  });
});
