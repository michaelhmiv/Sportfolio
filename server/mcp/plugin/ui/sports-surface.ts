import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createDefaultPublicMcpDependencies,
  executePublicTool,
  type PublicMcpDependencies,
  type PublicMcpServerContext,
} from "../../public-tool-registry";
import { getPluginOAuthConfig } from "../../../auth/plugin-oauth-config";
import { pluginMcpAuthError } from "../../../auth/plugin-auth-challenge";
import type { PluginMcpContext } from "../context";
import { assertNoRestrictedPluginFields, sanitizePluginValue } from "../sanitizer";
import { SPORTFOLIO_WIDGET_HTML } from "./generated-widget";
import { SPORTFOLIO_SHARED_UI_RESOURCE_URI } from "./shared-resource";
import {
  composedToolWarning,
  invokeComposedPublicTool,
  type ComposedToolState,
} from "./composed-tool";
import { normalizePresentationWarnings } from "./presentation-warnings";
import { normalizePublicError } from "../../public-errors";

type RawSchema = Record<string, z.ZodTypeAny>;
type JsonRecord = Record<string, unknown>;
type SportsPresentationView = "score_slate" | "live_event" | "game_insights";
type SportsPresentationAccess = "public" | "oauth";

type SportsPresentationDefinition = {
  name: string;
  title: string;
  description: string;
  view: SportsPresentationView;
  access: SportsPresentationAccess;
  featureFlag: string;
  resourceUri: string;
  inputSchema: RawSchema;
  fixtureArgs: Record<string, unknown>;
  invoking: string;
  invoked: string;
  render: (
    context: PluginMcpContext,
    publicContext: PublicMcpServerContext,
    args: Record<string, unknown>,
  ) => Promise<JsonRecord>;
};

export const SPORTFOLIO_SPORTS_UI_RESOURCE_URIS = {
  scoreSlate: "ui://sportfolio/score-slate/v1.html",
  liveEvent: "ui://sportfolio/live-event/v1.html",
  gameInsights: "ui://sportfolio/game-insights/v1.html",
} as const;

const sportSchema = z.enum(["mlb", "nhl", "nascar", "nfl"]);

const sportsPresentationOutputSchema: RawSchema = {
  view: z.enum(["score_slate", "live_event", "game_insights"]),
  asOf: z.string().datetime(),
  data: z.unknown(),
  warnings: z.array(z.string().max(500)).max(20),
};

const scoreSlateInputSchema: RawSchema = {
  sport: sportSchema.optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: z
    .enum(["scheduled", "in_progress", "final", "postponed", "suspended", "cancelled"])
    .optional(),
  team: z.string().trim().min(1).max(80).optional(),
  limit: z.number().int().min(1).max(50).optional().default(12),
};

const liveEventInputSchema: RawSchema = {
  sport: sportSchema,
  eventId: z.string().min(1).max(160),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
};

const gameInsightsInputSchema: RawSchema = {
  sport: sportSchema,
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
};

function flagEnabled(name: string, defaultValue = true): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return defaultValue;
  return !["0", "false", "off", "no"].includes(raw.trim().toLowerCase());
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableScore(value: unknown): number | string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value;
  return null;
}

function sanitizePresentation(
  view: SportsPresentationView,
  data: JsonRecord,
  warnings: string[] = [],
): JsonRecord {
  const payload = sanitizePluginValue({
    view,
    asOf: new Date().toISOString(),
    data,
    warnings: normalizePresentationWarnings(warnings),
  });
  assertNoRestrictedPluginFields(payload);
  return payload as JsonRecord;
}

function toPublicContext(
  context: PluginMcpContext,
  deps: PublicMcpDependencies,
): PublicMcpServerContext {
  return {
    userId: context.auth?.userId || "plugin-public-user",
    deps,
  };
}

async function executeOptional(
  publicContext: PublicMcpServerContext,
  name: string,
  args: Record<string, unknown>,
): Promise<{ value: JsonRecord | null; state: ComposedToolState; warning?: string }> {
  const result = await invokeComposedPublicTool(publicContext, name, args);
  return {
    value: result.state === "unavailable" ? null : result.data,
    state: result.state,
    warning: composedToolWarning(result),
  };
}

