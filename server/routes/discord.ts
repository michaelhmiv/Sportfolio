import type { Express, Request, Response } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { verify } from "crypto";
import { isAuthenticated } from "../auth/runtime-auth";
import { getDiscordRuntimeConfig } from "../discord-config";
import {
  cancelDiscordTradeIntent,
  cleanupExpiredDiscordLinkStates,
  cleanupExpiredDiscordTradeIntents,
  consumeDiscordLinkStateForUser,
  consumeDiscordTradeIntent,
  createDiscordLinkState,
  createDiscordTradeIntent,
  getDiscordLinkByDiscordUserId,
  getDiscordLinkByUserId,
  getDiscordTradeIntent,
  touchDiscordLink,
  validateDiscordLinkState,
} from "../discord-service";
import { buildDiscordSlashCommandDefinitions, syncDiscordGuildCommands } from "../discord-api";
import { syncDiscordReportThreadToGitHub } from "../discord-report-sync";
import { storage } from "../storage";
import { db } from "../db";
import { getBuyQuote, getSellQuote, executeBuy, executeSell, getPool } from "../amm/pool";
import { newsFeed, players, trades } from "@shared/schema";
import { getETDayBoundaries, getTodayET } from "../lib/time";
import { hasGameStartedForBoost } from "@shared/game-status";
import { assignDailyBoostWithValidation } from "../boosts/assign-daily-boost";
import { loadUserEntitlements } from "../services/user-entitlements";
import {
  DISCORD_SUPPORTED_SPORTS,
  normalizeDiscordSport,
  normalizePortfolioView,
  resolveAmountInput,
} from "../discord-command-utils";

const DISCORD_EPHEMERAL_FLAG = 1 << 6;
const LINK_STATE_TTL_MINUTES = 30;
const TRADE_CONFIRM_TTL_MS = 5 * 60 * 1000;
const DISCORD_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

interface DiscordInteractionUser {
  id: string;
  username?: string;
  global_name?: string | null;
}

interface DiscordInteractionMember {
  user?: DiscordInteractionUser;
  roles?: string[];
}

interface DiscordCommandOption {
  type: number;
  name: string;
  value?: string | number | boolean;
  focused?: boolean;
  options?: DiscordCommandOption[];
}

interface DiscordInteractionData {
  id?: string;
  name?: string;
  type?: number;
  custom_id?: string;
  options?: DiscordCommandOption[];
}

interface DiscordInteractionPayload {
  id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  data?: DiscordInteractionData;
  member?: DiscordInteractionMember;
  user?: DiscordInteractionUser;
}

interface DiscordCommandContext {
  interaction: DiscordInteractionPayload;
  discordUser: DiscordInteractionUser;
  roles: string[];
}

function getDiscordUserFromInteraction(
  payload: DiscordInteractionPayload,
): DiscordInteractionUser | null {
  return payload.member?.user || payload.user || null;
}

function getDiscordRolesFromInteraction(payload: DiscordInteractionPayload): string[] {
  const roles = payload.member?.roles;
  return Array.isArray(roles) ? roles : [];
}

function buildEphemeralResponse(content: string, components?: Array<Record<string, unknown>>) {
  return {
    type: 4,
    data: {
      content,
      flags: DISCORD_EPHEMERAL_FLAG,
      allowed_mentions: { parse: [] },
      ...(components ? { components } : {}),
    },
  };
}

function buildErrorResponse(content: string) {
  return buildEphemeralResponse(content);
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function parseDateInput(dateInput?: string | null): { dateStr: string; targetDate: Date } {
  const todayET = getTodayET();
  let dateStr = todayET;

  if (dateInput && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    dateStr = dateInput;
  }

  const { startOfDay } = getETDayBoundaries(dateStr);
  const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

  return {
    dateStr,
    targetDate,
  };
}

function extractSubcommand(options: DiscordCommandOption[] | undefined): {
  name: string | null;
  options: DiscordCommandOption[];
} {
  if (!options || options.length === 0) {
    return { name: null, options: [] };
  }

  const first = options[0];
  if (first.type === 1 && first.options) {
    return {
      name: first.name,
      options: first.options,
    };
  }

  return {
    name: null,
    options,
  };
}

function flattenCommandOptions(
  options: DiscordCommandOption[] | undefined,
): DiscordCommandOption[] {
  if (!options || options.length === 0) {
    return [];
  }

  const flattened: DiscordCommandOption[] = [];
  for (const option of options) {
    flattened.push(option);
    if (option.options && option.options.length > 0) {
      flattened.push(...flattenCommandOptions(option.options));
    }
  }

  return flattened;
}

function getOption(
  options: DiscordCommandOption[] | undefined,
  name: string,
): DiscordCommandOption | null {
  if (!options) return null;
  const option = options.find((candidate) => candidate.name === name);
  return option || null;
}

function getStringOption(options: DiscordCommandOption[] | undefined, name: string): string | null {
  const option = getOption(options, name);
  if (!option || typeof option.value !== "string") return null;
  return option.value;
}

function getNumberOption(options: DiscordCommandOption[] | undefined, name: string): number | null {
  const option = getOption(options, name);
  if (!option || typeof option.value !== "number") return null;
  return option.value;
}

function toSafeNumber(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? 0));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getRegularAvailableSharesForPlayer(
  userId: string,
  playerId: string,
): Promise<number> {
  const [regularHolding, lockedQuantity] = await Promise.all([
    storage.getRegularHolding(userId, "player", playerId),
    storage.getTotalLockedQuantity(userId, "player", playerId),
  ]);

  const regularQuantity = toSafeNumber(regularHolding?.quantity);
  return Math.max(0, regularQuantity - lockedQuantity);
}

function getAmountOptionInput(
  options: DiscordCommandOption[] | undefined,
  modernKey: string,
  legacyNumericKey: string,
): string | null {
  const modern = getStringOption(options, modernKey);
  if (modern) return modern;

  const legacy = getNumberOption(options, legacyNumericKey);
  if (legacy === null || legacy === undefined) return null;
  return String(legacy);
}

