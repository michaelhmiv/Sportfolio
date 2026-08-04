from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "server/mcp/public-tool-registry.ts"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


text = REGISTRY.read_text()

text = replace_once(
    text,
    'import { z } from "zod";\n',
    'import { z } from "zod";\n'
    'import { SportsAdapterRegistry, type SportsAdapter } from "../sports/adapter-registry";\n'
    'import { createDefaultSportsAdapterRegistry } from "../sports/default-registry";\n'
    'import { sportSchema, type Sport } from "../sports/contracts";\n',
    "sports imports",
)

text = replace_once(
    text,
    '  runInternalMlbMcpToolBounded: typeof runInternalMlbMcpToolBounded;\n};',
    '  runInternalMlbMcpToolBounded: typeof runInternalMlbMcpToolBounded;\n'
    '  sportsRegistry?: SportsAdapterRegistry;\n};',
    "sports dependency",
)

text = replace_once(
    text,
    'const PUBLIC_DYNAMIC_MLB_SOURCE_ID = "internal_mlb_mcp";\n',
    'const PUBLIC_DYNAMIC_MLB_SOURCE_ID = "internal_mlb_mcp";\n'
    'const DEFAULT_PUBLIC_SPORTS_REGISTRY = createDefaultSportsAdapterRegistry();\n',
    "default sports registry",
)

schema_marker = '''const collectionDetailSchema: RawSchema = {
  type: z.string().min(1),
  targetId: z.string().min(1),
};'''
schema_insert = schema_marker + '''
const publicSportSchema: RawSchema = {
  sport: sportSchema,
};
const sportsEntitySearchSchema: RawSchema = {
  sport: sportSchema,
  entityType: z.enum(["athlete", "team"]),
  query: z.string().min(1).max(120),
  limit: z.number().int().positive().max(50).optional(),
  offset: z.number().int().min(0).max(500).optional(),
};
const sportsEntityDetailSchema: RawSchema = {
  sport: sportSchema,
  entityType: z.enum(["athlete", "team"]),
  entityId: z.string().min(1).max(160),
};
const eventSlateSchema: RawSchema = {
  sport: sportSchema,
  date: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(),
  startDate: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(),
  endDate: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(),
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().min(0).max(500).optional(),
};
const eventLiveStateSchema: RawSchema = {
  sport: sportSchema,
  eventId: z.string().min(1).max(160),
};'''
text = replace_once(text, schema_marker, schema_insert, "sports schemas")

