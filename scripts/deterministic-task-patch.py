from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)

context_service = r'''import { z } from "zod";
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

export type SportsContextAccess =
  | { mode: "public" }
  | { mode: "authenticated"; userId: string };

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
    throw new SportsContextError("Context date ranges are limited to 14 days.", "request_too_broad", {
      maxDays: 14,
    });
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
    return Promise.reject(new SportsContextError("Sports context deadline exceeded.", "deadline_exceeded"));
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new SportsContextError("Sports context deadline exceeded.", "deadline_exceeded")),
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
  const resolution = await withDeadline(
    resolveProviderIdentities(references, dependencies.identityLookup),
    deadlineAt,
  );
  const resolved = references
    .map((reference) => ({
      reference,
      sportfolioId: resolution.resolved.get(providerIdentityKey(reference)) || "",
    }))
    .filter((entry) => entry.sportfolioId)
    .sort((left, right) => providerIdentityKey(left.reference).localeCompare(providerIdentityKey(right.reference)));

  const requests = await mapBounded(input.requests, 3, async (request) => {
    const adapter = dependencies.registry.get(request.sport);
    const athleteIds = uniqueSorted(request.athleteIds);
    const teamIds = uniqueSorted(request.teamIds);
    const eventIds = uniqueSorted(request.eventIds);
    const sections = [...new Set(request.sections)];
    const range = dateRange(request);

    const sectionResults = await mapBounded(sections, 3, async (name): Promise<SportsContextSection> => {
      try {
        switch (name) {
          case "entities": {
            if (!adapter.getAthlete) {
              return { name, status: "unsupported", data: [], provider: null, warnings: ["Athlete detail is not supported for this sport."] };
            }
            const entities = await mapBounded(athleteIds, 3, (id) =>
              once(`${request.sport}:athlete:${id}`, () => adapter.getAthlete!(id)),
            );
            const present = entities.filter(Boolean).sort((a: any, b: any) => a.id.localeCompare(b.id));
            return {
              name,
              status: present.length === athleteIds.length ? "complete" : "partial",
              data: present,
              provider: firstProvider(present),
              warnings: present.length === athleteIds.length ? [] : ["One or more requested athletes were unavailable."],
            };
          }
          case "teams": {
            if (!adapter.getTeams) {
              return { name, status: "unsupported", data: [], provider: null, warnings: ["Team data is not supported for this sport."] };
            }
            const teams = await once(`${request.sport}:teams`, () => adapter.getTeams!());
            const selected = (teams as any[])
              .filter((team) => teamIds.length === 0 || teamIds.includes(team.id))
              .sort((a, b) => a.id.localeCompare(b.id));
            return { name, status: "complete", data: selected, provider: firstProvider(selected), warnings: [] };
          }
          case "schedule": {
            if (!adapter.getSchedule || !range) {
              return { name, status: "unsupported", data: [], provider: null, warnings: [range ? "Schedule is not supported for this sport." : "A date or date range is required for schedule context."] };
            }
            const events = await once(
              `${request.sport}:schedule:${range.start.toISOString()}:${range.end.toISOString()}`,
              () => adapter.getSchedule!(range.start, range.end),
            );
            const ordered = (events as any[]).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
            return { name, status: "complete", data: ordered, provider: firstProvider(ordered), warnings: [] };
          }
          case "recent_performance": {
            if (!adapter.getStats || athleteIds.length === 0) {
              return { name, status: "unsupported", data: [], provider: null, warnings: [athleteIds.length ? "Performance stats are not supported for this sport." : "At least one athlete ID is required for recent performance."] };
            }
            const snapshots = await mapBounded(athleteIds, 3, (id) =>
              once(`${request.sport}:stats:${id}:${request.season || "current"}`, () => adapter.getStats!(id, request.season)),
            );
            const ordered = snapshots.sort((a: any, b: any) => a.entityId.localeCompare(b.entityId));
            return { name, status: "complete", data: ordered, provider: firstProvider(ordered), warnings: [] };
          }
          case "live_state": {
            if (!adapter.getLiveState || eventIds.length === 0) {
              return { name, status: "unsupported", data: [], provider: null, warnings: [eventIds.length ? "Live state is not supported for this sport." : "At least one event ID is required for live state."] };
            }
            const states = await mapBounded(eventIds, 3, (id) =>
              once(`${request.sport}:live:${id}`, () => adapter.getLiveState!(id)),
            );
            const present = states.filter(Boolean).sort((a: any, b: any) => a.gameId.localeCompare(b.gameId));
            return {
              name,
              status: present.length === eventIds.length ? "complete" : "partial",
              data: present,
              provider: firstProvider(present),
              warnings: present.length === eventIds.length ? [] : ["One or more requested live states were unavailable."],
            };
          }
          case "standings":
          case "leaders":
            return {
              name,
              status: "unsupported",
              data: [],
              provider: null,
              warnings: [`${name} is not exposed by the current unified adapter contract; no substitute data was inferred.`],
            };
          case "user_exposure": {
            if (access.mode !== "authenticated") {
              return { name, status: "error", data: null, provider: null, warnings: ["Connected-user exposure requires authenticated OAuth context."] };
            }
            if (!dependencies.storage) {
              return { name, status: "error", data: null, provider: null, warnings: ["Connected-user storage is unavailable."] };
            }
            const [holdings, watchlists] = await Promise.all([
              once(`user:${access.userId}:holdings`, () => dependencies.storage!.getUserHoldingsWithPlayers(access.userId)),
              once(`user:${access.userId}:watchlists`, () => dependencies.storage!.getWatchlists(access.userId)),
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
                  ? [...new Set(watchlist.items.map(String))].filter((id) => requested.size === 0 || requested.has(id)).sort()
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
    });

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
'''
(ROOT / "server/sports/context-service.ts").write_text(context_service)