function isMutationAllowed(roles: string[], requiredRoleId: string | null): boolean {
  if (!requiredRoleId) {
    return true;
  }
  return roles.includes(requiredRoleId);
}

function assertGuildScope(interaction: DiscordInteractionPayload): { ok: boolean; error?: string } {
  const config = getDiscordRuntimeConfig();
  if (!config.guildId) {
    return { ok: false, error: "Discord guild scope is not configured" };
  }

  if (!interaction.guild_id || interaction.guild_id !== config.guildId) {
    return {
      ok: false,
      error: "This Discord bot is currently available only in the official Sportfolio server.",
    };
  }

  return { ok: true };
}

function verifyDiscordRequestSignature(req: RawBodyRequest): boolean {
  const config = getDiscordRuntimeConfig();
  if (!config.publicKey) {
    return false;
  }

  const signatureHeader = req.header("x-signature-ed25519");
  const timestampHeader = req.header("x-signature-timestamp");

  if (!signatureHeader || !timestampHeader) {
    return false;
  }

  const timestampSeconds = Number(timestampHeader);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > DISCORD_SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const rawBody = Buffer.isBuffer(req.rawBody)
    ? req.rawBody
    : Buffer.from(JSON.stringify(req.body || {}), "utf8");

  const message = Buffer.concat([Buffer.from(timestampHeader, "utf8"), rawBody]);
  const signature = Buffer.from(signatureHeader, "hex");
  const publicKey = Buffer.from(config.publicKey, "hex");
  const spkiKey = Buffer.concat([SPKI_ED25519_PREFIX, publicKey]);

  try {
    return verify(null, message, { key: spkiKey, format: "der", type: "spki" }, signature);
  } catch {
    return false;
  }
}

async function resolvePlayerFromInput(playerInput: string) {
  const trimmed = playerInput.trim();
  if (!trimmed) return null;

  const canonicalInput = await storage.getCanonicalPlayerId(trimmed);
  const directMatch = await storage.getPlayer(canonicalInput);
  if (directMatch) return directMatch;

  const paginated = await storage.getPlayersPaginated({
    search: trimmed,
    sport: "ALL",
    limit: 1,
    offset: 0,
    sortBy: "name",
    sortOrder: "asc",
  });

  return paginated.players[0] || null;
}

async function buildLinkActionComponent(ctx: DiscordCommandContext) {
  const config = getDiscordRuntimeConfig();
  if (!config.linkStateSecret) {
    return null;
  }

  const state = await createDiscordLinkState({
    secret: config.linkStateSecret,
    discordUserId: ctx.discordUser.id,
    discordUsername: ctx.discordUser.username || null,
    discordGlobalName: ctx.discordUser.global_name || null,
    guildId: ctx.interaction.guild_id || null,
    channelId: ctx.interaction.channel_id || null,
  });

  const linkUrl = `${config.publicSiteUrl}/discord/link?state=${encodeURIComponent(state.token)}`;

  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 5,
        label: "Link Sportfolio Account",
        url: linkUrl,
      },
    ],
  };
}

async function requireLinkedUser(ctx: DiscordCommandContext) {
  const link = await getDiscordLinkByDiscordUserId(ctx.discordUser.id);

  if (!link) {
    const linkComponent = await buildLinkActionComponent(ctx);
    return {
      ok: false as const,
      response: buildEphemeralResponse(
        `Your Discord user is not linked yet. Click below to link via Supabase (link expires in ${LINK_STATE_TTL_MINUTES} minutes).`,
        linkComponent ? [linkComponent] : undefined,
      ),
    };
  }

  await touchDiscordLink(ctx.discordUser.id);

  return {
    ok: true as const,
    link,
  };
}

async function handleStartOrLink(ctx: DiscordCommandContext) {
  const existing = await getDiscordLinkByDiscordUserId(ctx.discordUser.id);
  if (existing) {
    return buildEphemeralResponse(`Discord is already linked to your Sportfolio account.`);
  }

  const linkComponent = await buildLinkActionComponent(ctx);
  return buildEphemeralResponse(
    "Welcome to Sportfolio in Discord. Link your account to unlock portfolio and trading commands.",
    linkComponent ? [linkComponent] : undefined,
  );
}

function handleHelp() {
  const lines = [
    "`/start` onboarding",
    "`/link` account linking",
    "`/portfolio` account summary with filters (`sport`, `view`, `limit`)",
    "`/player` player market snapshot",
    "`/buy`, `/sell`, `/stack` support `amount` as number, `%`, or `max`",
    "`/boost` daily boost actions (global slots across sports)",
    "`/scout` scout actions",
    "`/report submit` staff-only GitHub issue sync for closed-testing threads",
    "`/market` movers + indicators",
    "`/news` latest stories",
    "Examples:",
    "`/portfolio sport:MLB view:stacked`",
    "`/buy player:<name> amount:50%`",
    "`/sell player:<name> amount:max`",
    "`/stack player:<name> amount:50%`",
  ];

  return buildEphemeralResponse(lines.join("\n"));
}

