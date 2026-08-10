import { readFileSync, writeFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, content) {
  writeFileSync(path, content);
  console.log(`[patch] wrote ${path}`);
}

function replaceRequired(path, search, replacement, label = String(search).slice(0, 80)) {
  const source = read(path);
  const next = source.replace(search, replacement);
  if (next === source) {
    throw new Error(`Required patch did not match ${path}: ${label}`);
  }
  write(path, next);
}

function replaceAllRequired(path, search, replacement, minimum = 1) {
  const source = read(path);
  let count = 0;
  let next;
  if (search instanceof RegExp) {
    next = source.replace(search, (...args) => {
      count += 1;
      return typeof replacement === "function" ? replacement(...args) : replacement;
    });
  } else {
    count = source.split(search).length - 1;
    next = source.split(search).join(replacement);
  }
  if (count < minimum) {
    throw new Error(`Expected at least ${minimum} replacement(s) in ${path}, found ${count}`);
  }
  write(path, next);
}

const SHARED_URI_IMPORT = `import { SPORTFOLIO_SHARED_UI_RESOURCE_URI } from "./shared-resource";`;

write(
  "server/mcp/plugin/ui/shared-resource.ts",
  `import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildSportfolioWidgetHtml } from "./generated-widget";

const DEFAULT_ASSET_ORIGIN = "https://www.sportfolio.market";

function resolveAssetOrigin(): string {
  const configured =
    process.env.PUBLIC_SITE_URL || process.env.SITE_URL || process.env.VITE_PUBLIC_SITE_URL;
  if (!configured?.trim()) return DEFAULT_ASSET_ORIGIN;
  try {
    return new URL(configured).origin;
  } catch {
    return DEFAULT_ASSET_ORIGIN;
  }
}

export const SPORTFOLIO_WIDGET_ASSET_ORIGIN = resolveAssetOrigin();
const widgetHtml = buildSportfolioWidgetHtml(SPORTFOLIO_WIDGET_ASSET_ORIGIN);
const widgetHash = createHash("sha256").update(widgetHtml).digest("hex").slice(0, 16);

export const SPORTFOLIO_SHARED_UI_RESOURCE_URI = \`ui://sportfolio/app/\${widgetHash}.html\`;
export const SPORTFOLIO_UI_MIME_TYPE = "text/html;profile=mcp-app";

const SHARED_RESOURCE_NAME = "sportfolio-plugin-ui-shared";
const SHARED_RESOURCE_DESCRIPTION =
  "Shared Sportfolio interactive UI shell. The rendered view is selected from tool structured content.";

export function buildPluginUiResourceMeta(description = SHARED_RESOURCE_DESCRIPTION) {
  const assetOrigin = SPORTFOLIO_WIDGET_ASSET_ORIGIN;
  return {
    ui: {
      domain: assetOrigin,
      prefersBorder: true,
      csp: {
        connectDomains: [],
        resourceDomains: [assetOrigin],
      },
    },
    "openai/widgetDescription": description,
    "openai/widgetPrefersBorder": true,
  };
}

/** Register the canonical content-addressed MCP App resource exactly once. */
export function registerSharedPluginUiResource(server: McpServer): void {
  server.registerResource(
    SHARED_RESOURCE_NAME,
    SPORTFOLIO_SHARED_UI_RESOURCE_URI,
    {
      mimeType: SPORTFOLIO_UI_MIME_TYPE,
      description: SHARED_RESOURCE_DESCRIPTION,
    },
    async () =>
      ({
        contents: [
          {
            uri: SPORTFOLIO_SHARED_UI_RESOURCE_URI,
            mimeType: SPORTFOLIO_UI_MIME_TYPE,
            text: widgetHtml,
            _meta: buildPluginUiResourceMeta(),
          },
        ],
      }) as any,
  );
}
`,
);

write(
  "server/mcp/plugin/ui/player-display-name.ts",
  `type JsonRecord = Record<string, unknown>;

export const PLAYER_NAME_UNAVAILABLE = "Name unavailable";

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolvePlayerDisplayName(value: unknown): string {
  const player = record(value);
  return (
    text(player.playerName) ||
    text(player.displayName) ||
    text(player.name) ||
    [text(player.firstName), text(player.lastName)].filter(Boolean).join(" ") ||
    PLAYER_NAME_UNAVAILABLE
  );
}

export function normalizePlayerDisplayNames(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => normalizePlayerDisplayNames(entry));
  if (!value || typeof value !== "object") return value;

  const source = value as JsonRecord;
  const normalized: JsonRecord = {};
  for (const [key, child] of Object.entries(source)) {
    normalized[key] = normalizePlayerDisplayNames(child);
  }

  const looksPlayerBearing =
    typeof source.playerId === "string" ||
    typeof source.playerName === "string" ||
    typeof source.displayName === "string" ||
    typeof source.firstName === "string" ||
    typeof source.lastName === "string";
  if (looksPlayerBearing) {
    normalized.displayName = resolvePlayerDisplayName(source);
  }

  if (source.player && typeof source.player === "object" && !Array.isArray(source.player)) {
    const player = record(normalized.player);
    normalized.player = { ...player, displayName: resolvePlayerDisplayName(source.player) };
  }

  return normalized;
}
`,
);

