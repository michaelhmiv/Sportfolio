import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getGameplayTransaction } from "../../gameplay-transactions";
import { getLpPosition, getPool } from "../../../amm/pool";
import { getPluginOAuthConfig } from "../../../auth/plugin-oauth-config";
import { pluginMcpAuthError } from "../../../auth/plugin-auth-challenge";
import { storage } from "../../../storage";
import type { PluginMcpContext } from "../context";
import { assertNoRestrictedPluginFields, sanitizePluginValue } from "../sanitizer";
import { SPORTFOLIO_WIDGET_HTML } from "./generated-widget";
import { SPORTFOLIO_SHARED_UI_RESOURCE_URI } from "./shared-resource";
import { resolvePlayerDisplayName } from "./player-display-name";
import {
  getCanonicalPlayerMarket,
  getCanonicalPlayerMarkets,
  getCanonicalPortfolioValuation,
  getCanonicalPortfolioTotals,
  type CanonicalPortfolioValuation,
} from "../../../valuation/canonical-valuation";

type RawSchema = Record<string, z.ZodTypeAny>;
type JsonRecord = Record<string, unknown>;
type PluginUiView = "player_market" | "trade_preview" | "portfolio" | "market_movers" | "liquidity";
type PluginUiAccess = "public" | "oauth";

type PluginPresentationDefinition = {
  name: string;
  title: string;
  description: string;
  view: PluginUiView;
  access: PluginUiAccess;
  featureFlag: string;
  resourceUri: string;
  inputSchema: RawSchema;
  fixtureArgs: Record<string, unknown>;
  invoking: string;
  invoked: string;
  render: (context: PluginMcpContext, args: Record<string, unknown>) => Promise<JsonRecord>;
};

export const SPORTFOLIO_UI_RESOURCE_URIS = {
  playerMarket: "ui://sportfolio/player-market/v1.html",
  tradePreview: "ui://sportfolio/trade-preview/v1.html",
  portfolio: "ui://sportfolio/portfolio/v1.html",
  marketMovers: "ui://sportfolio/market-movers/v1.html",
  liquidity: "ui://sportfolio/liquidity/v1.html",
} as const;

const presentationOutputSchema: RawSchema = {
  view: z.enum(["player_market", "trade_preview", "portfolio", "market_movers", "liquidity"]),
  asOf: z.string().datetime(),
  data: z.unknown(),
  warnings: z.array(z.string().max(500)).max(20),
};

const playerMarketInputSchema: RawSchema = {
  playerId: z.string().min(1),
  range: z.enum(["1D", "7D", "1M", "1Y", "ALL"]).optional().default("1D"),
};

const tradePreviewInputSchema: RawSchema = {
  transactionId: z.string().uuid(),
};

const portfolioInputSchema: RawSchema = {
  sport: z.string().trim().min(1).max(12).optional(),
  sort: z.enum(["value", "gain", "loss", "quantity", "name"]).optional().default("value"),
  limit: z.number().int().min(1).max(50).optional().default(25),
};

const marketMoversInputSchema: RawSchema = {
  sport: z.string().trim().min(1).max(12).optional(),
  category: z
    .enum(["gainers", "decliners", "volume", "most_traded", "watchlist"])
    .optional()
    .default("gainers"),
  range: z.enum(["1D", "7D"]).optional().default("1D"),
  limit: z.number().int().min(3).max(8).optional().default(6),
};