async function handlePortfolio(
  ctx: DiscordCommandContext,
  options: DiscordCommandOption[] | undefined,
) {
  const linked = await requireLinkedUser(ctx);
  if (!linked.ok) {
    return linked.response;
  }

  const sport = normalizeDiscordSport(getStringOption(options, "sport") || "ALL");
  if (!sport) {
    return buildErrorResponse(
      `Invalid sport filter. Supported values: ${DISCORD_SUPPORTED_SPORTS.join(", ")}`,
    );
  }

  const view = normalizePortfolioView(getStringOption(options, "view"));
  if (!view) {
    return buildErrorResponse("Invalid view filter. Use one of: all, stacked, regular.");
  }

  const limitRaw = getNumberOption(options, "limit");
  const limit = Math.max(1, Math.min(limitRaw ? Math.floor(limitRaw) : 5, 20));

  const userId = linked.link.userId;
  const [user, holdings] = await Promise.all([
    storage.getUser(userId),
    storage.getUserHoldingsWithPlayers(userId),
  ]);

  if (!user) {
    return buildErrorResponse("Your linked Sportfolio account could not be loaded.");
  }

  const filteredHoldings = (holdings || [])
    .filter((item: any) => item?.holding?.assetType === "player" && item?.player)
    .filter((item: any) =>
      sport === "ALL" ? true : String(item.player?.sport || "").toUpperCase() === sport,
    )
    .filter((item: any) => {
      const isStacked = Boolean(item.holding?.isStackedShare);
      if (view === "stacked") return isStacked;
      if (view === "regular") return !isStacked;
      return true;
    });

  const topHoldings = filteredHoldings
    .sort(
      (a: any, b: any) =>
        toSafeNumber(b.holding?.effectiveShares || b.holding?.quantity) -
        toSafeNumber(a.holding?.effectiveShares || a.holding?.quantity),
    )
    .slice(0, limit)
    .map((item: any) => {
      const effectiveShares = toSafeNumber(item.holding?.effectiveShares || item.holding?.quantity);
      const shareType = item.holding?.isStackedShare
        ? `stacked ${toSafeNumber(item.holding?.multiplier || 1).toFixed(2)}x`
        : "regular";

      return `${item.player.firstName} ${item.player.lastName} [${item.player.sport}] - ${effectiveShares.toFixed(2)} effective (${shareType})`;
    });

  const content = [
    `Balance: ${formatCurrency(parseFloat(user.balance || "0"))}`,
    `Premium: ${user.isPremium ? "active" : "inactive"}`,
    `Filter: sport=${sport}, view=${view}, limit=${limit}`,
    `Matching holdings: ${filteredHoldings.length}`,
    `Top holdings:`,
    ...(topHoldings.length > 0 ? topHoldings : ["No player holdings yet."]),
  ].join("\n");

  return buildEphemeralResponse(content);
}

async function handlePlayer(
  _ctx: DiscordCommandContext,
  options: DiscordCommandOption[] | undefined,
) {
  const playerInput = getStringOption(options, "player");
  if (!playerInput) {
    return buildErrorResponse("`player` is required.");
  }

  const player = await resolvePlayerFromInput(playerInput);
  if (!player) {
    return buildErrorResponse("Player not found.");
  }

  const pool = await getPool(player.id);
  const content = [
    `${player.firstName} ${player.lastName} (${player.team})`,
    `Spot price: ${pool ? formatCurrency(pool.currentPrice) : "$0.00 (uninitialized pool)"}`,
    `Pool TVL est: ${pool ? formatCurrency(pool.playMoney * 2) : "$0.00"}`,
    `Pool trades: ${pool?.totalTrades ?? 0}`,
    `24h volume (player row): ${player.volume24h}`,
  ].join("\n");

  return buildEphemeralResponse(content);
}

async function handleMarket(options: DiscordCommandOption[] | undefined) {
  const sport = (getStringOption(options, "sport") || "ALL").toUpperCase();
  const scanners = await storage.getFinancialMarketScanners(sport);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since15m = new Date(Date.now() - 15 * 60 * 1000);

  const [tradeStats24h] = await db
    .select({
      tradeCount: sql<number>`COUNT(*)`,
      totalVolume: sql<number>`COALESCE(SUM(${trades.price} * ${trades.quantity}), 0)`,
    })
    .from(trades)
    .innerJoin(players, eq(trades.playerId, players.id))
    .where(
      and(gte(trades.executedAt, since24h), sport === "ALL" ? sql`TRUE` : eq(players.sport, sport)),
    );

  const [activity15m] = await db
    .select({
      tradeCount: sql<number>`COUNT(*)`,
    })
    .from(trades)
    .innerJoin(players, eq(trades.playerId, players.id))
    .where(
      and(gte(trades.executedAt, since15m), sport === "ALL" ? sql`TRUE` : eq(players.sport, sport)),
    );

  const topMoverLines = scanners.momentum.slice(0, 3).map((entry) => {
    const pct = parseFloat(entry.player.priceChange24h || "0");
    return `${entry.player.firstName} ${entry.player.lastName}: ${pct.toFixed(2)}%`;
  });

  const sentimentLines = scanners.sentiment.slice(0, 2).map((entry) => {
    const pressure = entry.metrics.sentiment.buyPressure;
    return `${entry.player.firstName} ${entry.player.lastName}: ${pressure.toFixed(1)}% buy pressure`;
  });

  const content = [
    `Sport: ${sport}`,
    `24h volume: ${formatCurrency(Number(tradeStats24h?.totalVolume || 0))}`,
    `24h trades: ${Number(tradeStats24h?.tradeCount || 0)}`,
    `15m activity trades: ${Number(activity15m?.tradeCount || 0)}`,
    `Top movers:`,
    ...(topMoverLines.length > 0 ? topMoverLines : ["No mover data"]),
    `Sentiment leaders:`,
    ...(sentimentLines.length > 0 ? sentimentLines : ["No sentiment data"]),
  ].join("\n");

  return buildEphemeralResponse(content);
}