write(
  "server/mcp/plugin/ui/composed-tool.ts",
  `import {
  executePublicTool,
  type PublicMcpServerContext,
} from "../../public-tool-registry";
import { normalizePlayerDisplayNames } from "./player-display-name";

type JsonRecord = Record<string, unknown>;
export type ComposedToolState = "ok" | "empty" | "unavailable";
export type ComposedToolResult =
  | { state: "ok"; data: JsonRecord }
  | { state: "empty"; data: JsonRecord }
  | { state: "unavailable"; code: string; message: string };

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const value = String((error as { code?: unknown }).code || "").trim();
    if (value) return value;
  }
  return "composed_tool_unavailable";
}

/**
 * Invoke a public tool through the same registry execution path used by MCP.
 * executePublicTool resolves the definition and strictly parses its input schema
 * before invoking the implementation, so composed renderers cannot drift from
 * their child tool contracts.
 */
export async function invokeComposedPublicTool(
  context: PublicMcpServerContext,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ComposedToolResult> {
  try {
    const normalized = record(normalizePlayerDisplayNames(await executePublicTool(context, name, args)));
    return Object.keys(normalized).length === 0
      ? { state: "empty", data: normalized }
      : { state: "ok", data: normalized };
  } catch (error) {
    return {
      state: "unavailable",
      code: errorCode(error),
      message: error instanceof Error ? error.message : \`\${name} is unavailable.\`,
    };
  }
}

export function composedToolValue(result: ComposedToolResult): JsonRecord {
  if (result.state === "unavailable") {
    return {
      state: result.state,
      unavailable: true,
      code: result.code,
      message: result.message,
    };
  }
  return result.data;
}

export function composedToolWarning(result: ComposedToolResult): string | undefined {
  return result.state === "unavailable" ? result.message : undefined;
}
`,
);

write(
  "server/observability/request-log-sanitizer.ts",
  `type HeaderValue = string | string[] | number | undefined;

const SENSITIVE_HEADER_NAME = /(authorization|cookie|session|subject|token|api[-_]?key|secret)/i;
const REDACTED = "[Redacted]";

export function sanitizeRequestHeaders(
  headers: Record<string, HeaderValue> | undefined,
): Record<string, HeaderValue> {
  if (!headers) return {};
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADER_NAME.test(name) ? REDACTED : value,
    ]),
  );
}

export function serializeRequestForLog(req: any) {
  const headers = (req?.raw?.headers || req?.headers || {}) as Record<string, HeaderValue>;
  return {
    id: req?.id,
    method: req?.method,
    url: req?.url,
    headers: sanitizeRequestHeaders(headers),
    remoteAddress: req?.remoteAddress || req?.socket?.remoteAddress,
    remotePort: req?.remotePort || req?.socket?.remotePort,
  };
}
`,
);

replaceRequired(
  "server/mcp/plugin/server.ts",
  `import { installSharedPluginUiResource } from "./ui/shared-resource";`,
  `import { registerSharedPluginUiResource } from "./ui/shared-resource";`,
);
replaceRequired(
  "server/mcp/plugin/server.ts",
  `  installSharedPluginUiResource(registrationServer);`,
  `  registerSharedPluginUiResource(registrationServer);`,
);

replaceRequired(
  "server/mcp/plugin/ui/surface.ts",
  `import { SPORTFOLIO_WIDGET_HTML } from "./generated-widget";`,
  `import { SPORTFOLIO_WIDGET_HTML } from "./generated-widget";\n${SHARED_URI_IMPORT}\nimport { resolvePlayerDisplayName } from "./player-display-name";`,
);
replaceRequired(
  "server/mcp/plugin/ui/surface.ts",
  `  const displayName =\n    stringValue(player.displayName) ||\n    [stringValue(player.firstName), stringValue(player.lastName)].filter(Boolean).join(" ") ||\n    stringValue(player.name, "Unknown player");`,
  `  const displayName = resolvePlayerDisplayName(player);`,
);
replaceAllRequired(
  "server/mcp/plugin/ui/surface.ts",
  `resourceDomains: [],`,
  `resourceDomains: ["https://www.sportfolio.market"],`,
  1,
);
replaceRequired(
  "server/mcp/plugin/ui/surface.ts",
  `          ui: { resourceUri: definition.resourceUri },\n          "openai/outputTemplate": definition.resourceUri,`,
  `          ui: { resourceUri: SPORTFOLIO_SHARED_UI_RESOURCE_URI },\n          "openai/outputTemplate": SPORTFOLIO_SHARED_UI_RESOURCE_URI,`,
);

