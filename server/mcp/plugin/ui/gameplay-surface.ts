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

type JsonRecord = Record<string, unknown>;
type RawSchema = Record<string, z.ZodTypeAny>;
type GameplayView = "scouting" | "boosts" | "watchlist";

type GameplayDefinition = {
  name: string;
  title: string;
  description: string;
  view: GameplayView;
  featureFlag: string;
  resourceUri: string;
  inputSchema: RawSchema;
  fixtureArgs: Record<string, unknown>;
  render: (
    context: PluginMcpContext,
    publicContext: PublicMcpServerContext,
    args: Record<string, unknown>,
  ) => Promise<JsonRecord>;
};

export const SPORTFOLIO_GAMEPLAY_UI_RESOURCE_URIS = {
  scouting: "ui://sportfolio/scouting/v1.html",
  boosts: "ui://sportfolio/boosts/v1.html",
  watchlist: "ui://sportfolio/watchlist/v1.html",
} as const;

const sportSchema = z.enum(["mlb", "nhl", "nascar", "nfl"]);
const commonInputSchema: RawSchema = {
  sport: sportSchema.optional(),
  limit: z.number().int().min(1).max(20).optional().default(8),
};
const boostInputSchema: RawSchema = {
  sport: sportSchema.optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.number().int().min(1).max(20).optional().default(8),
};
const watchlistInputSchema: RawSchema = {
  watchlistId: z.string().min(1).max(160).optional(),
  limit: z.number().int().min(1).max(50).optional().default(12),
};
const outputSchema: RawSchema = {
  view: z.enum(["scouting", "boosts", "watchlist"]),
  asOf: z.string().datetime(),
  data: z.unknown(),
  warnings: z.array(z.string().max(500)).max(20),
};

function flagEnabled(name: string, defaultValue = true): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return defaultValue;
  return !["0", "false", "off", "no"].includes(raw.trim().toLowerCase());
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sanitizePresentation(view: GameplayView, data: JsonRecord): JsonRecord {
  const payload = sanitizePluginValue({
    view,
    asOf: new Date().toISOString(),
    data,
    warnings: [],
  });
  assertNoRestrictedPluginFields(payload);
  return payload as JsonRecord;
}

function toPublicContext(
  context: PluginMcpContext,
  deps: PublicMcpDependencies,
): PublicMcpServerContext {
  return { userId: context.auth?.userId || "plugin-public-user", deps };
}

async function safeTool(
  publicContext: PublicMcpServerContext,
  name: string,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  try {
    return record(await executePublicTool(publicContext, name, args));
  } catch (error) {
    return {
      unavailable: true,
      message: error instanceof Error ? error.message : `${name} is unavailable.`,
    };
  }
}

async function renderScouting(
  _context: PluginMcpContext,
  publicContext: PublicMcpServerContext,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  const sport = stringValue(args.sport).toLowerCase();
  const limit = Math.min(20, Math.max(1, Number(args.limit) || 8));
  const [status, roster, assignments, opportunities] = await Promise.all([
    safeTool(publicContext, "get_scout_status", {}),
    safeTool(publicContext, "get_scout_roster", {}),
    safeTool(publicContext, "list_scout_assignments", {}),
    safeTool(publicContext, "list_scout_opportunities", {
      ...(sport ? { sport } : {}),
      limit,
    }),
  ]);
  return sanitizePresentation("scouting", {
    sport: sport || null,
    limit,
    status,
    roster,
    assignments,
    opportunities,
    toolBindings: { stage: "stage_scout_assignment", review: "render_action_review" },
  });
}

async function renderBoosts(
  _context: PluginMcpContext,
  publicContext: PublicMcpServerContext,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  const sport = stringValue(args.sport).toLowerCase();
  const date = stringValue(args.date);
  const limit = Math.min(20, Math.max(1, Number(args.limit) || 8));
  const baseArgs = {
    ...(sport ? { sport } : {}),
    ...(date ? { date } : {}),
  };
  const [active, candidates, eligible, history, community] = await Promise.all([
    safeTool(publicContext, "list_daily_boosts", baseArgs),
    safeTool(publicContext, "list_boost_candidates", { ...baseArgs, limit }),
    safeTool(publicContext, "list_daily_boost_eligible_players", { ...baseArgs, limit }),
    safeTool(publicContext, "list_daily_boost_history", { ...baseArgs, limit }),
    safeTool(publicContext, "get_community_boost_state", baseArgs),
  ]);
  return sanitizePresentation("boosts", {
    sport: sport || null,
    date: date || null,
    limit,
    active,
    candidates,
    eligible,
    history,
    community,
    toolBindings: {
      stageAssign: "stage_daily_boost_assign",
      stageRemove: "stage_daily_boost_remove",
      stageCommunity: "stage_community_boost_create",
      review: "render_action_review",
    },
  });
}

function firstId(value: JsonRecord): string {
  const direct = stringValue(value.watchlistId || value.id);
  if (direct) return direct;
  for (const child of Object.values(value)) {
    if (!Array.isArray(child) || !child.length) continue;
    const row = record(child[0]);
    const id = stringValue(row.watchlistId || row.id);
    if (id) return id;
  }
  return "";
}