async function handleNews(options: DiscordCommandOption[] | undefined) {
  const limitRaw = getNumberOption(options, "limit");
  const limit = Math.max(1, Math.min(limitRaw ? Math.floor(limitRaw) : 3, 10));

  const stories = await db.select().from(newsFeed).orderBy(desc(newsFeed.createdAt)).limit(limit);
  if (stories.length === 0) {
    return buildEphemeralResponse("No recent news yet.");
  }

  const content = stories
    .map((story, index) => {
      const url = story.sourceUrl ? ` (${story.sourceUrl})` : "";
      return `${index + 1}. [${story.sport}] ${story.headline}${url}`;
    })
    .join("\n");

  return buildEphemeralResponse(content);
}
async function handleBuy(ctx: DiscordCommandContext, options: DiscordCommandOption[] | undefined) {
  const linked = await requireLinkedUser(ctx);
  if (!linked.ok) {
    return linked.response;
  }

  if (!isMutationAllowed(ctx.roles, getDiscordRuntimeConfig().mutationRoleId)) {
    return buildErrorResponse(
      "You do not have permission to run mutation commands in this server.",
    );
  }

  const playerInput = getStringOption(options, "player");
  const amountInput = getAmountOptionInput(options, "amount", "sb_amount");
  const maxSlippage = getNumberOption(options, "max_slippage");

  if (!playerInput || !amountInput) {
    return buildErrorResponse("`player` and `amount` are required.");
  }

  const player = await resolvePlayerFromInput(playerInput);
  if (!player) {
    return buildErrorResponse("Player not found.");
  }

  const availableBalance = await storage.getAvailableBalance(linked.link.userId);
  const resolvedAmount = resolveAmountInput({
    rawInput: amountInput,
    baseAmount: availableBalance,
    kind: "currency",
    minimum: 0.01,
  });
  if (!resolvedAmount) {
    return buildErrorResponse(
      "Invalid `amount`. Use a positive number, a percentage like `50%`, or `max`.",
    );
  }

  if (resolvedAmount.value > availableBalance) {
    return buildErrorResponse(
      `Requested amount exceeds available balance (${formatCurrency(availableBalance)}).`,
    );
  }

  const amount = resolvedAmount.value;
  const quote = await getBuyQuote(player.id, amount);
  if (!quote) {
    return buildErrorResponse("Could not calculate quote.");
  }

  const intent = await createDiscordTradeIntent({
    userId: linked.link.userId,
    discordUserId: ctx.discordUser.id,
    guildId: ctx.interaction.guild_id,
    commandType: "buy",
    playerId: player.id,
    amount,
    maxSlippage,
    ttlMs: TRADE_CONFIRM_TTL_MS,
  });

  return buildEphemeralResponse(
    [
      `Buy quote for ${player.firstName} ${player.lastName}`,
      `Input: ${resolvedAmount.input} -> Spend ${formatCurrency(amount)}`,
      `Available balance: ${formatCurrency(availableBalance)}`,
      `Estimated shares out: ${quote.sharesOut.toFixed(4)}`,
      `Effective price: ${formatCurrency(quote.effectivePrice)}`,
      `Slippage estimate: ${formatPercent(quote.slippagePercent)}`,
      `Max slippage: ${formatPercent(maxSlippage ?? 0.05)}`,
      "Press confirm within 5 minutes.",
    ].join("\n"),
    [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "Confirm Buy",
            custom_id: `discord_trade_confirm:${intent.id}`,
          },
          {
            type: 2,
            style: 4,
            label: "Cancel",
            custom_id: `discord_trade_cancel:${intent.id}`,
          },
        ],
      },
    ],
  );
}

async function handleSell(ctx: DiscordCommandContext, options: DiscordCommandOption[] | undefined) {
  const linked = await requireLinkedUser(ctx);
  if (!linked.ok) {
    return linked.response;
  }

  if (!isMutationAllowed(ctx.roles, getDiscordRuntimeConfig().mutationRoleId)) {
    return buildErrorResponse(
      "You do not have permission to run mutation commands in this server.",
    );
  }

  const playerInput = getStringOption(options, "player");
  const amountInput = getAmountOptionInput(options, "amount", "shares");
  const maxSlippage = getNumberOption(options, "max_slippage");

  if (!playerInput || !amountInput) {
    return buildErrorResponse("`player` and `amount` are required.");
  }

  const player = await resolvePlayerFromInput(playerInput);
  if (!player) {
    return buildErrorResponse("Player not found.");
  }

  const regularAvailableShares = await getRegularAvailableSharesForPlayer(
    linked.link.userId,
    player.id,
  );
  const resolvedAmount = resolveAmountInput({
    rawInput: amountInput,
    baseAmount: regularAvailableShares,
    kind: "whole",
    minimum: 1,
  });
  if (!resolvedAmount) {
    return buildErrorResponse(
      "Invalid `amount`. Use a positive number, a percentage like `50%`, or `max`.",
    );
  }

  const shares = Math.floor(resolvedAmount.value);
  if (shares > regularAvailableShares) {
    return buildErrorResponse(
      `Requested shares exceed regular available shares (${Math.floor(regularAvailableShares)}).`,
    );
  }

  const quote = await getSellQuote(player.id, shares);
  if (!quote) {
    return buildErrorResponse("Could not calculate quote.");
  }

  const intent = await createDiscordTradeIntent({
    userId: linked.link.userId,
    discordUserId: ctx.discordUser.id,
    guildId: ctx.interaction.guild_id,
    commandType: "sell",
    playerId: player.id,
    amount: shares,
    maxSlippage,
    ttlMs: TRADE_CONFIRM_TTL_MS,
  });

  return buildEphemeralResponse(
    [
      `Sell quote for ${player.firstName} ${player.lastName}`,
      `Input: ${resolvedAmount.input} -> Shares in ${shares}`,
      `Regular available shares: ${Math.floor(regularAvailableShares)}`,
      `Estimated SB out: ${formatCurrency(quote.sbOut)}`,
      `Effective price: ${formatCurrency(quote.effectivePrice)}`,
      `Slippage estimate: ${formatPercent(quote.slippagePercent)}`,
      `Max slippage: ${formatPercent(maxSlippage ?? 0.05)}`,
      "Press confirm within 5 minutes.",
    ].join("\n"),
    [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "Confirm Sell",
            custom_id: `discord_trade_confirm:${intent.id}`,
          },
          {
            type: 2,
            style: 4,
            label: "Cancel",
            custom_id: `discord_trade_cancel:${intent.id}`,
          },
        ],
      },
    ],
  );
}