replaceRequired(
  "server/mcp/plugin/ui/action-surface.ts",
  `import { SPORTFOLIO_WIDGET_HTML } from "./generated-widget";`,
  `import { SPORTFOLIO_WIDGET_HTML } from "./generated-widget";\n${SHARED_URI_IMPORT}`,
);
replaceAllRequired(
  "server/mcp/plugin/ui/action-surface.ts",
  `resourceDomains: [],`,
  `resourceDomains: ["https://www.sportfolio.market"],`,
  1,
);
replaceRequired(
  "server/mcp/plugin/ui/action-surface.ts",
  `        ui: { resourceUri: SPORTFOLIO_ACTION_UI_RESOURCE_URI },\n        "openai/outputTemplate": SPORTFOLIO_ACTION_UI_RESOURCE_URI,`,
  `        ui: { resourceUri: SPORTFOLIO_SHARED_UI_RESOURCE_URI },\n        "openai/outputTemplate": SPORTFOLIO_SHARED_UI_RESOURCE_URI,`,
);

replaceRequired(
  "server/mcp/plugin/ui/gameplay-surface.ts",
  `  executePublicTool,\n`,
  ``,
);
replaceRequired(
  "server/mcp/plugin/ui/gameplay-surface.ts",
  `import { SPORTFOLIO_WIDGET_HTML } from "./generated-widget";`,
  `import { SPORTFOLIO_WIDGET_HTML } from "./generated-widget";\n${SHARED_URI_IMPORT}\nimport { composedToolValue, composedToolWarning, invokeComposedPublicTool } from "./composed-tool";`,
);
replaceRequired(
  "server/mcp/plugin/ui/gameplay-surface.ts",
  `function sanitizePresentation(view: GameplayView, data: JsonRecord): JsonRecord {\n  const payload = sanitizePluginValue({\n    view,\n    asOf: new Date().toISOString(),\n    data,\n    warnings: [],\n  });`,
  `function sanitizePresentation(view: GameplayView, data: JsonRecord, warnings: string[] = []): JsonRecord {\n  const payload = sanitizePluginValue({\n    view,\n    asOf: new Date().toISOString(),\n    data,\n    warnings,\n  });`,
);
replaceRequired(
  "server/mcp/plugin/ui/gameplay-surface.ts",
  /async function safeTool\([\s\S]*?\n}\n\nasync function renderScouting/,
  `async function safeTool(\n  publicContext: PublicMcpServerContext,\n  name: string,\n  args: Record<string, unknown>,\n) {\n  return invokeComposedPublicTool(publicContext, name, args);\n}\n\nasync function renderScouting`,
  "gameplay safeTool",
);
replaceRequired(
  "server/mcp/plugin/ui/gameplay-surface.ts",
  /async function renderScouting\([\s\S]*?\n}\n\nasync function renderBoosts/,
  `async function renderScouting(\n  _context: PluginMcpContext,\n  publicContext: PublicMcpServerContext,\n  args: Record<string, unknown>,\n): Promise<JsonRecord> {\n  const sport = stringValue(args.sport).toLowerCase();\n  const limit = Math.min(20, Math.max(1, Number(args.limit) || 8));\n  const [statusResult, assignmentsResult, opportunitiesResult] = await Promise.all([\n    safeTool(publicContext, "get_scout_status", {}),\n    safeTool(publicContext, "list_scout_assignments", {}),\n    safeTool(publicContext, "list_scout_opportunities", {\n      ...(sport ? { sport } : {}),\n      limit,\n    }),\n  ]);\n  const warnings = [statusResult, assignmentsResult, opportunitiesResult]\n    .map(composedToolWarning)\n    .filter((value): value is string => Boolean(value));\n  return sanitizePresentation(\n    "scouting",\n    {\n      sport: sport || null,\n      limit,\n      status: composedToolValue(statusResult),\n      assignments: composedToolValue(assignmentsResult),\n      opportunities: composedToolValue(opportunitiesResult),\n      sourceStates: {\n        status: statusResult.state,\n        assignments: assignmentsResult.state,\n        opportunities: opportunitiesResult.state,\n      },\n      toolBindings: {\n        stage: "stage_scout_assignment",\n        stageBatch: "stage_scout_assignments",\n        review: "render_action_review",\n      },\n    },\n    warnings,\n  );\n}\n\nasync function renderBoosts`,
  "renderScouting",
);
replaceRequired(
  "server/mcp/plugin/ui/gameplay-surface.ts",
  /async function renderBoosts\([\s\S]*?\n}\n\nfunction firstId/,
  `async function renderBoosts(\n  _context: PluginMcpContext,\n  publicContext: PublicMcpServerContext,\n  args: Record<string, unknown>,\n): Promise<JsonRecord> {\n  const sport = stringValue(args.sport).toLowerCase();\n  const date = stringValue(args.date);\n  const limit = Math.min(20, Math.max(1, Number(args.limit) || 8));\n  const baseArgs = {\n    ...(sport ? { sport } : {}),\n    ...(date ? { date } : {}),\n  };\n  const [activeResult, candidatesResult, eligibleResult, historyResult, communityResult] =\n    await Promise.all([\n      safeTool(publicContext, "list_daily_boosts", baseArgs),\n      safeTool(publicContext, "list_boost_candidates", { ...baseArgs, limit }),\n      safeTool(publicContext, "list_daily_boost_eligible_players", { ...baseArgs, limit }),\n      safeTool(publicContext, "list_daily_boost_history", { ...baseArgs, limit }),\n      safeTool(publicContext, "get_community_boost_state", baseArgs),\n    ]);\n  const results = [activeResult, candidatesResult, eligibleResult, historyResult, communityResult];\n  const warnings = results.map(composedToolWarning).filter((value): value is string => Boolean(value));\n  return sanitizePresentation(\n    "boosts",\n    {\n      sport: sport || null,\n      date: date || null,\n      limit,\n      active: composedToolValue(activeResult),\n      candidates: composedToolValue(candidatesResult),\n      eligible: composedToolValue(eligibleResult),\n      history: composedToolValue(historyResult),\n      community: composedToolValue(communityResult),\n      sourceStates: {\n        active: activeResult.state,\n        candidates: candidatesResult.state,\n        eligible: eligibleResult.state,\n        history: historyResult.state,\n        community: communityResult.state,\n      },\n      toolBindings: {\n        stageAssign: "stage_daily_boost_assign",\n        stageRemove: "stage_daily_boost_remove",\n        stageCommunity: "stage_community_boost_create",\n        review: "render_action_review",\n      },\n    },\n    warnings,\n  );\n}\n\nfunction firstId`,
  "renderBoosts",
);
replaceRequired(
  "server/mcp/plugin/ui/gameplay-surface.ts",
  /async function renderWatchlist\([\s\S]*?\n}\n\nconst DEFINITIONS/,
  `async function renderWatchlist(\n  _context: PluginMcpContext,\n  publicContext: PublicMcpServerContext,\n  args: Record<string, unknown>,\n): Promise<JsonRecord> {\n  const limit = Math.min(50, Math.max(1, Number(args.limit) || 12));\n  const watchlistsResult = await safeTool(publicContext, "list_watchlists", {});\n  const watchlists = composedToolValue(watchlistsResult);\n  const watchlistId = stringValue(args.watchlistId) || firstId(watchlists);\n  const itemsResult = watchlistId\n    ? await safeTool(publicContext, "get_watchlist_items", { watchlistId, limit })\n    : ({ state: "empty", data: { items: [] } } as const);\n  const warnings = [watchlistsResult, itemsResult]\n    .map(composedToolWarning)\n    .filter((value): value is string => Boolean(value));\n  return sanitizePresentation(\n    "watchlist",\n    {\n      watchlistId: watchlistId || null,\n      limit,\n      watchlists,\n      items: composedToolValue(itemsResult),\n      sourceStates: { watchlists: watchlistsResult.state, items: itemsResult.state },\n      toolBindings: {\n        create: "create_watchlist",\n        update: "update_watchlist",\n        addPlayer: "add_watchlist_player",\n        removePlayer: "remove_watchlist_player",\n        delete: "delete_watchlist",\n      },\n    },\n    warnings,\n  );\n}\n\nconst DEFINITIONS`,
  "renderWatchlist",
);
replaceAllRequired(
  "server/mcp/plugin/ui/gameplay-surface.ts",
  `resourceDomains: []`,
  `resourceDomains: ["https://www.sportfolio.market"]`,
  1,
);
replaceRequired(
  "server/mcp/plugin/ui/gameplay-surface.ts",
  `          ui: { resourceUri: definition.resourceUri },\n          "openai/outputTemplate": definition.resourceUri,`,
  `          ui: { resourceUri: SPORTFOLIO_SHARED_UI_RESOURCE_URI },\n          "openai/outputTemplate": SPORTFOLIO_SHARED_UI_RESOURCE_URI,`,
);

