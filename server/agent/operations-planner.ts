import { dailyBoosts, players } from "@shared/schema";
import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  getBuyQuote,
  getLpPosition,
  getOrCreatePool,
  getSellQuote,
  getZapAddQuoteSbOnly,
  getZapAddQuoteSharesOnly,
} from "../amm/pool";
import { db } from "../db";
import { getETDayBoundaries, getTodayET } from "../lib/time";
import { storage } from "../storage";
import type { UserAgentProfile } from "@shared/schema";
import { buildPlayerNameClarification } from "./clarification";
import { isHostedWebResearchAvailable } from "./research";
import type {
  AgentAnalysisResult,
  AgentDomain,
  CommunityBoostCreateAction,
  DailyBoostAssignAction,
  DailyBoostRemoveAction,
  PoolAddLiquidityAction,
  PoolAddLiquidityOptimalAction,
  PoolBuyAction,
  PoolRemoveLiquidityAction,
  PoolSellAction,
  PoolZapSbAction,
  PoolZapSharesAction,
  WatchlistAddPlayerAction,
  WatchlistRemovePlayerAction,
} from "./types";

const DEFAULT_MAX_SLIPPAGE = 0.05;
const LIQUIDITY_RATIO_TOLERANCE = 0.02;
const DAILY_BOOST_SLOT_COUNT = 4;
const SUPPORTED_SPORTS = ["NBA", "NFL", "MLB", "NASCAR"] as const;

type DirectOperationPlan = Omit<AgentAnalysisResult, "runId" | "status"> & {
  contextSnapshot: Record<string, unknown>;
  trace: Record<string, unknown>;
};

type ResolvedDate = {
  dateStr: string;
  targetDate: Date;
  label: "today" | "tomorrow";
};

type ResolvedPlayer = {
  player: typeof players.$inferSelect;
  warnings: string[];
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeNameFragment(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/\b(?:stock|shares?|share|pool|player pool|boosts?|boost slot|slot)\b/gi, " ")
      .replace(/[.,!?]+$/g, " "),
  );
}

function isAdvisoryRequest(message: string): boolean {
  const normalized = normalizeWhitespace(message).toLowerCase();
  if (
    normalized.endsWith("?") &&
    !/^(?:can|could|will)\s+you\b/.test(normalized) &&
    !/^(?:please\s+)?help me\b/.test(normalized)
  ) {
    return true;
  }

  return (
    normalized.startsWith("what do you think") ||
    normalized.startsWith("should i") ||
    normalized.startsWith("would you") ||
    normalized.startsWith("is it smart") ||
    normalized.startsWith("does it make sense") ||
    normalized.startsWith("talk me through") ||
    normalized.startsWith("walk me through") ||
    normalized.startsWith("how do you feel about") ||
    normalized.startsWith("what's your take on") ||
    normalized.startsWith("what is your take on") ||
    normalized.startsWith("what if") ||
    normalized.startsWith("i'm thinking about") ||
    normalized.startsWith("im thinking about") ||
    normalized.startsWith("thinking about") ||
    normalized.startsWith("i am considering") ||
    normalized.startsWith("considering") ||
    normalized.startsWith("i'm torn between") ||
    normalized.startsWith("im torn between") ||
    normalized.startsWith("compare") ||
    normalized.startsWith("help me understand") ||
    /\b(?:is it worth|would it be better|what's better|whats better)\b/.test(normalized)
  );
}

function normalizeOperationalParserMessage(message: string): string {
  let normalized = normalizeWhitespace(message);
  const prefixes = [
    /^(?:hey|hi|yo)\s+/i,
    /^(?:please\s+)?(?:can|could|will)\s+you\s+/i,
    /^(?:please\s+)?help me\s+/i,
    /^(?:please\s+)?(?:i want to|i'd like to|id like to|i need to|let's|lets|go ahead and)\s+/i,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      const updated = normalized.replace(prefix, "");
      if (updated !== normalized) {
        normalized = normalizeWhitespace(updated);
        changed = true;
      }
    }
  }

  return normalized.replace(/\s+for me[.?!]*$/i, "").trim();
}

function buildStageNudge(requestMode: "discussion" | "commit") {
  return requestMode === "discussion"
    ? "If you want to actually make that move, tell me to do it and I'll queue it up for confirmation."
    : "If you want to lock that in, confirm and I'll execute it.";
}

function resolveDateFromMessage(message: string): ResolvedDate {
  const lower = message.toLowerCase();
  const today = getTodayET();

  if (lower.includes("tomorrow")) {
    const { startOfDay } = getETDayBoundaries(today);
    const nextDate = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000).toLocaleDateString(
      "en-CA",
      { timeZone: "America/New_York" },
    );
    const { startOfDay: nextStartOfDay } = getETDayBoundaries(nextDate);

    return {
      dateStr: nextDate,
      targetDate: new Date(nextStartOfDay.getTime() + 12 * 60 * 60 * 1000),
      label: "tomorrow",
    };
  }

  const { startOfDay } = getETDayBoundaries(today);
  return {
    dateStr: today,
    targetDate: new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000),
    label: "today",
  };
}

function resolveSportHint(message: string, defaultSport: string | null): string | null {
  const upper = message.toUpperCase();
  const explicitSport = SUPPORTED_SPORTS.find((sport) => upper.includes(sport));
  return explicitSport || defaultSport || null;
}

async function resolvePlayerByReference(
  rawReference: string,
  options: {
    message: string;
    profile: UserAgentProfile;
  },
): Promise<ResolvedPlayer | null> {
  const cleanedReference = sanitizeNameFragment(rawReference)
    .replace(/\b(?:today|tomorrow|tonight)\b/gi, " ")
    .replace(/\b(?:my|the|a|an)\b/gi, " ");
  const normalizedReference = normalizeWhitespace(cleanedReference);

  if (!normalizedReference) {
    return null;
  }

  if (/^(nba|nfl|mlb|nascar)_[a-z0-9_-]+$/i.test(normalizedReference)) {
    const player = await storage.getPlayer(normalizedReference);
    if (!player) {
      return null;
    }
    return { player, warnings: [] };
  }

  const sportHint = resolveSportHint(options.message, options.profile.defaultSport);
  const conditions = [eq(players.isActive, true)];
  if (sportHint) {
    conditions.push(eq(players.sport, sportHint));
  }

  const exactMatches = await db
    .select()
    .from(players)
    .where(
      and(
        ...conditions,
        sql`LOWER(${players.firstName} || ' ' || ${players.lastName}) = ${normalizedReference.toLowerCase()}`,
      ),
    )
    .orderBy(desc(players.volume24h))
    .limit(5);

  if (exactMatches.length === 1) {
    return {
      player: exactMatches[0],
      warnings: [],
    };
  }

  if (exactMatches.length > 1) {
    return {
      player: exactMatches[0],
      warnings: [
        "Multiple active players matched that name, so I used the highest-volume one. Add the sport if you want a different player.",
      ],
    };
  }

  const likePattern = `%${normalizedReference.toLowerCase()}%`;
  const token = normalizedReference.split(/\s+/).filter(Boolean).pop() || normalizedReference;
  const tokenPattern = `%${token.toLowerCase()}%`;

  const candidates = await db
    .select()
    .from(players)
    .where(
      and(
        ...conditions,
        or(
          sql`LOWER(${players.firstName} || ' ' || ${players.lastName}) LIKE ${likePattern}`,
          sql`LOWER(${players.firstName}) LIKE ${tokenPattern}`,
          sql`LOWER(${players.lastName}) LIKE ${tokenPattern}`,
        ),
      ),
    )
    .orderBy(desc(players.volume24h))
    .limit(25);

  if (candidates.length === 0) {
    return null;
  }

  const normalizedTokens = normalizedReference.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = candidates
    .map((candidate) => {
      const fullName = `${candidate.firstName} ${candidate.lastName}`.toLowerCase();
      let score = 0;

      if (fullName === normalizedReference.toLowerCase()) score += 200;
      if (fullName.startsWith(normalizedReference.toLowerCase())) score += 120;
      if (fullName.includes(normalizedReference.toLowerCase())) score += 90;

      for (const nameToken of normalizedTokens) {
        if (
          candidate.firstName.toLowerCase() === nameToken ||
          candidate.lastName.toLowerCase() === nameToken
        ) {
          score += 45;
        } else if (fullName.includes(nameToken)) {
          score += 18;
        }
      }

      if (sportHint && candidate.sport === sportHint) score += 12;
      score += Math.min(10, candidate.volume24h / 1000);

      return {
        candidate,
        score,
      };
    })
    .sort((left, right) => right.score - left.score);

  const best = scored[0];
  if (!best || best.score <= 0) {
    return null;
  }

  const secondBest = scored[1];
  const warnings: string[] = [];
  if (secondBest && best.score - secondBest.score < 15) {
    warnings.push(
      "That name is a little ambiguous, so I used the highest-confidence match. Add the full player name or sport if you want to be more specific.",
    );
  }

  return {
    player: best.candidate,
    warnings,
  };
}

function buildUnavailableResponse(input: {
  domain: AgentDomain;
  requestMessage: string;
  summary: string;
  replyText: string;
  warnings?: string[];
  contextSnapshot: Record<string, unknown>;
  trace: Record<string, unknown>;
}): DirectOperationPlan {
  return {
    domain: input.domain,
    requestMessage: input.requestMessage,
    replyText: input.replyText,
    summary: input.summary,
    observations: [],
    warnings: input.warnings || [],
    actions: [],
    pendingClarification: null,
    errorMessage: null,
    contextSnapshot: input.contextSnapshot,
    trace: input.trace,
  };
}

