import { mkdir, writeFile } from "node:fs/promises";
import { buildPluginStaticCatalog } from "../server/mcp/plugin/registry";
import { buildPublicToolRegistry } from "../server/mcp/public-tool-registry";
import { buildAllPluginPresentationCatalog } from "../server/mcp/plugin/ui/catalog";
import { SPORTFOLIO_SHARED_UI_RESOURCE_URI } from "../server/mcp/plugin/ui/shared-resource";

const sourceBaseline = "main@169dae06d45261e3184aceb9fd7795b78e027d34";

type InventoryEntry = {
  name: string;
  purpose: string;
  mode: "read" | "write";
  sideEffects: string;
  confirmation: "none" | "staged_review_confirm" | "finalizer" | "immediate";
  sportScope: string;
  underlyingService: string;
  callers: string[];
  uiResourceAssociation: string | null;
  responseSize: {
    typicalBytes: number | null;
    p95Bytes: number | null;
    measured: boolean;
  };
  latencyMs: {
    p50: number | null;
    p95: number | null;
    p99: number | null;
    measured: boolean;
  };
  overlappingTools: string[];
  supersededBy: string | null;
  usedByWebsite: "route_backed" | "not_directly_route_backed";
  chatgptOnly: boolean;
  lifecycle: "current" | "legacy_removed";
  decision: "KEEP" | "UI-ONLY" | "REMOVE";
  decisionRationale: string;
};

function sportScope(name: string, inputFieldNames: string[] = [], domain = ""): string {
  if (name.startsWith("get_mlb_")) return "MLB";
  if (domain === "sports_data" || inputFieldNames.includes("sport")) {
    return "MLB/NHL/NASCAR/NFL where supported by the selected adapter";
  }
  return "not sport-scoped";
}

function overlap(name: string): string[] {
  const groups: Record<string, string[]> = {
    get_player_detail: [
      "get_player_stats",
      "get_player_recent_games",
      "get_player_financial_metrics",
      "get_player_shares_info",
      "get_sports_entity",
    ],
    get_player_stats: ["get_player_detail", "get_sports_entity"],
    get_player_recent_games: ["get_player_detail", "get_sports_entity"],
    get_player_financial_metrics: ["get_player_detail", "get_amm_pool_state"],
    get_player_shares_info: ["get_player_detail"],
    get_games_today: ["get_event_slate", "render_score_slate"],
    get_event_slate: ["get_games_today", "render_score_slate"],
    get_event_live_state: ["render_live_event"],
    get_game_insights: ["render_game_insights"],
    get_portfolio_summary: ["get_dashboard_overview", "render_portfolio"],
    get_balance_state: ["get_dashboard_overview", "render_portfolio"],
    get_holdings: ["get_dashboard_overview", "render_portfolio"],
    get_dashboard_overview: ["get_portfolio_summary", "get_balance_state", "render_dashboard"],
    list_daily_boosts: ["render_boosts"],
    list_daily_boost_history: ["render_boosts"],
    list_boost_candidates: ["render_boosts"],
    list_scout_opportunities: ["render_scouting"],
    list_scout_assignments: ["render_scouting"],
    list_watchlists: ["render_watchlist"],
    get_watchlist_items: ["render_watchlist"],
    get_trade_quote: ["render_player_market"],
    get_lp_position: ["render_liquidity_position"],
    get_leaderboard: ["render_rankings"],
  };
  return groups[name] || [];
}

