import { describe, expect, it, vi } from "vitest";
import { SportsAdapterRegistry } from "./adapter-registry";
import { athleteSchema, providerMetadataSchema } from "./contracts";
import { normalizeNascarSeries } from "./nascar-series";
import { providerIdentityKey, resolveProviderIdentities } from "./provider-identity";
import { withSyncTelemetry } from "./sync-telemetry";

const metadata = providerMetadataSchema.parse({
  provider: "test",
  fetchedAt: new Date().toISOString(),
  staleAfterSeconds: 60,
  isStale: false,
});

describe("unified sports foundation", () => {
  it("validates normalized athlete records", () => {
    expect(
      athleteSchema.parse({
        id: "mlb_1",
        sport: "mlb",
        name: "Player",
        teamId: null,
        position: null,
        active: true,
        provider: metadata,
      }).id,
    ).toBe("mlb_1");
  });

  it("fails closed for missing or duplicate adapters", () => {
    const registry = new SportsAdapterRegistry();
    expect(() => registry.get("mlb")).toThrow("No sports adapter");
    registry.register({ sport: "mlb" });
    expect(() => registry.register({ sport: "mlb" })).toThrow("already registered");
    expect(registry.list()).toEqual(["mlb"]);
  });

  it("normalizes NASCAR identifiers and aliases", () => {
    expect(normalizeNascarSeries("NCS")).toMatchObject({ id: "1", code: "NCS" });
    expect(normalizeNascarSeries("xfinity series").id).toBe("2");
    expect(() => normalizeNascarSeries("arca")).toThrow("Unsupported NASCAR series");
  });

  it("deduplicates and reports unresolved provider identities", async () => {
    const reference = {
      sport: "nhl" as const,
      provider: "nhl-web",
      entityType: "athlete" as const,
      providerId: "8478402",
    };
    const result = await resolveProviderIdentities(
      [reference, reference, { ...reference, providerId: "missing" }],
      async () => [{ ...reference, sportfolioId: "nhl_8478402" }],
    );
    expect(result.resolved.get(providerIdentityKey(reference))).toBe("nhl_8478402");
    expect(result.unresolved).toHaveLength(1);
  });

  it("reports successful and failed sync runs", async () => {
    const report = vi.fn();
    await expect(
      withSyncTelemetry({
        sport: "nascar",
        operation: "schedule",
        provider: "nascar",
        report,
        run: async () => ({ value: 42, recordsProcessed: 3 }),
      }),
    ).resolves.toBe(42);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "success", recordsProcessed: 3 }),
    );
    await expect(
      withSyncTelemetry({
        sport: "mlb",
        operation: "live",
        provider: "statsapi",
        report,
        run: async () => {
          throw new Error("offline");
        },
      }),
    ).rejects.toThrow("offline");
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "failed", errorCount: 1 }),
    );
  });
});