function_marker = 'async function getGameInsights(context: PublicMcpServerContext, args: Record<string, unknown>) {'
functions = r'''type PublicSportsCapability = Exclude<keyof SportsAdapter, "sport">;

function getPublicSportsRegistry(context: PublicMcpServerContext): SportsAdapterRegistry {
  return context.deps.sportsRegistry || DEFAULT_PUBLIC_SPORTS_REGISTRY;
}

function parsePublicSport(value: unknown): Sport {
  const parsed = sportSchema.safeParse(toStringValue(value).toLowerCase());
  if (!parsed.success) {
    throw new PublicMcpToolError(
      "sport must be one of mlb, nhl, or nascar.",
      "unsupported_sport",
    );
  }
  return parsed.data;
}

function requireSportsCapability(
  context: PublicMcpServerContext,
  sport: Sport,
  capability: PublicSportsCapability,
) {
  const registry = getPublicSportsRegistry(context);
  if (!registry.supports(sport, capability)) {
    throw new PublicMcpToolError(
      `${capability} is not supported for ${sport}.`,
      "unsupported_capability",
      { sport, capability },
    );
  }
  return registry.get(sport);
}

function getSportsCapabilityView(context: PublicMcpServerContext, sport: Sport) {
  const registry = getPublicSportsRegistry(context);
  const capabilities: PublicSportsCapability[] = [
    "searchAthletes",
    "getAthlete",
    "getTeams",
    "getSchedule",
    "getStats",
    "getLiveState",
  ];
  return Object.fromEntries(
    capabilities.map((capability) => [capability, registry.supports(sport, capability)]),
  );
}

function resolveSportsDateRange(args: Record<string, unknown>) {
  const date = toOptionalString(args.date);
  const startDate = toOptionalString(args.startDate) || date || getTodayET();
  const endDate = toOptionalString(args.endDate) || date || startDate;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T23:59:59.999Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
    throw new PublicMcpToolError("Invalid event date range.", "invalid_arguments");
  }
  const days = Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
  if (days > 14) {
    throw new PublicMcpToolError(
      "Event slate ranges are limited to 14 days.",
      "request_too_broad",
      { maxDays: 14 },
    );
  }
  return { startDate, endDate, start, end };
}

async function getSupportedSportsCapabilities(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const sport = parsePublicSport(args.sport);
  return {
    summary: `Loaded supported unified sports capabilities for ${sport}.`,
    sport,
    capabilities: getSportsCapabilityView(context, sport),
    supportedSports: getPublicSportsRegistry(context).list(),
    source: "unified_adapter_registry",
  };
}

async function searchSportsEntities(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const sport = parsePublicSport(args.sport);
  const entityType = toStringValue(args.entityType);
  const query = toStringValue(args.query).toLowerCase();
  const limit = toPositiveInteger(args.limit) || 20;
  const offset = Math.max(0, Number(args.offset) || 0);
  if (entityType === "athlete") {
    const adapter = requireSportsCapability(context, sport, "searchAthletes");
    const items = await adapter.searchAthletes!(query);
    return {
      summary: `Found ${items.length} ${sport} athlete match(es).`,
      sport,
      entityType,
      items: items.slice(offset, offset + limit),
      pagination: { offset, limit, total: items.length, hasMore: offset + limit < items.length },
      capabilities: getSportsCapabilityView(context, sport),
    };
  }
  const adapter = requireSportsCapability(context, sport, "getTeams");
  const teams = (await adapter.getTeams!()).filter((team) =>
    `${team.name} ${team.abbreviation || ""}`.toLowerCase().includes(query),
  );
  return {
    summary: `Found ${teams.length} ${sport} team match(es).`,
    sport,
    entityType: "team",
    items: teams.slice(offset, offset + limit),
    pagination: { offset, limit, total: teams.length, hasMore: offset + limit < teams.length },
    capabilities: getSportsCapabilityView(context, sport),
  };
}

async function getSportsEntity(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const sport = parsePublicSport(args.sport);
  const entityType = toStringValue(args.entityType);
  const entityId = toStringValue(args.entityId);
  if (entityType === "athlete") {
    const adapter = requireSportsCapability(context, sport, "getAthlete");
    const entity = await adapter.getAthlete!(entityId);
    if (!entity) {
      throw new PublicMcpToolError("Sports entity not found.", "not_found", {
        sport,
        entityType,
        entityId,
      });
    }
    return { summary: `Loaded ${entity.name}.`, sport, entityType, entity };
  }
  const adapter = requireSportsCapability(context, sport, "getTeams");
  const entity = (await adapter.getTeams!()).find((team) => team.id === entityId) || null;
  if (!entity) {
    throw new PublicMcpToolError("Sports entity not found.", "not_found", {
      sport,
      entityType,
      entityId,
    });
  }
  return { summary: `Loaded ${entity.name}.`, sport, entityType: "team", entity };
}

async function getUnifiedEventSlate(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const sport = parsePublicSport(args.sport);
  const range = resolveSportsDateRange(args);
  const limit = toPositiveInteger(args.limit) || 50;
  const offset = Math.max(0, Number(args.offset) || 0);
  const adapter = requireSportsCapability(context, sport, "getSchedule");
  const events = (await adapter.getSchedule!(range.start, range.end)).sort((left, right) =>
    left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id),
  );
  return {
    summary: `Loaded ${events.length} ${sport} event(s) from ${range.startDate} through ${range.endDate}.`,
    sport,
    range: { startDate: range.startDate, endDate: range.endDate },
    events: events.slice(offset, offset + limit),
    pagination: { offset, limit, total: events.length, hasMore: offset + limit < events.length },
    capabilities: getSportsCapabilityView(context, sport),
  };
}

async function getUnifiedEventLiveState(
  context: PublicMcpServerContext,
  args: Record<string, unknown>,
) {
  const sport = parsePublicSport(args.sport);
  const eventId = toStringValue(args.eventId);
  const adapter = requireSportsCapability(context, sport, "getLiveState");
  const liveState = await adapter.getLiveState!(eventId);
  if (!liveState) {
    throw new PublicMcpToolError("Live event state is not available.", "not_found", {
      sport,
      eventId,
    });
  }
  return {
    summary: `Loaded live state for ${eventId}.`,
    sport,
    eventId,
    liveState,
  };
}

'''
text = replace_once(text, function_marker, functions + function_marker, "sports tool functions")