const liquidityInputSchema: RawSchema = {
  playerId: z.string().min(1),
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

function numberValue(value: unknown, fallback = 0): number {
  const resolved = typeof value === "number" ? value : Number(value);
  return Number.isFinite(resolved) ? resolved : fallback;
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  const text = stringValue(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

function publicPlayer(playerValue: unknown): JsonRecord {
  const player = record(playerValue);
  const displayName = resolvePlayerDisplayName(player);
  return {
    playerId: stringValue(player.id || player.playerId),
    displayName,
    team: stringValue(player.team) || null,
    position: stringValue(player.position) || null,
    sport: stringValue(player.sport) || null,
    injuryStatus: stringValue(player.injuryStatus) || null,
    imageUrl:
      stringValue(player.headshotUrl) ||
      stringValue(player.imageUrl) ||
      stringValue(player.profileImageUrl) ||
      stringValue(player.photoUrl) ||
      null,
  };
}

function rangeDays(range: string): number {
  switch (range) {
    case "1D":
      return 1;
    case "7D":
      return 7;
    case "1M":
      return 31;
    case "1Y":
      return 366;
    case "ALL":
      return 3650;
    default:
      return 1;
  }
}

function downsample<T>(items: T[], maxPoints: number): T[] {
  if (items.length <= maxPoints) return items;
  const selected: T[] = [];
  const seen = new Set<number>();
  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round((index * (items.length - 1)) / Math.max(maxPoints - 1, 1));
    if (seen.has(sourceIndex)) continue;
    seen.add(sourceIndex);
    selected.push(items[sourceIndex]);
  }
  return selected;
}

function sanitizePresentation(view: PluginUiView, data: JsonRecord, warnings: string[] = []) {
  const payload = sanitizePluginValue({
    view,
    asOf: new Date().toISOString(),
    data,
    warnings,
  });
  assertNoRestrictedPluginFields(payload);
  return payload as JsonRecord;
}

function contentSummary(view: PluginUiView, data: JsonRecord): string {
  switch (view) {
    case "player_market":
      return `Loaded the interactive market for ${stringValue(record(data.player).displayName, "this player")}.`;
    case "trade_preview":
      return stringValue(data.summary, "Loaded the staged Sportfolio action for review.");
    case "portfolio":
      return "Loaded the connected Sportfolio portfolio.";
    case "market_movers":
      return "Loaded current Sportfolio market movers.";
    case "liquidity":
      return `Loaded the liquidity position for ${stringValue(record(data.player).displayName, "this player")}.`;
  }
}

async function renderPlayerMarket(
  context: PluginMcpContext,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  const playerId = stringValue(args.playerId);
  const range = stringValue(args.range, "1D");
  const player = await storage.getPlayer(playerId);
  if (!player) throw new Error("Player not found.");

  const userId = context.auth?.userId || null;
  const [
    pool,
    rawHistory,
    financialMetrics,
    stats,
    recentGames,
    holding,
    availableShares,
    availableBalance,
    lp,
    canonicalMarket,
  ] = await Promise.all([
    safe(getPool(playerId), null),
    safe(storage.getPriceHistory(playerId, rangeDays(range)), []),
    safe(storage.getPlayerFinancialMetrics(playerId), null),
    safe(storage.getPlayerSeasonStatsFromLogs(playerId), null),
    safe(storage.getPlayerRecentGamesFromLogs(playerId, 5), []),
    userId ? safe(storage.getHolding(userId, "player", playerId), null) : Promise.resolve(null),
    userId ? safe(storage.getAvailableShares(userId, "player", playerId), 0) : Promise.resolve(0),
    userId ? safe(storage.getAvailableBalance(userId), 0) : Promise.resolve(0),
    userId ? safe(getLpPosition(playerId, userId), null) : Promise.resolve(null),
    safe(getCanonicalPlayerMarket(playerId), null),
  ]);

  const sourcePoints = rawHistory
    .map((row) => ({
      timestamp: dateValue((row as { timestamp?: unknown }).timestamp),
      price: numberValue((row as { price?: unknown }).price, Number.NaN),
      volume: numberValue((row as { volume?: unknown }).volume),
    }))
    .filter((point) => point.timestamp && Number.isFinite(point.price))
    .sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)));
  const points = downsample(sourcePoints, 80);

  const playerRecord = record(player);
  const poolRecord = record(pool);
  const currentPrice = canonicalMarket?.marketPrice ?? null;
  const openingPrice = points.length ? points[0].price : currentPrice;
  const absoluteChange =
    currentPrice == null || openingPrice == null ? null : currentPrice - openingPrice;
  const percentageChange =
    absoluteChange == null || !openingPrice ? null : (absoluteChange / openingPrice) * 100;
  const poolInitialized = canonicalMarket?.poolInitialized || false;
  const holdingRecord = record(holding);
  const lpRecord = record(lp);

  return sanitizePresentation("player_market", {
    player: publicPlayer(player),
    market: {
      status: canonicalMarket?.marketStatus || "unpriced",
      statusMessage: poolInitialized
        ? null
        : "This player does not have an initialized AMM pool yet.",
      currentPrice,
      liquidity: canonicalMarket?.poolTvl ?? null,
      marketCap: canonicalMarket?.marketCap ?? null,
      priceSource: canonicalMarket?.priceSource ?? null,
      lastTradePrice: canonicalMarket?.lastTradePrice ?? null,
      volume: numberValue(poolRecord.totalVolume || playerRecord.volume24h),
      totalTrades: numberValue(poolRecord.totalTrades),
      sharesReserve: numberValue(poolRecord.shares),
      playMoneyReserve: numberValue(poolRecord.playMoney),
      feesAccumulated: numberValue(poolRecord.feesAccumulated),
    },
    history: {
      range,
      points,
      openingPrice,
      currentPrice,
      absoluteChange,
      percentageChange,
      sourcePointCount: sourcePoints.length,
      returnedPointCount: points.length,
      downsampled: sourcePoints.length !== points.length,
    },
    financialMetrics,
    stats,
    recentGames: array(recentGames).slice(0, 5),
    userHolding: userId
      ? {
          quantity: numberValue(holdingRecord.quantity),
          availableShares: numberValue(availableShares),
          avgCostBasis: numberValue(holdingRecord.avgCostBasis),
          totalCostBasis: numberValue(holdingRecord.totalCostBasis),
        }
      : null,
    availableBalance: userId ? availableBalance : null,
    liquidityPosition: userId
      ? {
          lpShares: numberValue(lpRecord.lpShares),
          ownershipPercentage: numberValue(lpRecord.ownershipPercentage),
          positionValue: numberValue(lpRecord.positionValue),
          feesEarnedToDate: numberValue(lpRecord.feesEarnedToDate),
        }
      : null,
    capabilities: {
      authenticated: Boolean(userId),
      canTrade: Boolean(userId && poolInitialized && flagEnabled("PLUGIN_UI_TRADING_ENABLED")),
      canManageLiquidity: Boolean(userId && flagEnabled("PLUGIN_UI_LIQUIDITY_ENABLED")),
    },
    toolBindings: {
      quote: "get_amm_trade_quote",
      stageBuy: "stage_market_buy",
      stageSell: "stage_market_sell",
      confirm: "confirm_pending_action",
      cancel: "cancel_pending_action",
    },
  });
}