context_tests = r'''import { describe, expect, it, vi } from "vitest";
import { SportsAdapterRegistry } from "./adapter-registry";
import type { ProviderMetadata } from "./contracts";
import { assembleSportsContext } from "./context-service";

const provider: ProviderMetadata = {
  provider: "fixture",
  fetchedAt: "2026-08-04T15:00:00.000Z",
  staleAfterSeconds: 60,
  isStale: false,
};

function registry() {
  const value = new SportsAdapterRegistry();
  value.register({
    sport: "mlb",
    getAthlete: vi.fn(async (id) => ({ id, sport: "mlb", name: id, active: true, provider })),
    getTeams: vi.fn(async () => [{ id: "mlb_team_1", sport: "mlb", name: "A", provider }]),
    getSchedule: vi.fn(async () => [{ id: "mlb_game_1", sport: "mlb", startsAt: "2026-08-04T20:00:00.000Z", status: "scheduled", homeTeamId: "a", awayTeamId: "b", provider }]),
    getStats: vi.fn(async (id) => ({ entityId: id, sport: "mlb", season: "2026", stats: { points: 1 }, provider })),
    getLiveState: vi.fn(async (id) => ({ gameId: id, status: "in_progress", clock: null, period: "5th", summary: "Top 5", provider })),
  });
  value.register({
    sport: "nhl",
    getSchedule: vi.fn(async () => [{ id: "nhl_game_1", sport: "nhl", startsAt: "2026-08-04T18:00:00.000Z", status: "scheduled", homeTeamId: "c", awayTeamId: "d", provider }]),
  });
  value.register({ sport: "nascar" });
  return value;
}

const lookup = vi.fn(async (references) => references.map((reference) => ({ ...reference, sportfolioId: reference.providerId })));
const storage = {
  getUserHoldingsWithPlayers: vi.fn(async () => [{ holding: { quantity: 4, lockedQuantity: 1, multiplier: 2 }, player: { id: "mlb_1", sport: "MLB" } }]),
  getWatchlists: vi.fn(async () => [{ id: "w1", name: "Targets", items: ["mlb_1", "mlb_2"] }]),
};

describe("assembleSportsContext", () => {
  it("deduplicates repeated provider calls and reports measured call counts", async () => {
    const sportsRegistry = registry();
    const result = await assembleSportsContext(
      { requests: [
        { sport: "mlb", sections: ["schedule"], date: "2026-08-04" },
        { sport: "mlb", sections: ["schedule"], date: "2026-08-04" },
      ] },
      { mode: "public" },
      { registry: sportsRegistry, identityLookup: lookup, now: () => new Date("2026-08-04T15:00:00.000Z") },
    );
    expect(sportsRegistry.get("mlb").getSchedule).toHaveBeenCalledTimes(1);
    expect(result.diagnostics).toMatchObject({ sourceCalls: 1, cacheHits: 1 });
  });

  it("runs one deduplicated identity resolution batch", async () => {
    lookup.mockClear();
    const reference = { sport: "mlb" as const, provider: "sportfolio", entityType: "athlete" as const, providerId: "mlb_1" };
    const result = await assembleSportsContext(
      { requests: [{ sport: "mlb", sections: ["entities"], athleteIds: ["mlb_1"] }], providerReferences: [reference, reference] },
      { mode: "public" },
      { registry: registry(), identityLookup: lookup },
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0][0]).toHaveLength(1);
    expect(result.identityResolution.resolved).toHaveLength(1);
  });

  it("supports deterministic mixed-sport responses", async () => {
    const result = await assembleSportsContext(
      { requests: [
        { sport: "nhl", sections: ["schedule"], date: "2026-08-04" },
        { sport: "mlb", sections: ["schedule"], date: "2026-08-04" },
      ] },
      { mode: "public" },
      { registry: registry(), identityLookup: lookup, now: () => new Date("2026-08-04T15:00:00.000Z") },
    );
    expect(result.requests.map((request) => request.sport)).toEqual(["mlb", "nhl"]);
    expect(result.generatedAt).toBe("2026-08-04T15:00:00.000Z");
  });

  it("returns partial section failures without discarding successful sections", async () => {
    const value = registry();
    value.replace({ sport: "mlb", getTeams: async () => { throw new Error("provider down"); }, getSchedule: value.get("mlb").getSchedule });
    const result = await assembleSportsContext(
      { requests: [{ sport: "mlb", sections: ["teams", "schedule"], date: "2026-08-04" }] },
      { mode: "public" },
      { registry: value, identityLookup: lookup },
    );
    expect(result.partial).toBe(true);
    expect(result.requests[0].sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "schedule", status: "complete" }),
      expect.objectContaining({ name: "teams", status: "error" }),
    ]));
  });

  it("never exposes private state in public mode", async () => {
    storage.getUserHoldingsWithPlayers.mockClear();
    const result = await assembleSportsContext(
      { requests: [{ sport: "mlb", sections: ["user_exposure"], athleteIds: ["mlb_1"] }] },
      { mode: "public" },
      { registry: registry(), identityLookup: lookup, storage },
    );
    expect(result.requests[0].sections[0]).toMatchObject({ status: "error", data: null });
    expect(storage.getUserHoldingsWithPlayers).not.toHaveBeenCalled();
  });

  it("sanitizes authenticated connected-user exposure", async () => {
    const result = await assembleSportsContext(
      { requests: [{ sport: "mlb", sections: ["user_exposure"], athleteIds: ["mlb_1"] }] },
      { mode: "authenticated", userId: "u1" },
      { registry: registry(), identityLookup: lookup, storage },
    );
    expect(result.requests[0].sections[0].data).toEqual({
      holdings: [{ playerId: "mlb_1", shares: 4, lockedShares: 1, multiplier: 2 }],
      watchlists: [{ id: "w1", name: "Targets", playerIds: ["mlb_1"] }],
    });
  });

  it("rejects oversized requests before provider access", async () => {
    await expect(assembleSportsContext(
      { requests: Array.from({ length: 7 }, () => ({ sport: "mlb" as const, sections: ["teams" as const] })) },
      { mode: "public" },
      { registry: registry(), identityLookup: lookup },
    )).rejects.toBeTruthy();
  });
});
'''
(ROOT / "server/sports/context-service.test.ts").write_text(context_tests)