tools_marker = 'const CUSTOM_TOOLS: PublicToolDefinition[] = [\n'
tools = '''const CUSTOM_TOOLS: PublicToolDefinition[] = [
  defineTool({
    name: "get_supported_sports_capabilities",
    title: "Get supported sports capabilities",
    description:
      "Use this to discover which unified read capabilities are available for MLB, NHL, or NASCAR before selecting another sports-data tool.",
    domain: "sports_data",
    readOnly: true,
    inputSchema: publicSportSchema,
    fixtureArgs: { sport: "mlb" },
    execute: getSupportedSportsCapabilities,
  }),
  defineTool({
    name: "search_sports_entities",
    title: "Search sports entities",
    description:
      "Use this to search canonical athletes, drivers, or teams within one supported sport. Do not use provider-native identifiers as Sportfolio IDs.",
    domain: "sports_data",
    readOnly: true,
    inputSchema: sportsEntitySearchSchema,
    fixtureArgs: { sport: "mlb", entityType: "athlete", query: "Ohtani", limit: 10 },
    execute: searchSportsEntities,
  }),
  defineTool({
    name: "get_sports_entity",
    title: "Get sports entity",
    description:
      "Use this to load one canonical athlete, driver, or team after resolving its stable unified ID.",
    domain: "sports_data",
    readOnly: true,
    inputSchema: sportsEntityDetailSchema,
    fixtureArgs: { sport: "mlb", entityType: "athlete", entityId: "mlb_660271" },
    execute: getSportsEntity,
  }),
  defineTool({
    name: "get_event_slate",
    title: "Get event slate",
    description:
      "Use this to list a compact, chronologically ordered MLB, NHL, or NASCAR schedule for one date or a bounded date range.",
    domain: "sports_data",
    readOnly: true,
    inputSchema: eventSlateSchema,
    fixtureArgs: { sport: "mlb", date: "2026-08-04", limit: 25 },
    execute: getUnifiedEventSlate,
  }),
  defineTool({
    name: "get_event_live_state",
    title: "Get event live state",
    description:
      "Use this to retrieve the current inning, period, lap, stage, clock, and normalized status for one canonical event ID.",
    domain: "sports_data",
    readOnly: true,
    inputSchema: eventLiveStateSchema,
    fixtureArgs: { sport: "mlb", eventId: "mlb_game_1" },
    execute: getUnifiedEventLiveState,
  }),
'''
text = replace_once(text, tools_marker, tools, "sports tool definitions")

pattern = re.compile(r"const PUBLIC_TOOL_ONLY_CAPABILITY_IDS = \[(.*?)\];", re.S)
match = pattern.search(text)
if not match:
    raise RuntimeError("public-tool-only capability list not found")
body = match.group(1)
for name in [
    "get_supported_sports_capabilities",
    "search_sports_entities",
    "get_sports_entity",
    "get_event_slate",
    "get_event_live_state",
]:
    if f'"{name}"' not in body:
        body += f'\n  "{name}",'
text = text[: match.start(1)] + body + text[match.end(1) :]

REGISTRY.write_text(text)

