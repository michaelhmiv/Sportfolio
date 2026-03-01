import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getManagedProviderModelCatalog,
  resetManagedProviderModelCatalogCache,
} from "./model-catalog";

const ORIGINAL_ENV = { ...process.env };

function resetProviderEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.CHUTES_API_KEY;
  delete process.env.CHUTES_DEFAULT_MODEL;
  delete process.env.CHUTES_MODELS;
  delete process.env.MINIMAX_API_KEY;
  delete process.env.MINIMAX_DEFAULT_MODEL;
  delete process.env.MINIMAX_MODELS;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_DEFAULT_MODEL;
  delete process.env.OPENROUTER_MODELS;
  delete process.env.OPENROUTER_SITE_URL;
  delete process.env.OPENROUTER_APP_NAME;
}

beforeEach(() => {
  resetProviderEnv();
  resetManagedProviderModelCatalogCache();
  vi.unstubAllGlobals();
});

afterEach(() => {
  resetProviderEnv();
  resetManagedProviderModelCatalogCache();
  vi.unstubAllGlobals();
});

describe("model-catalog", () => {
  it("returns configured model suggestions for non-openrouter providers", async () => {
    process.env.MINIMAX_API_KEY = "test-minimax";
    process.env.MINIMAX_DEFAULT_MODEL = "MiniMax-M2.5";
    process.env.MINIMAX_MODELS = "MiniMax-M2.5,MiniMax-M1";

    const catalog = await getManagedProviderModelCatalog("minimax");

    expect(catalog.provider).toBe("minimax");
    expect(catalog.source).toBe("configured");
    expect(catalog.warning).toBeNull();
    expect(catalog.models.map((model) => model.id)).toContain("MiniMax-M1");
    expect(catalog.models.map((model) => model.id)).toContain("MiniMax-M2.5");
    expect(catalog.models.map((model) => model.id)).toContain("MiniMax-M2.5-highspeed");
    expect(catalog.models.find((model) => model.id === "MiniMax-M2.5")?.contextLength).toBe(204800);
  });

  it("loads and merges the live openrouter model catalog", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    process.env.OPENROUTER_DEFAULT_MODEL = "openai/gpt-4o-mini";
    process.env.OPENROUTER_MODELS = "openai/gpt-4o-mini,anthropic/claude-3.5-sonnet";
    process.env.OPENROUTER_SITE_URL = "https://www.sportfolio.market";
    process.env.OPENROUTER_APP_NAME = "Sportfolio";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "anthropic/claude-3.5-sonnet",
              name: "Claude 3.5 Sonnet",
              context_length: 200000,
            },
            {
              id: "google/gemini-2.0-flash-001",
              name: "Gemini 2.0 Flash",
              top_provider: { context_length: 1048576 },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const catalog = await getManagedProviderModelCatalog("openrouter");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-openrouter",
          "HTTP-Referer": "https://www.sportfolio.market",
          "X-Title": "Sportfolio",
        }),
      }),
    );
    expect(catalog.source).toBe("configured+remote");
    expect(catalog.warning).toBeNull();
    expect(catalog.models.map((model) => model.id)).toEqual([
      "anthropic/claude-3.5-sonnet",
      "google/gemini-2.0-flash-001",
      "openai/gpt-4o-mini",
    ]);
    expect(
      catalog.models.find((model) => model.id === "google/gemini-2.0-flash-001")?.contextLength,
    ).toBe(1048576);
  });

  it("falls back to configured models if the live openrouter catalog fails", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter";
    process.env.OPENROUTER_DEFAULT_MODEL = "openai/gpt-4o-mini";

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { message: "upstream failed" } }), { status: 502 }),
        ),
    );

    const catalog = await getManagedProviderModelCatalog("openrouter");

    expect(catalog.source).toBe("configured");
    expect(catalog.models.map((model) => model.id)).toEqual(["openai/gpt-4o-mini"]);
    expect(catalog.warning).toContain("Unable to load live OpenRouter model catalog");
  });
});
