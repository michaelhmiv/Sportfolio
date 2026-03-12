import "dotenv/config";
import fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, asc, desc, eq, gte, lte, or } from "drizzle-orm";
import {
  buildPublicPromptRegistry,
  buildPublicResourceRegistry,
  buildPublicToolRegistry,
  getPublicPromptFixtures,
  getPublicToolFixtures,
} from "../server/mcp/public-tool-registry";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { addLiquidity, getLpPosition } from "../server/amm/pool";
import { createAgentThread } from "../server/agent/thread-service";
import { createSmsLinkTokenMaterial } from "../server/services/telnyx-sms";
import { completeSmsPhoneLink, getSmsSettings } from "../server/sms-service";
import { getETDayBoundaries, getTodayET } from "../server/lib/time";
import {
  dailyGames,
  players,
  smsMessageEvents,
  userCollections,
  userAgentRuns,
  userMilestones,
  userPhoneLinkTokens,
} from "@shared/schema";

type ValidationStatus = "passed" | "failed" | "blocked";

type ValidationResult = {
  surface: "cli" | "mcp";
  kind: "tool" | "prompt" | "resource";
  name: string;
  status: ValidationStatus;
  details?: string;
  invalidCase?: ValidationStatus;
  invalidDetails?: string;
};

type ValidationState = {
  baseUrl: string;
  authToken: string;
  authTokenId: string;
  userId: string;
  originalUsername: string | null;
  originalProfileImageUrl: string | null;
  playerId: string;
  playerName: string;
  team: string;
  sport: string;
  date: string;
  gameId: string | null;
  boostSlotTier: 2 | 3 | 4 | 5;
  watchlistId: string;
  threadId: string;
  pendingBundleId: string;
  createdTokenId: string;
  milestoneId: string;
  collectionType: string;
  collectionTargetId: string;
  phone: string;
  smsToken: string;
};

type OpenClient = {
  client: Client;
  transport: StreamableHTTPClientTransport;
};

const DEV_USER_ID = "dev-user-12345678";
const SERVER_PORT = 5057;
const REPORT_PATH = path.resolve("tmp/public-surface-dev-validation.json");
const SERVER_STDOUT_PATH = path.resolve("tmp/public-surface-dev-server.log");
const SERVER_STDERR_PATH = path.resolve("tmp/public-surface-dev-server.err");
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "sportfolio-dev-validate-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;

const { runCli } = await import("../packages/sportfolio-cli/src/index.mjs");

function formatEtDate(value: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

function isBlockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "TELNYX_API_KEY is not configured",
    "TELNYX_FROM_NUMBER or TELNYX_MESSAGING_PROFILE_ID must be configured",
    "Perplexity",
    "provider",
    "table does not exist",
    "Milestones unavailable",
  ].some((fragment) => message.includes(fragment));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealthyServer(baseUrl: string) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(1_000);
  }
  throw new Error("Timed out waiting for the dev server to become ready.");
}

function startDevServer(baseUrl: string): ChildProcessWithoutNullStreams {
  fs.mkdirSync(path.dirname(SERVER_STDOUT_PATH), { recursive: true });
  const stdout = fs.createWriteStream(SERVER_STDOUT_PATH, { flags: "w" });
  const stderr = fs.createWriteStream(SERVER_STDERR_PATH, { flags: "w" });
  const child = spawn(
    process.execPath,
    [path.resolve("node_modules/tsx/dist/cli.mjs"), "server/index.ts"],
    {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: String(SERVER_PORT),
        DEV_BYPASS_AUTH: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(`[public-surface-dev-validate] Dev server exited with code ${code}.`);
    }
  });
  return child;
}