TEST = ROOT / "server/mcp/public-sports-tools.test.ts"
TEST.write_text(r'''import { describe, expect, it } from "vitest";
import { SportsAdapterRegistry } from "../sports/adapter-registry";
import type { ProviderMetadata } from "../sports/contracts";
import { executePublicTool, buildPublicToolRegistry } from "./public-tool-registry";
import { createMockPublicMcpDependencies } from "./testing";

const provider: ProviderMetadata = {
  provider: "fixture",
  fetchedAt: "2026-08-04T12:00:00.000Z",
  staleAfterSeconds: 60,
  isStale: false,
};

function buildRegistry() {
  const registry = new SportsAdapterRegistry();
  registry.register({
    sport: "mlb",
    async searchAthletes(query) {
      return query.toLowerCase().includes("ohtani")
        ? [
            {
              id: "mlb_660271",
              sport: "mlb",
              name: "Shohei Ohtani",
              teamId: "mlb_team_119",
              position: "DH",
              active: true,
              provider,
            },
          ]
        : [];
    },
    async getAthlete(id) {
      return id === "mlb_660271"
        ? {
            id,
            sport: "mlb",
            name: "Shohei Ohtani",
            teamId: "mlb_team_119",
            position: "DH",
            active: true,
            provider,
          }
        : null;
    },
    async getTeams() {
      return [
        {
          id: "mlb_team_119",
          sport: "mlb",
          name: "Los Angeles Dodgers",
          abbreviation: "LAD",
          provider,
        },
      ];
    },
    async getSchedule() {
      return [
        {
          id: "mlb_game_1",
          sport: "mlb",
          startsAt: "2026-08-04T23:10:00.000Z",
          status: "scheduled",
          homeTeamId: "mlb_team_119",
          awayTeamId: "mlb_team_144",
          provider,
        },
      ];
    },
    async getLiveState(gameId) {
      return {
        gameId,
        status: "in_progress",
        clock: null,
        period: "5th",
        summary: "Top 5th",
        provider,
      };
    },
  });
  registry.register({ sport: "nhl", async getSchedule() { return []; } });
  registry.register({ sport: "nascar", async getSchedule() { return []; } });
  return registry;
}

function context() {
  const harness = createMockPublicMcpDependencies();
  harness.deps.sportsRegistry = buildRegistry();
  return { userId: harness.userId, deps: harness.deps };
}

describe("compact unified public sports tools", () => {
  it("registers only curated sport-agnostic names", () => {
    const names = buildPublicToolRegistry().map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_supported_sports_capabilities",
        "search_sports_entities",
        "get_sports_entity",
        "get_event_slate",
        "get_event_live_state",
      ]),
    );
    expect(names.some((name) => name.startsWith("mlb_mcp__"))).toBe(false);
  });

  it("selects the requested adapter and returns compact provenance", async () => {
    const result = await executePublicTool(context(), "search_sports_entities", {
      sport: "mlb",
      entityType: "athlete",
      query: "Ohtani",
      limit: 10,
    });
    expect(result).toMatchObject({
      sport: "mlb",
      entityType: "athlete",
      items: [{ id: "mlb_660271", provider: { provider: "fixture" } }],
      pagination: { total: 1, hasMore: false },
    });
  });

  it("orders and bounds event slate responses", async () => {
    const result = await executePublicTool(context(), "get_event_slate", {
      sport: "mlb",
      date: "2026-08-04",
      limit: 10,
    });
    expect(result).toMatchObject({
      sport: "mlb",
      events: [{ id: "mlb_game_1", status: "scheduled" }],
      pagination: { total: 1 },
    });
  });

  it("fails closed for unsupported capability combinations", async () => {
    await expect(
      executePublicTool(context(), "search_sports_entities", {
        sport: "nascar",
        entityType: "athlete",
        query: "Larson",
      }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
  });

  it("rejects oversized date windows", async () => {
    await expect(
      executePublicTool(context(), "get_event_slate", {
        sport: "mlb",
        startDate: "2026-08-01",
        endDate: "2026-09-01",
      }),
    ).rejects.toMatchObject({ code: "request_too_broad" });
  });
});
''')

DOC = ROOT / "docs/implementation/unified-sports-public-tools.md"
DOC.write_text('''# Unified sports public tools\n\nIssue #344 adds five compact read-only tools backed exclusively by the unified adapter registry.\n\n- `get_supported_sports_capabilities`\n- `search_sports_entities`\n- `get_sports_entity`\n- `get_event_slate`\n- `get_event_live_state`\n\nEvery request requires a canonical `sport` value (`mlb`, `nhl`, or `nascar`). Unsupported sport/capability combinations fail closed with a typed error. Schedule ranges are limited to 14 days, item counts are bounded, results are deterministically ordered, and provider freshness/provenance is preserved on normalized entities.\n\nNo raw provider response, provider-native tool prefix, connected-user state, or write behavior is exposed. Existing authenticated market, portfolio, scouting, boost, liquidity, account, and staged-action tools remain separate.\n\nRollback consists of reverting this PR; the internal adapters and existing gameplay surfaces are unchanged.\n''')