replaceRequired(
  "server/mcp/plugin/ui/overview-surface.ts",
  `  executePublicTool,\n`,
  ``,
);
replaceRequired(
  "server/mcp/plugin/ui/overview-surface.ts",
  `import { SPORTFOLIO_WIDGET_HTML } from "./generated-widget";`,
  `import { SPORTFOLIO_WIDGET_HTML } from "./generated-widget";\n${SHARED_URI_IMPORT}\nimport { composedToolValue, composedToolWarning, invokeComposedPublicTool, type ComposedToolState } from "./composed-tool";`,
);
replaceRequired(
  "server/mcp/plugin/ui/overview-surface.ts",
  /async function safeTool\([\s\S]*?\n}\n\nasync function renderDashboard/,
  `async function safeTool(\n  publicContext: PublicMcpServerContext,\n  name: string,\n  args: Record<string, unknown>,\n): Promise<{ value: JsonRecord; state: ComposedToolState; warning?: string }> {\n  const result = await invokeComposedPublicTool(publicContext, name, args);\n  return { value: composedToolValue(result), state: result.state, warning: composedToolWarning(result) };\n}\n\nasync function renderDashboard`,
  "overview safeTool",
);
replaceRequired(
  "server/mcp/plugin/ui/overview-surface.ts",
  `{ recentLotsLimit, dashboard: dashboard.value },`,
  `{ recentLotsLimit, dashboard: dashboard.value, sourceStates: { dashboard: dashboard.state } },`,
);
replaceRequired(
  "server/mcp/plugin/ui/overview-surface.ts",
  `  let selected: { value: JsonRecord; warning?: string } | null = null;`,
  `  let selected: Awaited<ReturnType<typeof safeTool>> | null = null;`,
);
replaceRequired(
  "server/mcp/plugin/ui/overview-surface.ts",
  `      selected: selected?.value || null,`,
  `      selected: selected?.value || null,\n      sourceStates: { collections: collectionList.state, selected: selected?.state || "empty" },`,
);
replaceRequired(
  "server/mcp/plugin/ui/overview-surface.ts",
  `{ category, limit, rankings: rankings.value },`,
  `{ category, limit, rankings: rankings.value, sourceStates: { rankings: rankings.state } },`,
);
replaceAllRequired(
  "server/mcp/plugin/ui/overview-surface.ts",
  `resourceDomains: []`,
  `resourceDomains: ["https://www.sportfolio.market"]`,
  1,
);
replaceRequired(
  "server/mcp/plugin/ui/overview-surface.ts",
  `          ui: { resourceUri: definition.resourceUri },\n          "openai/outputTemplate": definition.resourceUri,`,
  `          ui: { resourceUri: SPORTFOLIO_SHARED_UI_RESOURCE_URI },\n          "openai/outputTemplate": SPORTFOLIO_SHARED_UI_RESOURCE_URI,`,
);