async function stopDevServer(child: ChildProcessWithoutNullStreams | null) {
  if (!child || child.killed) {
    return;
  }
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

async function requestJson<T>(
  baseUrl: string,
  input: {
    path: string;
    method?: string;
    token?: string;
    body?: unknown;
    query?: Record<string, string>;
  },
): Promise<T> {
  const url = new URL(input.path, baseUrl);
  for (const [key, value] of Object.entries(input.query || {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: input.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
    },
    ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      String((payload as any)?.error || (payload as any)?.message || response.status),
    );
  }
  return payload as T;
}

async function invokeCli(rawArgs: string[]) {
  let stdout = "";
  let stderr = "";
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  const originalExitCode = process.exitCode;

  process.stdout.write = ((
    chunk: string | Uint8Array,
    _encoding?: BufferEncoding,
    callback?: () => void,
  ) => {
    stdout += String(chunk);
    callback?.();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((
    chunk: string | Uint8Array,
    _encoding?: BufferEncoding,
    callback?: () => void,
  ) => {
    stderr += String(chunk);
    callback?.();
    return true;
  }) as typeof process.stderr.write;
  process.exitCode = 0;
  let exitCode = 0;

  try {
    await runCli(rawArgs);
  } finally {
    exitCode = process.exitCode || 0;
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
    process.exitCode = originalExitCode;
  }

  return { stdout, stderr, exitCode };
}

async function connectMcpClient(baseUrl: string, authToken: string): Promise<OpenClient> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    },
  });
  const client = new Client({
    name: "sportfolio-dev-validator",
    version: "1.0.0",
  });
  await client.connect(transport);
  return { client, transport };
}

async function closeClient(openClient: OpenClient | null) {
  if (openClient) {
    await openClient.transport.close();
  }
}

async function ensureMilestone(userId: string): Promise<string> {
  const existing = await db
    .select({ id: userMilestones.id })
    .from(userMilestones)
    .where(and(eq(userMilestones.userId, userId), eq(userMilestones.milestoneType, "netWorth")))
    .orderBy(desc(userMilestones.achievedAt))
    .limit(1)
    .catch((error: any) => (error?.code === "42P01" ? [] : Promise.reject(error)));
  if (existing[0]?.id) {
    return existing[0].id;
  }

  const inserted = await db
    .insert(userMilestones)
    .values({
      userId,
      milestoneType: "netWorth",
      threshold: "100.00",
    })
    .returning({ id: userMilestones.id });
  return inserted[0].id;
}

async function ensureCollection(userId: string, team: string) {
  try {
    const existing = await db
      .select({ id: userCollections.id })
      .from(userCollections)
      .where(
        and(
          eq(userCollections.userId, userId),
          eq(userCollections.collectionType, "team"),
          eq(userCollections.targetId, team),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(userCollections).values({
        userId,
        collectionType: "team",
        targetId: team,
        progress: 1,
        total: 1,
      });
    }
  } catch (error: any) {
    if (error?.code !== "42P01") {
      throw error;
    }
  }
}

async function findValidationPlayer() {
  const bufferedNow = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const nearTermCutoff = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const nearTermGames = await db
    .select({
      gameId: dailyGames.gameId,
      sport: dailyGames.sport,
      homeTeam: dailyGames.homeTeam,
      awayTeam: dailyGames.awayTeam,
      startTime: dailyGames.startTime,
    })
    .from(dailyGames)
    .where(and(gte(dailyGames.startTime, bufferedNow), lte(dailyGames.startTime, nearTermCutoff)))
    .orderBy(asc(dailyGames.startTime))
    .limit(100);

  const upcomingGames =
    nearTermGames.length > 0
      ? nearTermGames
      : await db
          .select({
            gameId: dailyGames.gameId,
            sport: dailyGames.sport,
            homeTeam: dailyGames.homeTeam,
            awayTeam: dailyGames.awayTeam,
            startTime: dailyGames.startTime,
          })
          .from(dailyGames)
          .where(gte(dailyGames.startTime, bufferedNow))
          .orderBy(asc(dailyGames.startTime))
          .limit(100);

  for (const game of upcomingGames) {
    const [candidate] = await db
      .select({
        id: players.id,
        firstName: players.firstName,
        lastName: players.lastName,
        team: players.team,
        sport: players.sport,
        lastTradePrice: players.lastTradePrice,
      })
      .from(players)
      .where(
        and(
          eq(players.isActive, true),
          eq(players.sport, game.sport || ""),
          or(eq(players.team, game.homeTeam), eq(players.team, game.awayTeam)),
        ),
      )
      .limit(1);

    if (candidate) {
      const date = formatEtDate(new Date(game.startTime));
      const { startOfDay } = getETDayBoundaries(date);
      const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);
      const resolvedGame = await storage.getPlayerGameForDate(
        candidate.id,
        game.sport || candidate.sport,
        targetDate,
      );
      if (!resolvedGame) {
        continue;
      }

      const communityBoostRows = await storage.getCommunityBoostsForDate(
        game.sport || candidate.sport,
        targetDate,
      );
      if (communityBoostRows.some((entry) => entry.playerId === candidate.id)) {
        continue;
      }

      return {
        playerId: candidate.id,
        playerName: `${candidate.firstName} ${candidate.lastName}`,
        team: candidate.team,
        sport: game.sport || candidate.sport,
        date,
        gameId: game.gameId,
        lastTradePrice: candidate.lastTradePrice || "10.0000",
      };
    }
  }

  const [fallback] = await db
    .select({
      id: players.id,
      firstName: players.firstName,
      lastName: players.lastName,
      team: players.team,
      sport: players.sport,
      lastTradePrice: players.lastTradePrice,
    })
    .from(players)
    .where(eq(players.isActive, true))
    .limit(1);

  if (!fallback) {
    throw new Error("Could not find an active player to validate against.");
  }

  return {
    playerId: fallback.id,
    playerName: `${fallback.firstName} ${fallback.lastName}`,
    team: fallback.team,
    sport: fallback.sport,
    date: formatEtDate(new Date()),
    gameId: null,
    lastTradePrice: fallback.lastTradePrice || "10.0000",
  };
}