function normalizedGame(value: unknown, userContext?: unknown): JsonRecord {
  const game = record(value);
  return {
    gameId: stringValue(game.gameId || game.id),
    sport: stringValue(game.sport).toLowerCase(),
    status: stringValue(game.status, "unknown"),
    startTime: stringValue(game.startTime || game.startsAt) || null,
    homeTeam: stringValue(game.homeTeam || game.homeTeamId) || null,
    awayTeam: stringValue(game.awayTeam || game.awayTeamId) || null,
    homeScore: nullableScore(game.homeScore),
    awayScore: nullableScore(game.awayScore),
    venue: stringValue(game.venue) || null,
    sourceStatus: stringValue(game.sourceStatus) || null,
    userContext: userContext ? record(userContext) : null,
  };
}

async function renderScoreSlate(
  context: PluginMcpContext,
  publicContext: PublicMcpServerContext,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  const sport = stringValue(args.sport).toLowerCase();
  const date = stringValue(args.date);
  const status = stringValue(args.status);
  const team = stringValue(args.team).toLowerCase();
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 12));

  const schedule = record(
    await executePublicTool(publicContext, "get_games_today", {
      ...(sport ? { sport } : {}),
      ...(date ? { date } : {}),
    }),
  );
  const rawGames = array(schedule.games).map(record);

  const insightByGame = new Map<string, JsonRecord>();
  let insightSourceStates: Record<string, ComposedToolState> = {};
  if (context.auth) {
    const sports = [
      ...new Set(
        rawGames
          .map((game) => stringValue(game.sport).toLowerCase())
          .filter((value) => ["mlb", "nhl", "nascar", "nfl"].includes(value)),
      ),
    ];
    const insightResponses = await Promise.all(
      sports.map(
        async (insightSport) =>
          [
            insightSport,
            await executeOptional(publicContext, "get_game_insights", {
              sport: insightSport,
              ...(date ? { date } : {}),
            }),
          ] as const,
      ),
    );
    insightSourceStates = Object.fromEntries(
      insightResponses.map(([name, result]) => [name, result.state]),
    );
    for (const [, response] of insightResponses) {
      if (!response.value) continue;
      for (const insight of array(response.value.games).map(record)) {
        const gameId = stringValue(insight.gameId);
        if (gameId) insightByGame.set(gameId, record(insight.userContext));
      }
    }
  }

  const filtered = rawGames.filter((game) => {
    if (status && stringValue(game.status) !== status) return false;
    if (team) {
      const haystack = `${stringValue(game.homeTeam)} ${stringValue(game.awayTeam)}`.toLowerCase();
      if (!haystack.includes(team)) return false;
    }
    return true;
  });

  const games = filtered
    .slice(0, limit)
    .map((game) => normalizedGame(game, insightByGame.get(stringValue(game.gameId))));

  return sanitizePresentation("score_slate", {
    date: stringValue(schedule.date, date),
    sport: stringValue(schedule.sport, sport || "ALL"),
    filters: { status: status || null, team: team || null },
    games,
    total: filtered.length,
    hasMore: filtered.length > games.length,
    sourceStates: {
      schedule: "ok",
      gameInsights: insightSourceStates,
    },
    capabilities: {
      canPersonalize: Boolean(context.auth),
      canOpenLiveEvent: true,
      canUsePip: true,
    },
  });
}

async function renderLiveEvent(
  context: PluginMcpContext,
  publicContext: PublicMcpServerContext,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  const sport = stringValue(args.sport).toLowerCase();
  const eventId = stringValue(args.eventId);
  const date = stringValue(args.date);

  const liveResponse = record(
    await executePublicTool(publicContext, "get_event_live_state", {
      sport,
      eventId,
    }),
  );
  const liveState = record(liveResponse.liveState);

  const schedule = await executeOptional(publicContext, "get_games_today", {
    sport,
    ...(date ? { date } : {}),
  });
  const matchingGame =
    array(schedule.value?.games)
      .map(record)
      .find((game) => stringValue(game.gameId || game.id) === eventId) || null;

  let userContext: JsonRecord | null = null;
  let insights: Awaited<ReturnType<typeof executeOptional>> | null = null;
  if (context.auth) {
    insights = await executeOptional(publicContext, "get_game_insights", {
      sport,
      ...(date ? { date } : {}),
    });
    const matchingInsight = array(insights.value?.games)
      .map(record)
      .find((game) => stringValue(game.gameId) === eventId);
    if (matchingInsight) userContext = record(matchingInsight.userContext);
  }

  return sanitizePresentation("live_event", {
    sport,
    eventId,
    game: matchingGame ? normalizedGame(matchingGame, userContext) : null,
    liveState: {
      status: stringValue(liveState.status, "unknown"),
      clock: stringValue(liveState.clock) || null,
      period: stringValue(liveState.period) || null,
      summary: stringValue(liveState.summary) || null,
      phase: record(liveState.phase),
      progress: record(liveState.progress),
      sourceStatus: stringValue(liveState.sourceStatus) || null,
      statusConfidence: stringValue(liveState.statusConfidence) || null,
      provider: record(liveState.provider),
    },
    sourceStates: {
      liveState: "ok",
      schedule: schedule.state,
      gameInsights: context.auth ? insights?.state || "empty" : "empty",
    },
    capabilities: {
      canUsePip: true,
      canPersonalize: Boolean(context.auth),
    },
  });
}