function buildPlayerClarificationResponse(input: {
  domain: AgentDomain;
  requestMessage: string;
  summary: string;
  replyText: string;
  prompt: string;
  resumeMessageTemplate: string;
  workflowTitle?: string | null;
  workflowPreviewSteps?: string[];
  warnings?: string[];
  contextSnapshot: Record<string, unknown>;
  trace: Record<string, unknown>;
}): DirectOperationPlan {
  const response = buildUnavailableResponse(input);

  return {
    ...response,
    pendingClarification: buildPlayerNameClarification({
      prompt: input.prompt,
      originalRequest: input.requestMessage,
      resumeMessageTemplate: input.resumeMessageTemplate,
      workflowTitle: input.workflowTitle,
      workflowPreviewSteps: input.workflowPreviewSteps,
    }),
  };
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatNumber(value: number, digits = 2): string {
  return Number(value).toFixed(digits);
}

function computeEstimatedOwnershipPercent(input: {
  currentPoolShares: number;
  currentLpSharesTotal: number;
  depositedShares: number;
}): number | null {
  if (
    input.currentPoolShares <= 0 ||
    input.currentLpSharesTotal <= 0 ||
    input.depositedShares <= 0
  ) {
    return null;
  }

  const mintedLpShares =
    (input.depositedShares / input.currentPoolShares) * input.currentLpSharesTotal;
  const totalLpSharesAfter = input.currentLpSharesTotal + mintedLpShares;
  if (totalLpSharesAfter <= 0) {
    return null;
  }

  return (mintedLpShares / totalLpSharesAfter) * 100;
}

function parseNumericString(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

async function getPrimaryWatchlist(userId: string) {
  const watchlists = await storage.getWatchlists(userId);
  const defaultWatchlist = watchlists.find((entry) => entry.isDefault) || watchlists[0] || null;

  return {
    watchlists,
    defaultWatchlist,
  };
}

function isMarketAnalysisRequest(message: string): boolean {
  const lower = normalizeWhitespace(message).toLowerCase();

  return (
    /\b(?:who|what|which)\b.*\b(?:hasn't started|haven't started|not started|still ahead|still to play|left tonight|remaining tonight)\b/.test(
      lower,
    ) ||
    /\b(?:who|what|which)\b.*\b(?:trending|hot|heating up|momentum|best setup|under the radar|sleepers?)\b/.test(
      lower,
    ) ||
    /\b(?:best setup|best outlook|best spot)\b.*\b(?:next two days|next 2 days|tomorrow|tonight)\b/.test(
      lower,
    ) ||
    /\b(?:strong form|fantasy form|future matchups?|matchup window|remaining window)\b/.test(
      lower,
    ) ||
    /\b(?:underpriced|mispriced|weak market pricing|value right now|best value)\b/.test(lower) ||
    /\b(?:my players|my holdings|my portfolio)\b.*\b(?:strong form|hot|trending|underpriced|best setup)\b/.test(
      lower,
    ) ||
    /\b(?:who's|whos)\s+(?:hot|trending)\b/.test(lower) ||
    /\b(?:market|fantasy)\b.*\b(?:momentum|trend|setup)\b/.test(lower)
  );
}

function isCapabilityGuideRequest(message: string): boolean {
  const lower = normalizeWhitespace(message).toLowerCase();

  return (
    lower === "help" ||
    /\b(?:what can you do|what can you help with|what can you handle|what can the agent do)\b/.test(
      lower,
    ) ||
    /\b(?:show|list)\s+(?:me\s+)?(?:your\s+)?capabilities\b/.test(lower) ||
    /\b(?:how broad|how capable)\b.*\b(?:are you|is the agent)\b/.test(lower) ||
    /\b(?:which|what)\s+(?:areas|parts of sportfolio)\s+(?:can you manage|can you handle)\b/.test(
      lower,
    )
  );
}

function isBroadOperatorReviewRequest(message: string): boolean {
  const lower = normalizeWhitespace(message).toLowerCase();

  return (
    /\b(?:review|audit|check)\s+(?:my\s+)?(?:full\s+)?(?:setup|portfolio|account)\b/.test(lower) ||
    /\b(?:what should i do(?:\s+(?:today|right now))?|what am i missing)\b/.test(lower) ||
    /\banything i should(?:\s+be)?\s+(?:doing|do|clean(?:ing)? up)\b/.test(lower) ||
    /\b(?:how am i set up|give me (?:a\s+)?(?:full\s+)?review)\b/.test(lower) ||
    /^(?:today'?s?\s+)?(?:operator|portfolio)\s+(?:review|read)$/.test(lower)
  );
}

function isPortfolioCleanupRequest(message: string): boolean {
  const lower = normalizeWhitespace(message).toLowerCase();

  return (
    /\b(?:clean up|tidy up|audit|review|trim)\b.*\b(?:my\s+)?(?:portfolio|holdings|positions)\b/.test(
      lower,
    ) || /\b(?:where am i overexposed|am i too concentrated|too concentrated)\b/.test(lower)
  );
}

function isIdleCapitalRequest(message: string): boolean {
  const lower = normalizeWhitespace(message).toLowerCase();

  return (
    /\b(?:idle balance|idle cash|idle capital|dry powder|available balance)\b/.test(lower) ||
    /\bwhat should i do with (?:my\s+)?(?:cash|balance|dry powder)\b/.test(lower) ||
    /\bdeploy (?:my\s+)?(?:cash|balance|dry powder)\b/.test(lower)
  );
}

function isCommunityBoostOpportunityRequest(message: string): boolean {
  const lower = normalizeWhitespace(message).toLowerCase();

  return (
    /\b(?:best|good|any)\s+community boost\b/.test(lower) ||
    /\bcommunity boost\b.*\b(?:opportunity|target|candidate|today|tomorrow|now)\b/.test(lower) ||
    /\bwho should get (?:my\s+)?community boost\b/.test(lower)
  );
}

function selectScannerBackedUpcomingCandidate(input: {
  allPlayers: any[];
  games: any[];
  scannerIds: Set<string>;
  sportHint: string | null;
  excludedIds?: Set<string>;
}) {
  for (const player of input.allPlayers) {
    if (!player?.id || !player.isActive) {
      continue;
    }
    if (input.sportHint && player.sport !== input.sportHint) {
      continue;
    }
    if (!input.scannerIds.has(player.id)) {
      continue;
    }
    if (input.excludedIds?.has(player.id)) {
      continue;
    }

    const nextGame = input.games.find(
      (game) =>
        game.sport === player.sport &&
        new Date(game.startTime) > new Date() &&
        (game.homeTeam === player.team || game.awayTeam === player.team),
    );

    if (!nextGame) {
      continue;
    }

    return {
      player,
      game: nextGame,
    };
  }

  return null;
}

async function buildCapabilityGuidePlan(
  _userId: string,
  _profile: UserAgentProfile,
  message: string,
  _requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  if (!isCapabilityGuideRequest(message)) {
    return null;
  }

  const webResearchEnabled = isHostedWebResearchAvailable();

  return {
    domain: "sportfolio",
    requestMessage: message,
    replyText: webResearchEnabled
      ? "I can operate across the main user-facing Sportfolio loops: scouting, player-pool buys and sells, liquidity adds and removals, zaps, condense/power-up flows, daily boosts, watchlists, and community boosts. I can also pull current outside context through the hosted Brave search path when you ask for latest news, injuries, or other time-sensitive external info. For any live mutation, I still stage the move first and wait for your confirmation before execution."
      : "I can operate across the main user-facing Sportfolio loops: scouting, player-pool buys and sells, liquidity adds and removals, zaps, condense/power-up flows, daily boosts, watchlists, and community boosts. For any live mutation, I still stage the move first and wait for your confirmation before execution.",
    summary:
      "Broad operator coverage across scouting, markets, boosts, watchlists, and community boosts.",
    observations: [
      "Direct commands stage confirmation-gated actions instead of executing immediately.",
      "Broad advisory asks can return a cross-domain setup read before any plan is queued.",
      webResearchEnabled
        ? "Hosted Brave search is available for current external news and injury context."
        : "Hosted external web research is not configured right now.",
    ],
    warnings: [],
    actions: [],
    pendingClarification: null,
    errorMessage: null,
    contextSnapshot: {
      intent: "capability_guide",
      webResearchEnabled,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "capability_guide",
      webResearchEnabled,
    },
  };
}

async function buildPortfolioCleanupReviewPlan(
  userId: string,
  _profile: UserAgentProfile,
  message: string,
  _requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  if (!isPortfolioCleanupRequest(message)) {
    return null;
  }

  const [holdingsWithPlayers, activeBoosts, availableBalance] = await Promise.all([
    storage.getUserHoldingsWithPlayers(userId),
    storage.getDailyBoostsAllSports(userId, new Date()),
    storage.getAvailableBalance(userId),
  ]);
  const playerHoldings = holdingsWithPlayers.filter(
    (entry: any) => entry?.holding?.assetType === "player" && entry?.player?.id,
  );

  if (playerHoldings.length === 0) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: "There are no active player holdings to clean up right now.",
      replyText:
        "You do not have any active player holdings right now, so there is no portfolio cleanup to do yet.",
      contextSnapshot: {
        intent: "portfolio_cleanup_review",
        positionCount: 0,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "portfolio_cleanup_review",
        reason: "no_positions",
      },
    });
  }

  const sortedHoldings = [...playerHoldings].sort(
    (left: any, right: any) =>
      parseNumericString(right?.holding?.quantity) - parseNumericString(left?.holding?.quantity),
  );
  const totalShares = sortedHoldings.reduce(
    (sum: number, entry: any) => sum + parseNumericString(entry?.holding?.quantity),
    0,
  );
  const leadHolding = sortedHoldings[0];
  const leadHoldingShares = parseNumericString(leadHolding?.holding?.quantity);
  const leadConcentrationPercent =
    totalShares > 0 ? Math.round((leadHoldingShares / totalShares) * 100) : 0;
  const powerReadyRows = sortedHoldings.filter((entry: any) => {
    const power = parseNumericString(entry?.holding?.power || "1");
    const quantity = parseNumericString(entry?.holding?.quantity);

    return power === 1 && quantity >= 2;
  });
  const smallRows = sortedHoldings.filter((entry: any) => {
    const power = parseNumericString(entry?.holding?.power || "1");
    const quantity = parseNumericString(entry?.holding?.quantity);

    return power === 1 && quantity === 1;
  });
  const activeBoostCount = activeBoosts.filter((boost) => boost.status !== "cancelled").length;
  const cleanupLevers: string[] = [];

  if (leadConcentrationPercent >= 45) {
    cleanupLevers.push(
      `your biggest concentration is ${leadHolding.player.firstName} ${leadHolding.player.lastName} at roughly ${leadConcentrationPercent}% of visible shares`,
    );
  }
  if (powerReadyRows.length > 0) {
    cleanupLevers.push(
      `${powerReadyRows.length} raw holding row${powerReadyRows.length === 1 ? "" : "s"} can be condensed into powered shares`,
    );
  }
  if (activeBoostCount === 0 && sortedHoldings.length > 0) {
    cleanupLevers.push("you have player inventory but no active daily boost live right now");
  }
  if (availableBalance >= 25) {
    cleanupLevers.push(`you still have ${formatMoney(availableBalance)} sitting idle`);
  }

  const primaryCleanup = cleanupLevers[0]
    ? `The biggest cleanup lever is that ${cleanupLevers[0]}.`
    : "Nothing looks structurally messy right now, so the main job is staying selective instead of forcing a cleanup.";

  return {
    domain: "sportfolio",
    requestMessage: message,
    replyText: `${primaryCleanup} ${
      powerReadyRows.length > 0
        ? "You have at least one raw share stack that can be converted into stronger boost-ready inventory."
        : "Most of the current structure is already fairly clean."
    } ${
      smallRows.length > 0
        ? `There are also ${smallRows.length} one-share row${smallRows.length === 1 ? "" : "s"} that are small enough to review before adding more scattered exposure.`
        : "You are not carrying a pile of tiny one-share rows right now."
    } If you want, tell me which piece to act on and I can stage the exact move for confirmation.`,
    summary: "Cross-domain portfolio cleanup review.",
    observations: [
      `${leadHolding.player.firstName} ${leadHolding.player.lastName} is the largest visible position at ${formatNumber(
        leadHoldingShares,
        0,
      )} share${leadHoldingShares === 1 ? "" : "s"} (${leadConcentrationPercent}% of visible size).`,
      `${powerReadyRows.length} raw holding row${powerReadyRows.length === 1 ? "" : "s"} can be condensed right now.`,
      `${activeBoostCount} daily boost slot${activeBoostCount === 1 ? "" : "s"} are currently active today.`,
      `${smallRows.length} one-share row${smallRows.length === 1 ? "" : "s"} are sitting as small unpowered positions.`,
    ],
    warnings: [],
    actions: [],
    pendingClarification: null,
    errorMessage: null,
    contextSnapshot: {
      intent: "portfolio_cleanup_review",
      totalShares,
      leadHoldingPlayerId: leadHolding.player.id,
      leadConcentrationPercent,
      powerReadyRows: powerReadyRows.length,
      activeBoostCount,
      smallRows: smallRows.length,
      availableBalance,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "portfolio_cleanup_review",
      cleanupLevers,
    },
  };
}

async function buildIdleCapitalDeploymentPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  _requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  if (!isIdleCapitalRequest(message)) {
    return null;
  }

  const availableBalance = await storage.getAvailableBalance(userId);
  if (availableBalance < 10) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: "There is not enough idle balance to worry about deploying right now.",
      replyText: `You only have ${formatMoney(
        availableBalance,
      )} available right now, so there is no real idle-capital issue to solve yet.`,
      contextSnapshot: {
        intent: "idle_capital_review",
        availableBalance,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "idle_capital_review",
        reason: "balance_too_small",
      },
    });
  }

  const sportHint = resolveSportHint(message, profile.defaultSport);
  const now = new Date();
  const endWindow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const [allPlayers, games, scanners] = await Promise.all([
    storage.getPlayers(),
    storage.getDailyGames(now, endWindow),
    storage.getFinancialMarketScanners(sportHint || "ALL"),
  ]);
  const scannerIds = new Set(
    [...scanners.momentum, ...scanners.undervalued, ...scanners.sentiment]
      .map((entry: any) => entry?.player?.id)
      .filter((entry: unknown): entry is string => typeof entry === "string"),
  );
  const candidate = selectScannerBackedUpcomingCandidate({
    allPlayers,
    games,
    scannerIds,
    sportHint,
  });

  const candidateNote = candidate
    ? `${candidate.player.firstName} ${candidate.player.lastName} is the cleanest scanner-backed near-term name from the current board.`
    : "There is no single clean scanner-backed name standing out from the currently available window.";

  return {
    domain: "sportfolio",
    requestMessage: message,
    replyText: `You have ${formatMoney(
      availableBalance,
    )} available, so the right move is to treat it like deployable leverage, not dead cash. ${candidateNote} The clean hierarchy is: use a direct buy if you have conviction on one player, use LP if you want a steadier fee-earning posture, and keep some dry powder back if you expect a better window later today. If you want, send me the exact player and amount and I can stage the move.`,
    summary: "Idle-capital deployment review.",
    observations: [
      `${formatMoney(availableBalance)} is currently uncommitted.`,
      candidate
        ? `${candidate.player.firstName} ${candidate.player.lastName} has a scheduled near-term game window and is showing up in the scanner set.`
        : "No single scanner-backed deployment target stood out from the current near-term window.",
    ],
    warnings: [
      "This is a deployment read only; no capital is staged until you give a concrete action request.",
    ],
    actions: [],
    pendingClarification: null,
    errorMessage: null,
    contextSnapshot: {
      intent: "idle_capital_review",
      availableBalance,
      sportHint,
      candidatePlayerId: candidate?.player?.id || null,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "idle_capital_review",
      candidatePlayerId: candidate?.player?.id || null,
    },
  };
}

async function buildCommunityBoostOpportunityScanPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  if (requestMode !== "discussion") {
    return null;
  }

  if (!isCommunityBoostOpportunityRequest(message)) {
    return null;
  }

  const resolvedDate = resolveDateFromMessage(message);
  const sportHint = resolveSportHint(message, profile.defaultSport);
  const [communitySharesAvailable, allPlayers, games, scanners, existingBoosts] = await Promise.all(
    [
      storage.getUserCommunityBoostShares(userId),
      storage.getPlayers(),
      storage.getDailyGames(new Date(), new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)),
      storage.getFinancialMarketScanners(sportHint || "ALL"),
      storage.getCommunityBoostsForDate(
        sportHint || profile.defaultSport || "NBA",
        resolvedDate.targetDate,
      ),
    ],
  );

  if (communitySharesAvailable < 1) {
    return buildUnavailableResponse({
      domain: "community_boosts",
      requestMessage: message,
      summary: "You do not have a community share available right now.",
      replyText:
        "You do not have a spare community share right now, so there is no community-boost opportunity to act on until you have one available.",
      contextSnapshot: {
        intent: "community_boost_opportunity_scan",
        communitySharesAvailable,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "community_boost_opportunity_scan",
        reason: "no_community_shares",
      },
    });
  }

  const scannerIds = new Set(
    [...scanners.momentum, ...scanners.sentiment, ...scanners.undervalued]
      .map((entry: any) => entry?.player?.id)
      .filter((entry: unknown): entry is string => typeof entry === "string"),
  );
  const excludedIds = new Set(
    existingBoosts
      .map((entry) => entry.playerId)
      .filter((entry): entry is string => Boolean(entry)),
  );
  const candidate = selectScannerBackedUpcomingCandidate({
    allPlayers,
    games,
    scannerIds,
    sportHint,
    excludedIds,
  });

  if (!candidate) {
    return buildUnavailableResponse({
      domain: "community_boosts",
      requestMessage: message,
      summary: `I do not see a clean ${resolvedDate.label} community-boost target from the current window.`,
      replyText:
        "You do have a community share available, but I do not see a clean, unclaimed target from the current scanner-backed window right now, so the better move is to hold it for a stronger spot.",
      contextSnapshot: {
        intent: "community_boost_opportunity_scan",
        communitySharesAvailable,
        boostDate: resolvedDate.dateStr,
        sportHint,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "community_boost_opportunity_scan",
        reason: "no_candidate",
      },
    });
  }

  const opponent =
    candidate.game.homeTeam === candidate.player.team
      ? `vs ${candidate.game.awayTeam}`
      : `@ ${candidate.game.homeTeam}`;

  return {
    domain: "community_boosts",
    requestMessage: message,
    replyText: `The best ${resolvedDate.label} community-boost look right now is ${candidate.player.firstName} ${candidate.player.lastName}. They are scanner-backed, still have a live upcoming window ${opponent}, and are not already claimed in the current community-boost slate. If you want me to queue it, tell me to create a community boost for ${candidate.player.firstName} ${candidate.player.lastName}.`,
    summary: `Best ${resolvedDate.label} community-boost opportunity identified.`,
    observations: [
      `${candidate.player.firstName} ${candidate.player.lastName} is scheduled ${opponent} at ${new Date(
        candidate.game.startTime,
      ).toLocaleString()}.`,
      `${communitySharesAvailable} community share${communitySharesAvailable === 1 ? "" : "s"} are available right now.`,
      `${existingBoosts.length} community boost${existingBoosts.length === 1 ? "" : "s"} already exist in that window.`,
    ],
    warnings: [
      "This scan only identifies the best current candidate; the community boost is not staged until you give the direct create instruction.",
    ],
    actions: [],
    pendingClarification: null,
    errorMessage: null,
    contextSnapshot: {
      intent: "community_boost_opportunity_scan",
      playerId: candidate.player.id,
      boostDate: resolvedDate.dateStr,
      sportHint,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "community_boost_opportunity_scan",
      playerId: candidate.player.id,
    },
  };
}