function staticEntry(tool: ReturnType<typeof buildPluginStaticCatalog>[number]): InventoryEntry {
  const mode = tool.readOnly ? "read" : "write";
  const confirmation =
    tool.executionModel === "staged_write"
      ? "staged_review_confirm"
      : tool.executionModel === "finalizer"
        ? "finalizer"
        : mode === "write"
          ? "immediate"
          : "none";
  const sourceTool = buildPublicToolRegistry().find((entry) => entry.name === tool.name);
  const routeBacked = Boolean(sourceTool?.routeRefs?.length);
  return {
    name: tool.name,
    purpose: tool.description,
    mode,
    sideEffects:
      mode === "read"
        ? "None; bounded read."
        : `${tool.executionModel} mutation in the Sportfolio transaction/action layer.`,
    confirmation,
    sportScope: sportScope(
      tool.name,
      sourceTool ? Object.keys(sourceTool.inputSchema || {}) : [],
      tool.domain,
    ),
    underlyingService:
      tool.domain === "mlb"
        ? `Curated MLB provider adapter: ${tool.name}`
        : `Public registry ${tool.domain} handler: ${tool.name}`,
    callers: routeBacked ? tool.routeRefs : ["ChatGPT/MCP model-visible dispatch"],
    uiResourceAssociation: null,
    responseSize: { typicalBytes: null, p95Bytes: null, measured: false },
    latencyMs: { p50: null, p95: null, p99: null, measured: false },
    overlappingTools: overlap(tool.name),
    supersededBy: null,
    usedByWebsite: routeBacked ? "route_backed" : "not_directly_route_backed",
    chatgptOnly: !routeBacked,
    lifecycle: "current",
    decision: "KEEP",
    decisionRationale: tool.readOnly
      ? "Retained as a bounded, orthogonal read primitive or provider-specific capability needed for current routing."
      : tool.executionModel === "staged_write"
        ? "Retained because consequential actions require an explicit server-issued review/confirmation transaction."
        : "Retained because the action is a current product capability with an explicit mutation contract.",
  };
}

function fastEntry(
  name: string,
  purpose: string,
  mode: "read" | "write",
  confirmation: InventoryEntry["confirmation"],
  sport: string,
): InventoryEntry {
  return {
    name,
    purpose,
    mode,
    sideEffects:
      mode === "read"
        ? "None; bounded batched read."
        : "Stages one exact multi-assignment transaction.",
    confirmation,
    sportScope: sport,
    underlyingService:
      name === "resolve_players"
        ? "Public registry search_players in bounded Promise.all fan-out"
        : "Gameplay transaction service: scout_set_counts",
    callers: ["ChatGPT/MCP model-visible dispatch"],
    uiResourceAssociation: null,
    responseSize: { typicalBytes: null, p95Bytes: null, measured: false },
    latencyMs: { p50: null, p95: null, p99: null, measured: false },
    overlappingTools: name === "resolve_players" ? ["search_players"] : ["stage_scout_assignment"],
    supersededBy: null,
    usedByWebsite: "not_directly_route_backed",
    chatgptOnly: true,
    lifecycle: "current",
    decision: "KEEP",
    decisionRationale:
      name === "resolve_players"
        ? "Retained to resolve several names in one model round trip without repeated search calls."
        : "Retained to stage a multi-player scout change as one reviewable transaction.",
  };
}

function presentationEntry(
  tool: ReturnType<typeof buildAllPluginPresentationCatalog>[number],
): InventoryEntry {
  const sport = ["score_slate", "live_event", "game_insights"].includes(tool.view)
    ? "MLB/NHL/NASCAR/NFL where supported"
    : "not sport-scoped";
  return {
    name: tool.name,
    purpose: tool.description,
    mode: "read",
    sideEffects:
      "None; renders bounded final context. UI controls may initiate separate tool calls.",
    confirmation: "none",
    sportScope: sport,
    underlyingService: `Plugin presentation renderer: ${tool.view}`,
    callers: ["ChatGPT render routing", "Sportfolio MCP App widget"],
    uiResourceAssociation: SPORTFOLIO_SHARED_UI_RESOURCE_URI,
    responseSize: { typicalBytes: null, p95Bytes: null, measured: false },
    latencyMs: { p50: null, p95: null, p99: null, measured: false },
    overlappingTools: [],
    supersededBy: null,
    usedByWebsite: "not_directly_route_backed",
    chatgptOnly: true,
    lifecycle: "current",
    decision: "UI-ONLY",
    decisionRationale:
      "Keeps presentation decoupled from data tools and gives the host a single shared, versioned MCP App resource.",
  };
}

