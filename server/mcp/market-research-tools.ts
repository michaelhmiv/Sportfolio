import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  compareMarkets,
  getMarketCorrelations,
  getMarketOverview,
  getMarketSeries,
  getMarketTape,
  screenMarkets,
} from "../analytics/market-research";

const timeRangeSchema = z.enum(["1d", "7d", "30d", "90d"]).optional().default("30d");
const sportSchema = z.string().trim().min(2).max(16).optional().default("ALL");

const TOOL_DEFINITIONS = [
  {
    name: "get_market_overview",
    title: "Get Market Overview",
    description:
      "Use this when the user wants to evaluate the health, direction, liquidity, participation, supply, breadth, or sport-level composition of the public Sportfolio economy.",
    inputSchema: { sport: sportSchema, timeRange: timeRangeSchema },
    fixtureArgs: { sport: "ALL", timeRange: "30d" },
    execute: (args: Record<string, unknown>) =>
      getMarketOverview({
        sport: String(args.sport || "ALL"),
        timeRange: String(args.timeRange || "30d"),
      }),
  },
  {
    name: "screen_markets",
    title: "Screen Player Markets",
    description:
      "Use this when the user wants to rank or filter player markets by market cap, volume, turnover, return, net flow, liquidity, trade count, or AMM depth.",
    inputSchema: {
      sport: sportSchema,
      timeRange: timeRangeSchema,
      sort: z
        .enum(["marketCap", "volume", "turnover", "return", "netFlow", "tvl", "trades", "depth"])
        .optional()
        .default("marketCap"),
      limit: z.number().int().min(1).max(100).optional().default(25),
      search: z.string().trim().max(120).optional(),
    },
    fixtureArgs: { sport: "MLB", timeRange: "7d", sort: "volume", limit: 10 },
    execute: (args: Record<string, unknown>) =>
      screenMarkets({
        sport: String(args.sport || "ALL"),
        timeRange: String(args.timeRange || "30d"),
        sort: args.sort as any,
        limit: Number(args.limit || 25),
        search: typeof args.search === "string" ? args.search : undefined,
      }),
  },
  {
    name: "get_market_index",
    title: "Get Market Index",
    description:
      "Use this when the user wants the Sportfolio or sport-specific market trend over time, including equal-weight index performance, daily volume, participation, and net flow.",
    inputSchema: { sport: sportSchema, timeRange: timeRangeSchema },
    fixtureArgs: { sport: "NASCAR", timeRange: "30d" },
    execute: (args: Record<string, unknown>) =>
      getMarketSeries({
        sport: String(args.sport || "ALL"),
        timeRange: String(args.timeRange || "30d"),
      }),
  },
  {
    name: "get_market_tape",
    title: "Get Market Tape",
    description:
      "Use this when the user wants to inspect public Sportfolio transactions, whale prints, buying or selling flow, execution prices, or the trades behind a market move.",
    inputSchema: {
      sport: sportSchema,
      side: z.enum(["all", "buy", "sell", "peer"]).optional().default("all"),
      playerId: z.string().trim().min(1).max(160).optional(),
      minNotional: z.number().min(0).max(1_000_000_000).optional().default(0),
      limit: z.number().int().min(1).max(100).optional().default(40),
    },
    fixtureArgs: { sport: "ALL", side: "all", minNotional: 0, limit: 20 },
    execute: (args: Record<string, unknown>) =>
      getMarketTape({
        sport: String(args.sport || "ALL"),
        side: args.side as any,
        playerId: typeof args.playerId === "string" ? args.playerId : undefined,
        minNotional: Number(args.minNotional || 0),
        limit: Number(args.limit || 40),
      }),
  },
  {
    name: "compare_player_markets",
    title: "Compare Player Markets",
    description:
      "Use this when the user wants a side-by-side financial comparison of specific Sportfolio player markets using absolute price, returns, market cap, TVL, volume, flow, turnover, and AMM depth.",
    inputSchema: {
      playerIds: z.array(z.string().trim().min(1).max(160)).min(1).max(8),
      timeRange: timeRangeSchema,
    },
    fixtureArgs: { playerIds: ["mlb_660271", "mlb_660670"], timeRange: "30d" },
    execute: (args: Record<string, unknown>) =>
      compareMarkets({
        playerIds: Array.isArray(args.playerIds) ? args.playerIds.map(String) : [],
        timeRange: String(args.timeRange || "30d"),
      }),
  },
  {
    name: "get_market_correlations",
    title: "Get Market Correlations",
    description:
      "Use this when the user wants statistically valid relationships between selected player markets. Returns Pearson correlations from aligned daily market returns with the observation count; it does not use team or heuristic bonuses.",
    inputSchema: {
      playerIds: z.array(z.string().trim().min(1).max(160)).min(2).max(8),
      timeRange: timeRangeSchema,
      minSamples: z.number().int().min(3).max(30).optional().default(5),
    },
    fixtureArgs: { playerIds: ["mlb_660271", "mlb_660670"], timeRange: "30d", minSamples: 5 },
    execute: (args: Record<string, unknown>) =>
      getMarketCorrelations({
        playerIds: Array.isArray(args.playerIds) ? args.playerIds.map(String) : [],
        timeRange: String(args.timeRange || "30d"),
        minSamples: Number(args.minSamples || 5),
      }),
  },
] as const;

function toToolResult(value: any) {
  const summary =
    value && typeof value === "object" && typeof value.summary === "string"
      ? value.summary
      : "Sportfolio market research loaded.";
  return {
    content: [{ type: "text" as const, text: summary }],
    structuredContent: value,
  };
}

export function getMarketResearchToolNames() {
  return TOOL_DEFINITIONS.map((tool) => tool.name);
}

export function registerMarketResearchTools(
  server: McpServer,
  options: { plugin?: boolean } = {},
): void {
  for (const tool of TOOL_DEFINITIONS) {
    const securitySchemes = options.plugin ? [{ type: "noauth" as const }] : undefined;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(securitySchemes ? { securitySchemes } : {}),
        annotations: {
          title: tool.title,
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
        _meta: {
          ...(securitySchemes ? { securitySchemes } : {}),
          domain: "market_research",
          access: options.plugin ? "public" : "api_token",
          source: "analytics_v2",
          executionModel: "read",
          confirmationModel: "immediate",
          requiresConfirmation: false,
          riskLevel: "low",
          routeRefs: [
            "/api/analytics/v2/overview",
            "/api/analytics/v2/markets",
            "/api/analytics/v2/series",
            "/api/analytics/v2/tape",
            "/api/analytics/v2/compare",
            "/api/analytics/v2/correlations",
          ],
          fixtureArgs: tool.fixtureArgs,
        },
      } as any,
      async (args: Record<string, unknown>) => toToolResult(await tool.execute(args || {})),
    );
  }
}