async function renderGameInsights(
  _context: PluginMcpContext,
  publicContext: PublicMcpServerContext,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  const sport = stringValue(args.sport).toLowerCase();
  const date = stringValue(args.date);
  const response = record(
    await executePublicTool(publicContext, "get_game_insights", {
      sport,
      ...(date ? { date } : {}),
    }),
  );

  return sanitizePresentation("game_insights", {
    sport: stringValue(response.sport, sport),
    date: stringValue(response.date, date),
    insightQuality: stringValue(response.insightQuality, "basic"),
    games: array(response.games).map((game) => {
      const row = record(game);
      return normalizedGame(row, row.userContext);
    }),
  });
}

const SPORTS_PRESENTATION_DEFINITIONS: SportsPresentationDefinition[] = [
  {
    name: "render_score_slate",
    title: "Show Sportfolio score slate",
    description:
      "Render a compact, interactive score and schedule slate for Sportfolio-supported sports, with connected-user overlays when available.",
    view: "score_slate",
    access: "public",
    featureFlag: "PLUGIN_UI_SCORES_ENABLED",
    resourceUri: SPORTFOLIO_SPORTS_UI_RESOURCE_URIS.scoreSlate,
    inputSchema: scoreSlateInputSchema,
    fixtureArgs: { sport: "mlb", limit: 6 },
    invoking: "Loading the score slate…",
    invoked: "Score slate loaded.",
    render: renderScoreSlate,
  },
  {
    name: "render_live_event",
    title: "Follow a live Sportfolio event",
    description:
      "Use this when the user wants to follow one live supported event. It renders score/state context and can request picture-in-picture when the host supports it. Do not use it for a full schedule; use render_score_slate.",
    view: "live_event",
    access: "public",
    featureFlag: "PLUGIN_UI_LIVE_EVENT_ENABLED",
    resourceUri: SPORTFOLIO_SPORTS_UI_RESOURCE_URIS.liveEvent,
    inputSchema: liveEventInputSchema,
    fixtureArgs: { sport: "mlb", eventId: "mlb_game_1" },
    invoking: "Loading live event state…",
    invoked: "Live event loaded.",
    render: renderLiveEvent,
  },
  {
    name: "render_game_insights",
    title: "Show personalized Sportfolio game insights",
    description:
      "Render a connected user's owned-player and boost exposure across a sport's game slate.",
    view: "game_insights",
    access: "oauth",
    featureFlag: "PLUGIN_UI_GAME_INSIGHTS_ENABLED",
    resourceUri: SPORTFOLIO_SPORTS_UI_RESOURCE_URIS.gameInsights,
    inputSchema: gameInsightsInputSchema,
    fixtureArgs: { sport: "mlb" },
    invoking: "Loading personalized game insights…",
    invoked: "Game insights loaded.",
    render: renderGameInsights,
  },
];

export function buildSportsPluginPresentationCatalog() {
  return SPORTS_PRESENTATION_DEFINITIONS.map((definition) => ({
    name: definition.name,
    title: definition.title,
    description: definition.description,
    view: definition.view,
    access: definition.access,
    featureFlag: definition.featureFlag,
    resourceUri: definition.resourceUri,
    fixtureArgs: definition.fixtureArgs,
    readOnly: true as const,
    destructive: false as const,
    openWorld: false as const,
  }));
}