async function buildBroadOperatorReviewPlan(
  userId: string,
  _profile: UserAgentProfile,
  message: string,
  _requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  if (!isBroadOperatorReviewRequest(message)) {
    return null;
  }

  const [
    user,
    totalScouts,
    availableBalance,
    holdingsWithPlayers,
    watchlists,
    communitySharesAvailable,
    activeBoosts,
  ] = await Promise.all([
    storage.getUser(userId),
    storage.getTotalScoutsForUser(userId),
    storage.getAvailableBalance(userId),
    storage.getUserHoldingsWithPlayers(userId),
    storage.getWatchlists(userId),
    storage.getUserCommunityBoostShares(userId),
    storage.getDailyBoostsAllSports(userId, new Date()),
  ]);

  if (!user) {
    return null;
  }

  const playerHoldings = holdingsWithPlayers.filter(
    (entry: any) => entry?.holding?.assetType === "player" && entry?.player?.id,
  );
  const distinctPlayerCount = new Set(playerHoldings.map((entry: any) => entry.player.id as string))
    .size;
  const totalPlayerShares = playerHoldings.reduce(
    (sum: number, entry: any) => sum + parseNumericString(entry?.holding?.quantity),
    0,
  );
  const poweredRows = playerHoldings.filter(
    (entry: any) => parseNumericString(entry?.holding?.power) > 1,
  ).length;
  const topHolding =
    [...playerHoldings].sort(
      (left: any, right: any) =>
        parseNumericString(right?.holding?.quantity) - parseNumericString(left?.holding?.quantity),
    )[0] || null;
  const watchlistEntries = watchlists.reduce(
    (sum, watchlist) => sum + Math.max(0, Number(watchlist.itemCount || 0)),
    0,
  );
  const filledBoostSlots = activeBoosts.filter((boost) => boost.status !== "cancelled").length;
  const openBoostSlots = Math.max(0, DAILY_BOOST_SLOT_COUNT - filledBoostSlots);
  const maxScouts = user.isPremium ? 10 : 5;
  const openScoutSlots = Math.max(0, maxScouts - totalScouts);
  const nextLevers: string[] = [];

  if (openBoostSlots > 0 && playerHoldings.length > 0) {
    nextLevers.push(
      filledBoostSlots === 0
        ? "fill a daily boost slot before lock"
        : `use the ${openBoostSlots} remaining daily boost slot${openBoostSlots === 1 ? "" : "s"} before lock`,
    );
  }
  /*
  if (openBoostSlots > 0 && playerHoldings.length > 0) {
    nextLevers.push(
      fillեդBoostSlots === 0
        ? "fill a daily boost slot before lock"
        : `use the ${openBoostSlots} remaining daily boost slot${openBoostSlots === 1 ? "" : "s"} before lock`,
    );
  }
  */
  if (openScoutSlots > 0) {
    nextLevers.push(
      `deploy the ${openScoutSlots} unassigned scout${openScoutSlots === 1 ? "" : "s"}`,
    );
  }
  if (communitySharesAvailable > 0) {
    nextLevers.push(
      `use ${communitySharesAvailable} community share${communitySharesAvailable === 1 ? "" : "s"} on a community boost`,
    );
  }
  if (availableBalance >= 25) {
    nextLevers.push(`put some of the ${formatMoney(availableBalance)} idle balance to work`);
  }

  const leadHoldingText =
    topHolding && topHolding.player
      ? `${topHolding.player.firstName} ${topHolding.player.lastName} is your largest visible holding at ${formatNumber(
          parseNumericString(topHolding.holding.quantity),
          0,
        )} share${parseNumericString(topHolding.holding.quantity) === 1 ? "" : "s"}.`
      : "You do not have an active player holding concentration right now.";
  const leadRecommendation = nextLevers[0]
    ? `The cleanest next lever is to ${nextLevers[0]}.`
    : "Nothing looks urgent to clean up right now, so the best move is to hold and stay selective.";

  return {
    domain: "sportfolio",
    requestMessage: message,
    replyText: `Here is the broad operator read right now. You have ${formatMoney(
      availableBalance,
    )} available, ${distinctPlayerCount} player name${distinctPlayerCount === 1 ? "" : "s"} in the portfolio (${formatNumber(
      totalPlayerShares,
      0,
    )} total shares), ${filledBoostSlots}/${DAILY_BOOST_SLOT_COUNT} daily boost slots filled for today, and ${totalScouts}/${maxScouts} scouts assigned. ${
      communitySharesAvailable > 0
        ? `You also have ${communitySharesAvailable} community share${communitySharesAvailable === 1 ? "" : "s"} available.`
        : "You do not have a spare community share right now."
    } ${leadRecommendation} If you want, tell me which lever to stage and I'll queue it for confirmation.`,
    summary: "Broad operator review of your current Sportfolio setup.",
    observations: [
      leadHoldingText,
      `${watchlists.length} watchlist${watchlists.length === 1 ? "" : "s"} tracking ${watchlistEntries} total ${watchlistEntries === 1 ? "entry" : "entries"}.`,
      `${poweredRows} powered holding row${poweredRows === 1 ? "" : "s"} currently give you boosted-share flexibility.`,
      openBoostSlots > 0
        ? `${openBoostSlots} daily boost slot${openBoostSlots === 1 ? "" : "s"} are still open for today.`
        : "All daily boost slots are currently occupied for today.",
      openScoutSlots > 0
        ? `${openScoutSlots} scout slot${openScoutSlots === 1 ? "" : "s"} are still unassigned.`
        : "All available scout slots are currently assigned.",
    ],
    warnings: [],
    actions: [],
    pendingClarification: null,
    errorMessage: null,
    contextSnapshot: {
      intent: "broad_operator_review",
      availableBalance,
      distinctPlayerCount,
      totalPlayerShares,
      filledBoostSlots,
      openBoostSlots,
      totalScouts,
      maxScouts,
      openScoutSlots,
      communitySharesAvailable,
      claimableVestingShares: 0,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "broad_operator_review",
      nextLevers,
    },
  };
}

async function estimateSpendForTargetShares(playerId: string, targetShares: number) {
  if (!Number.isFinite(targetShares) || targetShares < 1) {
    return null;
  }

  const pool = await getOrCreatePool(playerId);
  const currentPrice = Number(
    (pool && "currentPrice" in pool ? pool.currentPrice : null) ||
      (pool && "playMoney" in pool && "shares" in pool && Number(pool.shares) > 0
        ? Number(pool.playMoney) / Number(pool.shares)
        : 10),
  );
  let low = Math.max(0.01, currentPrice * targetShares * 0.5);
  let high = Math.max(currentPrice * targetShares * 1.5, currentPrice + 1);
  let highQuote = await getBuyQuote(playerId, high);
  let guard = 0;

  while (guard < 12 && (!highQuote || Math.floor(highQuote.sharesOut) < targetShares)) {
    high *= 2;
    highQuote = await getBuyQuote(playerId, high);
    guard += 1;
  }

  if (!highQuote) {
    return null;
  }

  if (Math.floor(highQuote.sharesOut) < targetShares) {
    return {
      sbAmount: Math.round(high * 100) / 100,
      quote: highQuote,
      roundedSharesOut: Math.floor(highQuote.sharesOut),
    };
  }

  let bestAmount = high;
  let bestQuote = highQuote;

  for (let iteration = 0; iteration < 20; iteration += 1) {
    const mid = (low + high) / 2;
    const quote = await getBuyQuote(playerId, mid);
    if (!quote) {
      break;
    }

    if (Math.floor(quote.sharesOut) >= targetShares) {
      bestAmount = mid;
      bestQuote = quote;
      high = mid;
    } else {
      low = mid;
    }
  }

  return {
    sbAmount: Math.round(bestAmount * 100) / 100,
    quote: bestQuote,
    roundedSharesOut: Math.floor(bestQuote.sharesOut),
  };
}

async function buildMarketIntelligencePlan(
  _userId: string,
  profile: UserAgentProfile,
  message: string,
  _requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  if (!isMarketAnalysisRequest(message)) {
    return null;
  }

  const resolvedDate = resolveDateFromMessage(message);
  const lower = normalizeWhitespace(message).toLowerCase();
  const sportHint = resolveSportHint(message, profile.defaultSport);
  const wantsPortfolioLens = /\b(?:my players|my holdings|my portfolio)\b/.test(lower);
  const wantsUpcomingOnly =
    /\b(?:hasn't started|haven't started|not started|still ahead|still to play|tonight|tomorrow|today)\b/.test(
      lower,
    );
  const wantsUnderTheRadar = /\b(?:under the radar|sleepers?|low-owned|underowned)\b/.test(lower);
  const wantsValue =
    wantsUnderTheRadar ||
    /\b(?:underpriced|mispriced|weak market pricing|value right now|best value)\b/.test(lower);
  const wantsTwoDayWindow = /\b(?:next two days|next 2 days)\b/.test(lower);
  const now = new Date();
  const { startOfDay } = getETDayBoundaries(resolvedDate.dateStr);
  const windowDays = wantsTwoDayWindow ? 2 : 1;
  const endOfDay = new Date(startOfDay.getTime() + windowDays * 24 * 60 * 60 * 1000 - 1);

  const [allPlayers, games, scanners, holdingsWithPlayers] = await Promise.all([
    storage.getPlayers(),
    storage.getDailyGames(startOfDay, endOfDay),
    storage.getFinancialMarketScanners(sportHint || "ALL"),
    wantsPortfolioLens ? storage.getUserHoldingsWithPlayers(_userId) : Promise.resolve([]),
  ]);

  const filteredGames = games.filter((game) => {
    if (sportHint && game.sport !== sportHint) {
      return false;
    }

    return new Date(game.startTime) > now && game.status !== "completed";
  });

  const teamToGames = new Map<string, (typeof games)[number][]>();
  for (const game of filteredGames) {
    teamToGames.set(game.homeTeam, [...(teamToGames.get(game.homeTeam) || []), game]);
    teamToGames.set(game.awayTeam, [...(teamToGames.get(game.awayTeam) || []), game]);
  }

  const heldPlayerIds = new Set(
    holdingsWithPlayers
      .filter((entry: any) => entry?.holding?.assetType === "player" && entry?.player?.id)
      .map((entry: any) => entry.player.id as string),
  );
  const undervaluedIds = new Set(scanners.undervalued.map((entry) => entry.player.id));
  const momentumIds = new Set(scanners.momentum.map((entry) => entry.player.id));
  const sentimentIds = new Set(scanners.sentiment.map((entry) => entry.player.id));

  const candidatePlayers = allPlayers.filter((player) => {
    if (!player.isActive) {
      return false;
    }
    if (sportHint && player.sport !== sportHint) {
      return false;
    }
    if (wantsPortfolioLens && !heldPlayerIds.has(player.id)) {
      return false;
    }
    if ((wantsUpcomingOnly || wantsTwoDayWindow) && !teamToGames.has(player.team)) {
      return false;
    }

    return true;
  });

  const avgFantasyMap = await storage.getBatchAllTimeAvgFantasyPoints(
    candidatePlayers.map((player) => player.id),
  );

  const rankedPlayers = candidatePlayers
    .map((player) => {
      const upcomingGames = teamToGames.get(player.team) || [];
      const nextGame = upcomingGames[0] || null;
      const avgFantasy = avgFantasyMap.get(player.id) || 0;
      const priceChange = parseNumericString(player.priceChange24h);
      const volume = Number(player.volume24h || 0);
      const marketCap = parseNumericString(player.marketCap);
      const marketScore = Math.min(18, Math.log10(volume + 1) * 6);
      const momentumScore = Math.max(-8, Math.min(16, priceChange));
      const fantasyScore = Math.min(45, avgFantasy);
      const scheduleScore = Math.min(16, upcomingGames.length * 10);
      const underRadarAdjustment = wantsValue
        ? Math.max(0, 12 - Math.min(12, marketCap / 500000))
        : 0;
      const scannerMomentumBoost = momentumIds.has(player.id) ? 8 : 0;
      const sentimentBoost = sentimentIds.has(player.id) ? 6 : 0;
      const scannerValueBoost = undervaluedIds.has(player.id) ? (wantsValue ? 12 : 4) : 0;
      const portfolioBoost = wantsPortfolioLens && heldPlayerIds.has(player.id) ? 8 : 0;
      const score =
        fantasyScore * 1.25 +
        momentumScore * 1.2 +
        marketScore +
        scheduleScore +
        underRadarAdjustment +
        scannerMomentumBoost +
        sentimentBoost +
        scannerValueBoost +
        portfolioBoost;

      return {
        player,
        nextGame,
        upcomingGames,
        avgFantasy,
        priceChange,
        volume,
        score,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  if (rankedPlayers.length === 0) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: wantsPortfolioLens
        ? "I do not see a clean read inside your current holdings from the available data."
        : `I don't see a strong ${resolvedDate.label} market read from the currently available data.`,
      replyText: wantsPortfolioLens
        ? "I checked your current player holdings against the available market and schedule data, but I do not see a clean group of candidates from the current data right now."
        : "I checked the current schedule and market data, but I do not see a clean set of candidates from the available data for that window right now.",
      contextSnapshot: {
        intent: "market_intelligence",
        route: "no_candidates",
        date: resolvedDate.dateStr,
        sport: sportHint,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "market_intelligence",
        route: "no_candidates",
      },
    });
  }

  const observations = rankedPlayers.map(
    ({ player, nextGame, upcomingGames, avgFantasy, priceChange, volume }) => {
      const gameNote = nextGame
        ? `${nextGame.homeTeam === player.team ? "vs" : "@"} ${nextGame.homeTeam === player.team ? nextGame.awayTeam : nextGame.homeTeam} at ${new Date(nextGame.startTime).toLocaleTimeString()}`
        : "no forward game window detected";
      const scheduleNote =
        wantsTwoDayWindow && upcomingGames.length > 1
          ? ` ${upcomingGames.length} upcoming windows in the next two days.`
          : "";
      const portfolioNote =
        wantsPortfolioLens && heldPlayerIds.has(player.id) ? " Already in your portfolio." : "";

      return `${player.firstName} ${player.lastName}: ${formatNumber(avgFantasy, 1)} avg fantasy, ${priceChange >= 0 ? "+" : ""}${formatNumber(
        priceChange,
        2,
      )}% 24h, ${volume} volume, ${gameNote}.${scheduleNote}${portfolioNote}`;
    },
  );

  const leadNames = rankedPlayers
    .slice(0, 3)
    .map(({ player }) => `${player.firstName} ${player.lastName}`)
    .join(", ");
  const summary = wantsPortfolioLens
    ? wantsValue
      ? "Best form-versus-price opportunities inside your current holdings"
      : "Strongest current reads inside your existing player holdings"
    : wantsTwoDayWindow
      ? "Best market and fantasy setups across the next two days"
      : wantsUpcomingOnly
        ? `Best remaining ${resolvedDate.label} window targets from current market and fantasy data`
        : wantsUnderTheRadar
          ? "Best under-the-radar names from the current market and fantasy read"
          : wantsValue
            ? "Strongest current value pockets from the market and fantasy data"
            : "Strongest current market and fantasy trend signals";
  const replyText = wantsPortfolioLens
    ? `Inside your current player holdings, the strongest read right now is ${leadNames}. I'm weighting current fantasy production, 24-hour market movement, liquidity, and the remaining game window so you get the names that look strongest without adding new exposure. ${observations
        .slice(0, 3)
        .join(" ")}`
    : wantsTwoDayWindow
      ? `Across the next two days, the strongest setups right now are ${leadNames}. I'm weighting fantasy production, 24-hour momentum, liquidity, and how many clean upcoming windows each player still has. ${observations
          .slice(0, 3)
          .join(" ")}`
      : wantsUpcomingOnly
        ? `The strongest ${resolvedDate.label} names with games still ahead are ${leadNames}. I'm weighting this off current fantasy production, 24-hour market momentum, live volume, and the remaining game window. ${observations
            .slice(0, 3)
            .join(" ")}`
        : wantsValue
          ? `The best value-leaning names right now are ${leadNames}. I'm looking for strong fantasy form, current market pricing, live liquidity, and near-term game windows so the read is grounded in the actual board. ${observations
              .slice(0, 3)
              .join(" ")}`
          : `Right now the best market-and-fantasy trend names are ${leadNames}. I'm weighting recent fantasy production, 24-hour price movement, liquidity, and whether they still have a clean upcoming window. ${observations
              .slice(0, 3)
              .join(" ")}`;

  return {
    domain: "sportfolio",
    requestMessage: message,
    replyText,
    summary,
    observations,
    warnings: [
      ...(wantsUnderTheRadar
        ? [
            "Under-the-radar calls are based on current market footprint relative to fantasy output, not external ownership projections.",
          ]
        : []),
      ...(wantsPortfolioLens
        ? ["Portfolio-specific reads only use the holdings currently in your account."]
        : []),
    ],
    actions: [],
    pendingClarification: null,
    errorMessage: null,
    contextSnapshot: {
      intent: "market_intelligence",
      date: resolvedDate.dateStr,
      sport: sportHint,
      route: wantsPortfolioLens
        ? "portfolio_focus"
        : wantsTwoDayWindow
          ? "two_day_window"
          : wantsUpcomingOnly
            ? "upcoming_window"
            : wantsUnderTheRadar
              ? "under_the_radar"
              : wantsValue
                ? "value"
                : "trending",
      windowDays,
      playerIds: rankedPlayers.map(({ player }) => player.id),
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "market_intelligence",
      rankedPlayerIds: rankedPlayers.map(({ player }) => player.id),
    },
  };
}

async function buildBuyPowerBoostWorkflowPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const parserMessage = normalizeOperationalParserMessage(message);
  const hasPowerIntent =
    /\b(?:power(?:\s+them|\s+it|\s+that\s+share|\s+all(?:\s+up)?)?|power\s+up|condense)\b/i.test(
      parserMessage,
    );
  const slotMatch = parserMessage.match(/\b([2345])x\s+boost\s+slot\b/i);
  const buyMatch =
    parserMessage.match(/\b(?:buy|buying|get|grab|pick\s+up)\s+(\d+)\s+(.+?)\s+shares?\b/i) ||
    parserMessage.match(
      /\b(?:buy|buying|get|grab|pick\s+up)\s+(\d+)\s+shares?\s+of\s+(.+?)(?:\s+for\s+tomorrow|\s+for\s+today|\s+today|\s+tomorrow|$)/i,
    );

  if (!hasPowerIntent || !slotMatch || !buyMatch) {
    return null;
  }

  const desiredShares = Number.parseInt(buyMatch[1], 10);
  if (!Number.isFinite(desiredShares) || desiredShares < 2) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: "I need at least 2 shares to power one up first.",
      replyText:
        "Powering up only works if at least 2 regular shares are being condensed first, so I did not stage that workflow.",
      contextSnapshot: {
        intent: "buy_power_boost",
        desiredShares,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_power_boost",
        reason: "not_enough_shares",
      },
    });
  }

  const slotTier = Number(slotMatch[1]) as 2 | 3 | 4 | 5;
  const resolvedDate = resolveDateFromMessage(message);
  const playerResolution = await resolvePlayerByReference(buyMatch[2], { message, profile });
  if (!playerResolution) {
    return buildPlayerClarificationResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: "I need the full player name before I can stage that workflow.",
      replyText:
        "I can stage the buy, power-up, and boost sequence, but I need the full player name first so I do not hit the wrong player.",
      prompt:
        "I can queue the full buy, power-up, and boost sequence as soon as you give me the full player name.",
      resumeMessageTemplate: `buy ${desiredShares} {player} shares, power them all up and put that share into my ${slotTier}x boost slot ${resolvedDate.label}`,
      workflowTitle: "Build the buy, power-up, and boost workflow",
      workflowPreviewSteps: [
        `Buy ${desiredShares} shares`,
        "Power up the new position",
        `Assign the top powered share to the ${slotTier}x boost slot`,
      ],
      contextSnapshot: {
        intent: "buy_power_boost",
        desiredShares,
        rawPlayerReference: sanitizeNameFragment(buyMatch[2]),
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_power_boost",
        reason: "player_not_resolved",
      },
    });
  }

  const player = playerResolution.player;
  const { startOfDay } = getETDayBoundaries(resolvedDate.dateStr);
  const targetDate = new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);
  const [estimate, currentBoosts, game, availableBalance] = await Promise.all([
    estimateSpendForTargetShares(player.id, desiredShares),
    storage.getDailyBoosts(userId, player.sport, targetDate),
    storage.getPlayerGameForDate(player.id, player.sport, targetDate),
    storage.getAvailableBalance(userId),
  ]);

  if (!estimate) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `I couldn't estimate the buy needed to land ${desiredShares} ${player.firstName} ${player.lastName} shares.`,
      replyText:
        "That market is not giving me a reliable buy estimate right now, so I did not stage the full power-and-boost workflow.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "buy_power_boost",
        playerId: player.id,
        desiredShares,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_power_boost",
        reason: "buy_estimate_unavailable",
      },
    });
  }

  if (availableBalance < estimate.sbAmount) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `That workflow needs about ${formatMoney(estimate.sbAmount)}, but you only have ${formatMoney(availableBalance)} available.`,
      replyText: `I can stage that sequence once you have roughly ${formatMoney(
        estimate.sbAmount,
      )} available. Right now you only have ${formatMoney(
        availableBalance,
      )}, so I did not queue the buy-power-boost workflow.`,
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "buy_power_boost",
        playerId: player.id,
        desiredShares,
        estimatedSpend: estimate.sbAmount,
        availableBalance,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_power_boost",
        reason: "insufficient_balance",
      },
    });
  }

  if (currentBoosts.some((boost) => boost.slotTier === slotTier)) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `Your ${slotTier}x slot is already occupied for ${resolvedDate.label}.`,
      replyText: `Your ${slotTier}x slot is already filled for that window, so I did not stage the boost sequence.`,
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "buy_power_boost",
        playerId: player.id,
        slotTier,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_power_boost",
        reason: "slot_occupied",
      },
    });
  }

  if (currentBoosts.some((boost) => boost.playerId === player.id)) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `${player.firstName} ${player.lastName} is already in a boost slot for ${resolvedDate.label}.`,
      replyText:
        "That player is already sitting in one of your boost slots for that window, so I did not stage a duplicate boost workflow.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "buy_power_boost",
        playerId: player.id,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_power_boost",
        reason: "player_already_boosted",
      },
    });
  }

  if (!game) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `${player.firstName} ${player.lastName} does not have a game in that boost window.`,
      replyText:
        "I can buy and power up the shares, but I cannot finish the boost step because that player does not have a game in the requested window.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "buy_power_boost",
        playerId: player.id,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_power_boost",
        reason: "game_not_found",
      },
    });
  }

  if (new Date(game.startTime) <= new Date()) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `${player.firstName} ${player.lastName}'s game has already started for that window.`,
      replyText:
        "That boost window is already closed because the game has started, so I did not stage the buy-power-boost sequence.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "buy_power_boost",
        playerId: player.id,
        boostDate: resolvedDate.dateStr,
        gameId: game.gameId,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_power_boost",
        reason: "game_started",
      },
    });
  }

  const condenseableShares = Math.max(0, desiredShares - (desiredShares % 2));
  const leftoverShares = desiredShares - condenseableShares;
  const expectedPowerGained = condenseableShares / 2;
  const opponent = game.homeTeam === player.team ? `vs ${game.awayTeam}` : `@ ${game.homeTeam}`;

  const actions = [
    {
      actionType: "pool_buy" as const,
      playerId: player.id,
      playerName: `${player.firstName} ${player.lastName}`,
      sbAmount: estimate.sbAmount,
      maxSlippage: Math.max(0.05, Number(estimate.quote.slippagePercent || 0) + 0.02),
      estimatedSharesOut: estimate.roundedSharesOut,
      estimatedPricePerShare: estimate.quote.effectivePrice,
      estimatedSlippagePercent: estimate.quote.slippagePercent * 100,
      reasoning: `Buy approximately ${desiredShares} shares by spending about ${formatMoney(estimate.sbAmount)} at the current pool depth.`,
      confidence: 0.9,
    },
    {
      actionType: "holdings_condense" as const,
      playerId: player.id,
      playerName: `${player.firstName} ${player.lastName}`,
      sharesToCondense: condenseableShares,
      expectedPowerGained,
      expectedPoweredShareCount: 1,
      reasoning:
        leftoverShares > 0
          ? `Condense ${condenseableShares} of the bought shares into 1 powered share and leave ${leftoverShares} regular share${leftoverShares === 1 ? "" : "s"} uncondensed.`
          : `Condense all ${condenseableShares} bought shares into 1 powered share.`,
      confidence: 0.92,
    },
    {
      actionType: "daily_boost_assign" as const,
      playerId: player.id,
      playerName: `${player.firstName} ${player.lastName}`,
      sport: player.sport,
      slotTier,
      sharesEntered: 1 as const,
      boostDate: resolvedDate.dateStr,
      gameId: game.gameId,
      gameStartTime: new Date(game.startTime).toISOString(),
      opponent,
      reasoning: `Use the highest-power available ${player.firstName} ${player.lastName} share in the ${slotTier}x slot for ${resolvedDate.label}.`,
      confidence: 0.94,
    },
  ];

  const warnings = [
    ...playerResolution.warnings,
    "This is a 3-step workflow: the boost only happens after the buy and condense steps succeed.",
  ];
  if (leftoverShares > 0) {
    warnings.push(
      `${leftoverShares} share${leftoverShares === 1 ? "" : "s"} would remain regular because condense only works on even share counts in the current system.`,
    );
  }

  const summary = `Buy ${desiredShares} ${player.firstName} ${player.lastName} shares, power up the position, then use the powered share in your ${slotTier}x boost slot for ${resolvedDate.label}`;

  return {
    domain: "sportfolio",
    requestMessage: message,
    replyText:
      requestMode === "discussion"
        ? `${summary}. That would cost about ${formatMoney(estimate.sbAmount)} at current depth, create 1 powered share worth ${formatNumber(
            expectedPowerGained,
            2,
          )} power, and line up ${player.firstName} ${player.lastName} ${opponent} in your ${slotTier}x slot. ${buildStageNudge(requestMode)}`
        : `${summary}. I staged it as a 3-step workflow: buy about ${formatMoney(
            estimate.sbAmount,
          )}, condense ${condenseableShares} shares into 1 powered share, then slot that share into ${slotTier}x for ${resolvedDate.label}. ${buildStageNudge(
            requestMode,
          )}`,
    summary,
    observations: [
      `Estimated spend: ${formatMoney(estimate.sbAmount)} for about ${estimate.roundedSharesOut} shares at current pool depth.`,
      `Expected powered share strength after condense: ${formatNumber(expectedPowerGained, 2)} power.`,
      `${player.firstName} ${player.lastName} is scheduled ${opponent} at ${new Date(game.startTime).toLocaleString()}.`,
    ],
    warnings,
    actions: requestMode === "commit" ? actions : [],
    errorMessage: null,
    contextSnapshot: {
      intent: "buy_power_boost",
      playerId: player.id,
      desiredShares,
      condenseableShares,
      slotTier,
      boostDate: resolvedDate.dateStr,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "buy_power_boost",
      requestMode,
      actionTypes: actions.map((action) => action.actionType),
    },
  };
}

async function buildCondensePlan(
  _userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const parserMessage = normalizeOperationalParserMessage(message);
  const match = parserMessage.match(/\b(?:condense|power\s+up|power)\s+(\d+)\s+(.+?)\s+shares?\b/i);

  if (!match) {
    return null;
  }

  const sharesToCondense = Number.parseInt(match[1], 10);
  const rawReference = match[2];
  if (!Number.isFinite(sharesToCondense) || sharesToCondense < 2) {
    return null;
  }

  const playerResolution = await resolvePlayerByReference(rawReference, { message, profile });
  if (!playerResolution) {
    return buildPlayerClarificationResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: "I need a clearer player name before I can power that position up.",
      replyText:
        "I can power up that holding, but I need the full player name first so I do not condense the wrong shares.",
      prompt: "Send the full player name and I'll queue the power-up for confirmation.",
      resumeMessageTemplate: `power up ${sharesToCondense} {player} shares`,
      contextSnapshot: {
        intent: "holdings_condense",
        rawPlayerReference: sanitizeNameFragment(rawReference),
        sharesToCondense,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "holdings_condense",
        reason: "player_not_resolved",
      },
    });
  }

  const player = playerResolution.player;
  const normalizedShares = sharesToCondense % 2 === 0 ? sharesToCondense : sharesToCondense - 1;
  if (normalizedShares < 2) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: "Condense needs at least 2 regular shares.",
      replyText:
        "I need at least 2 regular shares to condense into a powered share, so I did not stage that move.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "holdings_condense",
        playerId: player.id,
        sharesToCondense,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "holdings_condense",
        reason: "not_enough_shares",
      },
    });
  }

  const action = {
    actionType: "holdings_condense" as const,
    playerId: player.id,
    playerName: `${player.firstName} ${player.lastName}`,
    sharesToCondense: normalizedShares,
    expectedPowerGained: normalizedShares / 2,
    expectedPoweredShareCount: 1,
    reasoning:
      normalizedShares === sharesToCondense
        ? `Condense ${normalizedShares} regular shares into 1 powered share.`
        : `Condense ${normalizedShares} regular shares into 1 powered share and leave 1 regular share untouched because the current rule requires an even share count.`,
    confidence: 0.92,
  };

  return {
    domain: "sportfolio",
    requestMessage: message,
    replyText:
      requestMode === "discussion"
        ? `Powering up ${action.playerName} using ${normalizedShares} shares would create 1 powered share worth ${formatNumber(
            action.expectedPowerGained,
            2,
          )} power. ${buildStageNudge(requestMode)}`
        : `I staged a power-up for ${action.playerName}: condense ${normalizedShares} regular shares into 1 powered share worth ${formatNumber(
            action.expectedPowerGained,
            2,
          )} power. ${buildStageNudge(requestMode)}`,
    summary: `Power up ${action.playerName}`,
    observations: [
      `Expected output: 1 powered share at ${formatNumber(action.expectedPowerGained, 2)} power.`,
    ],
    warnings:
      normalizedShares === sharesToCondense
        ? playerResolution.warnings
        : [
            ...playerResolution.warnings,
            "The current condense rule only accepts even share counts, so one share would be left uncondensed.",
          ],
    actions: requestMode === "commit" ? [action] : [],
    errorMessage: null,
    contextSnapshot: {
      intent: "holdings_condense",
      playerId: player.id,
      sharesToCondense: normalizedShares,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "holdings_condense",
      requestMode,
    },
  };
}

