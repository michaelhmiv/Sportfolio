import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getManagedProviderModelCatalog,
  resetManagedProviderModelCatalogCache,
} from "./model-catalog";

const ORIGINAL_ENV = { ...process.env };

function resetProviderEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MINIMAX_API_KEY;
  delete process.env.MINIMAX_DEFAULT_MODEL;
  delete process.env.MINIMAX_MODELS;
}

beforeEach(() => {
  resetProviderEnv();
  resetManagedProviderModelCatalogCache();
});

afterEach(() => {
  resetProviderEnv();
  resetManagedProviderModelCatalogCache();
});

describe("model-catalog", () => {
  it("returns configured MiniMax model suggestions and builtin family entries", async () => {
    process.env.MINIMAX_API_KEY = "test-minimax";
    process.env.MINIMAX_DEFAULT_MODEL = "MiniMax-M2.7";
    process.env.MINIMAX_MODELS = "MiniMax-M2.7,MiniMax-M2";

    const catalog = await getManagedProviderModelCatalog("minimax");

    expect(catalog.provider).toBe("minimax");
    expect(catalog.source).toBe("configured");
    expect(catalog.warning).toBeNull();
    expect(catalog.models.map((model) => model.id)).toContain("MiniMax-M2.7");
    expect(catalog.models.map((model) => model.id)).toContain("MiniMax-M2.7-highspeed");
    expect(catalog.models.map((model) => model.id)).toContain("MiniMax-M2");
  });
});
