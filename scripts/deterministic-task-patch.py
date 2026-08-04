from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FILES = {
"server/sports/contracts.ts": r'''import { z } from "zod";

export const sportSchema = z.enum(["mlb", "nhl", "nascar"]);
export type Sport = z.infer<typeof sportSchema>;

export const providerMetadataSchema = z.object({
  provider: z.string().min(1),
  fetchedAt: z.string().datetime(),
  sourceUpdatedAt: z.string().datetime().nullable().optional(),
  staleAfterSeconds: z.number().int().nonnegative(),
  isStale: z.boolean(),
});
export type ProviderMetadata = z.infer<typeof providerMetadataSchema>;

export const providerReferenceSchema = z.object({
  sport: sportSchema,
  provider: z.string().min(1),
  entityType: z.enum(["athlete", "team", "game", "series"]),
  providerId: z.string().min(1),
});
export type ProviderReference = z.infer<typeof providerReferenceSchema>;

export const athleteSchema = z.object({
  id: z.string().min(1),
  sport: sportSchema,
  name: z.string().min(1),
  teamId: z.string().nullable(),
  position: z.string().nullable(),
  active: z.boolean(),
  provider: providerMetadataSchema,
});
export type Athlete = z.infer<typeof athleteSchema>;

export const teamSchema = z.object({
  id: z.string().min(1),
  sport: sportSchema,
  name: z.string().min(1),
  abbreviation: z.string().nullable(),
  provider: providerMetadataSchema,
});
export type Team = z.infer<typeof teamSchema>;

export const gameStatusSchema = z.enum(["scheduled", "in_progress", "final", "postponed", "cancelled", "unknown"]);
export type GameStatus = z.infer<typeof gameStatusSchema>;

export const gameSchema = z.object({
  id: z.string().min(1),
  sport: sportSchema,
  startsAt: z.string().datetime(),
  status: gameStatusSchema,
  homeTeamId: z.string().nullable(),
  awayTeamId: z.string().nullable(),
  seriesId: z.string().nullable().optional(),
  provider: providerMetadataSchema,
});
export type Game = z.infer<typeof gameSchema>;

export const statValueSchema = z.union([z.number(), z.string(), z.boolean(), z.null()]);
export const statLineSchema = z.object({
  athleteId: z.string().min(1),
  gameId: z.string().nullable(),
  values: z.record(z.string(), statValueSchema),
  provider: providerMetadataSchema,
});
export type StatLine = z.infer<typeof statLineSchema>;

export const liveStateSchema = z.object({
  gameId: z.string().min(1),
  status: gameStatusSchema,
  clock: z.string().nullable(),
  period: z.string().nullable(),
  summary: z.string().nullable(),
  provider: providerMetadataSchema,
});
export type LiveState = z.infer<typeof liveStateSchema>;

export const sportsDataErrorSchema = z.object({
  code: z.enum(["unsupported_sport", "unsupported_capability", "invalid_provider_id", "provider_unavailable", "invalid_payload", "not_found"]),
  message: z.string().min(1),
  sport: sportSchema.optional(),
  provider: z.string().optional(),
  retryable: z.boolean(),
});
export type SportsDataError = z.infer<typeof sportsDataErrorSchema>;
''',
"server/sports/adapter-registry.ts": r'''import type { Athlete, Game, LiveState, Sport, StatLine, Team } from "./contracts";

export interface SportsAdapter {
  readonly sport: Sport;
  searchAthletes?(query: string): Promise<Athlete[]>;
  getAthlete?(id: string): Promise<Athlete | null>;
  getTeams?(): Promise<Team[]>;
  getSchedule?(from: Date, to: Date): Promise<Game[]>;
  getStats?(athleteIds: string[], from?: Date, to?: Date): Promise<StatLine[]>;
  getLiveState?(gameId: string): Promise<LiveState | null>;
}

export class SportsAdapterRegistry {
  private readonly adapters = new Map<Sport, SportsAdapter>();

  register(adapter: SportsAdapter): void {
    if (this.adapters.has(adapter.sport)) {
      throw new Error(`Sports adapter already registered for ${adapter.sport}`);
    }
    this.adapters.set(adapter.sport, adapter);
  }

  get(sport: Sport): SportsAdapter {
    const adapter = this.adapters.get(sport);
    if (!adapter) throw new Error(`No sports adapter registered for ${sport}`);
    return adapter;
  }

  supports(sport: Sport, capability: keyof SportsAdapter): boolean {
    const adapter = this.adapters.get(sport);
    return Boolean(adapter && typeof adapter[capability] === "function");
  }

  list(): Sport[] {
    return [...this.adapters.keys()].sort();
  }
}
''',
"server/sports/provider-identity.ts": r'''import { providerReferenceSchema, type ProviderReference } from "./contracts";

export type ProviderIdentityRecord = ProviderReference & { sportfolioId: string };
export type ProviderIdentityLookup = (references: ProviderReference[]) => Promise<ProviderIdentityRecord[]>;

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
''',
"server/sports/nascar-series.ts": r'''export const NASCAR_SERIES = {
  cup: { id: "1", code: "NCS", name: "Cup Series" },
  xfinity: { id: "2", code: "NXS", name: "Xfinity Series" },
  trucks: { id: "3", code: "NCTS", name: "Craftsman Truck Series" },
} as const;

export type NascarSeriesKey = keyof typeof NASCAR_SERIES;

const aliases = new Map<string, NascarSeriesKey>([
  ["1", "cup"], ["ncs", "cup"], ["cup", "cup"], ["cup series", "cup"],
  ["2", "xfinity"], ["nxs", "xfinity"], ["xfinity", "xfinity"], ["xfinity series", "xfinity"],
  ["3", "trucks"], ["ncts", "trucks"], ["truck", "trucks"], ["trucks", "trucks"], ["craftsman truck series", "trucks"],
]);

export function normalizeNascarSeries(value: string | number): (typeof NASCAR_SERIES)[NascarSeriesKey] {
  const normalized = String(value).trim().toLowerCase();
  const key = aliases.get(normalized);
  if (!key) throw new Error(`Unsupported NASCAR series: ${value}`);
  return NASCAR_SERIES[key];
}
''',
"server/sports/sync-telemetry.ts": r'''import type { Sport } from "./contracts";

export type SyncRunStatus = "success" | "partial" | "failed";
export type SyncRunTelemetry = {
  sport: Sport;
  operation: string;
  provider: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  recordsProcessed: number;
  requestCount: number;
  errorCount: number;
  status: SyncRunStatus;
  metadata?: Record<string, string | number | boolean | null>;
};

export type SyncRunReporter = (telemetry: SyncRunTelemetry) => void | Promise<void>;

export async function withSyncTelemetry<T>(options: {
  sport: Sport;
  operation: string;
  provider: string;
  report: SyncRunReporter;
  run: () => Promise<{ value: T; recordsProcessed?: number; requestCount?: number; errorCount?: number; metadata?: SyncRunTelemetry["metadata"] }>;
}): Promise<T> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  try {
    const result = await options.run();
    const errorCount = result.errorCount ?? 0;
    await options.report({
      sport: options.sport,
      operation: options.operation,
      provider: options.provider,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      recordsProcessed: result.recordsProcessed ?? 0,
      requestCount: result.requestCount ?? 0,
      errorCount,
      status: errorCount > 0 ? "partial" : "success",
      metadata: result.metadata,
    });
    return result.value;
  } catch (error) {
    await options.report({
      sport: options.sport,
      operation: options.operation,
      provider: options.provider,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      recordsProcessed: 0,
      requestCount: 0,
      errorCount: 1,
      status: "failed",
      metadata: { error: error instanceof Error ? error.message : "Unknown error" },
    });
    throw error;
  }
}
''',
"server/sports/foundation.test.ts": r'''import { describe, expect, it, vi } from "vitest";
import { SportsAdapterRegistry } from "./adapter-registry";
import { athleteSchema, providerMetadataSchema } from "./contracts";
import { normalizeNascarSeries } from "./nascar-series";
import { providerIdentityKey, resolveProviderIdentities } from "./provider-identity";
import { withSyncTelemetry } from "./sync-telemetry";

const metadata = providerMetadataSchema.parse({ provider: "test", fetchedAt: new Date().toISOString(), staleAfterSeconds: 60, isStale: false });

describe("unified sports foundation", () => {
  it("validates normalized athlete records", () => {
    expect(athleteSchema.parse({ id: "mlb_1", sport: "mlb", name: "Player", teamId: null, position: null, active: true, provider: metadata }).id).toBe("mlb_1");
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
    const reference = { sport: "nhl" as const, provider: "nhl-web", entityType: "athlete" as const, providerId: "8478402" };
    const result = await resolveProviderIdentities([reference, reference, { ...reference, providerId: "missing" }], async () => [{ ...reference, sportfolioId: "nhl_8478402" }]);
    expect(result.resolved.get(providerIdentityKey(reference))).toBe("nhl_8478402");
    expect(result.unresolved).toHaveLength(1);
  });

  it("reports successful and failed sync runs", async () => {
    const report = vi.fn();
    await expect(withSyncTelemetry({ sport: "nascar", operation: "schedule", provider: "nascar", report, run: async () => ({ value: 42, recordsProcessed: 3 }) })).resolves.toBe(42);
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ status: "success", recordsProcessed: 3 }));
    await expect(withSyncTelemetry({ sport: "mlb", operation: "live", provider: "statsapi", report, run: async () => { throw new Error("offline"); } })).rejects.toThrow("offline");
    expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed", errorCount: 1 }));
  });
});
''',
"docs/implementation/unified-sports-foundation.md": r'''# Unified Sports Foundation

This release introduces behavior-preserving internal contracts for MLB, NHL, and NASCAR. It does not change public MCP tools, scheduler registrations, providers, market economics, or database topology.

The foundation includes runtime-validated sport, athlete, team, game, statistics, live-state, provider-reference, freshness, and error contracts; a fail-closed adapter registry; batched provider-identity resolution through an injected existing-storage lookup; canonical NASCAR Cup/Xfinity/Truck identifiers; and a reusable sync telemetry wrapper.

Concrete adapters will wrap the repository's existing MLB StatsAPI, NHL web API, NASCAR API, and persisted Sportfolio data in subsequent releases. Existing consumers remain unchanged until each adapter passes parity tests.
''',
}

for path, content in FILES.items():
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