async function buildWatchlistPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const parserMessage = normalizeOperationalParserMessage(message);
  const addMatch =
    parserMessage.match(
      /\b(?:add|put|save|track)\s+(.+?)\s+(?:to|on|in)\s+(?:my\s+)?watchlist\b/i,
    ) || parserMessage.match(/^watchlist\s+(.+?)$/i);
  const removeMatch =
    parserMessage.match(
      /\b(?:remove|take|drop|delete|unwatch)\s+(.+?)\s+(?:from|off)\s+(?:my\s+)?watchlist\b/i,
    ) || parserMessage.match(/\bunwatch\s+(.+?)$/i);

  if (!addMatch && !removeMatch) {
    return null;
  }

  const isRemove = Boolean(removeMatch);
  const playerReference = sanitizeNameFragment((removeMatch || addMatch)?.[1] || "");
  const playerResolution = await resolvePlayerByReference(playerReference, { message, profile });

  if (!playerResolution) {
    const resumeMessageTemplate = isRemove
      ? "remove {player} from my watchlist"
      : "add {player} to my watchlist";

    return buildPlayerClarificationResponse({
      domain: "watchlists",
      requestMessage: message,
      summary: `I need a clearer player name before I can ${isRemove ? "update" : "add to"} your watchlist.`,
      replyText: isRemove
        ? "I can remove that player from your watchlist, but I need the full player name first."
        : "I can add that player to your watchlist, but I need the full player name first.",
      prompt: isRemove
        ? "Send the full player name and I'll queue that watchlist removal for confirmation."
        : "Send the full player name and I'll queue that watchlist add for confirmation.",
      resumeMessageTemplate,
      contextSnapshot: {
        intent: isRemove ? "watchlist_remove_player" : "watchlist_add_player",
        rawPlayerReference: playerReference,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: isRemove ? "watchlist_remove_player" : "watchlist_add_player",
        reason: "player_not_resolved",
      },
    });
  }

  const player = playerResolution.player;
  const { watchlists, defaultWatchlist } = await getPrimaryWatchlist(userId);
  const currentWatchlistIds = await storage.getPlayerWatchlists(userId, player.id);
  const currentWatchlistNames = watchlists
    .filter((entry) => currentWatchlistIds.includes(entry.id))
    .map((entry) => entry.name);

  if (!isRemove) {
    if (defaultWatchlist && currentWatchlistIds.includes(defaultWatchlist.id)) {
      return buildUnavailableResponse({
        domain: "watchlists",
        requestMessage: message,
        summary: `${player.firstName} ${player.lastName} is already on ${defaultWatchlist.name}.`,
        replyText: `${player.firstName} ${player.lastName} is already in your ${defaultWatchlist.name} watchlist, so I did not stage another add.`,
        warnings: playerResolution.warnings,
        contextSnapshot: {
          intent: "watchlist_add_player",
          playerId: player.id,
          watchlistId: defaultWatchlist.id,
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: "watchlist_add_player",
          reason: "already_tracked",
        },
      });
    }

    const action: WatchlistAddPlayerAction = {
      actionType: "watchlist_add_player",
      playerId: player.id,
      playerName: `${player.firstName} ${player.lastName}`,
      watchlistId: defaultWatchlist?.id || null,
      watchlistName: defaultWatchlist?.name || "Favorites",
      reasoning:
        requestMode === "discussion"
          ? "Previewing a watchlist add so you can keep tracking this player."
          : "This stages adding the player to your default watchlist.",
      confidence: 0.94,
    };

    const summary = `Add ${action.playerName} to ${action.watchlistName}`;
    return {
      domain: "watchlists",
      requestMessage: message,
      replyText:
        requestMode === "discussion"
          ? `${summary}. That keeps the player in your monitor list without changing any capital. ${buildStageNudge(requestMode)}`
          : `${summary}. I staged that watchlist add and it will use your default watchlist. ${buildStageNudge(requestMode)}`,
      summary,
      observations:
        currentWatchlistNames.length > 0
          ? [
              `${action.playerName} is already tracked elsewhere: ${currentWatchlistNames.join(", ")}.`,
            ]
          : ["Watchlist adds are organizational only and do not touch your portfolio."],
      warnings: playerResolution.warnings,
      actions: requestMode === "commit" ? [action] : [],
      errorMessage: null,
      contextSnapshot: {
        intent: "watchlist_add_player",
        playerId: player.id,
        watchlistId: action.watchlistId,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "watchlist_add_player",
        requestMode,
      },
    };
  }

  if (currentWatchlistIds.length === 0) {
    return buildUnavailableResponse({
      domain: "watchlists",
      requestMessage: message,
      summary: `${player.firstName} ${player.lastName} is not on any of your watchlists right now.`,
      replyText: `${player.firstName} ${player.lastName} is not on any of your watchlists right now, so I did not stage a removal.`,
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "watchlist_remove_player",
        playerId: player.id,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "watchlist_remove_player",
        reason: "not_tracked",
      },
    });
  }

  const action: WatchlistRemovePlayerAction = {
    actionType: "watchlist_remove_player",
    playerId: player.id,
    playerName: `${player.firstName} ${player.lastName}`,
    watchlistId: null,
    watchlistName: null,
    removeFromAll: true,
    reasoning:
      requestMode === "discussion"
        ? "Previewing a watchlist cleanup across every list that currently tracks this player."
        : "This stages removing the player from every watchlist that currently tracks them.",
    confidence: 0.93,
  };

  const summary = `Remove ${action.playerName} from your watchlists`;
  const trackedLabel =
    currentWatchlistNames.length > 0
      ? currentWatchlistNames.join(", ")
      : `${currentWatchlistIds.length} watchlist${currentWatchlistIds.length === 1 ? "" : "s"}`;
  return {
    domain: "watchlists",
    requestMessage: message,
    replyText:
      requestMode === "discussion"
        ? `${summary}. They are currently tracked in ${trackedLabel}. ${buildStageNudge(requestMode)}`
        : `${summary}. I staged a clean removal across ${currentWatchlistIds.length} watchlist${currentWatchlistIds.length === 1 ? "" : "s"}. ${buildStageNudge(requestMode)}`,
    summary,
    observations: [`Current watchlists: ${trackedLabel}.`],
    warnings: playerResolution.warnings,
    actions: requestMode === "commit" ? [action] : [],
    errorMessage: null,
    contextSnapshot: {
      intent: "watchlist_remove_player",
      playerId: player.id,
      currentWatchlistIds,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "watchlist_remove_player",
      requestMode,
    },
  };
}

async function buildCommunityBoostPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const parserMessage = normalizeOperationalParserMessage(message);
  const match =
    parserMessage.match(
      /\b(?:create|make|activate|use|redeem|spend)\s+(?:(?:a|my)\s+)?community\s+(?:boost|share)\s+(?:on|for)\s+(.+?)$/i,
    ) || parserMessage.match(/^community\s+boost\s+(.+?)$/i);

  if (!match) {
    return null;
  }

  const resolvedDate = resolveDateFromMessage(message);
  const playerReference = sanitizeNameFragment(match[1]);
  const playerResolution = await resolvePlayerByReference(playerReference, { message, profile });

  if (!playerResolution) {
    return buildPlayerClarificationResponse({
      domain: "community_boosts",
      requestMessage: message,
      summary: "I need a clearer player name before I can queue that community boost.",
      replyText:
        "I can queue that community boost, but I need the full player name first so I use the right player.",
      prompt: "Send the full player name and I'll queue that community boost for confirmation.",
      resumeMessageTemplate: `create a community boost for {player} ${resolvedDate.label}`,
      contextSnapshot: {
        intent: "community_boost_create",
        rawPlayerReference: playerReference,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "community_boost_create",
        reason: "player_not_resolved",
      },
    });
  }

  const player = playerResolution.player;
  const [communitySharesAvailable, game, existingBoosts] = await Promise.all([
    storage.getUserCommunityBoostShares(userId),
    storage.getPlayerGameForDate(player.id, player.sport, resolvedDate.targetDate),
    storage.getCommunityBoostsForDate(player.sport, resolvedDate.targetDate),
  ]);

  if (communitySharesAvailable < 1) {
    return buildUnavailableResponse({
      domain: "community_boosts",
      requestMessage: message,
      summary: "You do not have a community share available right now.",
      replyText:
        "Creating a community boost burns one community share, and you do not have one available right now.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "community_boost_create",
        playerId: player.id,
        boostDate: resolvedDate.dateStr,
        communitySharesAvailable,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "community_boost_create",
        reason: "insufficient_community_shares",
      },
    });
  }

  if (!game) {
    return buildUnavailableResponse({
      domain: "community_boosts",
      requestMessage: message,
      summary: `${player.firstName} ${player.lastName} does not have a ${resolvedDate.label} game in scope.`,
      replyText:
        "That player does not have a game in the target community-boost window, so I did not stage it.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "community_boost_create",
        playerId: player.id,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "community_boost_create",
        reason: "no_game",
      },
    });
  }

  if (new Date(game.startTime) <= new Date()) {
    return buildUnavailableResponse({
      domain: "community_boosts",
      requestMessage: message,
      summary: `${player.firstName} ${player.lastName}'s game has already started.`,
      replyText:
        "That game has already started, so the community-boost window is closed and I did not stage it.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "community_boost_create",
        playerId: player.id,
        boostDate: resolvedDate.dateStr,
        gameId: game.gameId,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "community_boost_create",
        reason: "game_started",
      },
    });
  }

  if (existingBoosts.some((entry) => entry.playerId === player.id)) {
    return buildUnavailableResponse({
      domain: "community_boosts",
      requestMessage: message,
      summary: `${player.firstName} ${player.lastName} already has a community boost for ${resolvedDate.label}.`,
      replyText:
        "That player already has an active community boost in that window, so I did not stage a duplicate one.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "community_boost_create",
        playerId: player.id,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "community_boost_create",
        reason: "already_boosted",
      },
    });
  }

  const opponent = game.homeTeam === player.team ? `vs ${game.awayTeam}` : `@ ${game.homeTeam}`;
  const action: CommunityBoostCreateAction = {
    actionType: "community_boost_create",
    playerId: player.id,
    playerName: `${player.firstName} ${player.lastName}`,
    sport: player.sport,
    boostDate: resolvedDate.dateStr,
    gameId: game.gameId,
    gameStartTime: new Date(game.startTime).toISOString(),
    opponent,
    communitySharesAvailable,
    reasoning:
      requestMode === "discussion"
        ? "Previewing a valid community boost redemption on the selected player."
        : "This stages a community boost redemption that will burn one community share on confirmation.",
    confidence: 0.94,
  };

  const summary = `Create a community boost for ${action.playerName} ${resolvedDate.label}`;
  return {
    domain: "community_boosts",
    requestMessage: message,
    replyText:
      requestMode === "discussion"
        ? `${summary}. That would burn 1 community share and apply to holders before lock. ${buildStageNudge(requestMode)}`
        : `${summary}. I staged it with ${action.playerName} scheduled ${opponent}. ${buildStageNudge(requestMode)}`,
    summary,
    observations: [
      `${action.playerName} is scheduled ${opponent} at ${new Date(game.startTime).toLocaleString()}.`,
      `You currently have ${communitySharesAvailable} community share${communitySharesAvailable === 1 ? "" : "s"} available.`,
    ],
    warnings: [
      ...playerResolution.warnings,
      "Creating a community boost burns one community share and cannot be duplicated for the same player/day.",
    ],
    actions: requestMode === "commit" ? [action] : [],
    errorMessage: null,
    contextSnapshot: {
      intent: "community_boost_create",
      playerId: player.id,
      boostDate: resolvedDate.dateStr,
      gameId: game.gameId,
      communitySharesAvailable,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "community_boost_create",
      requestMode,
    },
  };
}

export async function planDirectAgentOperation(input: {
  userId: string;
  message: string | null;
  profile: UserAgentProfile;
}): Promise<DirectOperationPlan | null> {
  const requestMessage = normalizeWhitespace(input.message || "");
  if (!requestMessage) {
    return null;
  }

  const requestMode = isAdvisoryRequest(requestMessage) ? "discussion" : "commit";

  const planners = [
    buildCapabilityGuidePlan,
    buildPortfolioCleanupReviewPlan,
    buildIdleCapitalDeploymentPlan,
    buildCommunityBoostOpportunityScanPlan,
    buildBroadOperatorReviewPlan,
    buildMarketIntelligencePlan,
    buildBuyPowerBoostWorkflowPlan,
    buildCommunityBoostPlan,
    buildWatchlistPlan,
    buildCondensePlan,
    buildGameplayStrategyPlan,
    buildBoostRemovePlan,
    buildBoostAssignPlan,
    buildRemoveLiquidityPlan,
    buildZapPlan,
    buildLiquidityPlan,
    buildSellPlan,
    buildBuyPlan,
  ];

  for (const planner of planners) {
    const result = await planner(input.userId, input.profile, requestMessage, requestMode);
    if (result) {
      return result;
    }
  }

  return null;
}

// Planner implementations are appended below to keep the exported router close to the shared helpers.

async function buildGameplayStrategyPlan(
  _userId: string,
  _profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  if (requestMode !== "discussion") {
    return null;
  }

  const lower = normalizeWhitespace(message).toLowerCase();
  const mentionsBoost = /\b(boost|boosts|boost slot|slot)\b/.test(lower);
  const mentionsPool = /\b(pool|pools|buy|sell|trade|market|lp|liquidity|zap)\b/.test(lower);
  const mentionsBuy = /\b(buy|buying|position|market)\b/.test(lower);
  const mentionsLiquidity = /\b(lp|liquidity|zap)\b/.test(lower);

  if (mentionsBoost && mentionsPool) {
    return {
      domain: "sportfolio",
      requestMessage: message,
      replyText:
        "If you're choosing between a boost and a pool move, think of them as two different bets. A boost is the sharper, one-game swing: it burns exactly one share, only works before lock, and is best when you want concentrated upside on a player you already like today. A pool move is the more flexible position: you can buy, trim, or LP around that player over time, and it is usually the better fit when you want exposure you can manage instead of a single-game spike. If you want, send me the player and the move you're leaning toward and I'll talk through the exact tradeoff or stage it.",
      summary:
        "Boosts are for short-window upside; pool moves are for flexible position management.",
      observations: [
        "Boosts lock at game start and use exactly one share.",
        "Pool buys, sells, and LP moves stay flexible and can be managed over time.",
      ],
      warnings: [],
      actions: [],
      errorMessage: null,
      contextSnapshot: {
        intent: "gameplay_tradeoff",
        topic: "boost_vs_pool",
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "gameplay_tradeoff",
        topic: "boost_vs_pool",
      },
    };
  }

  if (mentionsBuy && mentionsLiquidity) {
    return {
      domain: "sportfolio",
      requestMessage: message,
      replyText:
        "If you're deciding between buying shares and adding liquidity, buying is the cleaner directional bet. It gives you pure price exposure and is the easiest thing to unwind later. LP is more of a balance-and-fees position: you get exposure on both sides of the pool, but you give up some upside if the player runs hard because part of the position sits in cash. Use a direct buy when you have conviction on the player; use LP when you want steadier exposure and you care more about staying flexible around the pool. If you want, send me the player plus your amount and I'll compare the exact move.",
      summary:
        "Direct buys maximize player exposure; LP trades upside for a steadier, balanced position.",
      observations: [
        "Buying is the strongest directional expression.",
        "LP adds keep part of the position in cash and can be smoother, but less aggressive.",
      ],
      warnings: [],
      actions: [],
      errorMessage: null,
      contextSnapshot: {
        intent: "gameplay_tradeoff",
        topic: "buy_vs_lp",
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "gameplay_tradeoff",
        topic: "buy_vs_lp",
      },
    };
  }

  return null;
}