async function handleBoost(
  ctx: DiscordCommandContext,
  options: DiscordCommandOption[] | undefined,
) {
  const linked = await requireLinkedUser(ctx);
  if (!linked.ok) {
    return linked.response;
  }

  if (!isMutationAllowed(ctx.roles, getDiscordRuntimeConfig().mutationRoleId)) {
    return buildErrorResponse(
      "You do not have permission to run mutation commands in this server.",
    );
  }

  const sub = extractSubcommand(options);
  const userId = linked.link.userId;

  if (sub.name === "eligible") {
    const sport = (getStringOption(sub.options, "sport") || "ALL").toUpperCase();
    const dateInput = getStringOption(sub.options, "date");
    const { dateStr, targetDate } = parseDateInput(dateInput);

    const sports = sport === "ALL" ? ["NBA", "NFL", "MLB", "NASCAR", "NHL"] : [sport];

    const eligible = (
      await Promise.all(
        sports.map(async (currentSport) => {
          const rows = await storage.getEligiblePlayersForBoost(userId, currentSport, targetDate);
          return rows.map((row) => ({ sport: currentSport, row }));
        }),
      )
    )
      .flat()
      .slice(0, 12)
      .map((entry) => {
        const p = entry.row.player;
        return `${p.firstName} ${p.lastName} (${entry.sport}) - ${entry.row.availableShares.toFixed(4)} Singles available`;
      });

    return buildEphemeralResponse(
      [
        `Boost eligible players for ${sport} on ${dateStr}:`,
        ...(eligible.length > 0 ? eligible : ["No eligible players found."]),
      ].join("\n"),
    );
  }

  if (sub.name === "assign") {
    const playerInput = getStringOption(sub.options, "player");
    const slot = getNumberOption(sub.options, "slot");
    const dateInput = getStringOption(sub.options, "date");

    if (!playerInput || !slot) {
      return buildErrorResponse("`player` and `slot` are required.");
    }

    const slotTier = Math.floor(slot);
    if (![2, 3, 5, 7, 10].includes(slotTier)) {
      return buildErrorResponse("slot must be one of 2, 3, 5, 7, or 10.");
    }

    const player = await resolvePlayerFromInput(playerInput);
    if (!player) {
      return buildErrorResponse("Player not found.");
    }

    const canonicalPlayerId = await storage.getCanonicalPlayerId(player.id);
    const sport = String(player.sport || "").toUpperCase();
    if (!sport) {
      return buildErrorResponse("Player sport could not be resolved.");
    }

    const { dateStr, targetDate } = parseDateInput(dateInput);

    const currentBoosts = await storage.getDailyBoostsAllSports(userId, targetDate);
    if (currentBoosts.some((boost) => boost.slotTier === slotTier)) {
      return buildErrorResponse(`Slot ${slotTier}x is already occupied.`);
    }
    if (currentBoosts.some((boost) => boost.playerId === canonicalPlayerId)) {
      return buildErrorResponse("This player is already in a boost slot.");
    }
    if (currentBoosts.length >= 5) {
      return buildErrorResponse("All five boost slots are already filled.");
    }

    const game = await storage.getPlayerGameForDate(canonicalPlayerId, sport, targetDate);
    if (!game) {
      return buildErrorResponse("This player does not have a game for that date.");
    }
    if (hasGameStartedForBoost(game)) {
      return buildErrorResponse("Cannot assign boost after game start.");
    }

    const availableShares = await storage.getAvailableShares(userId, "player", canonicalPlayerId);
    if (availableShares < 1) {
      return buildErrorResponse("You need at least one available share for this player.");
    }

    const shares = Math.min(1, availableShares);
    const { boost } = await assignDailyBoostWithValidation({
      userId,
      playerId: canonicalPlayerId,
      sport,
      slotTier,
      shares,
      etDate: dateStr,
    });

    return buildEphemeralResponse(
      [
        `Boost assigned for ${player.firstName} ${player.lastName}.`,
        `Slot: ${slotTier}x`,
        `Singles committed: 1`,
        `Boost id: ${boost.id}`,
      ].join("\n"),
    );
  }

  if (sub.name === "live") {
    const sportInput = getStringOption(sub.options, "sport");
    const sport = normalizeDiscordSport(sportInput || "ALL");
    if (!sport) {
      return buildErrorResponse(
        `Invalid sport filter. Supported values: ${DISCORD_SUPPORTED_SPORTS.join(", ")}`,
      );
    }

    const { targetDate } = parseDateInput(null);
    const allBoosts = await storage.getDailyBoostsAllSports(userId, targetDate);
    const boosts =
      sport === "ALL"
        ? allBoosts
        : allBoosts.filter((boost) => String(boost.sport || "").toUpperCase() === sport);

    const rows = boosts.slice(0, 8).map((boost) => {
      return `${boost.id}: ${boost.status} | ${boost.sport} | slot ${boost.slotTier}x | multiplier ${boost.sharesEntered}`;
    });

    return buildEphemeralResponse(
      [
        `Live boosts (${sport}):`,
        ...(rows.length > 0 ? rows : ["No boosts found for this sport/date."]),
      ].join("\n"),
    );
  }

  if (sub.name === "remove") {
    const boostId = getStringOption(sub.options, "boost_id");
    if (!boostId) {
      return buildErrorResponse("`boost_id` is required.");
    }

    const boosts = await storage.getDailyBoostsByStatus("active");
    const targetBoost = boosts.find((boost) => boost.id === boostId && boost.userId === userId);
    if (!targetBoost) {
      return buildErrorResponse("Boost not found or not removable.");
    }

    if (targetBoost.gameId) {
      const game = await storage.getDailyGameByGameId(targetBoost.gameId);
      if (game && hasGameStartedForBoost(game)) {
        return buildErrorResponse("Cannot remove boost after game start.");
      }
    }

    await storage.deleteDailyBoost(boostId);
    return buildEphemeralResponse(`Removed boost ${boostId}.`);
  }

  return buildErrorResponse("Unknown boost subcommand.");
}
async function handleScout(
  ctx: DiscordCommandContext,
  options: DiscordCommandOption[] | undefined,
) {
  const linked = await requireLinkedUser(ctx);
  if (!linked.ok) {
    return linked.response;
  }

  if (!isMutationAllowed(ctx.roles, getDiscordRuntimeConfig().mutationRoleId)) {
    return buildErrorResponse(
      "You do not have permission to run mutation commands in this server.",
    );
  }

  const sub = extractSubcommand(options);
  const userId = linked.link.userId;

  if (sub.name === "status") {
    const [status, assignments, totalScouts, entitlements] = await Promise.all([
      storage.getScoutStatus(userId),
      storage.getUserScoutAssignments(userId),
      storage.getTotalScoutsForUser(userId),
      loadUserEntitlements(storage, userId),
    ]);

    const maxScouts = entitlements?.entitlements.maxScouts ?? 5;
    return buildEphemeralResponse(
      [
        `Scouts used: ${totalScouts}/${maxScouts}`,
        `Active assignments: ${assignments.length}`,
        `Earned minutes: ${status.earnedMinutes.toFixed(2)}`,
        `Next distribution: ${status.nextDistribution.toISOString()}`,
      ].join("\n"),
    );
  }

  if (sub.name === "assign") {
    const playerInput = getStringOption(sub.options, "player");
    const countValue = getNumberOption(sub.options, "count");

    if (!playerInput || countValue === null) {
      return buildErrorResponse("`player` and `count` are required.");
    }

    const count = Math.floor(countValue);
    if (count < 0) {
      return buildErrorResponse("count must be non-negative.");
    }

    const player = await resolvePlayerFromInput(playerInput);
    if (!player) {
      return buildErrorResponse("Player not found.");
    }

    await storage.assignScouts(userId, player.id, count);
    const totalScouts = await storage.getTotalScoutsForUser(userId);

    return buildEphemeralResponse(
      `Assigned ${count} scouts to ${player.firstName} ${player.lastName}. Total scouts used: ${totalScouts}.`,
    );
  }

  if (sub.name === "roster") {
    const playerInput = getStringOption(sub.options, "player");
    if (!playerInput) {
      return buildErrorResponse("`player` is required.");
    }

    const player = await resolvePlayerFromInput(playerInput);
    if (!player) {
      return buildErrorResponse("Player not found.");
    }

    const roster = await storage.getScoutRoster(player.id);
    const topRows = roster.slice(0, 10).map((entry: any) => {
      const username = entry.username || entry.userId?.slice(0, 8) || "user";
      return `${username}: ${entry.scoutCount}`;
    });

    return buildEphemeralResponse(
      [
        `Scout roster for ${player.firstName} ${player.lastName}:`,
        ...(topRows.length > 0 ? topRows : ["No scouts assigned."]),
      ].join("\n"),
    );
  }

  return buildErrorResponse("Unknown scout subcommand.");
}