async function getSmsToken(userId: string): Promise<string> {
  const [event] = await db
    .select({
      messageText: smsMessageEvents.messageText,
    })
    .from(smsMessageEvents)
    .where(and(eq(smsMessageEvents.userId, userId), eq(smsMessageEvents.direction, "outbound")))
    .orderBy(desc(smsMessageEvents.createdAt))
    .limit(1);

  const match = String(event?.messageText || "").match(/[a-f0-9]{48}/i);
  return match?.[0] || "";
}

async function seedSmsToken(phone: string, userId: string): Promise<string> {
  const tokenMaterial = createSmsLinkTokenMaterial();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await db.insert(userPhoneLinkTokens).values({
    phoneE164: phone,
    tokenHash: tokenMaterial.tokenHash,
    purpose: "signup_or_link",
    expiresAt,
    claimedByUserId: userId,
  });

  return tokenMaterial.plaintextToken;
}

async function pruneActiveApiTokens(input: {
  userId: string;
  keepTokenIds?: string[];
  maxActive: number;
}) {
  const keepTokenIds = new Set((input.keepTokenIds || []).filter(Boolean));
  const tokens = await storage.listUserApiTokens(input.userId);
  const keptActiveCount = tokens.filter(
    (token) => !token.revokedAt && keepTokenIds.has(token.id),
  ).length;
  const revokableActiveTokens = tokens
    .filter((token) => !token.revokedAt && !keepTokenIds.has(token.id))
    .sort(
      (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    );
  const availableBudget = Math.max(0, input.maxActive - keptActiveCount);
  const toRevoke = revokableActiveTokens.slice(
    0,
    Math.max(0, revokableActiveTokens.length - availableBudget),
  );

  for (const token of toRevoke) {
    await storage.revokeUserApiToken(input.userId, token.id);
  }
}

async function waitForAgentIdle(userId: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pendingRuns = await db
      .select({ id: userAgentRuns.id })
      .from(userAgentRuns)
      .where(and(eq(userAgentRuns.userId, userId), eq(userAgentRuns.status, "pending")))
      .limit(1);
    if (pendingRuns.length === 0) {
      return;
    }
    await sleep(1_000);
  }

  throw new Error("Timed out waiting for agent runs to go idle.");
}

async function clearPendingAgentRuns(userId: string) {
  await db
    .update(userAgentRuns)
    .set({
      status: "failed",
      errorMessage: "Cleared by public-surface dev validation.",
      completedAt: new Date(),
    })
    .where(and(eq(userAgentRuns.userId, userId), eq(userAgentRuns.status, "pending")));
}