async function buildBuyPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const parserMessage = normalizeOperationalParserMessage(message);
  const amountMatch =
    parserMessage.match(
      /\b(?:buy|buying|purchase|purchasing|get|grab|pick\s+up|start(?:\s+my)?\s+position(?:\s+in)?)\s+\$?(\d+(?:\.\d+)?)\s+(?:of\s+)?(.+?)(?:\s+from\s+the\s+pool|\s+in\s+the\s+pool|\s+in\s+pool|$)/i,
    ) || null;
  const shareMatch =
    parserMessage.match(/\b(?:buy|buying|get|grab|pick\s+up)\s+(\d+)\s+(.+?)\s+shares?\b/i) ||
    parserMessage.match(
      /\b(?:buy|buying|get|grab|pick\s+up)\s+(\d+)\s+shares?\s+of\s+(.+?)(?:\s+from\s+the\s+pool|\s+in\s+the\s+pool|\s+in\s+pool|$)/i,
    );

  if (!amountMatch && !shareMatch) {
    return null;
  }

  const requestedShareCount = shareMatch ? Number.parseInt(shareMatch[1], 10) : null;
  const requestedDollarAmount =
    requestedShareCount == null && amountMatch ? Number(amountMatch[1]) : null;
  const rawPlayerReference =
    requestedShareCount != null ? shareMatch![2] : (amountMatch?.[2] as string);
  const playerResolution = await resolvePlayerByReference(rawPlayerReference, { message, profile });
  if (!playerResolution) {
    return buildPlayerClarificationResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: "I need a clearer player name before I can stage that buy.",
      replyText:
        "I can stage that pool buy, but I need the full player name first so I do not hit the wrong market.",
      prompt: "Send the full player name and I'll queue that buy for confirmation.",
      resumeMessageTemplate:
        requestedShareCount != null
          ? `buy ${requestedShareCount} {player} shares`
          : `buy $${requestedDollarAmount} of {player}`,
      contextSnapshot: {
        intent: "pool_buy",
        sbAmount: requestedDollarAmount,
        requestedShareCount,
        rawPlayerReference: sanitizeNameFragment(rawPlayerReference),
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_buy",
        reason: "player_not_resolved",
      },
    });
  }

  const player = playerResolution.player;
  await getOrCreatePool(player.id);
  const estimatedShareSpend =
    requestedDollarAmount == null && requestedShareCount
      ? await estimateSpendForTargetShares(player.id, requestedShareCount)
      : null;
  const sbAmount =
    requestedDollarAmount ?? (estimatedShareSpend ? estimatedShareSpend.sbAmount : Number.NaN);
  const quote =
    requestedDollarAmount != null
      ? await getBuyQuote(player.id, sbAmount)
      : estimatedShareSpend?.quote || null;
  const availableBalance = await storage.getAvailableBalance(userId);

  if (!quote) {
    return buildUnavailableResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: `I could not quote a buy for ${player.firstName} ${player.lastName} right now.`,
      replyText:
        "That player pool is not returning a usable quote right now, so I did not stage the buy.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "pool_buy",
        playerId: player.id,
        sbAmount,
        requestedShareCount,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_buy",
        reason: "quote_unavailable",
      },
    });
  }

  if (availableBalance < sbAmount) {
    return buildUnavailableResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: `You only have ${formatMoney(availableBalance)} available, so that buy cannot be staged yet.`,
      replyText: `That buy needs ${formatMoney(sbAmount)}, but you currently have ${formatMoney(
        availableBalance,
      )} available. Top up or lower the amount and I can stage it.`,
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "pool_buy",
        playerId: player.id,
        sbAmount,
        requestedShareCount,
        availableBalance,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_buy",
        reason: "insufficient_balance",
      },
    });
  }

  const action: PoolBuyAction = {
    actionType: "pool_buy",
    playerId: player.id,
    playerName: `${player.firstName} ${player.lastName}`,
    sbAmount,
    availableBalanceBefore: availableBalance,
    availableBalanceAfter: availableBalance - sbAmount,
    maxSlippage: DEFAULT_MAX_SLIPPAGE,
    estimatedSharesOut: quote.sharesOut,
    estimatedPricePerShare: quote.effectivePrice,
    estimatedSlippagePercent: quote.slippagePercent * 100,
    reasoning:
      requestMode === "discussion"
        ? "Previewing the current pool buy quote before staging anything."
        : "This stages the requested pool buy at the current quoted price and default slippage guard.",
    confidence: 0.94,
  };

  const summary = `Buy ${formatMoney(sbAmount)} of ${action.playerName}`;
  const observations = [
    `Estimated shares out: ${formatNumber(
      requestedShareCount != null && estimatedShareSpend
        ? estimatedShareSpend.roundedSharesOut
        : quote.sharesOut,
      4,
    )}.`,
    `Estimated effective price: ${formatMoney(quote.effectivePrice)} per share.`,
    `Estimated slippage: ${formatNumber(quote.slippagePercent * 100)}%.`,
  ];
  const warnings = [
    ...playerResolution.warnings,
    "Pool prices can move before you confirm, so the final fill can differ slightly from the preview.",
  ];
  if (
    requestedShareCount != null &&
    estimatedShareSpend &&
    estimatedShareSpend.roundedSharesOut !== requestedShareCount
  ) {
    warnings.push(
      `I staged the closest current spend that should land about ${estimatedShareSpend.roundedSharesOut} whole shares, not exactly ${requestedShareCount}, because the AMM buy path executes by spend rather than exact share count.`,
    );
  }

  return {
    domain: "player_pools",
    requestMessage: message,
    replyText:
      requestMode === "discussion"
        ? `Buying ${formatMoney(sbAmount)} of ${action.playerName} would currently estimate ${
            requestedShareCount != null && estimatedShareSpend
              ? `${estimatedShareSpend.roundedSharesOut} whole shares`
              : `${formatNumber(quote.sharesOut, 4)} shares`
          } at about ${formatMoney(quote.effectivePrice)} each with ${formatNumber(
            quote.slippagePercent * 100,
          )}% slippage. ${buildStageNudge(requestMode)}`
        : `I can stage that buy. ${summary} currently estimates ${
            requestedShareCount != null && estimatedShareSpend
              ? `${estimatedShareSpend.roundedSharesOut} whole shares`
              : `${formatNumber(quote.sharesOut, 4)} shares`
          } at about ${formatMoney(quote.effectivePrice)} each with ${formatNumber(
            quote.slippagePercent * 100,
          )}% slippage. ${buildStageNudge(requestMode)}`,
    summary,
    observations,
    warnings,
    actions: requestMode === "commit" ? [action] : [],
    errorMessage: null,
    contextSnapshot: {
      intent: "pool_buy",
      playerId: player.id,
      playerName: action.playerName,
      sbAmount,
      requestedShareCount,
      availableBalance,
      quote: {
        sharesOut:
          requestedShareCount != null && estimatedShareSpend
            ? estimatedShareSpend.roundedSharesOut
            : quote.sharesOut,
        effectivePrice: quote.effectivePrice,
        slippagePercent: quote.slippagePercent * 100,
      },
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "pool_buy",
      requestMode,
      matchedPattern: requestedDollarAmount != null ? "buy_by_dollars" : "buy_by_shares",
    },
  };
}

async function buildSellPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const parserMessage = normalizeOperationalParserMessage(message);
  const match = parserMessage.match(
    /\b(?:sell|selling|dump|liquidate|trim|trimming|cut|reduce|exit)\s+(\d+(?:\.\d+)?)\s+shares?\s+(?:of\s+)?(.+?)(?:\s+from\s+the\s+pool|\s+from\s+the\s+market|$)/i,
  );
  if (!match) {
    return null;
  }

  const sharesAmount = Number(match[1]);
  const playerResolution = await resolvePlayerByReference(match[2], { message, profile });
  if (!playerResolution) {
    return buildPlayerClarificationResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: "I need a clearer player name before I can stage that sale.",
      replyText:
        "I can stage that sale, but I need the full player name first so I do not sell the wrong holding.",
      prompt: "Send the full player name and I'll queue that sale for confirmation.",
      resumeMessageTemplate: `sell ${sharesAmount} shares of {player}`,
      contextSnapshot: {
        intent: "pool_sell",
        sharesAmount,
        rawPlayerReference: sanitizeNameFragment(match[2]),
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_sell",
        reason: "player_not_resolved",
      },
    });
  }

  if (!Number.isInteger(sharesAmount)) {
    return buildUnavailableResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: "Pool sells must use whole shares.",
      replyText:
        "The AMM sell path only accepts whole shares right now. Give me a whole-number share amount and I can stage it.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "pool_sell",
        playerId: playerResolution.player.id,
        sharesAmount,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_sell",
        reason: "non_integer_shares",
      },
    });
  }

  const player = playerResolution.player;
  await getOrCreatePool(player.id);
  const [quote, availableShares, availableBalance] = await Promise.all([
    getSellQuote(player.id, sharesAmount),
    storage.getAvailableShares(userId, "player", player.id),
    storage.getAvailableBalance(userId),
  ]);

  if (!quote) {
    return buildUnavailableResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: `I could not quote a sale for ${player.firstName} ${player.lastName} right now.`,
      replyText:
        "That player pool is not returning a usable sell quote right now, so I did not stage the trade.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "pool_sell",
        playerId: player.id,
        sharesAmount,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_sell",
        reason: "quote_unavailable",
      },
    });
  }

  if (availableShares < sharesAmount) {
    return buildUnavailableResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: `You only have ${formatNumber(availableShares, 0)} available shares, so that sale cannot be staged yet.`,
      replyText: `That sale needs ${formatNumber(sharesAmount, 0)} shares, but you currently have ${formatNumber(
        availableShares,
        0,
      )} available. Lower the share count and I can stage it.`,
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "pool_sell",
        playerId: player.id,
        sharesAmount,
        availableShares,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_sell",
        reason: "insufficient_shares",
      },
    });
  }

  const action: PoolSellAction = {
    actionType: "pool_sell",
    playerId: player.id,
    playerName: `${player.firstName} ${player.lastName}`,
    sharesAmount,
    availableBalanceBefore: availableBalance,
    availableBalanceAfter: availableBalance + quote.sbOut,
    availableSharesBefore: availableShares,
    availableSharesAfter: availableShares - sharesAmount,
    maxSlippage: DEFAULT_MAX_SLIPPAGE,
    estimatedSbOut: quote.sbOut,
    estimatedPricePerShare: quote.effectivePrice,
    estimatedSlippagePercent: quote.slippagePercent * 100,
    reasoning:
      requestMode === "discussion"
        ? "Previewing the current pool sell quote before staging anything."
        : "This stages the requested pool sell with the default slippage guard.",
    confidence: 0.94,
  };

  const summary = `Sell ${sharesAmount} share${sharesAmount === 1 ? "" : "s"} of ${action.playerName}`;
  const observations = [
    `Estimated proceeds: ${formatMoney(quote.sbOut)}.`,
    `Estimated effective price: ${formatMoney(quote.effectivePrice)} per share.`,
    `Estimated slippage: ${formatNumber(quote.slippagePercent * 100)}%.`,
  ];
  const warnings = [
    ...playerResolution.warnings,
    "Pool pricing can move before you confirm, so the final proceeds can differ slightly from the preview.",
  ];

  return {
    domain: "player_pools",
    requestMessage: message,
    replyText:
      requestMode === "discussion"
        ? `Selling ${sharesAmount} share${sharesAmount === 1 ? "" : "s"} of ${
            action.playerName
          } would currently estimate ${formatMoney(quote.sbOut)} back at about ${formatMoney(
            quote.effectivePrice,
          )} each with ${formatNumber(
            quote.slippagePercent * 100,
          )}% slippage. ${buildStageNudge(requestMode)}`
        : `I can stage that sale. ${summary} currently estimates ${formatMoney(
            quote.sbOut,
          )} back at about ${formatMoney(quote.effectivePrice)} each with ${formatNumber(
            quote.slippagePercent * 100,
          )}% slippage. ${buildStageNudge(requestMode)}`,
    summary,
    observations,
    warnings,
    actions: requestMode === "commit" ? [action] : [],
    errorMessage: null,
    contextSnapshot: {
      intent: "pool_sell",
      playerId: player.id,
      playerName: action.playerName,
      sharesAmount,
      availableShares,
      quote: {
        sbOut: quote.sbOut,
        effectivePrice: quote.effectivePrice,
        slippagePercent: quote.slippagePercent * 100,
      },
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "pool_sell",
      requestMode,
      matchedPattern: "sell",
    },
  };
}