registry_path = ROOT / "server/mcp/public-tool-registry.ts"
text = registry_path.read_text()
text = replace_once(
    text,
    'import { sportSchema, type Sport } from "../sports/contracts";\n',
    'import { sportSchema, type Sport } from "../sports/contracts";\n'
    'import { assembleSportsContext } from "../sports/context-service";\n'
    'import type { ProviderIdentityLookup } from "../sports/provider-identity";\n',
    "context imports",
)
text = replace_once(
    text,
    '  sportsRegistry?: SportsAdapterRegistry;\n};',
    '  sportsRegistry?: SportsAdapterRegistry;\n  sportsIdentityLookup?: ProviderIdentityLookup;\n};',
    "context dependency",
)

schema_marker = '''const eventLiveStateSchema: RawSchema = {
  sport: sportSchema,
  eventId: z.string().min(1).max(160),
};'''
schema_add = schema_marker + '''
const sportsContextToolSchema: RawSchema = {
  requests: z
    .array(
      z
        .object({
          sport: sportSchema,
          sections: z
            .array(
              z.enum([
                "entities",
                "teams",
                "schedule",
                "recent_performance",
                "live_state",
                "standings",
                "leaders",
                "user_exposure",
              ]),
            )
            .min(1)
            .max(8),
          athleteIds: z.array(z.string().min(1).max(160)).max(20).optional(),
          teamIds: z.array(z.string().min(1).max(160)).max(20).optional(),
          eventIds: z.array(z.string().min(1).max(160)).max(10).optional(),
          date: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(),
          startDate: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(),
          endDate: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(),
          season: z.string().min(4).max(16).optional(),
        })
        .strict(),
    )
    .min(1)
    .max(6),
  providerReferences: z
    .array(
      z
        .object({
          sport: sportSchema,
          provider: z.string().min(1).max(80),
          entityType: z.enum(["athlete", "team", "event"]),
          providerId: z.string().min(1).max(160),
        })
        .strict(),
    )
    .max(30)
    .optional(),
  deadlineMs: z.number().int().min(250).max(8000).optional(),
};'''
text = replace_once(text, schema_marker, schema_add, "context schema")