async function renderTradePreview(
  context: PluginMcpContext,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  const userId = context.auth?.userId;
  if (!userId) throw new Error("Authentication is required.");
  const transactionId = stringValue(args.transactionId);
  const transaction = await getGameplayTransaction(userId, transactionId);
  return sanitizePresentation("trade_preview", {
    transactionId,
    summary: transaction.summary,
    warnings: transaction.warnings,
    confirmationRequired: transaction.status === "pending_confirmation",
    transaction,
  });
}

export function buildPortfolioViewData(
  valuation: CanonicalPortfolioValuation,
  availableBalance: number,
  args: Record<string, unknown>,
): JsonRecord {
  const totals = getCanonicalPortfolioTotals(valuation);
  const requestedSport = stringValue(args.sport).toUpperCase();
  const sort = stringValue(args.sort, "value");
  const limit = Math.min(50, Math.max(1, Math.trunc(numberValue(args.limit, 25))));
  const normalized = valuation.positions
    .map((position) => {
      const player = record(position.player);
      return {
        player: publicPlayer(player),
        quantity: position.singles,
        singles: position.singles,
        lockedSingles: position.lockedSingles,
        availableShares: position.availableSingles,
        marketStatus: position.marketStatus,
        marketPrice: position.marketPrice,
        currentPrice: position.marketPrice,
        priceSource: position.priceSource,
        positionValue: position.marketValue,
        averageCostBasis: position.averageCostBasis,
        costBasis: position.costBasis,
        unrealizedChange: position.unrealizedChange,
        unrealizedChangePercent: position.unrealizedChangePercent,
        lastTradePrice: position.lastTradePrice,
      };
    })
    .filter((holding) => {
      if (!requestedSport) return true;
      return stringValue(record(holding.player).sport).toUpperCase() === requestedSport;
    });

  normalized.sort((left, right) => {
    switch (sort) {
      case "gain":
        return numberValue(right.unrealizedChange) - numberValue(left.unrealizedChange);
      case "loss":
        return numberValue(left.unrealizedChange) - numberValue(right.unrealizedChange);
      case "quantity":
        return right.quantity - left.quantity;
      case "name":
        return stringValue(record(left.player).displayName).localeCompare(
          stringValue(record(right.player).displayName),
        );
      case "value":
      default:
        return numberValue(right.positionValue) - numberValue(left.positionValue);
    }
  });

  const totalValue = valuation.portfolioValue;
  const costBasis = normalized.reduce((sum, holding) => sum + holding.costBasis, 0);
  const playerPositionValue = normalized.reduce(
    (sum, holding) => sum + numberValue(holding.positionValue),
    0,
  );
  const unrealizedChange = playerPositionValue - costBasis;
  const allocations = new Map<string, number>();
  for (const holding of normalized) {
    const sport = stringValue(record(holding.player).sport, "Other");
    allocations.set(sport, (allocations.get(sport) || 0) + numberValue(holding.positionValue));
  }
  for (const position of valuation.lpPositions) {
    const sport = stringValue(record(position.player).sport, "Other");
    allocations.set(sport, (allocations.get(sport) || 0) + numberValue(position.marketValue));
  }

  return {
    summary: {
      ...totals,
      totalValue,
      availableBalance,
      costBasis,
      unrealizedChange,
      unrealizedChangePercent: costBasis > 0 ? (unrealizedChange / costBasis) * 100 : 0,
      holdingCount: normalized.length,
    },
    allocations: Array.from(allocations.entries()).map(([key, value]) => ({
      key,
      label: key,
      value,
      percentage: totalValue > 0 ? (value / totalValue) * 100 : 0,
    })),
    holdings: normalized.slice(0, limit),
    lpPositions: valuation.lpPositions,
    page: {
      returned: Math.min(limit, normalized.length),
      total: normalized.length,
      hasMore: normalized.length > limit,
    },
    filters: { sport: requestedSport || null, sort },
  };
}