replaceRequired(
  "server/mcp/plugin/ui/sports-surface.ts",
  `  executePublicTool,\n`,
  `  executePublicTool,\n`,
  "sports import anchor",
);
replaceRequired(
  "server/mcp/plugin/ui/sports-surface.ts",
  `import { SPORTFOLIO_WIDGET_HTML } from "./generated-widget";`,
  `import { SPORTFOLIO_WIDGET_HTML } from "./generated-widget";\n${SHARED_URI_IMPORT}\nimport { composedToolWarning, invokeComposedPublicTool, type ComposedToolState } from "./composed-tool";`,
);
replaceRequired(
  "server/mcp/plugin/ui/sports-surface.ts",
  /async function executeOptional\([\s\S]*?\n}\n\nfunction normalizedGame/,
  `async function executeOptional(\n  publicContext: PublicMcpServerContext,\n  name: string,\n  args: Record<string, unknown>,\n): Promise<{ value: JsonRecord | null; state: ComposedToolState; warning?: string }> {\n  const result = await invokeComposedPublicTool(publicContext, name, args);\n  return {\n    value: result.state === "unavailable" ? null : result.data,\n    state: result.state,\n    warning: composedToolWarning(result),\n  };\n}\n\nfunction normalizedGame`,
  "sports executeOptional",
);
replaceRequired(
  "server/mcp/plugin/ui/sports-surface.ts",
  `    const insightResponses = await Promise.all(\n      sports.map((insightSport) =>\n        executeOptional(publicContext, "get_game_insights", {\n          sport: insightSport,\n          ...(date ? { date } : {}),\n        }),\n      ),\n    );\n    for (const response of insightResponses) {\n      if (!response) continue;\n      for (const insight of array(response.games).map(record)) {`,
  `    const insightResponses = await Promise.all(\n      sports.map(async (insightSport) => [\n        insightSport,\n        await executeOptional(publicContext, "get_game_insights", {\n          sport: insightSport,\n          ...(date ? { date } : {}),\n        }),\n      ] as const),\n    );\n    for (const [, response] of insightResponses) {\n      if (!response.value) continue;\n      for (const insight of array(response.value.games).map(record)) {`,
);
replaceRequired(
  "server/mcp/plugin/ui/sports-surface.ts",
  `    capabilities: {\n      canPersonalize: Boolean(context.auth),`,
  `    sourceStates: {\n      schedule: "ok",\n      gameInsights: Object.fromEntries(insightResponses.map(([name, result]) => [name, result.state])),\n    },\n    capabilities: {\n      canPersonalize: Boolean(context.auth),`,
);
replaceRequired(
  "server/mcp/plugin/ui/sports-surface.ts",
  `    array(schedule?.games)`,
  `    array(schedule.value?.games)`,
);
replaceRequired(
  "server/mcp/plugin/ui/sports-surface.ts",
  `    const matchingInsight = array(insights?.games)`,
  `    const matchingInsight = array(insights.value?.games)`,
);
replaceRequired(
  "server/mcp/plugin/ui/sports-surface.ts",
  `    capabilities: {\n      canUsePip: true,\n      canPersonalize: Boolean(context.auth),\n    },\n  });\n}\n\nasync function renderGameInsights`,
  `    sourceStates: {\n      liveState: "ok",\n      schedule: schedule.state,\n      gameInsights: context.auth ? insights?.state || "empty" : "empty",\n    },\n    capabilities: {\n      canUsePip: true,\n      canPersonalize: Boolean(context.auth),\n    },\n  });\n}\n\nasync function renderGameInsights`,
  "live event source states",
);
// Keep an optional result available for source-state reporting outside the auth block.
replaceRequired(
  "server/mcp/plugin/ui/sports-surface.ts",
  `  let userContext: JsonRecord | null = null;\n  if (context.auth) {\n    const insights = await executeOptional(publicContext, "get_game_insights", {`,
  `  let userContext: JsonRecord | null = null;\n  let insights: Awaited<ReturnType<typeof executeOptional>> | null = null;\n  if (context.auth) {\n    insights = await executeOptional(publicContext, "get_game_insights", {`,
);
replaceAllRequired(
  "server/mcp/plugin/ui/sports-surface.ts",
  `resourceDomains: [],`,
  `resourceDomains: ["https://www.sportfolio.market"],`,
  1,
);
replaceRequired(
  "server/mcp/plugin/ui/sports-surface.ts",
  `          ui: { resourceUri: definition.resourceUri },\n          "openai/outputTemplate": definition.resourceUri,`,
  `          ui: { resourceUri: SPORTFOLIO_SHARED_UI_RESOURCE_URI },\n          "openai/outputTemplate": SPORTFOLIO_SHARED_UI_RESOURCE_URI,`,
);

