import { getModels } from "@mariozechner/pi-ai";
import { getManagedProviderRuntimeConfig } from "./provider-registry";
import type { ManagedProviderKey } from "./types";

export interface ManagedProviderModelCatalogEntry {
  id: string;
  name: string;
  contextLength: number | null;
}

export interface ManagedProviderModelCatalog {
  provider: ManagedProviderKey;
  source: "configured";
  warning: string | null;
  fetchedAt: string;
  models: ManagedProviderModelCatalogEntry[];
}

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

function buildConfiguredCatalog(provider: ManagedProviderKey): ManagedProviderModelCatalog {
  const config = getManagedProviderRuntimeConfig(provider);
  const builtin: ManagedProviderModelCatalogEntry[] =
    provider === "minimax"
      ? getModels("minimax").map((model) => ({
          id: model.id,
          name: model.name,
          contextLength: model.contextWindow ?? null,
        }))
      : [];

  const models = dedupeCatalogEntries(
    builtin.concat(
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

export async function getManagedProviderModelCatalog(
  provider: ManagedProviderKey,
): Promise<ManagedProviderModelCatalog> {
  return buildConfiguredCatalog(provider);
}

export function resetManagedProviderModelCatalogCache() {
  // no-op: MiniMax-only catalog is local/configured and does not use remote cache.
}