async function seedValidationState(baseUrl: string, authToken: string): Promise<ValidationState> {
  const user = await requestJson<any>(baseUrl, {
    path: "/api/auth/user",
  });
  const player = await findValidationPlayer();
  const { startOfDay } = getETDayBoundaries(player.date);
  const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);

  await storage.addUserBalance(DEV_USER_ID, 5_000);
  await storage.updateHolding(DEV_USER_ID, "player", player.playerId, 10, player.lastTradePrice);
  await storage.updateHolding(DEV_USER_ID, "community", "community", 2, "1.00");

  const activeBoosts = await storage.getDailyBoostsAllSports(DEV_USER_ID, targetDate);
  for (const boost of activeBoosts) {
    if (boost.status === "active") {
      await storage.deleteDailyBoost(boost.id);
    }
  }

  try {
    await addLiquidity(player.playerId, DEV_USER_ID, 1, 10);
  } catch {
    // Keep going; LP tools may still surface environment issues in the final report.
  }

  await ensureCollection(DEV_USER_ID, player.team);
  const milestoneId = await ensureMilestone(DEV_USER_ID);
  const watchlist = await storage.createWatchlist(
    DEV_USER_ID,
    "Validation Watchlist",
    false,
    "blue",
  );
  const thread = await createAgentThread(DEV_USER_ID, {
    channel: "cli",
    title: "Validation Thread",
    domain: "sportfolio",
  });

  await requestJson(baseUrl, {
    path: "/api/dev/grant-premium-shares",
    method: "POST",
    body: {
      userId: DEV_USER_ID,
      quantity: 3,
    },
  }).catch(() => undefined);

  const phone = `+1555${String(Date.now()).slice(-7)}`;

  return {
    baseUrl,
    authToken,
    authTokenId: "",
    userId: DEV_USER_ID,
    originalUsername: user.username || null,
    originalProfileImageUrl: user.profileImageUrl || null,
    playerId: player.playerId,
    playerName: player.playerName,
    team: player.team,
    sport: player.sport,
    date: player.date,
    gameId: player.gameId,
    boostSlotTier: 4,
    watchlistId: watchlist.id,
    threadId: thread.id,
    pendingBundleId: "",
    createdTokenId: "",
    milestoneId,
    collectionType: "team",
    collectionTargetId: player.team,
    phone,
    smsToken: "",
  };
}

function hasRequiredArgs(inputSchema?: Record<string, any>) {
  return Object.values(inputSchema || {}).some((schema) => !schema.safeParse(undefined).success);
}

async function ensureWatchlistExists(state: ValidationState) {
  const watchlists = await storage.getWatchlists(state.userId);
  const existing = watchlists.find((entry) => entry.id === state.watchlistId);
  if (existing) {
    return existing.id;
  }

  const created = await storage.createWatchlist(
    state.userId,
    `Validation Watchlist ${Date.now()}`,
    false,
    "blue",
  );
  state.watchlistId = created.id;
  return created.id;
}

async function ensureSmsLinked(state: ValidationState) {
  const existing = await getSmsSettings(state.userId);
  if (existing) {
    return existing;
  }

  const token = await seedSmsToken(state.phone, state.userId);
  state.smsToken = token;
  return completeSmsPhoneLink(state.userId, token);
}

async function ensureActiveDailyBoost(state: ValidationState) {
  if (!state.gameId) {
    return;
  }

  const { startOfDay } = getETDayBoundaries(state.date || getTodayET());
  const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);
  const currentBoosts = await storage.getDailyBoostsAllSports(state.userId, targetDate);
  const existing = currentBoosts.find(
    (entry) =>
      entry.playerId === state.playerId &&
      entry.slotTier === state.boostSlotTier &&
      entry.status === "active",
  );
  if (existing) {
    return;
  }

  const conflicting = currentBoosts.find(
    (entry) => entry.slotTier === state.boostSlotTier && entry.status === "active",
  );
  if (conflicting) {
    await storage.deleteDailyBoost(conflicting.id);
  }

  await storage.createDailyBoost({
    userId: state.userId,
    playerId: state.playerId,
    sport: state.sport,
    slotTier: state.boostSlotTier,
    boostDate: startOfDay,
    sharesEntered: 1,
    shareMultiplier: "1.00",
    shareSourceType: "regular",
    gameId: state.gameId,
  });
}

async function ensureLpPosition(state: ValidationState) {
  const position = await getLpPosition(state.playerId, state.userId);
  if (position && Number(position.lpShares || 0) >= 1) {
    return position;
  }

  await addLiquidity(state.playerId, state.userId, 1, 10);
  return getLpPosition(state.playerId, state.userId);
}