async function renderPortfolio(
  context: PluginMcpContext,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  const userId = context.auth?.userId;
  if (!userId) throw new Error("Authentication is required.");
  const [valuation, availableBalance] = await Promise.all([
    getCanonicalPortfolioValuation(userId),
    storage.getAvailableBalance(userId),
  ]);
  if (!valuation) throw new Error("User not found.");
  return sanitizePresentation(
    "portfolio",
    buildPortfolioViewData(valuation, availableBalance, args),
    valuation.warnings,
  );
}

async function renderMarketMovers(
  context: PluginMcpContext,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  const category = stringValue(args.category, "gainers");
  const requestedSport = stringValue(args.sport).toUpperCase();
  const limit = Math.min(8, Math.max(3, Math.trunc(numberValue(args.limit, 6))));
  if (category === "watchlist" && !context.auth?.userId) {
    throw new Error("Authentication is required for watchlist movers.");
  }

  const sortBy = category === "volume" || category === "most_traded" ? "volume" : "change";
  const sortOrder = category === "decliners" ? "asc" : "desc";
  // Change-sorted categories use the same 24-hour AMM price-change formula in SQL
  // and batch enrichment, so only the requested result window is needed. Volume
  // and most-traded retain the broad candidate set because their final pool metrics
  // are not identical to the database's 24-hour volume ordering.
  const candidateLimit =
    category === "gainers" || category === "decliners" || category === "watchlist" ? limit : 100;
  const result = await storage.getPlayersPaginated({
    sport: requestedSport || undefined,
    limit: candidateLimit,
    offset: 0,
    sortBy,
    sortOrder,
    ...(category === "watchlist" ? { watchlistUserId: context.auth?.userId } : {}),
  });
  const players = result.players;
  const playerIds = players.map((player) => player.id);
  const [poolData, changeData, canonicalMarkets] = await Promise.all([
    playerIds.length ? storage.getBatchPoolData(playerIds) : Promise.resolve(new Map()),
    playerIds.length ? storage.getBatchPlayerPriceChange24h(playerIds) : Promise.resolve(new Map()),
    getCanonicalPlayerMarkets(playerIds),
  ]);

  const items = players.map((player) => {
    const playerRecord = record(player);
    const pool = record(poolData.get(player.id));
    const market = canonicalMarkets.get(player.id);
    return {
      player: publicPlayer(player),
      marketStatus: market?.marketStatus || "unpriced",
      currentPrice: market?.marketPrice ?? null,
      changePercent: numberValue(changeData.get(player.id) || playerRecord.priceChange24h),
      volume: numberValue(pool.totalVolume || playerRecord.volume24h),
      totalTrades: numberValue(pool.totalTrades),
      liquidity: numberValue(pool.playMoney) * 2,
    };
  });

  items.sort((left, right) => {
    if (category === "decliners") return left.changePercent - right.changePercent;
    if (category === "volume") return right.volume - left.volume;
    if (category === "most_traded") return right.totalTrades - left.totalTrades;
    return right.changePercent - left.changePercent;
  });

  return sanitizePresentation("market_movers", {
    category,
    range: stringValue(args.range, "1D"),
    sport: requestedSport || null,
    items: items.slice(0, limit),
    returned: Math.min(limit, items.length),
  });
}