function_marker = 'async function getGameInsights(context: PublicMcpServerContext, args: Record<string, unknown>) {'
context_function = r'''async function getBatchedSportsContext(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const registry = getPublicSportsRegistry(context);
  const identityLookup: ProviderIdentityLookup =
    context.deps.sportsIdentityLookup ||
    (async (references) =>
      references
        .filter((reference) => reference.provider === "sportfolio")
        .map((reference) => ({ ...reference, sportfolioId: reference.providerId })));
  const result = await assembleSportsContext(
    args as any,
    { mode: "authenticated", userId: context.userId },
    {
      registry,
      identityLookup,
      storage: context.deps.storage,
    },
  );
  return {
    summary: `Loaded ${result.requests.length} batched sports context request(s).`,
    ...result,
  };
}

'''
text = replace_once(text, function_marker, context_function + function_marker, "context function")

tool_marker = '''  defineTool({
    name: "get_supported_sports_capabilities",'''
context_tool = '''  defineTool({
    name: "get_sports_context",
    title: "Get batched sports context",
    description:
      "Use this to assemble only the requested MLB, NHL, or NASCAR entity, schedule, performance, live-state, or sanitized connected-user sections in one bounded call.",
    domain: "sports_data",
    readOnly: true,
    inputSchema: sportsContextToolSchema,
    fixtureArgs: {
      requests: [{ sport: "mlb", sections: ["schedule"], date: "2026-08-04" }],
      deadlineMs: 4000,
    },
    execute: getBatchedSportsContext,
  }),
'''
text = replace_once(text, tool_marker, context_tool + tool_marker, "context tool")

pattern = re.compile(r"const PUBLIC_TOOL_ONLY_CAPABILITY_IDS = \[(.*?)\] as const;", re.S)
match = pattern.search(text)
if not match:
    raise RuntimeError("public tool capability list not found")
body = match.group(1)
if '"get_sports_context"' not in body:
    body += '\n  "get_sports_context",'
text = text[:match.start(1)] + body + text[match.end(1):]
registry_path.write_text(text)

submission_path = ROOT / "chatgpt-app-submission.json"
submission = json.loads(submission_path.read_text())
submission["tools"]["get_sports_context"] = {
    "annotations": {"readOnlyHint": True, "openWorldHint": False, "destructiveHint": False},
    "justifications": {
        "read_only_justification": "Retrieves sanitized sports_data information and does not modify Sportfolio account or gameplay state.",
        "open_world_justification": "Operates only within the connected user's private Sportfolio game account and does not publish to the public internet or modify an unrelated third-party system.",
        "destructive_justification": "Does not delete, revoke, irreversibly overwrite, or finalize a destructive action according to the implemented tool behavior.",
    },
}
submission["tools"] = dict(sorted(submission["tools"].items()))
submission_path.write_text(json.dumps(submission, indent=2) + "\n")

(ROOT / "docs/plugin/batched-sports-context.md").write_text('''# Batched sports context\n\n`get_sports_context` assembles only explicitly requested MLB, NHL, and NASCAR sections. It deduplicates source calls, resolves provider references once, bounds concurrency and date ranges, preserves per-section freshness and warnings, and returns partial results deterministically when one source fails.\n\nConnected-user exposure is available only through authenticated MCP execution and is reduced to player IDs, share quantities, locked shares, multipliers, and watchlist membership. Public service calls cannot retrieve this section. No account credentials, balances, email addresses, trade history, or write behavior are included.\n\nCurrent adapters do not expose standings or leaguewide leader contracts. Requests for those sections return an explicit unsupported status rather than inferred substitute data.\n''')
(ROOT / "docs/implementation/batched-sports-context.md").write_text('''# Batched sports context implementation\n\nIssue #345 adds `server/sports/context-service.ts` and one compact public MCP tool. Before this change, a multi-sport question required separate entity, schedule, stats, live-state, holdings, and watchlist calls. The service memoizes identical source requests, uses a single identity lookup batch, limits section concurrency to three, caps six sport requests, and enforces a four-second default deadline.\n\nDiagnostics report source calls and cache hits. Tests prove duplicate schedule requests use one adapter call, mixed sports are ordered deterministically, partial provider failures retain successful sections, public access cannot load user exposure, authenticated exposure is sanitized, and oversized requests fail before provider access.\n\nRollback consists of reverting this PR; existing individual sports tools and adapters remain unchanged.\n''')