async function renderWatchlist(
  _context: PluginMcpContext,
  publicContext: PublicMcpServerContext,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 12));
  const watchlists = await safeTool(publicContext, "list_watchlists", {});
  const watchlistId = stringValue(args.watchlistId) || firstId(watchlists);
  const items = watchlistId
    ? await safeTool(publicContext, "get_watchlist_items", { watchlistId, limit })
    : { items: [] };
  return sanitizePresentation("watchlist", {
    watchlistId: watchlistId || null,
    limit,
    watchlists,
    items,
    toolBindings: {
      create: "create_watchlist",
      update: "update_watchlist",
      addPlayer: "add_watchlist_player",
      removePlayer: "remove_watchlist_player",
      delete: "delete_watchlist",
    },
  });
}

const DEFINITIONS: GameplayDefinition[] = [
  {
    name: "render_scouting",
    title: "Show Sportfolio scouting",
    description:
      "Render the connected user's current scouting status, assignments, roster, and candidate opportunities in an interactive Sportfolio view.",
    view: "scouting",
    featureFlag: "PLUGIN_UI_SCOUTING_ENABLED",
    resourceUri: SPORTFOLIO_GAMEPLAY_UI_RESOURCE_URIS.scouting,
    inputSchema: commonInputSchema,
    fixtureArgs: { sport: "mlb", limit: 6 },
    render: renderScouting,
  },
  {
    name: "render_boosts",
    title: "Show Sportfolio boosts",
    description:
      "Render active daily boosts, eligible players, boost candidates, history, and community boost context for the connected user.",
    view: "boosts",
    featureFlag: "PLUGIN_UI_BOOSTS_ENABLED",
    resourceUri: SPORTFOLIO_GAMEPLAY_UI_RESOURCE_URIS.boosts,
    inputSchema: boostInputSchema,
    fixtureArgs: { sport: "mlb", limit: 6 },
    render: renderBoosts,
  },
  {
    name: "render_watchlist",
    title: "Show Sportfolio watchlist",
    description:
      "Render the connected user's Sportfolio watchlists and players with a compact interactive browsing surface.",
    view: "watchlist",
    featureFlag: "PLUGIN_UI_WATCHLISTS_ENABLED",
    resourceUri: SPORTFOLIO_GAMEPLAY_UI_RESOURCE_URIS.watchlist,
    inputSchema: watchlistInputSchema,
    fixtureArgs: { limit: 8 },
    render: renderWatchlist,
  },
];

export function buildGameplayPluginPresentationCatalog() {
  return DEFINITIONS.map((definition) => ({
    name: definition.name,
    title: definition.title,
    description: definition.description,
    view: definition.view,
    access: "oauth" as const,
    featureFlag: definition.featureFlag,
    resourceUri: definition.resourceUri,
    fixtureArgs: definition.fixtureArgs,
    readOnly: true as const,
    destructive: false as const,
    openWorld: false as const,
  }));
}

export async function registerGameplayPluginUiSurface(
  server: McpServer,
  context: PluginMcpContext,
  deps?: PublicMcpDependencies,
): Promise<void> {
  if (!flagEnabled("PLUGIN_UI_ENABLED")) return;
  const publicDeps = deps || createDefaultPublicMcpDependencies();
  const publicContext = toPublicContext(context, publicDeps);
  const oauthSecurity = [{ type: "oauth2" as const, scopes: ["openid"] }];

  for (const [index, definition] of DEFINITIONS.entries()) {
    if (!flagEnabled(definition.featureFlag)) continue;
    server.registerResource(
      `sportfolio-plugin-gameplay-ui-${index + 1}`,
      definition.resourceUri,
      {
        mimeType: "text/html;profile=mcp-app",
        description: definition.description,
      },
      async () =>
        ({
          contents: [
            {
              uri: definition.resourceUri,
              mimeType: "text/html;profile=mcp-app",
              text: SPORTFOLIO_WIDGET_HTML,
              _meta: {
                ui: {
                  domain: "https://www.sportfolio.market",
                  prefersBorder: true,
                  csp: { connectDomains: [], resourceDomains: [] },
                },
                "openai/widgetDescription": definition.description,
                "openai/widgetPrefersBorder": true,
              },
            },
          ],
        }) as any,
    );

    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema,
        securitySchemes: oauthSecurity,
        annotations: {
          title: definition.title,
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        _meta: {
          securitySchemes: oauthSecurity,
          source: "plugin_ui:gameplay_presentation",
          access: "oauth",
          ui: { resourceUri: definition.resourceUri },
          "openai/outputTemplate": definition.resourceUri,
          "openai/toolInvocation/invoking": `Loading ${definition.view}…`,
          "openai/toolInvocation/invoked": `${definition.title} loaded.`,
          fixtureArgs: definition.fixtureArgs,
        },
      } as any,
      async (args: any) => {
        if (!context.auth?.userId) {
          return pluginMcpAuthError(getPluginOAuthConfig(), {
            error: "invalid_token",
            description: "Connect your Sportfolio account to use this interactive view.",
          }) as any;
        }
        try {
          const structuredContent = await definition.render(context, publicContext, args || {});
          return {
            content: [{ type: "text" as const, text: `${definition.title} loaded.` }],
            structuredContent,
          } as any;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Sportfolio could not render this view.";
          return {
            isError: true,
            content: [{ type: "text" as const, text: message }],
            structuredContent: sanitizePresentation(definition.view, {
              code: "plugin_ui_gameplay_render_failed",
              message,
            }),
          } as any;
        }
      },
    );
  }
}
