import { z } from "zod";
import type { SportsAdapterRegistry } from "./adapter-registry";
import {
  providerReferenceSchema,
  sportSchema,
  type ProviderMetadata,
  type ProviderReference,
  type Sport,
} from "./contracts";
import {
  providerIdentityKey,
  resolveProviderIdentities,
  type ProviderIdentityLookup,
} from "./provider-identity";

export const sportsContextSectionSchema = z.enum([
  "entities",
  "teams",
  "schedule",
  "recent_performance",
  "live_state",
  "standings",
  "leaders",
  "user_exposure",
]);
export type SportsContextSectionName = z.infer<typeof sportsContextSectionSchema>;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const requestSchema = z
  .object({
    sport: sportSchema,
    sections: z.array(sportsContextSectionSchema).min(1).max(8),
    athleteIds: z.array(z.string().min(1).max(160)).max(20).optional(),
    teamIds: z.array(z.string().min(1).max(160)).max(20).optional(),
    eventIds: z.array(z.string().min(1).max(160)).max(10).optional(),
    date: dateSchema.optional(),
    startDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
    season: z.string().min(4).max(16).optional(),
  })
  .strict();

export const sportsContextInputSchema = z
  .object({
    requests: z.array(requestSchema).min(1).max(6),
    providerReferences: z.array(providerReferenceSchema).max(30).optional(),
    deadlineMs: z.number().int().min(250).max(8_000).optional(),
  })
  .strict();
export type SportsContextInput = z.infer<typeof sportsContextInputSchema>;

export type SportsContextAccess = { mode: "public" } | { mode: "authenticated"; userId: string };

export type SportsContextStorage = {
  getUserHoldingsWithPlayers(userId: string): Promise<Array<any>>;
  getWatchlists(userId: string): Promise<Array<any>>;
};

export type SportsContextDependencies = {
  registry: SportsAdapterRegistry;
  identityLookup: ProviderIdentityLookup;
  storage?: SportsContextStorage;
  now?: () => Date;
};

export type SportsContextSection = {
  name: SportsContextSectionName;
  status: "complete" | "partial" | "unsupported" | "error";
  data: unknown;
  provider: ProviderMetadata | null;
  warnings: string[];
};

export type SportsContextEnvelope = {
  generatedAt: string;
  partial: boolean;
  identityResolution: {
    resolved: Array<{ reference: ProviderReference; sportfolioId: string }>;
    unresolved: ProviderReference[];
  };
  requests: Array<{
    sport: Sport;
    sections: SportsContextSection[];
  }>;
  diagnostics: {
    sourceCalls: number;
    cacheHits: number;
    deadlineMs: number;
  };
};

class SportsContextError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SportsContextError";
  }
}

function uniqueSorted(values: string[] | undefined): string[] {
  return [...new Set(values || [])].sort((a, b) => a.localeCompare(b));
}