async function resolveToolArgs(name: string, state: ValidationState) {
  const defaultArgs = { ...(getPublicToolFixtures()[name] || {}) };
  switch (name) {
    case "search_players":
      return { query: state.playerName.split(" ")[0], sport: state.sport };
    case "get_market_scanners":
      return { sport: state.sport };
    case "get_games_today":
    case "get_game_insights":
    case "list_daily_boost_eligible_players":
    case "list_daily_boosts":
    case "get_community_boost_state":
      return { sport: state.sport, date: state.date };
    case "list_community_boost_eligible_players":
      return { date: state.date };
    case "get_player_detail":
    case "get_player_stats":
    case "get_player_recent_games":
    case "get_player_financial_metrics":
    case "get_player_shares_info":
    case "get_holding_multiplier_state":
    case "get_lp_position":
    case "get_amm_pool_state":
    case "list_player_watchlists":
    case "get_scout_roster":
      return { playerId: state.playerId };
    case "get_trade_quote":
      return { playerId: state.playerId, type: "buy", amount: 25 };
    case "get_lp_zap_quote":
      return { playerId: state.playerId, sbAmount: 25 };
    case "get_lp_history":
      return { playerId: state.playerId, limit: 10 };
    case "get_doc_article":
      return { section: "gameplay", slug: "stacking-shares-and-boosts" };
    case "get_watchlist_items":
      return { watchlistId: state.watchlistId };
    case "get_collection_detail":
      return { type: state.collectionType, targetId: state.collectionTargetId };
    case "celebrate_milestone":
      return { milestoneId: state.milestoneId };
    case "create_watchlist":
      return { name: `Validation ${Date.now()}`, color: "blue" };
    case "update_watchlist":
      return { watchlistId: state.watchlistId, name: `Updated ${Date.now()}` };
    case "delete_watchlist":
      return { watchlistId: state.watchlistId };
    case "add_watchlist_player":
    case "remove_watchlist_player":
      return { watchlistId: state.watchlistId, playerId: state.playerId };
    case "create_api_token":
      return { label: `validation-${Date.now()}` };
    case "revoke_api_token":
      return { tokenId: state.createdTokenId };
    case "update_username":
      return { username: `dev_validate_${String(Date.now()).slice(-6)}` };
    case "update_profile_image":
      return { profileImageUrl: `https://example.com/${Date.now()}.png` };
    case "start_sms_link":
      return { phone: state.phone };
    case "complete_sms_link":
      return { token: state.smsToken };
    case "update_agent_profile":
      return { enabled: true, defaultSport: state.sport };
    case "create_agent_thread":
      return { title: `Validation Thread ${Date.now()}`, channel: "cli" };
    case "get_thread_state":
    case "list_thread_messages":
    case "list_thread_research_sources":
    case "get_pending_action":
      return { threadId: state.threadId };
    case "send_agent_message":
      return { threadId: state.threadId, message: `buy $25 of ${state.playerName}` };
    case "confirm_pending_action":
    case "cancel_pending_action":
      return { threadId: state.threadId, pendingBundleId: state.pendingBundleId };
    case "stage_market_buy":
      return { playerId: state.playerId, amount: 250 };
    case "stage_market_sell":
      return { playerId: state.playerId, shares: 2 };
    case "stage_lp_add":
      return { playerId: state.playerId, shares: 1, playMoney: 10 };
    case "stage_lp_add_optimal":
      return { playerId: state.playerId, maxShares: 1, maxPlayMoney: 10 };
    case "stage_lp_zap_add":
      return { playerId: state.playerId, sbAmount: 10 };
    case "stage_lp_remove":
      return { playerId: state.playerId, lpShares: 1 };
    case "stage_scout_assignment":
      return { playerId: state.playerId, targetCount: 1 };
    case "stage_stack_shares":
      return { playerId: state.playerId, shares: 4 };
    case "stage_daily_boost_assign":
      return {
        playerId: state.playerId,
        slotTier: state.boostSlotTier,
        sport: state.sport,
        date: state.date,
      };
    case "stage_daily_boost_remove":
      return {
        playerId: state.playerId,
        slotTier: state.boostSlotTier,
        sport: state.sport,
        date: state.date,
      };
    case "stage_community_boost_create":
      return { playerId: state.playerId, sport: state.sport, date: state.date };
    case "upsert_schedule":
      return {
        jobType: "daily_setup_review",
        enabled: true,
        scheduleCron: "0 8 * * *",
        channelTargets: ["in_app"],
      };
    case "delete_schedule":
      return { jobType: "daily_setup_review" };
    default:
      return defaultArgs;
  }
}