async function handleReport(
  ctx: DiscordCommandContext,
  options: DiscordCommandOption[] | undefined,
) {
  const config = getDiscordRuntimeConfig();
  const sub = extractSubcommand(options);

  if (sub.name !== "submit") {
    return buildErrorResponse("Unknown report subcommand.");
  }

  if (!config.reportingEnabled) {
    return buildErrorResponse("Discord -> GitHub reporting is not configured yet.");
  }

  if (!isMutationAllowed(ctx.roles, config.reportModRoleId)) {
    return buildErrorResponse("You do not have permission to submit reports to GitHub.");
  }

  if (!ctx.interaction.guild_id || !ctx.interaction.channel_id) {
    return buildErrorResponse("This command must be run inside a Discord server thread.");
  }

  if (!config.bugForumChannelId || !config.featureForumChannelId || !config.githubIssueToken) {
    return buildErrorResponse("Missing report forum or GitHub sync configuration.");
  }

  const submitterDisplayName =
    ctx.discordUser.global_name || ctx.discordUser.username || ctx.discordUser.id;

  try {
    const result = await syncDiscordReportThreadToGitHub({
      guildId: ctx.interaction.guild_id,
      threadChannelId: ctx.interaction.channel_id,
      submittedByDiscordUserId: ctx.discordUser.id,
      submittedByDisplayName: submitterDisplayName,
      bugForumChannelId: config.bugForumChannelId,
      featureForumChannelId: config.featureForumChannelId,
      githubToken: config.githubIssueToken,
      githubOwner: config.githubIssueOwner,
      githubRepo: config.githubIssueRepo,
    });

    if (result.status === "created") {
      return buildEphemeralResponse(
        [
          `Created GitHub issue #${result.issueNumber} from this ${result.reportType} report thread.`,
          `Synced messages: ${result.syncedMessageCount}`,
          `Issue: ${result.issueUrl}`,
        ].join("\n"),
      );
    }

    if (result.status === "updated") {
      return buildEphemeralResponse(
        [
          `Posted ${result.syncedMessageCount} new message(s) to GitHub issue #${result.issueNumber}.`,
          `Issue: ${result.issueUrl}`,
        ].join("\n"),
      );
    }

    return buildEphemeralResponse(
      [
        `No new messages to sync for GitHub issue #${result.issueNumber}.`,
        `Issue: ${result.issueUrl}`,
      ].join("\n"),
    );
  } catch (error: any) {
    return buildErrorResponse(`Report submit failed: ${String(error?.message || "Unknown error")}`);
  }
}