function dateRange(input: z.infer<typeof requestSchema>) {
  const date = input.date;
  const startDate = input.startDate || date;
  const endDate = input.endDate || date || startDate;
  if (!startDate && !endDate) return null;
  const start = new Date(`${startDate || endDate}T00:00:00.000Z`);
  const end = new Date(`${endDate || startDate}T23:59:59.999Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
    throw new SportsContextError("Invalid context date range.", "invalid_date_range");
  }
  if (Math.ceil((end.getTime() - start.getTime()) / 86_400_000) > 14) {
    throw new SportsContextError(
      "Context date ranges are limited to 14 days.",
      "request_too_broad",
      {
        maxDays: 14,
      },
    );
  }
  return { start, end };
}

function providerFrom(value: unknown): ProviderMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const provider = (value as { provider?: unknown }).provider;
  return provider && typeof provider === "object" && !Array.isArray(provider)
    ? (provider as ProviderMetadata)
    : null;
}

function firstProvider(value: unknown): ProviderMetadata | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = providerFrom(item);
      if (found) return found;
    }
    return null;
  }
  return providerFrom(value);
}

async function mapBounded<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await operation(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function withDeadline<T>(promise: Promise<T>, deadlineAt: number): Promise<T> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    return Promise.reject(
      new SportsContextError("Sports context deadline exceeded.", "deadline_exceeded"),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new SportsContextError("Sports context deadline exceeded.", "deadline_exceeded")),
      remaining,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function assembleSportsContext(
  rawInput: SportsContextInput,
  access: SportsContextAccess,
  dependencies: SportsContextDependencies,
): Promise<SportsContextEnvelope> {
  const input = sportsContextInputSchema.parse(rawInput);
  const deadlineMs = input.deadlineMs || 4_000;
  const deadlineAt = Date.now() + deadlineMs;
  const now = dependencies.now || (() => new Date());
  const memo = new Map<string, Promise<unknown>>();
  let sourceCalls = 0;
  let cacheHits = 0;

  const once = <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const existing = memo.get(key);
    if (existing) {
      cacheHits += 1;
      return existing as Promise<T>;
    }
    sourceCalls += 1;
    const pending = withDeadline(operation(), deadlineAt);
    memo.set(key, pending);
    return pending;
  };

  const references = input.providerReferences || [];
  const uniqueReferences = [
    ...new Map(references.map((reference) => [providerIdentityKey(reference), reference])).values(),
  ];
  const resolution = await withDeadline(
    resolveProviderIdentities(uniqueReferences, dependencies.identityLookup),
    deadlineAt,
  );
  const resolved = uniqueReferences
    .map((reference) => ({
      reference,
      sportfolioId: resolution.resolved.get(providerIdentityKey(reference)) || "",
    }))
    .filter((entry) => entry.sportfolioId)
    .sort((left, right) =>
      providerIdentityKey(left.reference).localeCompare(providerIdentityKey(right.reference)),
    );

  const requests = await mapBounded(input.requests, 3, async (request) => {
    const adapter = dependencies.registry.get(request.sport);
    const athleteIds = uniqueSorted(request.athleteIds);
    const teamIds = uniqueSorted(request.teamIds);
    const eventIds = uniqueSorted(request.eventIds);
    const sections = [...new Set(request.sections)];
    const range = dateRange(request);

    const sectionResults = await mapBounded(
      sections,
      3,
      async (name): Promise<SportsContextSection> => {
        try {
          switch (name) {
            case "entities": {
              if (!adapter.getAthlete) {
                return {
                  name,
                  status: "unsupported",
                  data: [],
                  provider: null,
                  warnings: ["Athlete detail is not supported for this sport."],
                };
              }
              const entities = await mapBounded(athleteIds, 3, (id) =>
                once(`${request.sport}:athlete:${id}`, () => adapter.getAthlete!(id)),
              );
              const present = entities
                .filter(Boolean)
                .sort((a: any, b: any) => a.id.localeCompare(b.id));
              return {
                name,
                status: present.length === athleteIds.length ? "complete" : "partial",
                data: present,
                provider: firstProvider(present),
                warnings:
                  present.length === athleteIds.length
                    ? []
                    : ["One or more requested athletes were unavailable."],
              };
            }
            case "teams": {
              if (!adapter.getTeams) {
                return {
                  name,
                  status: "unsupported",
                  data: [],
                  provider: null,
                  warnings: ["Team data is not supported for this sport."],
                };
              }
              const teams = await once(`${request.sport}:teams`, () => adapter.getTeams!());
              const selected = (teams as any[])
                .filter((team) => teamIds.length === 0 || teamIds.includes(team.id))
                .sort((a, b) => a.id.localeCompare(b.id));
              return {
                name,
                status: "complete",
                data: selected,
                provider: firstProvider(selected),
                warnings: [],
              };
            }
            case "schedule": {
              if (!adapter.getSchedule || !range) {
                return {
                  name,
                  status: "unsupported",
                  data: [],
                  provider: null,
                  warnings: [
                    range
                      ? "Schedule is not supported for this sport."
                      : "A date or date range is required for schedule context.",
                  ],
                };
              }
              const events = await once(
                `${request.sport}:schedule:${range.start.toISOString()}:${range.end.toISOString()}`,
                () => adapter.getSchedule!(range.start, range.end),
              );
              const ordered = (events as any[]).sort(
                (a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
              );
              return {
                name,
                status: "complete",
                data: ordered,
                provider: firstProvider(ordered),
                warnings: [],
              };
            }
            case "recent_performance": {
              if (!adapter.getStats || athleteIds.length === 0) {
                return {
                  name,
                  status: "unsupported",
                  data: [],
                  provider: null,
                  warnings: [
                    athleteIds.length
                      ? "Performance stats are not supported for this sport."
                      : "At least one athlete ID is required for recent performance.",
                  ],
                };
              }
              const snapshots = await once(
                `${request.sport}:stats:${athleteIds.join(",")}:${range?.start.toISOString() || "current"}:${range?.end.toISOString() || "current"}`,
                () => adapter.getStats!(athleteIds, range?.start, range?.end),
              );
              const ordered = (snapshots as any[]).sort((a: any, b: any) =>
                a.entityId.localeCompare(b.entityId),
              );
              return {
                name,
                status: "complete",
                data: ordered,
                provider: firstProvider(ordered),
                warnings: [],
              };
            }
            case "live_state": {
              if (!adapter.getLiveState || eventIds.length === 0) {
                return {
                  name,
                  status: "unsupported",
                  data: [],
                  provider: null,
                  warnings: [
                    eventIds.length
                      ? "Live state is not supported for this sport."
                      : "At least one event ID is required for live state.",
                  ],
                };
              }
              const states = await mapBounded(eventIds, 3, (id) =>
                once(`${request.sport}:live:${id}`, () => adapter.getLiveState!(id)),
              );
              const present = states
                .filter(Boolean)
                .sort((a: any, b: any) => a.gameId.localeCompare(b.gameId));
              return {
                name,
                status: present.length === eventIds.length ? "complete" : "partial",
                data: present,
                provider: firstProvider(present),
                warnings:
                  present.length === eventIds.length
                    ? []
                    : ["One or more requested live states were unavailable."],
              };
            }
            case "standings":
            case "leaders":
              return {
                name,
                status: "unsupported",
                data: [],
                provider: null,
                warnings: [
                  `${name} is not exposed by the current unified adapter contract; no substitute data was inferred.`,
                ],
              };
            case "user_exposure": {
              if (access.mode !== "authenticated") {
                return {
                  name,
                  status: "error",
                  data: null,
                  provider: null,
                  warnings: ["Connected-user exposure requires authenticated OAuth context."],
                };
              }
              if (!dependencies.storage) {
                return {
                  name,
                  status: "error",
                  data: null,
                  provider: null,
                  warnings: ["Connected-user storage is unavailable."],
                };
              }
              const [holdings, watchlists] = await Promise.all([
                once(`user:${access.userId}:holdings`, () =>
                  dependencies.storage!.getUserHoldingsWithPlayers(access.userId),
                ),
                once(`user:${access.userId}:watchlists`, () =>
                  dependencies.storage!.getWatchlists(access.userId),
                ),
              ]);
              const requested = new Set(athleteIds);
              const sanitizedHoldings = (holdings as any[])
                .filter((entry) => entry?.player?.sport?.toLowerCase() === request.sport)
                .filter((entry) => requested.size === 0 || requested.has(entry.player.id))
                .map((entry) => ({
                  playerId: entry.player.id,
                  shares: Number(entry.holding?.quantity || 0),
                  lockedShares: Number(entry.holding?.lockedQuantity || 0),
                  multiplier: Number(entry.holding?.multiplier || 1),
                }))
                .sort((a, b) => a.playerId.localeCompare(b.playerId));
              const sanitizedWatchlists = (watchlists as any[])
                .map((watchlist) => ({
                  id: String(watchlist.id || ""),
                  name: String(watchlist.name || ""),
                  playerIds: Array.isArray(watchlist.items)
                    ? Array.from(
                        new Set<string>((watchlist.items as unknown[]).map((item) => String(item))),
                      )
                        .filter((id) => requested.size === 0 || requested.has(id))
                        .sort()
                    : [],
                }))
                .filter((watchlist) => watchlist.id)
                .sort((a, b) => a.id.localeCompare(b.id));
              return {
                name,
                status: "complete",
                data: { holdings: sanitizedHoldings, watchlists: sanitizedWatchlists },
                provider: null,
                warnings: [],
              };
            }
          }
        } catch (error) {
          return {
            name,
            status: "error",
            data: null,
            provider: null,
            warnings: [error instanceof Error ? error.message : String(error)],
          };
        }
      },
    );

    return {
      sport: request.sport,
      sections: sectionResults.sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  const orderedRequests = requests.sort((a, b) => a.sport.localeCompare(b.sport));
  return {
    generatedAt: now().toISOString(),
    partial: orderedRequests.some((request) =>
      request.sections.some((section) => section.status !== "complete"),
    ),
    identityResolution: { resolved, unresolved: resolution.unresolved },
    requests: orderedRequests,
    diagnostics: { sourceCalls, cacheHits, deadlineMs },
  };
}