replaceRequired(
  "server/mcp/public-tool-registry.ts",
  `const optionalSportDateSchema: RawSchema = {\n  message: z.string().min(1).max(1200).optional(),\n  sport: z.string().min(2).max(16).optional(),\n  date: z\n    .string()\n    .regex(/^\\d{4}-\\d{2}-\\d{2}$/)\n    .optional(),\n};`,
  `const optionalSportDateSchema: RawSchema = {\n  message: z.string().min(1).max(1200).optional(),\n  sport: z.string().min(2).max(16).optional(),\n  date: z\n    .string()\n    .regex(/^\\d{4}-\\d{2}-\\d{2}$/)\n    .optional(),\n};\nconst scoutOpportunitySchema: RawSchema = {\n  message: z.string().min(1).max(1200).optional(),\n  sport: z.string().min(2).max(16).optional(),\n  limit: z.number().int().positive().max(20).optional(),\n};`,
);
replaceRequired(
  "server/mcp/public-tool-registry.ts",
  `    inputSchema: optionalMessageSchema,\n    fixtureArgs: {},\n    execute: (context, args) => executeScanTool(context, "scan_scout_opportunities", args),`,
  `    inputSchema: scoutOpportunitySchema,\n    fixtureArgs: { sport: "mlb", limit: 6 },\n    execute: (context, args) => executeScanTool(context, "scan_scout_opportunities", args),`,
  "list_scout_opportunities schema",
);

replaceRequired(
  "server/mcp/native-operations.ts",
  `      const candidates = players\n        .filter((player) => player.isActive !== false)\n        .sort((a, b) => Number(b.currentPrice || 0) - Number(a.currentPrice || 0))\n        .slice(0, 20)`,
  `      const limit = Math.min(20, positiveInt(args.limit, 20) || 20);\n      const candidates = players\n        .filter((player) => player.isActive !== false)\n        .sort((a, b) => Number(b.currentPrice || 0) - Number(a.currentPrice || 0))\n        .slice(0, limit)`,
);

replaceRequired(
  "server/index.ts",
  `import { logger } from "./lib/logger";`,
  `import { logger } from "./lib/logger";\nimport { serializeRequestForLog } from "./observability/request-log-sanitizer";`,
);
replaceRequired(
  "server/index.ts",
  `    genReqId: (req) => req.requestId ?? nanoid(),\n    customLogLevel:`,
  `    genReqId: (req) => req.requestId ?? nanoid(),\n    serializers: { req: serializeRequestForLog },\n    customLogLevel:`,
);

write(
  "server/mcp/plugin/ui/shared-resource.test.ts",
  `import { describe, expect, it, vi } from "vitest";
import {
  registerSharedPluginUiResource,
  SPORTFOLIO_SHARED_UI_RESOURCE_URI,
  SPORTFOLIO_UI_MIME_TYPE,
  SPORTFOLIO_WIDGET_ASSET_ORIGIN,
} from "./shared-resource";

describe("shared Sportfolio plugin UI resource", () => {
  it("registers one canonical resource without mutating MCP registration methods", async () => {
    const resources: any[][] = [];
    const registerResource = vi.fn((...args: any[]) => resources.push(args));
    const registerTool = vi.fn();
    const server = { registerResource, registerTool } as any;

    registerSharedPluginUiResource(server);

    expect(server.registerResource).toBe(registerResource);
    expect(server.registerTool).toBe(registerTool);
    expect(resources).toHaveLength(1);
    expect(resources[0][1]).toBe(SPORTFOLIO_SHARED_UI_RESOURCE_URI);
    expect(resources[0][2]).toMatchObject({ mimeType: SPORTFOLIO_UI_MIME_TYPE });

    const result = await resources[0][3]();
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]).toMatchObject({
      uri: SPORTFOLIO_SHARED_UI_RESOURCE_URI,
      mimeType: SPORTFOLIO_UI_MIME_TYPE,
      _meta: {
        ui: {
          domain: SPORTFOLIO_WIDGET_ASSET_ORIGIN,
          csp: { connectDomains: [], resourceDomains: [SPORTFOLIO_WIDGET_ASSET_ORIGIN] },
        },
      },
    });
  });
});
`,
);