async function renderLiquidity(
  context: PluginMcpContext,
  args: Record<string, unknown>,
): Promise<JsonRecord> {
  const userId = context.auth?.userId;
  if (!userId) throw new Error("Authentication is required.");
  const playerId = stringValue(args.playerId);
  const player = await storage.getPlayer(playerId);
  if (!player) throw new Error("Player not found.");
  const [pool, position, holding, availableBalance, canonicalMarket] = await Promise.all([
    safe(getPool(playerId), null),
    safe(getLpPosition(playerId, userId), null),
    safe(storage.getHolding(userId, "player", playerId), null),
    safe(storage.getAvailableBalance(userId), 0),
    safe(getCanonicalPlayerMarket(playerId), null),
  ]);
  const poolRecord = record(pool);
  const positionRecord = record(position);
  const holdingRecord = record(holding);
  return sanitizePresentation("liquidity", {
    player: publicPlayer(player),
    pool: {
      initialized: Boolean(pool),
      marketStatus: canonicalMarket?.marketStatus || "unpriced",
      shares: numberValue(poolRecord.shares),
      playMoney: numberValue(poolRecord.playMoney),
      currentPrice: canonicalMarket?.marketPrice ?? null,
      liquidity: canonicalMarket?.poolTvl ?? null,
      totalVolume: numberValue(poolRecord.totalVolume),
      totalTrades: numberValue(poolRecord.totalTrades),
      lpSharesTotal: numberValue(poolRecord.lpSharesTotal),
      feesAccumulated: numberValue(poolRecord.feesAccumulated),
    },
    position: {
      lpShares: numberValue(positionRecord.lpShares),
      totalLpShares: numberValue(positionRecord.totalLpShares),
      ownershipPercentage: numberValue(positionRecord.ownershipPercentage),
      equivalentShares: numberValue(positionRecord.equivalentShares),
      equivalentPlayMoney: numberValue(positionRecord.equivalentPlayMoney),
      positionValue:
        canonicalMarket?.marketPrice == null ? null : numberValue(positionRecord.positionValue),
      feesEarnedToDate: numberValue(positionRecord.feesEarnedToDate),
    },
    availableAssets: {
      shares: numberValue(holdingRecord.availableShares || holdingRecord.quantity),
      playMoney: availableBalance,
    },
    capabilities: {
      canManage: Boolean(pool && flagEnabled("PLUGIN_UI_LIQUIDITY_ENABLED")),
    },
    toolBindings: {
      stageAdd: "stage_lp_add",
      stageRemove: "stage_lp_remove",
      confirm: "confirm_pending_action",
      cancel: "cancel_pending_action",
    },
  });
}