async function handleTradeComponent(
  ctx: DiscordCommandContext,
  customId: string,
): Promise<Record<string, unknown>> {
  const action = customId.startsWith("discord_trade_confirm:")
    ? "confirm"
    : customId.startsWith("discord_trade_cancel:")
      ? "cancel"
      : null;

  if (!action) {
    return buildErrorResponse("Unknown interaction action.");
  }

  const intentId = customId.split(":")[1];
  if (!intentId) {
    return buildErrorResponse("Invalid trade intent id.");
  }

  if (action === "cancel") {
    await cancelDiscordTradeIntent({ intentId, discordUserId: ctx.discordUser.id });
    return {
      type: 7,
      data: {
        content: "Trade canceled.",
        components: [],
        allowed_mentions: { parse: [] },
      },
    };
  }

  const intent = await getDiscordTradeIntent({ intentId, discordUserId: ctx.discordUser.id });
  if (!intent) {
    return {
      type: 7,
      data: {
        content: "Trade confirmation expired or unavailable.",
        components: [],
        allowed_mentions: { parse: [] },
      },
    };
  }

  if (intent.expiresAt <= new Date()) {
    await cancelDiscordTradeIntent({ intentId, discordUserId: ctx.discordUser.id });
    return {
      type: 7,
      data: {
        content: "Trade confirmation expired. Submit the slash command again.",
        components: [],
        allowed_mentions: { parse: [] },
      },
    };
  }

  const consumed = await consumeDiscordTradeIntent({
    intentId,
    discordUserId: ctx.discordUser.id,
  });

  if (!consumed) {
    return {
      type: 7,
      data: {
        content: "Trade confirmation was already used or expired.",
        components: [],
        allowed_mentions: { parse: [] },
      },
    };
  }

  const maxSlippage =
    consumed.maxSlippage === null || consumed.maxSlippage === undefined
      ? 0.05
      : parseFloat(consumed.maxSlippage);

  try {
    if (consumed.commandType === "buy") {
      const result = await executeBuy(
        consumed.playerId,
        consumed.userId,
        parseFloat(consumed.amount),
        maxSlippage,
      );

      if (!result.success) {
        return {
          type: 7,
          data: {
            content: `Buy failed: ${result.error || "unknown error"}`,
            components: [],
            allowed_mentions: { parse: [] },
          },
        };
      }

      const tradeId = result.tradeId || "unknown";
      const sharesReceived = result.sharesTraded ?? 0;
      const totalCost = result.totalValue ?? parseFloat(consumed.amount);

      return {
        type: 7,
        data: {
          content: [
            "Buy executed.",
            `Trade id: ${tradeId}`,
            `Shares received: ${sharesReceived.toFixed(4)}`,
            `Total cost: ${formatCurrency(totalCost)}`,
          ].join("\n"),
          components: [],
          allowed_mentions: { parse: [] },
        },
      };
    }

    const sharesAmount = Math.floor(parseFloat(consumed.amount));
    const result = await executeSell(consumed.playerId, consumed.userId, sharesAmount, maxSlippage);
    if (!result.success) {
      return {
        type: 7,
        data: {
          content: `Sell failed: ${result.error || "unknown error"}`,
          components: [],
          allowed_mentions: { parse: [] },
        },
      };
    }

    const tradeId = result.tradeId || "unknown";
    const sharesSold = result.sharesTraded ?? sharesAmount;
    const totalProceeds = result.totalValue ?? 0;

    return {
      type: 7,
      data: {
        content: [
          "Sell executed.",
          `Trade id: ${tradeId}`,
          `Shares sold: ${sharesSold.toFixed(4)}`,
          `Total proceeds: ${formatCurrency(totalProceeds)}`,
        ].join("\n"),
        components: [],
        allowed_mentions: { parse: [] },
      },
    };
  } catch (error: any) {
    return {
      type: 7,
      data: {
        content: `Trade failed: ${error?.message || "Unknown error"}`,
        components: [],
        allowed_mentions: { parse: [] },
      },
    };
  }
}

async function handleAutocomplete(interaction: DiscordInteractionPayload) {
  const options = flattenCommandOptions(interaction.data?.options);
  const focusedOption =
    options.find((option) => option.focused) ||
    options.find((option) => typeof option.value === "string") ||
    null;
  const query = (typeof focusedOption?.value === "string" ? focusedOption.value : "").trim();

  if (!query) {
    return {
      type: 8,
      data: {
        choices: [],
      },
    };
  }

  const matchingPlayers = await db
    .select({
      id: players.id,
      firstName: players.firstName,
      lastName: players.lastName,
      team: players.team,
      sport: players.sport,
    })
    .from(players)
    .where(
      and(
        eq(players.isActive, true),
        sql`(
          ${players.id} ILIKE ${`%${query}%`}
          OR (${players.firstName} || ' ' || ${players.lastName}) ILIKE ${`%${query}%`}
          OR ${players.lastName} ILIKE ${`%${query}%`}
        )`,
      ),
    )
    .orderBy(players.lastName, players.firstName)
    .limit(25);

  return {
    type: 8,
    data: {
      choices: matchingPlayers.map((player) => ({
        name: `${player.firstName} ${player.lastName} (${player.team}) [${player.sport}]`,
        value: player.id,
      })),
    },
  };
}

async function handleApplicationCommand(ctx: DiscordCommandContext) {
  const commandName = ctx.interaction.data?.name;
  const options = ctx.interaction.data?.options;

  switch (commandName) {
    case "start":
    case "link":
      return handleStartOrLink(ctx);
    case "help":
      return handleHelp();
    case "portfolio":
      return handlePortfolio(ctx, options);
    case "player":
      return handlePlayer(ctx, options);
    case "market":
      return handleMarket(options);
    case "news":
      return handleNews(options);
    case "buy":
      return handleBuy(ctx, options);
    case "sell":
      return handleSell(ctx, options);
    case "boost":
      return handleBoost(ctx, options);
    case "scout":
      return handleScout(ctx, options);
    case "report":
      return handleReport(ctx, options);
    default:
      return buildErrorResponse("Unsupported command.");
  }
}