const removed: InventoryEntry[] = [
  {
    name: "stage_stack_shares",
    purpose: "Retired Stack Shares assignment tool.",
    mode: "write",
    sideEffects: "Retired gameplay mutation; must not be callable.",
    confirmation: "staged_review_confirm",
    sportScope: "not sport-scoped",
    underlyingService: "Retired Stack Shares transaction path",
    callers: ["Historical production catalog / stale connector cache"],
    uiResourceAssociation: null,
    responseSize: { typicalBytes: null, p95Bytes: null, measured: false },
    latencyMs: { p50: null, p95: null, p99: null, measured: false },
    overlappingTools: ["stage_daily_boost_assign"],
    supersededBy: "stage_daily_boost_assign",
    usedByWebsite: "not_directly_route_backed",
    chatgptOnly: true,
    lifecycle: "legacy_removed",
    decision: "REMOVE",
    decisionRationale:
      "Stack Shares/Stack Power are retired. No runtime alias, registration, metadata, UI binding, or current documentation remains.",
  },
  ...[
    [
      "list_market_opportunities",
      "Redundant market-opportunity list; superseded by bounded market-movers presentation.",
    ],
    [
      "get_market_scanners",
      "Redundant scanner endpoint; removed from ChatGPT surface while retained only where website/internal code requires it.",
    ],
    [
      "list_watchlist_player_ids",
      "Redundant watchlist ID primitive; UI and watchlist reads use the current watchlist contract.",
    ],
    [
      "list_community_boost_history",
      "Redundant history primitive; current boost presentation owns bounded history composition.",
    ],
    [
      "get_market_overview",
      "Analytics-only market research tool removed from ChatGPT model-visible registration.",
    ],
    [
      "screen_markets",
      "Analytics-only market research tool removed from ChatGPT model-visible registration.",
    ],
    [
      "get_market_index",
      "Analytics-only market research tool removed from ChatGPT model-visible registration.",
    ],
    [
      "get_market_tape",
      "Analytics-only market research tool removed from ChatGPT model-visible registration.",
    ],
    [
      "compare_player_markets",
      "Analytics-only market research tool removed from ChatGPT model-visible registration.",
    ],
    [
      "get_market_correlations",
      "Analytics-only market research tool removed from ChatGPT model-visible registration.",
    ],
    [
      "get_holding_multiplier_state",
      "Stale runtime-only tool that leaked framework exceptions; no current product contract.",
    ],
  ].map(([name, purpose]) => ({
    name,
    purpose,
    mode: "read" as const,
    sideEffects: "None; removed from the production ChatGPT surface.",
    confirmation: "none" as const,
    sportScope: "not sport-scoped",
    underlyingService: "Legacy or analytics-only path",
    callers: ["Historical catalog/source references"],
    uiResourceAssociation: null,
    responseSize: { typicalBytes: null, p95Bytes: null, measured: false },
    latencyMs: { p50: null, p95: null, p99: null, measured: false },
    overlappingTools: [],
    supersededBy: null,
    usedByWebsite: "not_directly_route_backed" as const,
    chatgptOnly: true,
    lifecycle: "legacy_removed" as const,
    decision: "REMOVE" as const,
    decisionRationale: purpose,
  })),
];

async function main() {
  const staticTools = buildPluginStaticCatalog().map(staticEntry);
  const fastTools = [
    fastEntry(
      "resolve_players",
      "Resolve several player names to canonical Sportfolio player IDs in one bounded call.",
      "read",
      "none",
      "MLB/NHL/NASCAR/NFL where supported",
    ),
    fastEntry(
      "stage_scout_assignments",
      "Stage multiple scout assignment target counts as one exact bundle for a single confirmation.",
      "write",
      "staged_review_confirm",
      "not sport-scoped",
    ),
  ];
  const presentations = buildAllPluginPresentationCatalog().map(presentationEntry);
  const tools = [...staticTools, ...fastTools, ...presentations].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const document = {
    schemaVersion: 1,
    generatedFrom: sourceBaseline,
    generatedFor: "Sportfolio ChatGPT/OpenAI MCP production surface",
    measurementNotes: [
      "Per-tool latency and response sizes are null when a production sample was not attributable to a single tool. Aggregate Railway and MCP measurements are in docs/plugin/production-audit.md.",
      "Website use is route-backed only when the shared route inventory names the capability; internal website service use may exist without a direct route reference.",
      "The 102 current tools are 85 static public tools, 2 bounded fast paths, and 15 UI-only render tools.",
    ],
    counts: {
      before: { static: 89, analyticsPluginOnly: 6, fastPaths: 2, renderTools: 15, total: 112 },
      after: { static: 85, analyticsPluginOnly: 0, fastPaths: 2, renderTools: 15, total: 102 },
      reduction: 10,
    },
    tools,
    removed,
  };
  await mkdir("docs/plugin", { recursive: true });
  await writeFile(
    "docs/plugin/production-tool-inventory.json",
    `${JSON.stringify(document, null, 2)}\n`,
  );
}

void main();