async function buildLiquidityPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const parserMessage = normalizeOperationalParserMessage(message);
  const match = parserMessage.match(
    /\b(?:add|deposit|provide|supply)(?:\s+liquidity)?\s+(?:up to\s+|at most\s+|maximum\s+)?(\d+(?:\.\d+)?)\s+shares?\s+(?:and|with)\s+\$?(\d+(?:\.\d+)?)\s*(?:sb|bucks|dollars?)?\s+(?:to|into)\s+(.+?)(?:'s)?(?:\s+pool)?$/i,
  );
  if (!match) {
    return null;
  }

  const shares = Number(match[1]);
  const playMoney = Number(match[2]);
  const isOptimal = /\b(?:up to|at most|maximum|max)\b/i.test(message);
  const playerResolution = await resolvePlayerByReference(match[3], { message, profile });

  if (!playerResolution) {
    return buildPlayerClarificationResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: "I need a clearer player name before I can stage that LP move.",
      replyText:
        "I can stage that liquidity add, but I need the full player name first so I do not use the wrong pool.",
      prompt: "Send the full player name and I'll queue that LP move for confirmation.",
      resumeMessageTemplate: isOptimal
        ? `add up to ${shares} shares and $${playMoney} into {player} pool`
        : `add ${shares} shares and $${playMoney} into {player} pool`,
      contextSnapshot: {
        intent: isOptimal ? "pool_add_liquidity_optimal" : "pool_add_liquidity",
        shares,
        playMoney,
        rawPlayerReference: sanitizeNameFragment(match[3]),
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: isOptimal ? "pool_add_liquidity_optimal" : "pool_add_liquidity",
        reason: "player_not_resolved",
      },
    });
  }

  const player = playerResolution.player;
  const [pool, availableShares, availableBalance] = await Promise.all([
    getOrCreatePool(player.id),
    storage.getAvailableShares(userId, "player", player.id),
    storage.getAvailableBalance(userId),
  ]);

  if (availableShares < shares || availableBalance < playMoney) {
    return buildUnavailableResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: "You do not currently have enough inventory to stage that LP deposit.",
      replyText: `That liquidity add needs ${formatNumber(
        shares,
        2,
      )} shares and ${formatMoney(playMoney)}. You currently have ${formatNumber(
        availableShares,
        2,
      )} available shares and ${formatMoney(availableBalance)} available cash.`,
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: isOptimal ? "pool_add_liquidity_optimal" : "pool_add_liquidity",
        playerId: player.id,
        shares,
        playMoney,
        availableShares,
        availableBalance,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: isOptimal ? "pool_add_liquidity_optimal" : "pool_add_liquidity",
        reason: "insufficient_inventory",
      },
    });
  }

  const expectedPlayMoney = shares * pool.currentPrice;
  if (!isOptimal && Math.abs(expectedPlayMoney - playMoney) > LIQUIDITY_RATIO_TOLERANCE) {
    return buildUnavailableResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: "That exact LP add does not match the current pool ratio.",
      replyText: `That fixed liquidity add would fail right now because ${formatNumber(
        shares,
        2,
      )} shares currently needs about ${formatMoney(
        expectedPlayMoney,
      )}, not ${formatMoney(playMoney)}. Use the current ratio or say \"add up to\" if you want me to stage the optimal version instead.`,
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "pool_add_liquidity",
        playerId: player.id,
        shares,
        playMoney,
        expectedPlayMoney,
        currentPrice: pool.currentPrice,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_add_liquidity",
        reason: "ratio_mismatch",
      },
    });
  }

  const previewSharesUsed = isOptimal ? Math.min(shares, playMoney / pool.currentPrice) : shares;
  const previewPlayMoneyUsed = isOptimal
    ? Math.min(playMoney, shares * pool.currentPrice)
    : playMoney;
  const estimatedOwnershipPercent = computeEstimatedOwnershipPercent({
    currentPoolShares: pool.shares,
    currentLpSharesTotal: pool.lpSharesTotal,
    depositedShares: previewSharesUsed,
  });

  const summary = isOptimal
    ? `Add up to ${formatNumber(shares, 2)} shares and ${formatMoney(playMoney)} to ${player.firstName} ${player.lastName}'s pool`
    : `Add ${formatNumber(shares, 2)} shares and ${formatMoney(playMoney)} to ${player.firstName} ${player.lastName}'s pool`;
  const warnings = [
    ...playerResolution.warnings,
    "LP ownership and final deposit amounts can shift if the pool moves before you confirm.",
  ];

  const basePlan = {
    domain: "player_pools" as const,
    requestMessage: message,
    summary,
    observations: [
      `Current pool price is ${formatMoney(pool.currentPrice)}.`,
      estimatedOwnershipPercent == null
        ? "I could not estimate the post-deposit ownership cleanly from the current pool snapshot."
        : `Estimated ownership after execution: ${formatNumber(estimatedOwnershipPercent)}%.`,
    ],
    warnings,
    errorMessage: null,
    contextSnapshot: {
      intent: isOptimal ? "pool_add_liquidity_optimal" : "pool_add_liquidity",
      playerId: player.id,
      playerName: `${player.firstName} ${player.lastName}`,
      shares,
      playMoney,
      availableShares,
      availableBalance,
      currentPrice: pool.currentPrice,
      estimatedOwnershipPercent,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: isOptimal ? "pool_add_liquidity_optimal" : "pool_add_liquidity",
      requestMode,
      matchedPattern: "add_liquidity",
    },
  };

  if (isOptimal) {
    const action: PoolAddLiquidityOptimalAction = {
      actionType: "pool_add_liquidity_optimal",
      playerId: player.id,
      playerName: `${player.firstName} ${player.lastName}`,
      maxShares: shares,
      maxPlayMoney: playMoney,
      availableBalanceBefore: availableBalance,
      availableBalanceAfter: availableBalance - previewPlayMoneyUsed,
      availableSharesBefore: availableShares,
      availableSharesAfter: availableShares - previewSharesUsed,
      estimatedOwnershipPercent,
      reasoning:
        requestMode === "discussion"
          ? "Previewing an optimal-ratio LP add using the current pool state."
          : "This stages an optimal-ratio LP add capped by the provided share and cash limits.",
      confidence: 0.91,
    };

    return {
      ...basePlan,
      replyText:
        requestMode === "discussion"
          ? `${summary}. At the current pool ratio, I would use up to ${formatNumber(
              Math.min(shares, playMoney / pool.currentPrice),
              2,
            )} shares inside that cap. ${buildStageNudge(requestMode)}`
          : `${summary}. I'll use the server-side optimal ratio at execution time so anything unused stays in your wallet. ${buildStageNudge(requestMode)}`,
      actions: requestMode === "commit" ? [action] : [],
    };
  }

  const action: PoolAddLiquidityAction = {
    actionType: "pool_add_liquidity",
    playerId: player.id,
    playerName: `${player.firstName} ${player.lastName}`,
    shares,
    playMoney,
    availableBalanceBefore: availableBalance,
    availableBalanceAfter: availableBalance - playMoney,
    availableSharesBefore: availableShares,
    availableSharesAfter: availableShares - shares,
    estimatedOwnershipPercent,
    reasoning:
      requestMode === "discussion"
        ? "Previewing a fixed-ratio LP add using the exact requested amounts."
        : "This stages the exact requested LP deposit into the player pool.",
    confidence: 0.91,
  };

  return {
    ...basePlan,
    replyText:
      requestMode === "discussion"
        ? `${summary}. At the current pool price of ${formatMoney(
            pool.currentPrice,
          )}, that is a direct fixed-size LP add. ${buildStageNudge(requestMode)}`
        : `${summary}. This uses the exact amounts you gave me at the current pool ratio. ${buildStageNudge(requestMode)}`,
    actions: requestMode === "commit" ? [action] : [],
  };
}

async function buildZapPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const parserMessage = normalizeOperationalParserMessage(message);
  const sharesMatch = parserMessage.match(
    /\b(?:zap|single[- ]side(?:d)?(?:\s+add)?)\s+(\d+(?:\.\d+)?)\s+shares?\s+(?:into|to)\s+(.+?)(?:'s)?(?:\s+pool)?$/i,
  );
  const sbWithUnitsMatch = parserMessage.match(
    /\b(?:zap|single[- ]side(?:d)?(?:\s+add)?)\s+(\d+(?:\.\d+)?)\s*(?:sb|bucks|dollars?)\s+(?:into|to)\s+(.+?)(?:'s)?(?:\s+pool)?$/i,
  );
  const sbDollarMatch = parserMessage.match(
    /\b(?:zap|single[- ]side(?:d)?(?:\s+add)?)\s+\$(\d+(?:\.\d+)?)\s+(?:into|to)\s+(.+?)(?:'s)?(?:\s+pool)?$/i,
  );
  const sbMatch = sbWithUnitsMatch || sbDollarMatch;

  if (!sharesMatch && !sbMatch) {
    return null;
  }

  const useShares = Boolean(sharesMatch);
  const amount = Number((sharesMatch || sbMatch)![1]);
  const playerReference = (sharesMatch || sbMatch)![2];
  const playerResolution = await resolvePlayerByReference(playerReference, { message, profile });

  if (!playerResolution) {
    return buildPlayerClarificationResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: "I need a clearer player name before I can stage that zap.",
      replyText:
        "I can stage that single-sided LP zap, but I need the full player name first so I do not use the wrong pool.",
      prompt: "Send the full player name and I'll queue that single-sided LP zap for confirmation.",
      resumeMessageTemplate: useShares
        ? `zap ${amount} shares into {player} pool`
        : `zap $${amount} into {player} pool`,
      contextSnapshot: {
        intent: useShares ? "pool_zap_add_shares" : "pool_zap_add_sb",
        amount,
        rawPlayerReference: sanitizeNameFragment(playerReference),
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: useShares ? "pool_zap_add_shares" : "pool_zap_add_sb",
        reason: "player_not_resolved",
      },
    });
  }

  const player = playerResolution.player;
  const availableAmount = useShares
    ? await storage.getAvailableShares(userId, "player", player.id)
    : await storage.getAvailableBalance(userId);

  if (availableAmount < amount) {
    return buildUnavailableResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: `You do not currently have enough ${useShares ? "shares" : "cash"} to stage that zap.`,
      replyText: useShares
        ? `That zap needs ${formatNumber(amount, 2)} shares, but you currently have ${formatNumber(
            availableAmount,
            2,
          )} available.`
        : `That zap needs ${formatMoney(amount)}, but you currently have ${formatMoney(
            availableAmount,
          )} available.`,
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: useShares ? "pool_zap_add_shares" : "pool_zap_add_sb",
        playerId: player.id,
        amount,
        availableAmount,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: useShares ? "pool_zap_add_shares" : "pool_zap_add_sb",
        reason: "insufficient_inventory",
      },
    });
  }

  let estimatedLpSharesMinted: number | null = null;
  try {
    const quote = useShares
      ? await getZapAddQuoteSharesOnly(player.id, userId, amount)
      : await getZapAddQuoteSbOnly(player.id, userId, amount);
    const parsedLpShares = Number(quote?.estimatedLpSharesMinted || 0);
    estimatedLpSharesMinted = Number.isFinite(parsedLpShares) ? parsedLpShares : null;
  } catch {
    estimatedLpSharesMinted = null;
  }

  const summary = useShares
    ? `Zap ${formatNumber(amount, 2)} shares into ${player.firstName} ${player.lastName}'s pool`
    : `Zap ${formatMoney(amount)} into ${player.firstName} ${player.lastName}'s pool`;
  const warnings = [
    ...playerResolution.warnings,
    "Single-sided zaps run an internal swap first, so the final result can move with the pool before you confirm.",
  ];

  if (useShares) {
    const action: PoolZapSharesAction = {
      actionType: "pool_zap_add_shares",
      playerId: player.id,
      playerName: `${player.firstName} ${player.lastName}`,
      shares: amount,
      availableSharesBefore: availableAmount,
      availableSharesAfter: availableAmount - amount,
      estimatedLpSharesMinted,
      reasoning:
        requestMode === "discussion"
          ? "Previewing a shares-only LP zap."
          : "This stages a shares-only LP zap using the current pool math.",
      confidence: 0.9,
    };

    return {
      domain: "player_pools",
      requestMessage: message,
      replyText:
        requestMode === "discussion"
          ? `${summary}. ${
              estimatedLpSharesMinted == null
                ? "I could not get a clean LP share estimate from the current quote, but the route is available."
                : `The current quote estimates about ${formatNumber(estimatedLpSharesMinted, 4)} LP shares.`
            } ${buildStageNudge(requestMode)}`
          : `${summary}. ${
              estimatedLpSharesMinted == null
                ? "The route is available, but the preview quote is noisy right now."
                : `The current quote estimates about ${formatNumber(estimatedLpSharesMinted, 4)} LP shares.`
            } ${buildStageNudge(requestMode)}`,
      summary,
      observations:
        estimatedLpSharesMinted == null
          ? [
              "The single-sided zap route is available, but the quote did not return a stable LP-share preview.",
            ]
          : [`Estimated LP shares minted: ${formatNumber(estimatedLpSharesMinted, 4)}.`],
      warnings,
      actions: requestMode === "commit" ? [action] : [],
      errorMessage: null,
      contextSnapshot: {
        intent: "pool_zap_add_shares",
        playerId: player.id,
        playerName: action.playerName,
        shares: amount,
        estimatedLpSharesMinted,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_zap_add_shares",
        requestMode,
        matchedPattern: "zap_shares",
      },
    };
  }

  const action: PoolZapSbAction = {
    actionType: "pool_zap_add_sb",
    playerId: player.id,
    playerName: `${player.firstName} ${player.lastName}`,
    sb: amount,
    availableBalanceBefore: availableAmount,
    availableBalanceAfter: availableAmount - amount,
    estimatedLpSharesMinted,
    reasoning:
      requestMode === "discussion"
        ? "Previewing a cash-only LP zap."
        : "This stages a cash-only LP zap using the current pool math.",
    confidence: 0.9,
  };

  return {
    domain: "player_pools",
    requestMessage: message,
    replyText:
      requestMode === "discussion"
        ? `${summary}. ${
            estimatedLpSharesMinted == null
              ? "I could not get a clean LP share estimate from the current quote, but the route is available."
              : `The current quote estimates about ${formatNumber(estimatedLpSharesMinted, 4)} LP shares.`
          } ${buildStageNudge(requestMode)}`
        : `${summary}. ${
            estimatedLpSharesMinted == null
              ? "The route is available, but the preview quote is noisy right now."
              : `The current quote estimates about ${formatNumber(estimatedLpSharesMinted, 4)} LP shares.`
          } ${buildStageNudge(requestMode)}`,
    summary,
    observations:
      estimatedLpSharesMinted == null
        ? [
            "The single-sided zap route is available, but the quote did not return a stable LP-share preview.",
          ]
        : [`Estimated LP shares minted: ${formatNumber(estimatedLpSharesMinted, 4)}.`],
    warnings,
    actions: requestMode === "commit" ? [action] : [],
    errorMessage: null,
    contextSnapshot: {
      intent: "pool_zap_add_sb",
      playerId: player.id,
      playerName: action.playerName,
      sb: amount,
      estimatedLpSharesMinted,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "pool_zap_add_sb",
      requestMode,
      matchedPattern: "zap_sb",
    },
  };
}

async function buildRemoveLiquidityPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const parserMessage = normalizeOperationalParserMessage(message);
  const match = parserMessage.match(
    /\b(?:remove|withdraw|pull|unwind|take\s+out)\s+(\d+(?:\.\d+)?)\s+lp\s+shares?\s+(?:from\s+)?(.+?)(?:'s)?(?:\s+pool)?$/i,
  );
  if (!match) {
    return null;
  }

  const lpShares = Number(match[1]);
  const playerResolution = await resolvePlayerByReference(match[2], { message, profile });
  if (!playerResolution) {
    return buildPlayerClarificationResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: "I need a clearer player name before I can stage that LP withdrawal.",
      replyText:
        "I can stage that liquidity removal, but I need the full player name first so I do not use the wrong pool.",
      prompt: "Send the full player name and I'll queue that LP withdrawal for confirmation.",
      resumeMessageTemplate: `remove ${lpShares} lp shares from {player} pool`,
      contextSnapshot: {
        intent: "pool_remove_liquidity",
        lpShares,
        rawPlayerReference: sanitizeNameFragment(match[2]),
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_remove_liquidity",
        reason: "player_not_resolved",
      },
    });
  }

  const player = playerResolution.player;
  const position = await getLpPosition(player.id, userId);
  if (!position) {
    return buildUnavailableResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: `You do not currently have an LP position in ${player.firstName} ${player.lastName}'s pool.`,
      replyText: "There is no LP position there right now, so I did not stage a removal.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "pool_remove_liquidity",
        playerId: player.id,
        lpShares,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_remove_liquidity",
        reason: "no_lp_position",
      },
    });
  }

  if (position.lpShares < lpShares) {
    return buildUnavailableResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: `You only have ${formatNumber(position.lpShares, 2)} LP shares available there.`,
      replyText: `That removal needs ${formatNumber(lpShares, 2)} LP shares, but you currently hold ${formatNumber(
        position.lpShares,
        2,
      )}.`,
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "pool_remove_liquidity",
        playerId: player.id,
        lpShares,
        currentLpShares: position.lpShares,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_remove_liquidity",
        reason: "insufficient_lp_shares",
      },
    });
  }

  const ratio = position.lpShares > 0 ? lpShares / position.lpShares : 0;
  const estimatedSharesOut = position.equivalentShares * ratio;
  const estimatedPlayMoneyOut = position.equivalentPlayMoney * ratio;

  const action: PoolRemoveLiquidityAction = {
    actionType: "pool_remove_liquidity",
    playerId: player.id,
    playerName: `${player.firstName} ${player.lastName}`,
    lpShares,
    currentLpShares: position.lpShares,
    remainingLpShares: position.lpShares - lpShares,
    estimatedSharesOut: Number.isFinite(estimatedSharesOut) ? estimatedSharesOut : null,
    estimatedPlayMoneyOut: Number.isFinite(estimatedPlayMoneyOut) ? estimatedPlayMoneyOut : null,
    reasoning:
      requestMode === "discussion"
        ? "Previewing an LP removal based on the current position snapshot."
        : "This stages the requested LP share burn from the current position.",
    confidence: 0.89,
  };

  const summary = `Remove ${formatNumber(lpShares, 2)} LP shares from ${action.playerName}'s pool`;
  const warnings = [
    ...playerResolution.warnings,
    "Pool reserves and your exact outputs can move before you confirm.",
  ];

  return {
    domain: "player_pools",
    requestMessage: message,
    replyText:
      requestMode === "discussion"
        ? `${summary}. ${
            action.estimatedSharesOut == null || action.estimatedPlayMoneyOut == null
              ? "I could not derive a clean output estimate from the current position snapshot."
              : `That currently lines up to about ${formatNumber(action.estimatedSharesOut, 4)} shares and ${formatMoney(action.estimatedPlayMoneyOut)} back.`
          } ${buildStageNudge(requestMode)}`
        : `${summary}. ${
            action.estimatedSharesOut == null || action.estimatedPlayMoneyOut == null
              ? "The position is valid, but the exact preview is noisy right now."
              : `That currently lines up to about ${formatNumber(action.estimatedSharesOut, 4)} shares and ${formatMoney(action.estimatedPlayMoneyOut)} back.`
          } ${buildStageNudge(requestMode)}`,
    summary,
    observations:
      action.estimatedSharesOut == null || action.estimatedPlayMoneyOut == null
        ? [
            "The LP removal path is available, but the current snapshot did not produce a clean output estimate.",
          ]
        : [
            `Estimated shares returned: ${formatNumber(action.estimatedSharesOut, 4)}.`,
            `Estimated cash returned: ${formatMoney(action.estimatedPlayMoneyOut)}.`,
          ],
    warnings,
    actions: requestMode === "commit" ? [action] : [],
    errorMessage: null,
    contextSnapshot: {
      intent: "pool_remove_liquidity",
      playerId: player.id,
      playerName: action.playerName,
      lpShares,
      position: {
        lpShares: position.lpShares,
        ownershipPercentage: position.ownershipPercentage,
      },
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "pool_remove_liquidity",
      requestMode,
      matchedPattern: "remove_liquidity",
    },
  };
}