write(
  "server/mcp/plugin/ui/player-display-name.test.ts",
  `import { describe, expect, it } from "vitest";
import { PLAYER_NAME_UNAVAILABLE, resolvePlayerDisplayName } from "./player-display-name";

describe("player display-name normalization", () => {
  it("uses the required human-name priority", () => {
    expect(resolvePlayerDisplayName({ playerName: "Player Name", displayName: "Display" })).toBe("Player Name");
    expect(resolvePlayerDisplayName({ displayName: "Display", name: "Name" })).toBe("Display");
    expect(resolvePlayerDisplayName({ name: "Name", firstName: "First", lastName: "Last" })).toBe("Name");
    expect(resolvePlayerDisplayName({ firstName: "First", lastName: "Last" })).toBe("First Last");
  });

  it("never substitutes an identifier for a missing human name", () => {
    expect(resolvePlayerDisplayName({ id: "player_123", playerId: "player_123" })).toBe(PLAYER_NAME_UNAVAILABLE);
    expect(PLAYER_NAME_UNAVAILABLE).toBe("Name unavailable");
  });
});
`,
);

write(
  "server/mcp/plugin/ui/composed-tool.test.ts",
  `import { describe, expect, it, vi } from "vitest";
import { invokeComposedPublicTool } from "./composed-tool";

describe("composed public-tool invocation", () => {
  it("uses the public schema and accepts the scouting sport/limit contract", async () => {
    const runNativeScanTool = vi.fn(async (input) => ({ candidates: [], args: input.args }));
    const context = { userId: "u1", deps: { runNativeScanTool } } as any;
    const result = await invokeComposedPublicTool(context, "list_scout_opportunities", {
      sport: "mlb",
      limit: 6,
    });
    expect(result.state).toBe("ok");
    expect(runNativeScanTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "scan_scout_opportunities", args: { sport: "mlb", limit: 6 } }),
    );
  });

  it("surfaces schema drift as unavailable before the child implementation executes", async () => {
    const runNativeScanTool = vi.fn();
    const context = { userId: "u1", deps: { runNativeScanTool } } as any;
    const result = await invokeComposedPublicTool(context, "list_scout_opportunities", {
      sport: "mlb",
      limit: 6,
      unexpected: true,
    });
    expect(result.state).toBe("unavailable");
    expect(runNativeScanTool).not.toHaveBeenCalled();
  });

  it("distinguishes empty results and normalizes player names without using IDs", async () => {
    const emptyContext = {
      userId: "u1",
      deps: { runNativeScanTool: vi.fn(async () => ({})) },
    } as any;
    expect((await invokeComposedPublicTool(emptyContext, "list_scout_opportunities", {})).state).toBe("empty");

    const playerContext = {
      userId: "u1",
      deps: { runNativeScanTool: vi.fn(async () => ({ candidates: [{ playerId: "player_123" }] })) },
    } as any;
    const result = await invokeComposedPublicTool(playerContext, "list_scout_opportunities", {});
    expect(result).toMatchObject({
      state: "ok",
      data: { candidates: [{ playerId: "player_123", displayName: "Name unavailable" }] },
    });
  });
});
`,
);

write(
  "server/observability/request-log-sanitizer.test.ts",
  `import { describe, expect, it } from "vitest";
import { sanitizeRequestHeaders, serializeRequestForLog } from "./request-log-sanitizer";

describe("request log privacy", () => {
  it("redacts auth, cookie, OpenAI session/subject, token, key, and secret headers", () => {
    const headers = sanitizeRequestHeaders({
      authorization: "Bearer secret-token",
      cookie: "session=abc",
      "openai-session-id": "session-secret",
      "openai-subject": "subject-secret",
      "x-api-key": "api-secret",
      "x-auth-token": "token-secret",
      "mcp-method": "tools/list",
      "user-agent": "test-agent",
    });
    const serialized = JSON.stringify(headers);
    for (const secret of ["secret-token", "session=abc", "session-secret", "subject-secret", "api-secret", "token-secret"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(headers["mcp-method"]).toBe("tools/list");
    expect(headers["user-agent"]).toBe("test-agent");
  });

  it("keeps operational request fields while sanitizing headers", () => {
    expect(
      serializeRequestForLog({
        id: "req-1",
        method: "POST",
        url: "/mcp",
        headers: { "mcp-protocol-version": "2026-07-28", "chatgpt-subject": "private" },
      }),
    ).toMatchObject({
      id: "req-1",
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": "2026-07-28", "chatgpt-subject": "[Redacted]" },
    });
  });
});
`,
);