async function assertAdmin(req: Request): Promise<{ ok: boolean; userId?: string }> {
  const userId = req.user?.claims?.sub;
  if (!userId) {
    return { ok: false };
  }

  const user = await storage.getUser(userId);
  if (!user || !user.isAdmin) {
    return { ok: false };
  }

  return { ok: true, userId };
}
export function registerDiscordRoutes(app: Express): void {
  app.get("/api/discord/health", (_req, res) => {
    const config = getDiscordRuntimeConfig();
    res.json({
      enabled: config.enabled,
      hasBotToken: Boolean(config.botToken),
      hasPublicKey: Boolean(config.publicKey),
      hasGuildId: Boolean(config.guildId),
      hasLinkStateSecret: Boolean(config.linkStateSecret),
      hasNewsChannel: Boolean(config.newsChannelId),
      hasHourlyChannel: Boolean(config.hourlyChannelId),
      hasBugForumChannel: Boolean(config.bugForumChannelId),
      hasFeatureForumChannel: Boolean(config.featureForumChannelId),
      hasReportModRole: Boolean(config.reportModRoleId),
      hasGithubIssueSyncToken: Boolean(config.githubIssueToken),
      githubIssueOwner: config.githubIssueOwner,
      githubIssueRepo: config.githubIssueRepo,
      reportingEnabled: config.reportingEnabled,
    });
  });

  app.get("/api/discord/link/state", async (req: Request, res: Response) => {
    const config = getDiscordRuntimeConfig();
    const state = typeof req.query.state === "string" ? req.query.state.trim() : "";

    if (!config.linkStateSecret || !state) {
      return res.status(400).json({ valid: false, message: "Missing state token" });
    }

    const row = await validateDiscordLinkState({
      secret: config.linkStateSecret,
      token: state,
    });

    if (!row) {
      return res.status(400).json({ valid: false, message: "Link token expired or invalid" });
    }

    return res.json({
      valid: true,
      discordUserId: row.discordUserId,
      discordUsername: row.discordUsername,
      discordGlobalName: row.discordGlobalName,
      guildId: row.guildId,
      expiresAt: row.expiresAt,
    });
  });

  app.post("/api/discord/link/complete", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const config = getDiscordRuntimeConfig();
      const userId = req.user?.claims?.sub;
      const state = typeof req.body?.state === "string" ? req.body.state.trim() : "";

      if (!config.linkStateSecret || !userId) {
        return res.status(503).json({ message: "Discord linking is not configured" });
      }

      if (!state) {
        return res.status(400).json({ message: "State token is required" });
      }

      const linked = await consumeDiscordLinkStateForUser({
        secret: config.linkStateSecret,
        token: state,
        userId,
      });

      return res.json({
        link: {
          userId: linked.userId,
          discordUserId: linked.discordUserId,
          discordUsername: linked.discordUsername,
          discordGlobalName: linked.discordGlobalName,
          linkedAt: linked.linkedAt,
        },
      });
    } catch (error: any) {
      const message = String(error?.message || "Could not link Discord account");
      const isUserError = /invalid|expired|already linked/i.test(message);
      return res.status(isUserError ? 400 : 500).json({
        message: isUserError ? message : "Could not link Discord account",
        ...(isUserError ? {} : { error: message }),
      });
    }
  });

  app.get("/api/discord/link/me", isAuthenticated, async (req: Request, res: Response) => {
    const userId = req.user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const link = await getDiscordLinkByUserId(userId);
    return res.json({ link });
  });

  app.post(
    "/api/admin/discord/commands/sync",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const adminCheck = await assertAdmin(req);
      if (!adminCheck.ok) {
        return res.status(403).json({ message: "Admin access required" });
      }

      const result = await syncDiscordGuildCommands();
      return res.status(result.ok ? 200 : result.status).json(result);
    },
  );

  app.get(
    "/api/admin/discord/commands/preview",
    isAuthenticated,
    async (req: Request, res: Response) => {
      const adminCheck = await assertAdmin(req);
      if (!adminCheck.ok) {
        return res.status(403).json({ message: "Admin access required" });
      }

      return res.json({ commands: buildDiscordSlashCommandDefinitions() });
    },
  );

  app.post("/api/webhooks/discord/interactions", async (req: Request, res: Response) => {
    const rawRequest = req as RawBodyRequest;
    const config = getDiscordRuntimeConfig();

    if (!config.enabled) {
      return res.status(503).json({ message: "Discord integration is not configured" });
    }

    if (!verifyDiscordRequestSignature(rawRequest)) {
      return res.status(401).json({ message: "Invalid Discord signature" });
    }

    const interaction = req.body as DiscordInteractionPayload;

    if (!interaction || typeof interaction.type !== "number") {
      return res.status(400).json({ message: "Invalid interaction payload" });
    }

    if (interaction.type === 1) {
      return res.json({ type: 1 });
    }

    const guildScope = assertGuildScope(interaction);
    if (!guildScope.ok) {
      return res.json(buildErrorResponse(guildScope.error || "Unsupported guild"));
    }

    const discordUser = getDiscordUserFromInteraction(interaction);
    if (!discordUser) {
      return res.json(buildErrorResponse("Could not identify Discord user."));
    }

    const ctx: DiscordCommandContext = {
      interaction,
      discordUser,
      roles: getDiscordRolesFromInteraction(interaction),
    };

    try {
      if (interaction.type === 4) {
        const response = await handleAutocomplete(interaction);
        return res.json(response);
      }

      if (interaction.type === 2) {
        const response = await handleApplicationCommand(ctx);
        return res.json(response);
      }

      if (interaction.type === 3) {
        const customId = interaction.data?.custom_id || "";
        const response = await handleTradeComponent(ctx, customId);
        return res.json(response);
      }

      return res.json(buildErrorResponse("Unsupported interaction type."));
    } catch (error: any) {
      console.error("[DISCORD] Interaction error:", error);
      return res.json(
        buildErrorResponse(`Command failed: ${String(error?.message || "Unknown error")}`),
      );
    }
  });

  app.post("/api/admin/discord/cleanup", isAuthenticated, async (req: Request, res: Response) => {
    const adminCheck = await assertAdmin(req);
    if (!adminCheck.ok) {
      return res.status(403).json({ message: "Admin access required" });
    }

    const [stateRows, intentRows] = await Promise.all([
      cleanupExpiredDiscordLinkStates(),
      cleanupExpiredDiscordTradeIntents(),
    ]);

    return res.json({
      cleanedLinkStates: stateRows,
      cleanedTradeIntents: intentRows,
    });
  });
}