async function buildBoostAssignPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const parserMessage = normalizeOperationalParserMessage(message);
  const match =
    parserMessage.match(
      /\b(?:put|putting|place|placing|assign|assigning|boost|boosting|slot|slotting|lock|locking|run)\s+(.+?)\s+(?:in|into|to)\s+(?:my\s+)?([2345])x\s+(?:boost\s+)?slot\b/i,
    ) ||
    parserMessage.match(
      /\b(?:use|using|throw)\s+(?:my\s+)?([2345])x\s+(?:boost\s+)?slot\s+(?:on|for)\s+(.+?)$/i,
    );

  if (!match) {
    return null;
  }

  const slotFirstPattern = /^[2345]$/.test(match[1]);
  const playerReference = slotFirstPattern ? match[2] : match[1];
  const slotTier = Number(slotFirstPattern ? match[1] : match[2]) as 2 | 3 | 4 | 5;
  const resolvedDate = resolveDateFromMessage(message);
  const playerResolution = await resolvePlayerByReference(playerReference, { message, profile });

  if (!playerResolution) {
    return buildPlayerClarificationResponse({
      domain: "daily_boosts",
      requestMessage: message,
      summary: "I need a clearer player name before I can stage that boost.",
      replyText:
        "I can stage that daily boost, but I need the full player name first so I do not burn the wrong share.",
      prompt: "Send the full player name and I'll queue that daily boost for confirmation.",
      resumeMessageTemplate: `put {player} in my ${slotTier}x boost slot ${resolvedDate.label}`,
      contextSnapshot: {
        intent: "daily_boost_assign",
        slotTier,
        rawPlayerReference: sanitizeNameFragment(playerReference),
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "daily_boost_assign",
        reason: "player_not_resolved",
      },
    });
  }

  const player = playerResolution.player;
  const [currentBoosts, game, availableShares, breakdown] = await Promise.all([
    storage.getDailyBoosts(userId, player.sport, resolvedDate.targetDate),
    storage.getPlayerGameForDate(player.id, player.sport, resolvedDate.targetDate),
    storage.getAvailableShares(userId, "player", player.id),
    storage.getHoldingsWithPowerBreakdown(userId, player.id),
  ]);

  if (currentBoosts.some((boost) => boost.slotTier === slotTier)) {
    return buildUnavailableResponse({
      domain: "daily_boosts",
      requestMessage: message,
      summary: `Your ${slotTier}x slot is already filled for ${resolvedDate.label}.`,
      replyText: `That ${slotTier}x slot is already occupied for ${resolvedDate.label}, so I did not stage a new boost there.`,
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "daily_boost_assign",
        playerId: player.id,
        slotTier,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "daily_boost_assign",
        reason: "slot_taken",
      },
    });
  }

  if (currentBoosts.some((boost) => boost.playerId === player.id)) {
    return buildUnavailableResponse({
      domain: "daily_boosts",
      requestMessage: message,
      summary: `${player.firstName} ${player.lastName} is already in one of your boost slots for ${resolvedDate.label}.`,
      replyText:
        "That player is already boosted for the target day, so I did not stage a duplicate boost.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "daily_boost_assign",
        playerId: player.id,
        slotTier,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "daily_boost_assign",
        reason: "player_already_boosted",
      },
    });
  }

  if (currentBoosts.length >= 4) {
    return buildUnavailableResponse({
      domain: "daily_boosts",
      requestMessage: message,
      summary: `All four boost slots are already filled for ${resolvedDate.label}.`,
      replyText: "All four daily boost slots are already occupied, so I did not stage another one.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "daily_boost_assign",
        playerId: player.id,
        slotTier,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "daily_boost_assign",
        reason: "slots_full",
      },
    });
  }

  if (!game) {
    return buildUnavailableResponse({
      domain: "daily_boosts",
      requestMessage: message,
      summary: `${player.firstName} ${player.lastName} does not have a ${resolvedDate.label} game in scope.`,
      replyText:
        "That player does not have a game in the target daily-boost window, so I did not stage the boost.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "daily_boost_assign",
        playerId: player.id,
        slotTier,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "daily_boost_assign",
        reason: "no_game",
      },
    });
  }

  if (new Date(game.startTime) <= new Date()) {
    return buildUnavailableResponse({
      domain: "daily_boosts",
      requestMessage: message,
      summary: `${player.firstName} ${player.lastName}'s game has already started.`,
      replyText:
        "That game has already started, so the daily boost is locked out and I did not stage it.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "daily_boost_assign",
        playerId: player.id,
        slotTier,
        boostDate: resolvedDate.dateStr,
        gameId: game.gameId,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "daily_boost_assign",
        reason: "game_started",
      },
    });
  }

  if (availableShares < 1) {
    return buildUnavailableResponse({
      domain: "daily_boosts",
      requestMessage: message,
      summary: `You do not have an available share to boost ${player.firstName} ${player.lastName}.`,
      replyText:
        "Daily boosts always consume exactly one available share, and you do not have one free for that player right now.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "daily_boost_assign",
        playerId: player.id,
        slotTier,
        boostDate: resolvedDate.dateStr,
        availableShares,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "daily_boost_assign",
        reason: "insufficient_shares",
      },
    });
  }

  const poweredCandidates = [
    ...(breakdown.powered || []).filter((holding) => Number.parseFloat(holding.quantity) >= 1),
    ...(breakdown.regular && Number.parseFloat(breakdown.regular.quantity) >= 1
      ? [breakdown.regular]
      : []),
  ].sort((left, right) => (right.power || 1) - (left.power || 1));
  const selectedHolding = poweredCandidates[0];
  const powerLevel = selectedHolding?.power || 1;
  const opponent = game.homeTeam === player.team ? `vs ${game.awayTeam}` : `@ ${game.homeTeam}`;

  const action: DailyBoostAssignAction = {
    actionType: "daily_boost_assign",
    playerId: player.id,
    playerName: `${player.firstName} ${player.lastName}`,
    sport: player.sport,
    slotTier,
    sharesEntered: 1,
    boostDate: resolvedDate.dateStr,
    gameId: game.gameId,
    gameStartTime: new Date(game.startTime).toISOString(),
    opponent,
    availableShares,
    powerLevel,
    reasoning:
      requestMode === "discussion"
        ? "Previewing a valid daily boost placement for the selected slot."
        : "This stages the requested daily boost using exactly one eligible share in the chosen slot.",
    confidence: 0.93,
  };

  const summary = `Put ${action.playerName} in your ${slotTier}x boost slot for ${resolvedDate.label}`;
  const observations = [
    `${action.playerName} is scheduled ${opponent} at ${new Date(game.startTime).toLocaleString()}.`,
    `The selected share would contribute ${formatNumber(powerLevel, 2)} power in that slot.`,
  ];
  const warnings = [
    ...playerResolution.warnings,
    "Daily boosts always use exactly one share and become locked when the game starts.",
  ];

  return {
    domain: "daily_boosts",
    requestMessage: message,
    replyText:
      requestMode === "discussion"
        ? `${summary}. ${action.playerName} is eligible right now, and the best available share would carry ${formatNumber(
            powerLevel,
            2,
          )} power into that slot. ${buildStageNudge(requestMode)}`
        : `${summary}. ${action.playerName} is eligible right now, and the best available share would carry ${formatNumber(
            powerLevel,
            2,
          )} power into that slot. ${buildStageNudge(requestMode)}`,
    summary,
    observations,
    warnings,
    actions: requestMode === "commit" ? [action] : [],
    errorMessage: null,
    contextSnapshot: {
      intent: "daily_boost_assign",
      playerId: player.id,
      playerName: action.playerName,
      sport: player.sport,
      slotTier,
      boostDate: resolvedDate.dateStr,
      gameId: game.gameId,
      availableShares,
      selectedPowerLevel: powerLevel,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "daily_boost_assign",
      requestMode,
      matchedPattern: "boost_assign",
    },
  };
}

async function buildBoostRemovePlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const parserMessage = normalizeOperationalParserMessage(message);
  const slotMatch = parserMessage.match(
    /\b(?:remove|clear|delete|cancel|pull|take|free\s+up|unslot)\s+(?:my\s+)?([2345])x\s+(?:boost\s+)?slot\b/i,
  );
  const playerMatch = parserMessage.match(
    /\b(?:remove|clear|delete|cancel|pull|take|unslot)\s+(.+?)\s+from\s+(?:my\s+)?boosts?\b/i,
  );

  if (!slotMatch && !playerMatch) {
    return null;
  }

  const resolvedDate = resolveDateFromMessage(message);
  const boosts = await storage.getDailyBoostsAllSports(userId, resolvedDate.targetDate);
  let boost:
    | (typeof dailyBoosts.$inferSelect & {
        player?: typeof players.$inferSelect;
      })
    | undefined;
  let warnings: string[] = [];

  if (slotMatch) {
    const slotTier = Number(slotMatch[1]);
    boost = boosts.find((entry) => entry.slotTier === slotTier);
  } else if (playerMatch) {
    const playerResolution = await resolvePlayerByReference(playerMatch[1], { message, profile });
    if (!playerResolution) {
      return buildPlayerClarificationResponse({
        domain: "daily_boosts",
        requestMessage: message,
        summary: "I need a clearer player name before I can remove that boost.",
        replyText:
          "I can remove that daily boost, but I need the full player name first so I do not clear the wrong slot.",
        prompt: "Send the full player name and I'll queue that boost removal for confirmation.",
        resumeMessageTemplate: "remove {player} from my boosts",
        contextSnapshot: {
          intent: "daily_boost_remove",
          boostDate: resolvedDate.dateStr,
          rawPlayerReference: sanitizeNameFragment(playerMatch[1]),
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: "daily_boost_remove",
          reason: "player_not_resolved",
        },
      });
    }

    warnings = playerResolution.warnings;
    boost = boosts.find((entry) => entry.playerId === playerResolution.player.id);
  }

  if (!boost) {
    return buildUnavailableResponse({
      domain: "daily_boosts",
      requestMessage: message,
      summary: `I could not find a matching active boost for ${resolvedDate.label}.`,
      replyText:
        "There is no matching active daily boost to remove in that window, so I did not stage anything.",
      warnings,
      contextSnapshot: {
        intent: "daily_boost_remove",
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "daily_boost_remove",
        reason: "boost_not_found",
      },
    });
  }

  if (boost.status !== "active") {
    return buildUnavailableResponse({
      domain: "daily_boosts",
      requestMessage: message,
      summary: `That boost is ${boost.status}, so it can no longer be removed.`,
      replyText:
        "That daily boost is no longer active. Once a boost locks, the removal window is gone.",
      warnings,
      contextSnapshot: {
        intent: "daily_boost_remove",
        boostId: boost.id,
        boostDate: resolvedDate.dateStr,
        status: boost.status,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "daily_boost_remove",
        reason: "boost_not_active",
      },
    });
  }

  let gameStartTime: string | null = null;
  if (boost.gameId) {
    const game = await storage.getDailyGameByGameId(boost.gameId);
    if (game) {
      gameStartTime = new Date(game.startTime).toISOString();
    }
    if (game && new Date(game.startTime) <= new Date()) {
      return buildUnavailableResponse({
        domain: "daily_boosts",
        requestMessage: message,
        summary: "That game has already started, so the boost is locked.",
        replyText:
          "That boost is effectively locked because the game has already started, so I did not stage the removal.",
        warnings,
        contextSnapshot: {
          intent: "daily_boost_remove",
          boostId: boost.id,
          boostDate: resolvedDate.dateStr,
          gameId: boost.gameId,
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: "daily_boost_remove",
          reason: "game_started",
        },
      });
    }
  }

  const player = await storage.getPlayer(boost.playerId);
  const playerName = player ? `${player.firstName} ${player.lastName}` : boost.playerId;
  const action: DailyBoostRemoveAction = {
    actionType: "daily_boost_remove",
    boostId: boost.id,
    playerId: boost.playerId,
    playerName,
    sport: boost.sport,
    slotTier: boost.slotTier as 2 | 3 | 4 | 5,
    boostDate: resolvedDate.dateStr,
    gameId: boost.gameId,
    gameStartTime,
    reasoning:
      requestMode === "discussion"
        ? "Previewing the removal of the matching active daily boost."
        : "This stages removal of the matching active daily boost before the lock window closes.",
    confidence: 0.95,
  };

  const summary = `Remove ${playerName} from your ${action.slotTier}x boost slot`;

  return {
    domain: "daily_boosts",
    requestMessage: message,
    replyText:
      requestMode === "discussion"
        ? `${summary}. The boost is still active, so it can be cleared before lock. ${buildStageNudge(requestMode)}`
        : `${summary}. The boost is still active, so I can clear it now. ${buildStageNudge(requestMode)}`,
    summary,
    observations: [`Matched an active ${action.slotTier}x boost for ${playerName}.`],
    warnings: [...warnings, "Once the game starts, active boosts can no longer be removed."],
    actions: requestMode === "commit" ? [action] : [],
    errorMessage: null,
    contextSnapshot: {
      intent: "daily_boost_remove",
      boostId: boost.id,
      playerId: boost.playerId,
      playerName,
      slotTier: boost.slotTier,
      boostDate: resolvedDate.dateStr,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "daily_boost_remove",
      requestMode,
      matchedPattern: slotMatch ? "boost_remove_slot" : "boost_remove_player",
    },
  };
}