write(
  "server/mcp/plugin/ui/protocol-resource.test.ts",
  `import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createPluginMcpServer } from "../server";
import { SPORTFOLIO_SHARED_UI_RESOURCE_URI, SPORTFOLIO_WIDGET_ASSET_ORIGIN } from "./shared-resource";

const PROTOCOL_VERSION = "2026-07-28";
let requestId = 0;

function requestMeta() {
  return {
    "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: "plugin-ui-protocol-test", version: "1.0.0" },
  };
}

async function call(method: string, params: Record<string, unknown> = {}) {
  requestId += 1;
  const server = await createPluginMcpServer({ auth: null, requestId: \`ui-protocol-\${requestId}\` });
  const handler = createMcpHandler(() => server);
  try {
    const response = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": PROTOCOL_VERSION,
          "mcp-method": method,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          method,
          params: { ...params, _meta: requestMeta() },
        }),
      }),
    );
    expect(response.ok).toBe(true);
    const text = await response.text();
    const payload = response.headers.get("content-type")?.includes("text/event-stream")
      ? JSON.parse(text.split(/\\r?\\n/).find((line) => line.startsWith("data:"))!.slice(5).trim())
      : JSON.parse(text);
    expect(payload.error).toBeUndefined();
    return payload.result;
  } finally {
    await handler.close();
  }
}

describe("Sportfolio MCP v2 UI resource contract", () => {
  it("advertises the canonical shared resource from every presentation tool", async () => {
    const tools = await call("tools/list");
    const presentationTools = tools.tools.filter((tool: any) => tool.name.startsWith("render_"));
    expect(presentationTools.length).toBeGreaterThan(0);
    for (const tool of presentationTools) {
      expect(tool._meta?.ui?.resourceUri).toBe(SPORTFOLIO_SHARED_UI_RESOURCE_URI);
      expect(tool._meta?.["openai/outputTemplate"]).toBe(SPORTFOLIO_SHARED_UI_RESOURCE_URI);
      expect(tool._meta?.ui?.resourceUri).not.toMatch(/\\/v\\d+\\.html$/);
    }
  });

  it("lists one canonical content-addressed resource and reads its MCP App metadata", async () => {
    const resources = await call("resources/list");
    expect(resources.resources.filter((resource: any) => resource.uri === SPORTFOLIO_SHARED_UI_RESOURCE_URI)).toHaveLength(1);
    expect(SPORTFOLIO_SHARED_UI_RESOURCE_URI).toMatch(/^ui:\\/\\/sportfolio\\/app\\/[a-f0-9]{16}\\.html$/);

    const resource = await call("resources/read", { uri: SPORTFOLIO_SHARED_UI_RESOURCE_URI });
    expect(resource.contents[0]).toMatchObject({
      uri: SPORTFOLIO_SHARED_UI_RESOURCE_URI,
      mimeType: "text/html;profile=mcp-app",
      _meta: {
        ui: {
          domain: SPORTFOLIO_WIDGET_ASSET_ORIGIN,
          csp: { connectDomains: [], resourceDomains: [SPORTFOLIO_WIDGET_ASSET_ORIGIN] },
        },
      },
    });
  });
});
`,
);

// Existing compatibility-resource tests should now reflect the asset origin used by their HTML.
for (const path of [
  "server/mcp/plugin/ui/action-surface.test.ts",
  "server/mcp/plugin/ui/gameplay-surface.test.ts",
  "server/mcp/plugin/ui/overview-surface.test.ts",
]) {
  const source = read(path);
  if (source.includes("resourceDomains: []")) {
    write(path, source.replaceAll("resourceDomains: []", 'resourceDomains: ["https://www.sportfolio.market"]'));
  }
}

// Gameplay test explicitly inspects the active tool template; update only that expectation.
replaceRequired(
  "server/mcp/plugin/ui/gameplay-surface.test.ts",
  `import {\n  buildGameplayPluginPresentationCatalog,`,
  `import { SPORTFOLIO_SHARED_UI_RESOURCE_URI } from "./shared-resource";\nimport {\n  buildGameplayPluginPresentationCatalog,`,
);
replaceRequired(
  "server/mcp/plugin/ui/gameplay-surface.test.ts",
  `        ui: { resourceUri: SPORTFOLIO_GAMEPLAY_UI_RESOURCE_URIS.scouting },\n        "openai/outputTemplate": SPORTFOLIO_GAMEPLAY_UI_RESOURCE_URIS.scouting,`,
  `        ui: { resourceUri: SPORTFOLIO_SHARED_UI_RESOURCE_URI },\n        "openai/outputTemplate": SPORTFOLIO_SHARED_UI_RESOURCE_URI,`,
);

console.log("[patch] ChatGPT MCP App hardening transformations complete");