function captureToolState(name: string, result: Record<string, any>, state: ValidationState) {
  if (result.threadId) {
    state.threadId = String(result.threadId);
  }
  if (result.thread?.id) {
    state.threadId = String(result.thread.id);
  }
  if (result.pendingBundleId) {
    state.pendingBundleId = String(result.pendingBundleId);
  }
  if (result.watchlist?.id) {
    state.watchlistId = String(result.watchlist.id);
  }
  if (result.token?.id) {
    state.createdTokenId = String(result.token.id);
  }
  if (name === "confirm_pending_action" || name === "cancel_pending_action") {
    state.pendingBundleId = "";
  }
}

async function ensurePendingBundleForCli(state: ValidationState) {
  const result = await invokeCli([
    "--json",
    "tools",
    "call",
    "stage_market_buy",
    "--args-json",
    JSON.stringify({ playerId: state.playerId, amount: 100 }),
  ]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  captureToolState("stage_market_buy", JSON.parse(result.stdout), state);
}

async function ensurePendingBundleForMcp(openClient: OpenClient, state: ValidationState) {
  const result = await openClient.client.callTool({
    name: "stage_market_buy",
    arguments: {
      playerId: state.playerId,
      amount: 100,
    },
  });
  if (result.isError) {
    throw new Error(JSON.stringify(result.structuredContent || {}));
  }
  captureToolState(
    "stage_market_buy",
    (result.structuredContent || {}) as Record<string, any>,
    state,
  );
}

async function createFreshThread(state: ValidationState) {
  await clearPendingAgentRuns(state.userId);
  await waitForAgentIdle(state.userId);
  const thread = await createAgentThread(state.userId, {
    channel: "cli",
    title: `Validation Thread ${Date.now()}`,
    domain: "sportfolio",
  });
  state.threadId = thread.id;
  state.pendingBundleId = "";
}

async function validateCliSurface(state: ValidationState, results: ValidationResult[]) {
  const listedTools = await invokeCli(["--json", "tools", "list"]);
  if (listedTools.exitCode !== 0) {
    throw new Error(listedTools.stderr || listedTools.stdout);
  }
  const listedPrompts = await invokeCli(["--json", "prompts", "list"]);
  const listedResources = await invokeCli(["--json", "resources", "list"]);

  if (listedPrompts.exitCode !== 0 || listedResources.exitCode !== 0) {
    throw new Error(listedPrompts.stderr || listedResources.stderr || "CLI list command failed.");
  }

  for (const tool of buildPublicToolRegistry()) {
    const record: ValidationResult = {
      surface: "cli",
      kind: "tool",
      name: tool.name,
      status: "passed",
    };

    try {
      if (tool.name === "confirm_pending_action" || tool.name === "cancel_pending_action") {
        await ensurePendingBundleForCli(state);
      }
      if (
        [
          "get_watchlist_items",
          "update_watchlist",
          "delete_watchlist",
          "add_watchlist_player",
          "remove_watchlist_player",
        ].includes(tool.name)
      ) {
        await ensureWatchlistExists(state);
      }
      if (tool.name === "update_sms_settings") {
        await ensureSmsLinked(state);
      }
      if (tool.name === "create_api_token") {
        await pruneActiveApiTokens({
          userId: state.userId,
          keepTokenIds: [state.authTokenId],
          maxActive: 7,
        });
      }
      if (tool.name === "stage_daily_boost_remove") {
        await ensureActiveDailyBoost(state);
      }
      if (tool.name === "stage_lp_remove") {
        await ensureLpPosition(state);
      }
      if (tool.name === "complete_sms_link") {
        state.smsToken = await seedSmsToken(state.phone, state.userId);
      }
      if (tool.name === "send_agent_message") {
        await createFreshThread(state);
      }
      const args = await resolveToolArgs(tool.name, state);

      const response = await invokeCli([
        "--json",
        "tools",
        "call",
        tool.name,
        "--args-json",
        JSON.stringify(args),
      ]);

      if (response.exitCode !== 0) {
        throw new Error(response.stderr || response.stdout);
      }

      const payload = JSON.parse(response.stdout) as Record<string, any>;
      captureToolState(tool.name, payload, state);
      if (tool.name === "start_sms_link") {
        state.smsToken = await getSmsToken(state.userId);
      }

      if (hasRequiredArgs(tool.inputSchema)) {
        const invalid = await invokeCli([
          "--json",
          "tools",
          "call",
          tool.name,
          "--args-json",
          "{}",
        ]);
        if (invalid.exitCode === 0) {
          record.invalidCase = "failed";
          record.invalidDetails = "Expected the CLI to reject empty required arguments.";
        } else {
          record.invalidCase = "passed";
        }
      }
    } catch (error) {
      record.status = isBlockedError(error) ? "blocked" : "failed";
      record.details = toErrorMessage(error);
    }

    results.push(record);
  }

  for (const prompt of buildPublicPromptRegistry()) {
    const record: ValidationResult = {
      surface: "cli",
      kind: "prompt",
      name: prompt.name,
      status: "passed",
    };
    try {
      const response = await invokeCli([
        "--json",
        "prompts",
        "render",
        prompt.name,
        "--args-json",
        JSON.stringify(getPublicPromptFixtures()[prompt.name]),
      ]);
      if (response.exitCode !== 0) {
        throw new Error(response.stderr || response.stdout);
      }
      JSON.parse(response.stdout);
    } catch (error) {
      record.status = isBlockedError(error) ? "blocked" : "failed";
      record.details = toErrorMessage(error);
    }
    results.push(record);
  }

  for (const resource of buildPublicResourceRegistry({
    userId: state.userId,
    deps: (await import("../server/mcp/public-tool-registry")).createDefaultPublicMcpDependencies(),
  })) {
    const record: ValidationResult = {
      surface: "cli",
      kind: "resource",
      name: resource.uri,
      status: "passed",
    };
    try {
      const response = await invokeCli(["--json", "resources", "read", resource.uri]);
      if (response.exitCode !== 0) {
        throw new Error(response.stderr || response.stdout);
      }
      JSON.parse(response.stdout);
    } catch (error) {
      record.status = "failed";
      record.details = toErrorMessage(error);
    }
    results.push(record);
  }
}

async function validateMcpSurface(
  openClient: OpenClient,
  state: ValidationState,
  results: ValidationResult[],
) {
  await openClient.client.listTools();
  await openClient.client.listPrompts();
  await openClient.client.listResources();

  for (const tool of buildPublicToolRegistry()) {
    const record: ValidationResult = {
      surface: "mcp",
      kind: "tool",
      name: tool.name,
      status: "passed",
    };
    try {
      if (tool.name === "confirm_pending_action" || tool.name === "cancel_pending_action") {
        await ensurePendingBundleForMcp(openClient, state);
      }
      if (
        [
          "get_watchlist_items",
          "update_watchlist",
          "delete_watchlist",
          "add_watchlist_player",
          "remove_watchlist_player",
        ].includes(tool.name)
      ) {
        await ensureWatchlistExists(state);
      }
      if (tool.name === "update_sms_settings") {
        await ensureSmsLinked(state);
      }
      if (tool.name === "create_api_token") {
        await pruneActiveApiTokens({
          userId: state.userId,
          keepTokenIds: [state.authTokenId],
          maxActive: 7,
        });
      }
      if (tool.name === "stage_daily_boost_remove") {
        await ensureActiveDailyBoost(state);
      }
      if (tool.name === "stage_lp_remove") {
        await ensureLpPosition(state);
      }
      if (tool.name === "complete_sms_link") {
        state.smsToken = await seedSmsToken(state.phone, state.userId);
      }
      if (tool.name === "send_agent_message") {
        await createFreshThread(state);
      }
      const args = await resolveToolArgs(tool.name, state);
      const response = await openClient.client.callTool({
        name: tool.name,
        arguments: args,
      });
      if (response.isError) {
        throw new Error(JSON.stringify(response.structuredContent || {}));
      }
      const payload = (response.structuredContent || {}) as Record<string, any>;
      captureToolState(tool.name, payload, state);
      if (tool.name === "start_sms_link") {
        state.smsToken = await getSmsToken(state.userId);
      }

      if (hasRequiredArgs(tool.inputSchema)) {
        const invalid = await openClient.client.callTool({
          name: tool.name,
          arguments: {},
        });
        record.invalidCase = invalid.isError ? "passed" : "failed";
        record.invalidDetails = invalid.isError
          ? undefined
          : "Expected the MCP surface to reject empty required arguments.";
      }
    } catch (error) {
      record.status = isBlockedError(error) ? "blocked" : "failed";
      record.details = toErrorMessage(error);
    }
    results.push(record);
  }

  for (const prompt of buildPublicPromptRegistry()) {
    const record: ValidationResult = {
      surface: "mcp",
      kind: "prompt",
      name: prompt.name,
      status: "passed",
    };
    try {
      await openClient.client.getPrompt({
        name: prompt.name,
        arguments: getPublicPromptFixtures()[prompt.name],
      });
    } catch (error) {
      record.status = isBlockedError(error) ? "blocked" : "failed";
      record.details = toErrorMessage(error);
    }
    results.push(record);
  }

  for (const resource of buildPublicResourceRegistry({
    userId: state.userId,
    deps: (await import("../server/mcp/public-tool-registry")).createDefaultPublicMcpDependencies(),
  })) {
    const record: ValidationResult = {
      surface: "mcp",
      kind: "resource",
      name: resource.uri,
      status: "passed",
    };
    try {
      await openClient.client.readResource({
        uri: resource.uri,
      });
    } catch (error) {
      record.status = "failed";
      record.details = toErrorMessage(error);
    }
    results.push(record);
  }
}

async function main() {
  const baseUrl = `http://127.0.0.1:${SERVER_PORT}`;
  const server = startDevServer(baseUrl);
  let openClient: OpenClient | null = null;

  try {
    await waitForHealthyServer(baseUrl);
    await clearPendingAgentRuns(DEV_USER_ID);
    await pruneActiveApiTokens({
      userId: DEV_USER_ID,
      maxActive: 6,
    });

    const tokenResponse = await requestJson<{ token: { plaintextToken: string; id: string } }>(
      baseUrl,
      {
        path: "/api/account/tokens",
        method: "POST",
        body: {
          label: `dev-validate-${Date.now()}`,
        },
      },
    );
    const authToken = tokenResponse.token.plaintextToken;
    const originalState = await seedValidationState(baseUrl, authToken);
    originalState.authTokenId = tokenResponse.token.id;

    const login = await invokeCli(["auth", "login", "--token", authToken, "--base-url", baseUrl]);
    if (login.exitCode !== 0) {
      throw new Error(login.stderr || login.stdout);
    }

    openClient = await connectMcpClient(baseUrl, authToken);
    const results: ValidationResult[] = [];

    await validateCliSurface(originalState, results);

    const mcpState = await seedValidationState(baseUrl, authToken);
    mcpState.authTokenId = tokenResponse.token.id;
    mcpState.originalUsername = originalState.originalUsername;
    mcpState.originalProfileImageUrl = originalState.originalProfileImageUrl;
    await validateMcpSurface(openClient, mcpState, results);

    const summary = {
      ok: !results.some((result) => result.status === "failed" || result.invalidCase === "failed"),
      generatedAt: new Date().toISOString(),
      baseUrl,
      results,
      counts: {
        passed: results.filter((result) => result.status === "passed").length,
        blocked: results.filter((result) => result.status === "blocked").length,
        failed: results.filter((result) => result.status === "failed").length,
      },
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));

    if (!summary.ok) {
      process.exitCode = 1;
    }

    if (originalState.originalUsername) {
      await storage
        .updateUsername(originalState.userId, originalState.originalUsername)
        .catch(() => undefined);
    }
    if (originalState.originalProfileImageUrl) {
      await storage
        .updateProfileImage(originalState.userId, originalState.originalProfileImageUrl)
        .catch(() => undefined);
    }
  } finally {
    await closeClient(openClient);
    await stopDevServer(server);
  }
}

await main();