function contentSummary(view: SportsPresentationView, data: JsonRecord): string {
  switch (view) {
    case "score_slate":
      return `Loaded ${array(data.games).length} Sportfolio score card(s).`;
    case "live_event":
      return stringValue(record(data.liveState).summary, "Loaded live Sportfolio event state.");
    case "game_insights":
      return `Loaded ${array(data.games).length} personalized Sportfolio game insight row(s).`;
  }
}

function registerSportsUiResources(server: McpServer): void {
  const descriptions: Record<string, string> = {
    [SPORTFOLIO_SPORTS_UI_RESOURCE_URIS.scoreSlate]:
      "Sportfolio score and schedule cards with live status and optional connected-user overlays.",
    [SPORTFOLIO_SPORTS_UI_RESOURCE_URIS.liveEvent]:
      "Sportfolio live-event interface with inline, fullscreen, and picture-in-picture modes.",
    [SPORTFOLIO_SPORTS_UI_RESOURCE_URIS.gameInsights]:
      "Connected Sportfolio game insights showing owned-player and boost exposure.",
  };

  for (const [index, uri] of Object.values(SPORTFOLIO_SPORTS_UI_RESOURCE_URIS).entries()) {
    server.registerResource(
      `sportfolio-plugin-sports-ui-${index + 1}`,
      uri,
      {
        mimeType: "text/html;profile=mcp-app",
        description: descriptions[uri],
      },
      async () =>
        ({
          contents: [
            {
              uri,
              mimeType: "text/html;profile=mcp-app",
              text: SPORTFOLIO_WIDGET_HTML,
              _meta: {
                ui: {
                  domain: "https://www.sportfolio.market",
                  prefersBorder: true,
                  csp: {
                    connectDomains: [],
                    resourceDomains: ["https://www.sportfolio.market"],
                  },
                },
                "openai/widgetDescription": descriptions[uri],
                "openai/widgetPrefersBorder": true,
              },
            },
          ],
        }) as any,
    );
  }
}

export async function registerSportsPluginUiSurface(
  server: McpServer,
  context: PluginMcpContext,
  deps?: PublicMcpDependencies,
): Promise<void> {
  if (!flagEnabled("PLUGIN_UI_ENABLED")) return;

  const publicDeps = deps || createDefaultPublicMcpDependencies();
  const publicContext = toPublicContext(context, publicDeps);
  registerSportsUiResources(server);

  for (const definition of SPORTS_PRESENTATION_DEFINITIONS) {
    if (!flagEnabled(definition.featureFlag)) continue;
    const oauthSecurity = [{ type: "oauth2" as const, scopes: ["openid"] }];
    const securitySchemes =
      definition.access === "oauth"
        ? oauthSecurity
        : [{ type: "noauth" as const }, ...oauthSecurity];

    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema: sportsPresentationOutputSchema,
        securitySchemes,
        annotations: {
          title: definition.title,
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        _meta: {
          securitySchemes,
          source: "plugin_ui:sports_presentation",
          access: definition.access,
          ui: { resourceUri: SPORTFOLIO_SHARED_UI_RESOURCE_URI },
          "openai/outputTemplate": SPORTFOLIO_SHARED_UI_RESOURCE_URI,
          "openai/toolInvocation/invoking": definition.invoking,
          "openai/toolInvocation/invoked": definition.invoked,
          fixtureArgs: definition.fixtureArgs,
        },
      } as any,
      async (args: Record<string, unknown>) => {
        if (definition.access === "oauth" && !context.auth) {
          return pluginMcpAuthError(getPluginOAuthConfig(), {
            error: "invalid_token",
            description: "Connect your Sportfolio account to use this interactive view.",
          }) as any;
        }
        try {
          const structuredContent = await definition.render(context, publicContext, args || {});
          return {
            content: [
              {
                type: "text" as const,
                text: contentSummary(definition.view, record(structuredContent.data)),
              },
            ],
            structuredContent,
          } as any;
        } catch (error) {
          const normalized = normalizePublicError(error);
          return {
            isError: true,
            content: [{ type: "text" as const, text: normalized.message }],
            structuredContent: {
              view: definition.view,
              asOf: new Date().toISOString(),
              data: { code: normalized.code, retryable: normalized.retryable },
              warnings: [],
            },
          } as any;
        }
      },
    );
  }
}