const PRESENTATION_DEFINITIONS: PluginPresentationDefinition[] = [
  {
    name: "render_player_market",
    title: "Show Player Market",
    description:
      "Render an interactive Sportfolio player market with current virtual price, bounded price history, account holding context, live quotes, and staged buy or sell controls. Use this after resolving a player id.",
    view: "player_market",
    access: "public",
    featureFlag: "PLUGIN_UI_MARKET_ENABLED",
    resourceUri: SPORTFOLIO_UI_RESOURCE_URIS.playerMarket,
    inputSchema: playerMarketInputSchema,
    fixtureArgs: { playerId: "player_1", range: "1D" },
    invoking: "Loading player market…",
    invoked: "Player market loaded.",
    render: renderPlayerMarket,
  },
  {
    name: "render_trade_preview",
    title: "Show Pending Sportfolio Action",
    description:
      "Render one staged Sportfolio gameplay transaction with Confirm and Cancel controls. Use this only after a stage_* tool returns transactionId.",
    view: "trade_preview",
    access: "oauth",
    featureFlag: "PLUGIN_UI_TRADING_ENABLED",
    resourceUri: SPORTFOLIO_UI_RESOURCE_URIS.tradePreview,
    inputSchema: tradePreviewInputSchema,
    fixtureArgs: { transactionId: "00000000-0000-4000-8000-000000000001" },
    invoking: "Loading staged action…",
    invoked: "Staged action ready for review.",
    render: renderTradePreview,
  },
  {
    name: "render_portfolio",
    title: "Show Sportfolio Portfolio",
    description:
      "Render the authenticated user's Sportfolio portfolio, balances, allocation, and player holdings in an interactive dashboard.",
    view: "portfolio",
    access: "oauth",
    featureFlag: "PLUGIN_UI_PORTFOLIO_ENABLED",
    resourceUri: SPORTFOLIO_UI_RESOURCE_URIS.portfolio,
    inputSchema: portfolioInputSchema,
    fixtureArgs: { sort: "value", limit: 25 },
    invoking: "Loading portfolio…",
    invoked: "Portfolio loaded.",
    render: renderPortfolio,
  },
  {
    name: "render_market_movers",
    title: "Show Market Movers",
    description:
      "Render a compact carousel of current Sportfolio gainers, decliners, volume leaders, most-traded players, or authenticated watchlist movers.",
    view: "market_movers",
    access: "public",
    featureFlag: "PLUGIN_UI_DISCOVERY_ENABLED",
    resourceUri: SPORTFOLIO_UI_RESOURCE_URIS.marketMovers,
    inputSchema: marketMoversInputSchema,
    fixtureArgs: { category: "gainers", range: "1D", limit: 6 },
    invoking: "Loading market movers…",
    invoked: "Market movers loaded.",
    render: renderMarketMovers,
  },
  {
    name: "render_liquidity_position",
    title: "Show Liquidity Position",
    description:
      "Render the authenticated user's virtual AMM liquidity position for a player with staged add and remove controls.",
    view: "liquidity",
    access: "oauth",
    featureFlag: "PLUGIN_UI_LIQUIDITY_ENABLED",
    resourceUri: SPORTFOLIO_UI_RESOURCE_URIS.liquidity,
    inputSchema: liquidityInputSchema,
    fixtureArgs: { playerId: "player_1" },
    invoking: "Loading liquidity position…",
    invoked: "Liquidity position loaded.",
    render: renderLiquidity,
  },
];

export function buildPluginPresentationCatalog() {
  return PRESENTATION_DEFINITIONS.map((definition) => ({
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

function registerUiResources(server: McpServer): void {
  const descriptions: Record<string, string> = {
    [SPORTFOLIO_UI_RESOURCE_URIS.playerMarket]:
      "Interactive Sportfolio player market, chart, quote, and staged trade interface.",
    [SPORTFOLIO_UI_RESOURCE_URIS.tradePreview]:
      "Exact-bundle Sportfolio action confirmation interface.",
    [SPORTFOLIO_UI_RESOURCE_URIS.portfolio]: "Interactive Sportfolio portfolio dashboard.",
    [SPORTFOLIO_UI_RESOURCE_URIS.marketMovers]: "Sportfolio market movers carousel.",
    [SPORTFOLIO_UI_RESOURCE_URIS.liquidity]: "Sportfolio virtual liquidity position interface.",
  };

  for (const [index, uri] of Object.values(SPORTFOLIO_UI_RESOURCE_URIS).entries()) {
    server.registerResource(
      `sportfolio-plugin-ui-${index + 1}`,
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

export async function registerPluginUiSurface(
  server: McpServer,
  context: PluginMcpContext,
): Promise<void> {
  if (!flagEnabled("PLUGIN_UI_ENABLED")) return;
  registerUiResources(server);

  for (const definition of PRESENTATION_DEFINITIONS) {
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
        outputSchema: presentationOutputSchema,
        securitySchemes,
        annotations: {
          title: definition.title,
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        _meta: {
          securitySchemes,
          source: "plugin_ui:presentation",
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
          const structuredContent = await definition.render(context, args || {});
          const data = record(structuredContent.data);
          return {
            content: [
              {
                type: "text" as const,
                text: contentSummary(definition.view, data),
              },
            ],
            structuredContent,
          } as any;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Sportfolio could not render this view.";
          return {
            isError: true,
            content: [{ type: "text" as const, text: message }],
            structuredContent: {
              view: definition.view,
              asOf: new Date().toISOString(),
              data: { code: "plugin_ui_render_failed", message },
              warnings: [],
            },
          } as any;
        }
      },
    );
  }
}
