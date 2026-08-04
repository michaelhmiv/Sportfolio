import { providerReferenceSchema, type ProviderReference } from "./contracts";

export type ProviderIdentityRecord = ProviderReference & { sportfolioId: string };
export type ProviderIdentityLookup = (
  references: ProviderReference[],
) => Promise<ProviderIdentityRecord[]>;

export type ProviderIdentityResolution = {
  resolved: Map<string, string>;
  unresolved: ProviderReference[];
};

function key(reference: ProviderReference): string {
  return `${reference.sport}:${reference.provider}:${reference.entityType}:${reference.providerId}`;
}

export async function resolveProviderIdentities(
  references: ProviderReference[],
  lookup: ProviderIdentityLookup,
): Promise<ProviderIdentityResolution> {
  const unique = new Map<string, ProviderReference>();
  for (const input of references) {
    const parsed = providerReferenceSchema.parse(input);
    unique.set(key(parsed), parsed);
  }

  const requested = [...unique.values()];
  const records = await lookup(requested);
  const resolved = new Map<string, string>();
  for (const record of records) {
    const parsed = providerReferenceSchema.parse(record);
    if (!unique.has(key(parsed)) || !record.sportfolioId) continue;
    resolved.set(key(parsed), record.sportfolioId);
  }

  return {
    resolved,
    unresolved: requested.filter((reference) => !resolved.has(key(reference))),
  };
}

export function providerIdentityKey(reference: ProviderReference): string {
  return key(providerReferenceSchema.parse(reference));
}
