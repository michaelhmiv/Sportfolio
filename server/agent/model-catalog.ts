import { getModels } from "@mariozechner/pi-ai";
import { instrumentedFetch } from "../observability/fetch";
import { getManagedProviderRuntimeConfig } from "./provider-registry";
import { normalizeOpenAICompatibleBaseUrl } from "./pi-provider";
import type { ManagedProviderKey } from "./types";

const MODEL_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

type ManagedProviderModelCatalogSource = "configured" | "remote" | "configured+remote";

export interface ManagedProviderModelCatalogEntry {
  id: string;
  name: string;
  contextLength: number | null;
}

export interface ManagedProviderModelCatalog {
  provider: ManagedProviderKey;
  source: ManagedProviderModelCatalogSource;
  warning: string | null;
  fetchedAt: string;
  models: ManagedProviderModelCatalogEntry[];
}

interface CachedCatalogEntry {
  expiresAt: number;
  catalog: ManagedProviderModelCatalog;
}

const catalogCache = new Map<ManagedProviderKey, CachedCatalogEntry>();

function normalizeModelId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function dedupeCatalogEntries(
  entries: ManagedProviderModelCatalogEntry[],
): ManagedProviderModelCatalogEntry[] {
  const seen = new Set<string>();
  const deduped: ManagedProviderModelCatalogEntry[] = [];

  for (const entry of entries) {
    const normalizedId = normalizeModelId(entry.id);
    if (!normalizedId || seen.has(normalizedId)) {
      continue;
    }

    seen.add(normalizedId);
    deduped.push({
      id: normalizedId,
      name: entry.name?.trim() || normalizedId,
      contextLength: typeof entry.contextLength === "number" ? entry.contextLength : null,
    });
  }

  return deduped.sort((left, right) => left.id.localeCompare(right.id));
}

function buildBuiltinCatalogEntries(
  provider: ManagedProviderKey,
): ManagedProviderModelCatalogEntry[] {
  if (provider === "minimax") {
    return dedupeCatalogEntries(
      getModels("minimax").map((model) => ({
        id: model.id,
        name: model.name,
        contextLength: model.contextWindow,
      })),
    );
  }

  return [];
}

function buildConfiguredCatalog(provider: ManagedProviderKey): ManagedProviderModelCatalog {
  const config = getManagedProviderRuntimeConfig(provider);
  const models = dedupeCatalogEntries(
    buildBuiltinCatalogEntries(provider).concat(
      config.models.map((model) => ({
        id: model,
        name: model,
        contextLength: null,
      })),
    ),
  );

  return {
    provider,
    source: "configured",
    warning: null,
    fetchedAt: new Date().toISOString(),
    models,
  };
}

function parseContextLength(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function parseOpenRouterCatalogPayload(payload: unknown): ManagedProviderModelCatalogEntry[] {
  const rawModels = Array.isArray((payload as { data?: unknown })?.data)
    ? ((payload as { data: unknown[] }).data ?? [])
    : [];

  return dedupeCatalogEntries(
    rawModels.map((entry) => {
      const record = typeof entry === "object" && entry ? (entry as Record<string, unknown>) : {};
      const id =
        normalizeModelId(typeof record.id === "string" ? record.id : null) ||
        normalizeModelId(typeof record.slug === "string" ? record.slug : null) ||
        normalizeModelId(typeof record.name === "string" ? record.name : null) ||
        "";
      const name = normalizeModelId(typeof record.name === "string" ? record.name : null) || id;

      return {
        id,
        name,
        contextLength:
          parseContextLength(record.context_length) ??
          parseContextLength(record.contextLength) ??
          parseContextLength(
            record.top_provider && typeof record.top_provider === "object"
              ? (record.top_provider as Record<string, unknown>).context_length
              : null,
          ),
      };
    }),
  );
}

function getCatalogCache(provider: ManagedProviderKey): ManagedProviderModelCatalog | null {
  const cached = catalogCache.get(provider);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt < Date.now()) {
    return null;
  }

  return cached.catalog;
}

function setCatalogCache(provider: ManagedProviderKey, catalog: ManagedProviderModelCatalog) {
  catalogCache.set(provider, {
    catalog,
    expiresAt: Date.now() + MODEL_CATALOG_CACHE_TTL_MS,
  });
}

function mergeCatalogs(
  provider: ManagedProviderKey,
  configuredModels: ManagedProviderModelCatalogEntry[],
  remoteModels: ManagedProviderModelCatalogEntry[],
): ManagedProviderModelCatalog {
  const mergedModels = dedupeCatalogEntries([...configuredModels, ...remoteModels]);

  return {
    provider,
    source: configuredModels.length > 0 ? "configured+remote" : "remote",
    warning: null,
    fetchedAt: new Date().toISOString(),
    models: mergedModels,
  };
}

async function fetchOpenRouterCatalog(): Promise<ManagedProviderModelCatalog> {
  const cachedCatalog = getCatalogCache("openrouter");
  const staleCatalog = catalogCache.get("openrouter")?.catalog ?? null;
  if (cachedCatalog) {
    return cachedCatalog;
  }

  const configuredCatalog = buildConfiguredCatalog("openrouter");
  const provider = getManagedProviderRuntimeConfig("openrouter");

  if (!provider.configured || !provider.apiKey) {
    return configuredCatalog;
  }

  try {
    const baseUrl = normalizeOpenAICompatibleBaseUrl(provider.baseUrl);
    const response = await instrumentedFetch(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        ...(provider.headers || {}),
      },
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const message =
        typeof (payload as { error?: { message?: unknown } })?.error?.message === "string"
          ? ((payload as { error: { message: string } }).error.message ?? "")
          : `OpenRouter model catalog request failed with status ${response.status}`;
      throw new Error(message);
    }

    const remoteModels = parseOpenRouterCatalogPayload(payload);
    const catalog = mergeCatalogs("openrouter", configuredCatalog.models, remoteModels);
    setCatalogCache("openrouter", catalog);
    return catalog;
  } catch (error: any) {
    if (staleCatalog) {
      return {
        ...staleCatalog,
        warning: `Using cached OpenRouter model catalog: ${String(error?.message || error)}`,
      };
    }

    return {
      ...configuredCatalog,
      warning: `Unable to load live OpenRouter model catalog: ${String(error?.message || error)}`,
    };
  }
}

export async function getManagedProviderModelCatalog(
  provider: ManagedProviderKey,
): Promise<ManagedProviderModelCatalog> {
  if (provider === "openrouter") {
    return fetchOpenRouterCatalog();
  }

  return buildConfiguredCatalog(provider);
}

export function resetManagedProviderModelCatalogCache() {
  catalogCache.clear();
}
