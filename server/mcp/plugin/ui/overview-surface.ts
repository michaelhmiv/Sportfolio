import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createDefaultPublicMcpDependencies,
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
  composedToolValue,
  composedToolWarning,
  invokeComposedPublicTool,
  type ComposedToolState,
} from "./composed-tool";
import { normalizePresentationWarnings } from "./presentation-warnings";
import { normalizePublicError } from "../../public-errors";

type JsonRecord = Record<string, unknown>;
type RawSchema = Record<string, z.ZodTypeAny>;
type OverviewView = "dashboard" | "collections" | "rankings";

type OverviewDefinition = {
  name: string;
  title: string;
  description: string;
  view: OverviewView;
  sourceToolName: string;
  featureFlag: string;
  resourceUri: string;
  inputSchema: RawSchema;
  fixtureArgs: Record<string, unknown>;
  render: (
    publicContext: PublicMcpServerContext,
    args: Record<string, unknown>,
  ) => Promise<JsonRecord>;
};

export const SPORTFOLIO_OVERVIEW_UI_RESOURCE_URIS = {
  dashboard: "ui://sportfolio/dashboard/v1.html",
  collections: "ui://sportfolio/collections/v1.html",
  rankings: "ui://sportfolio/rankings/v1.html",
} as const;

const dashboardInputSchema: RawSchema = {
  recentLotsLimit: z.number().int().min(1).max(20).optional().default(6),
};
const collectionsInputSchema: RawSchema = {
  type: z.string().min(1).max(80).optional(),
  targetId: z.string().min(1).max(160).optional(),
};
const rankingsInputSchema: RawSchema = {
  category: z
    .enum(["netWorth", "cashBalance", "portfolioValue", "tradingVolume24h", "marketOrders"])
    .optional()
    .default("netWorth"),
  limit: z.number().int().min(3).max(50).optional().default(10),
};
const outputSchema: RawSchema = {
  view: z.enum(["dashboard", "collections", "rankings"]),
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

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function sanitizePresentation(
  view: OverviewView,
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
  return { userId: context.auth?.userId || "plugin-public-user", deps };
}

async function safeTool(
  publicContext: PublicMcpServerContext,
  name: string,
  args: Record<string, unknown>,
): Promise<{ value: JsonRecord; state: ComposedToolState; warning?: string }> {
  const result = await invokeComposedPublicTool(publicContext, name, args);
  return {
    value: composedToolValue(result),
    state: result.state,
    warning: composedToolWarning(result),
  };
}

async function renderDashboard(
  publicContext: PublicMcpServerContext,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  const recentLotsLimit = clamp(args.recentLotsLimit, 6, 1, 20);
  const dashboard = await safeTool(publicContext, "get_dashboard_overview", { recentLotsLimit });
  return sanitizePresentation(
    "dashboard",
    { recentLotsLimit, dashboard: dashboard.value, sourceStates: { dashboard: dashboard.state } },
    dashboard.warning ? [dashboard.warning] : [],
  );
}

async function renderCollections(
  publicContext: PublicMcpServerContext,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  const type = text(args.type);
  const targetId = text(args.targetId);
  const collectionList = await safeTool(publicContext, "list_collections", {});
  let selected: Awaited<ReturnType<typeof safeTool>> | null = null;
  if (type && targetId) {
    selected = await safeTool(publicContext, "get_collection_detail", { type, targetId });
  }
  const warnings = [collectionList.warning, selected?.warning].filter((value): value is string =>
    Boolean(value),
  );
  return sanitizePresentation(
    "collections",
    {
      type: type || null,
      targetId: targetId || null,
      collections: collectionList.value,
      selected: selected?.value || null,
      sourceStates: { collections: collectionList.state, selected: selected?.state || "empty" },
    },
    warnings,
  );
}

async function renderRankings(
  publicContext: PublicMcpServerContext,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  const category = text(args.category) || "netWorth";
  const limit = clamp(args.limit, 10, 3, 50);
  const rankings = await safeTool(publicContext, "get_leaderboard", { category, limit });
  return sanitizePresentation(
    "rankings",
    { category, limit, rankings: rankings.value, sourceStates: { rankings: rankings.state } },
    rankings.warning ? [rankings.warning] : [],
  );
}

const DEFINITIONS: OverviewDefinition[] = [
  {
    name: "render_dashboard",
    title: "Show Sportfolio dashboard",
    description:
      "Use this for the connected user's compact dashboard overview, including bounded recent player lots, achievements, and portfolio progress. Do not use it as a complete holdings export; use render_portfolio.",
    view: "dashboard",
    sourceToolName: "get_dashboard_overview",
    featureFlag: "PLUGIN_UI_DASHBOARD_ENABLED",
    resourceUri: SPORTFOLIO_OVERVIEW_UI_RESOURCE_URIS.dashboard,
    inputSchema: dashboardInputSchema,
    fixtureArgs: { recentLotsLimit: 6 },
    render: renderDashboard,
  },
  {
    name: "render_collections",
    title: "Show Sportfolio collections",
    description:
      "Render the connected user's Sportfolio collection progress and optionally open one collection in a compact interactive view.",
    view: "collections",
    sourceToolName: "list_collections",
    featureFlag: "PLUGIN_UI_COLLECTIONS_ENABLED",
    resourceUri: SPORTFOLIO_OVERVIEW_UI_RESOURCE_URIS.collections,
    inputSchema: collectionsInputSchema,
    fixtureArgs: {},
    render: renderCollections,
  },
  {
    name: "render_rankings",
    title: "Show Sportfolio rankings",
    description:
      "Render live Sportfolio trader rankings with the connected user's current position and nearby rank window.",
    view: "rankings",
    sourceToolName: "get_leaderboard",
    featureFlag: "PLUGIN_UI_RANKINGS_ENABLED",
    resourceUri: SPORTFOLIO_OVERVIEW_UI_RESOURCE_URIS.rankings,
    inputSchema: rankingsInputSchema,
    fixtureArgs: { category: "netWorth", limit: 10 },
    render: renderRankings,
  },
];

export function buildOverviewPluginPresentationCatalog() {
  return DEFINITIONS.map((definition) => ({
    name: definition.name,
    title: definition.title,
    description: definition.description,
    view: definition.view,
    sourceToolName: definition.sourceToolName,
    access: "oauth" as const,
    featureFlag: definition.featureFlag,
    resourceUri: definition.resourceUri,
    fixtureArgs: definition.fixtureArgs,
    readOnly: true as const,
    destructive: false as const,
    openWorld: false as const,
  }));
}

export async function registerOverviewPluginUiSurface(
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
      `sportfolio-plugin-overview-ui-${index + 1}`,
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
                  csp: { connectDomains: [], resourceDomains: ["https://www.sportfolio.market"] },
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
          source: "plugin_ui:overview_presentation",
          access: "oauth",
          ui: { resourceUri: SPORTFOLIO_SHARED_UI_RESOURCE_URI },
          "openai/outputTemplate": SPORTFOLIO_SHARED_UI_RESOURCE_URI,
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
          const structuredContent = await definition.render(publicContext, args || {});
          return {
            content: [{ type: "text" as const, text: `${definition.title} loaded.` }],
            structuredContent,
          } as any;
        } catch (error) {
          const normalized = normalizePublicError(error);
          return {
            isError: true,
            content: [{ type: "text" as const, text: normalized.message }],
            structuredContent: sanitizePresentation(definition.view, {
              code: normalized.code,
              retryable: normalized.retryable,
            }),
          } as any;
        }
      },
    );
  }
}
