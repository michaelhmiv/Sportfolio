import { dailyBoosts, players } from "@shared/schema";
import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  getBuyQuote,
  getPool,
  getLpPosition,
  getSellQuote,
  getZapAddQuoteSbOnly,
  getZapAddQuoteSharesOnly,
} from "../amm/pool";
import { db } from "../db";
import { getETDayBoundaries, getTodayET } from "../lib/time";
import { storage } from "../storage";
import { loadUserEntitlements } from "../services/user-entitlements";
import type { UserAgentProfile } from "@shared/schema";
import { buildPlayerNameClarification } from "./clarification";
import { getAgentDataSourceSummary } from "./data-sources";
import { resolveInternalMlbMcpConfig, runInternalMlbMcpToolRaw } from "./internal-mlb-mcp";
import { isHostedWebResearchAvailable } from "./research";
import type {
  AgentAnalysisResult,
  AgentDataSourceSummaryView,
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
  ScoutProposalAction,
  WatchlistAddPlayerAction,
  WatchlistRemovePlayerAction,
} from "./types";

const DEFAULT_MAX_SLIPPAGE = 0.05;
const LIQUIDITY_RATIO_TOLERANCE = 0.02;
const DAILY_BOOST_SLOT_COUNT = 4;
const BOOST_SLOT_PRIORITY = [5, 4, 3, 2] as const;
const DEFAULT_ASSUMED_BUY_SB = 25;
const DEFAULT_ASSUMED_SELL_SHARES = 1;
const DEFAULT_ASSUMED_SCOUT_COUNT = 1;
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

type RankedMlbWorkflowSpec = {
  playerCount: number;
  leaderCategory: string;
  leaderLabel: string;
  statGroup: "pitching" | "hitting";
  order: "asc" | "desc";
  slotTiers: Array<2 | 3 | 4 | 5>;
  requiresStack: boolean;
  requiresBoost: boolean;
  season: number;
  resolvedDate: ResolvedDate;
};

type RankedMlbLeaderRow = {
  rank: number | null;
  playerName: string;
  teamName: string | null;
  valueLabel: string | null;
  numericValue: number | null;
};

type CompoundPlanningState = {
  availableBalance: number;
  reservedBoostSlots: Array<2 | 3 | 4 | 5>;
  reservedBoostPlayerIds: string[];
};

type StructuredBuyFollowUpGoal = {
  rawPlayerReference: string;
  requestedShareCount: number | null;
  requestedDollarAmount: number | null;
  buyAssumptionMode:
    | "explicit_dollars"
    | "explicit_shares"
    | "assumed_starter"
    | "assumed_max_safe";
  hasStackIntent: boolean;
  stackOptional: boolean;
  slotTier: 2 | 3 | 4 | 5 | null;
  boostOptional: boolean;
  resolvedDate: ResolvedDate;
};

type StructuredPlannerStatus = "supported" | "unavailable" | "clarification";

type StructuredPlannerEvaluation = {
  status: StructuredPlannerStatus;
  plan: DirectOperationPlan;
  reason: string;
};

type RankedWorkflowCandidateAssessment = {
  rank: number | null;
  leaderboardPlayerName: string;
  playerId: string | null;
  playerName: string | null;
  slotTier: 2 | 3 | 4 | 5 | null;
  provisionalBudget: number;
  status: StructuredPlannerStatus | "skipped";
  reason: string;
  summary: string;
};

type ParsedBuyDirective = {
  rawPlayerReference: string;
  requestedShareCount: number | null;
  requestedDollarAmount: number | null;
  buyAssumptionMode:
    | "explicit_dollars"
    | "explicit_shares"
    | "assumed_starter"
    | "assumed_max_safe";
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeNameFragment(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/\([^)]*\)/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\b(?:my|some|all|remaining|rest)\b/gi, " ")
      .replace(/\b(?:today|tonight|tomorrow|please)\b/gi, " ")
      .replace(/\b(?:stock|shares?|share|pool|player pool|boosts?|boost slot|slot|of)\b/gi, " ")
      .replace(/[.,!?]+$/g, " "),
  );
}

function getPlayerDisplayName(player: typeof players.$inferSelect): string {
  return `${player.firstName} ${player.lastName}`;
}

function getRegularShareCount(
  availableShares: number,
  breakdown: Awaited<ReturnType<typeof storage.getPlayerShareBreakdown>>,
): number {
  return Math.max(
    0,
    Math.min(availableShares, Number.parseFloat(breakdown.regular?.quantity || "0")),
  );
}

function getHighestAvailableShareMultiplier(
  breakdown: Awaited<ReturnType<typeof storage.getPlayerShareBreakdown>>,
): number {
  const stackedMultipliers =
    (breakdown.stacked || [])
      .map((holding) => Number.parseFloat(holding.multiplier || "1"))
      .filter((value) => Number.isFinite(value) && value >= 1) || [];
  return Math.max(1, ...stackedMultipliers);
}

function inferMaxStackableShares(regularShares: number): number | null {
  const maxEvenShares = Math.floor(Math.max(0, regularShares) / 2) * 2;
  return maxEvenShares >= 4 ? maxEvenShares : null;
}

function findHighestOpenBoostSlot(
  currentBoosts: Array<Pick<typeof dailyBoosts.$inferSelect, "slotTier">>,
): 2 | 3 | 4 | 5 | null {
  const occupied = new Set(currentBoosts.map((boost) => Number(boost.slotTier)));
  for (const slotTier of BOOST_SLOT_PRIORITY) {
    if (!occupied.has(slotTier)) {
      return slotTier;
    }
  }

  return null;
}

function parseBuyDirective(message: string): ParsedBuyDirective | null {
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
  const maxBuyMatch =
    parserMessage.match(
      /^(?:buy|buying|purchase|purchasing|get|grab|pick\s+up)\s+as\s+much\s+(.+?)\s+as\s+i\s+can\s+afford$/i,
    ) ||
    parserMessage.match(
      /^(?:buy|buying|purchase|purchasing|get|grab|pick\s+up)\s+as\s+many\s+(.+?)\s+shares?\s+as\s+(?:i\s+can\s+afford|possible)$/i,
    ) ||
    parserMessage.match(
      /^(?:buy|buying|purchase|purchasing|get|grab|pick\s+up)\s+max(?:imum)?\s+shares?\s+(?:of\s+)?(.+?)$/i,
    );
  const bareMatch = parserMessage.match(
    /^(?:buy|buying|purchase|purchasing|get|grab|pick\s+up|start(?:\s+my)?\s+position(?:\s+in)?)\s+(.+?)(?:\s+shares?)?$/i,
  );

  if (amountMatch) {
    return {
      rawPlayerReference: amountMatch[2],
      requestedShareCount: null,
      requestedDollarAmount: Number(amountMatch[1]),
      buyAssumptionMode: "explicit_dollars",
    };
  }

  if (shareMatch) {
    return {
      rawPlayerReference: shareMatch[2],
      requestedShareCount: Number.parseInt(shareMatch[1], 10),
      requestedDollarAmount: null,
      buyAssumptionMode: "explicit_shares",
    };
  }

  if (maxBuyMatch) {
    return {
      rawPlayerReference: maxBuyMatch[1],
      requestedShareCount: null,
      requestedDollarAmount: null,
      buyAssumptionMode: "assumed_max_safe",
    };
  }

  if (bareMatch) {
    return {
      rawPlayerReference: bareMatch[1],
      requestedShareCount: null,
      requestedDollarAmount: null,
      buyAssumptionMode: "assumed_starter",
    };
  }

  return null;
}

function splitCompoundFollowUpClauses(message: string): string[] {
  return message
    .split(
      /(?:,?\s+(?:and then|then|and)\s+(?=(?:stack|put|assign|boost|place|slot|lock)\b)|,\s*(?=(?:stack|put|assign|boost|place|slot|lock)\b))/i,
    )
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function parseStackDirective(
  stackClause: string | null,
  fallbackPlayerReference: string | null,
): {
  mode: "explicit" | "max";
  requestedShares: number | null;
  rawPlayerReference: string | null;
} | null {
  if (!stackClause || !/\bstack(?:\s+shares?)?\b/i.test(stackClause)) {
    return null;
  }

  const explicitOfMatch = stackClause.match(
    /\bstack(?:\s+shares?)?\s+(\d+)\s+shares?\s+of\s+(.+)$/i,
  );
  if (explicitOfMatch) {
    return {
      mode: "explicit",
      requestedShares: Number.parseInt(explicitOfMatch[1], 10),
      rawPlayerReference: sanitizeNameFragment(explicitOfMatch[2]),
    };
  }

  const explicitSuffixMatch = stackClause.match(
    /\bstack(?:\s+shares?)?\s+(\d+)\s+(.+?)\s+shares?\b/i,
  );
  if (explicitSuffixMatch) {
    return {
      mode: "explicit",
      requestedShares: Number.parseInt(explicitSuffixMatch[1], 10),
      rawPlayerReference: sanitizeNameFragment(explicitSuffixMatch[2]),
    };
  }

  const remainderMatch = stackClause.match(
    /\bstack(?:\s+shares?)?\s+(?:the\s+)?(?:rest|remainder|remaining|all(?:\s+of\s+(?:my\s+)?)?|them all)(?:\s+of\s+(.+))?$/i,
  );
  if (remainderMatch) {
    return {
      mode: "max",
      requestedShares: null,
      rawPlayerReference: sanitizeNameFragment(remainderMatch[1] || fallbackPlayerReference || ""),
    };
  }

  const genericNamedMatch = stackClause.match(/\bstack(?:\s+shares?)?\s+(.+)$/i);
  if (genericNamedMatch) {
    return {
      mode: "max",
      requestedShares: null,
      rawPlayerReference: sanitizeNameFragment(genericNamedMatch[1]),
    };
  }

  return fallbackPlayerReference
    ? {
        mode: "max",
        requestedShares: null,
        rawPlayerReference: sanitizeNameFragment(fallbackPlayerReference),
      }
    : null;
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

function roundCurrency(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
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

function parseRequestedPlayerCount(message: string): number | null {
  const numericMatch = message.match(/\b([2-5])\b/);
  if (numericMatch) {
    return Number.parseInt(numericMatch[1], 10);
  }

  const wordLookup: Record<string, number> = {
    two: 2,
    three: 3,
    four: 4,
    five: 5,
  };

  for (const [word, value] of Object.entries(wordLookup)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(message)) {
      return value;
    }
  }

  return null;
}

function parseSlotTiers(message: string): Array<2 | 3 | 4 | 5> {
  return Array.from(message.matchAll(/\b([2345])x\b/gi))
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value): value is 2 | 3 | 4 | 5 => [2, 3, 4, 5].includes(value));
}

function getCurrentSeasonYear(): number {
  const today = getTodayET();
  const parsed = Number.parseInt(today.slice(0, 4), 10);
  return Number.isFinite(parsed) ? parsed : new Date().getFullYear();
}

function parseRankedMlbWorkflowSpec(message: string): RankedMlbWorkflowSpec | null {
  const parserMessage = normalizeOperationalParserMessage(message);
  const lower = parserMessage.toLowerCase();

  if (
    !/\bbuy\b/.test(lower) ||
    !/\b(?:max|as many)\b/.test(lower) ||
    !/\b(?:lowest|highest|top|best)\b/.test(lower)
  ) {
    return null;
  }

  const playerCount = parseRequestedPlayerCount(lower);
  if (!playerCount || playerCount < 2) {
    return null;
  }

  const requiresStack = /\bstack(?:\s+shares?)?\b/.test(lower);
  const requiresBoost = /\b(?:boost|slot)\b/.test(lower);
  if (!requiresStack && !requiresBoost) {
    return null;
  }

  let leaderCategory: string | null = null;
  let leaderLabel: string | null = null;
  let statGroup: "pitching" | "hitting" | null = null;
  let order: "asc" | "desc" | null = null;

  if (/\bpitchers?\b/.test(lower) && /\beras?\b/.test(lower)) {
    leaderCategory = "earnedRunAverage";
    leaderLabel = "ERA";
    statGroup = "pitching";
    order = "asc";
  } else if (/\bpitchers?\b/.test(lower) && /\bwhip\b/.test(lower)) {
    leaderCategory = "whip";
    leaderLabel = "WHIP";
    statGroup = "pitching";
    order = "asc";
  } else if (/\b(?:hitters?|batters?)\b/.test(lower) && /\bobp\b/.test(lower)) {
    leaderCategory = "onBasePercentage";
    leaderLabel = "OBP";
    statGroup = "hitting";
    order = "desc";
  } else if (/\b(?:hitters?|batters?)\b/.test(lower) && /\bops\b/.test(lower)) {
    leaderCategory = "ops";
    leaderLabel = "OPS";
    statGroup = "hitting";
    order = "desc";
  }

  if (!leaderCategory || !leaderLabel || !statGroup || !order) {
    return null;
  }

  const slotTiers = requiresBoost ? parseSlotTiers(lower) : [];
  const explicitSeason = lower.match(/\b(20\d{2})\b/);
  const season = explicitSeason ? Number.parseInt(explicitSeason[1], 10) : getCurrentSeasonYear();

  return {
    playerCount,
    leaderCategory,
    leaderLabel,
    statGroup,
    order,
    slotTiers,
    requiresStack,
    requiresBoost,
    season,
    resolvedDate: resolveDateFromMessage(message),
  };
}

function extractRankedMlbLeaderRows(payload: unknown): RankedMlbLeaderRow[] {
  const rows = Array.isArray(
    (payload as { result?: { leaders?: unknown[] } } | null)?.result?.leaders,
  )
    ? ((payload as { result?: { leaders?: unknown[] } }).result?.leaders as unknown[])
    : [];

  return rows
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 4) {
        return null;
      }

      const rank = Number.parseInt(String(entry[0]), 10);
      const numericValue = Number.parseFloat(String(entry[3]));

      return {
        rank: Number.isFinite(rank) ? rank : null,
        playerName: normalizeWhitespace(String(entry[1] || "")),
        teamName: normalizeWhitespace(String(entry[2] || "")) || null,
        valueLabel: normalizeWhitespace(String(entry[3] || "")) || null,
        numericValue: Number.isFinite(numericValue) ? numericValue : null,
      };
    })
    .filter((entry): entry is RankedMlbLeaderRow => Boolean(entry?.playerName));
}

function allocateEvenBuyBudgets(totalBudget: number, itemCount: number): number[] {
  const safeBudget = roundCurrency(totalBudget);
  if (!Number.isFinite(safeBudget) || safeBudget <= 0 || itemCount <= 0) {
    return [];
  }

  let remaining = safeBudget;
  const budgets: number[] = [];

  for (let index = 0; index < itemCount; index += 1) {
    const remainingItems = itemCount - index;
    const allocation =
      index === itemCount - 1 ? remaining : roundCurrency(remaining / remainingItems);
    budgets.push(allocation);
    remaining = roundCurrency(remaining - allocation);
  }

  if (remaining !== 0 && budgets.length > 0) {
    budgets[budgets.length - 1] = roundCurrency(budgets[budgets.length - 1] + remaining);
  }

  return budgets;
}

function createCompoundPlanningState(availableBalance: number): CompoundPlanningState {
  return {
    availableBalance: roundCurrency(availableBalance),
    reservedBoostSlots: [],
    reservedBoostPlayerIds: [],
  };
}

function applyCompoundPlanningReservation(input: {
  state: CompoundPlanningState;
  goal: StructuredBuyFollowUpGoal;
  playerId: string;
}): CompoundPlanningState {
  const spentAmount = roundCurrency(Math.max(0, input.goal.requestedDollarAmount || 0));

  return {
    availableBalance: roundCurrency(Math.max(0, input.state.availableBalance - spentAmount)),
    reservedBoostSlots:
      input.goal.slotTier != null
        ? [...input.state.reservedBoostSlots, input.goal.slotTier]
        : [...input.state.reservedBoostSlots],
    reservedBoostPlayerIds:
      input.goal.slotTier != null
        ? [...input.state.reservedBoostPlayerIds, input.playerId]
        : [...input.state.reservedBoostPlayerIds],
  };
}

function buildRankedWorkflowSyntheticMessage(input: {
  budget: number;
  playerReference: string;
  slotTier: 2 | 3 | 4 | 5 | null;
  resolvedDate: ResolvedDate;
  requiresStack: boolean;
}): string {
  const parts = [`buy $${input.budget.toFixed(2)} of ${input.playerReference}`];

  if (input.requiresStack) {
    parts.push("stack shares");
  }

  if (input.slotTier != null) {
    parts.push(
      `put ${input.requiresStack ? "that stacked share" : input.playerReference} in my ${input.slotTier}x boost slot ${input.resolvedDate.label}`,
    );
  }

  return parts.join(", and ");
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
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

  const explicitSportHint =
    SUPPORTED_SPORTS.find((sport) => options.message.toUpperCase().includes(sport)) || null;
  const sportHint = explicitSportHint || options.profile.defaultSport || null;
  const conditions = [eq(players.isActive, true)];
  if (explicitSportHint) {
    conditions.push(eq(players.sport, explicitSportHint));
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
    ) ||
    /\b(?:do|does)\s+(?:you|hermes|the agent)\s+(?:have|support)\b.*\b(?:tools?|mcp\s+(?:connections?|tools?)|data sources?)\b/.test(
      lower,
    ) ||
    /\b(?:what|which)\s+(?:tools?|mcp\s+(?:connections?|tools?)|data sources?)\s+(?:do you have|are available)\b/.test(
      lower,
    )
  );
}

function summarizeCapabilityDataSources(dataSources: AgentDataSourceSummaryView | undefined) {
  const builtIn = dataSources?.builtIn[0] || null;
  const enabledExternal = (dataSources?.external || []).filter((source) => source.enabled);
  const disabledExternal = (dataSources?.external || []).filter((source) => !source.enabled);

  return {
    builtIn,
    enabledExternal,
    disabledExternal,
  };
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
  userId: string,
  profile: UserAgentProfile,
  message: string,
  _requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  if (!isCapabilityGuideRequest(message)) {
    return null;
  }

  const webResearchEnabled = isHostedWebResearchAvailable();
  const dataSources = await getAgentDataSourceSummary(userId, profile);
  const { builtIn, enabledExternal, disabledExternal } =
    summarizeCapabilityDataSources(dataSources);
  const builtInSentence = !builtIn
    ? null
    : builtIn.enabled && builtIn.available
      ? "I also have a built-in Hermes-only MLB enrichment connection for in-house MLB stats and leaderboard context."
      : builtIn.enabled
        ? "The built-in Hermes-only MLB enrichment connection exists in Configure, but it is currently unavailable."
        : "The built-in Hermes-only MLB enrichment connection is available in Configure, but it is currently toggled off for this user.";
  const externalSentence =
    enabledExternal.length > 0
      ? `You also have ${enabledExternal.length} enabled external MCP source${enabledExternal.length === 1 ? "" : "s"}: ${enabledExternal.map((source) => source.name).join(", ")}. Hermes treats those as optional external context, not canonical Sportfolio state.`
      : disabledExternal.length > 0
        ? `You have ${disabledExternal.length} external MCP source${disabledExternal.length === 1 ? "" : "s"} saved, but none are enabled right now.`
        : "You do not have any enabled external MCP sources connected right now.";

  return {
    domain: "sportfolio",
    requestMessage: message,
    replyText: [
      "I can operate across the main user-facing Sportfolio loops: scouting, player-pool buys and sells, liquidity adds and removals, zaps, stack-shares / multiplier flows, daily boosts, watchlists, and community boosts.",
      "For account and gameplay state, I use native Sportfolio tools first.",
      builtInSentence,
      externalSentence,
      webResearchEnabled
        ? "I can also pull current outside context through the hosted Brave search path when you ask for latest news, injuries, or other time-sensitive external info."
        : null,
      "For any live mutation, I still stage the move first and wait for your confirmation before execution.",
    ]
      .filter(Boolean)
      .join(" "),
    summary:
      "Broad operator coverage across scouting, markets, boosts, watchlists, and community boosts.",
    observations: [
      "Direct commands stage confirmation-gated actions instead of executing immediately.",
      "Broad advisory asks can return a cross-domain setup read before any plan is queued.",
      builtIn
        ? builtIn.enabled && builtIn.available
          ? `${builtIn.name} is enabled as a built-in Hermes data source.`
          : `${builtIn.name} is not currently available for this user.`
        : "No built-in data source metadata is available.",
      enabledExternal.length > 0
        ? `${enabledExternal.length} external MCP source${enabledExternal.length === 1 ? "" : "s"} enabled.`
        : "No external MCP sources are enabled.",
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
      dataSources,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "capability_guide",
      webResearchEnabled,
      dataSources,
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
  const stackReadyRows = sortedHoldings.filter((entry: any) => {
    const quantity = parseNumericString(entry?.holding?.quantity);

    return !entry?.holding?.isStackedShare && quantity >= 4;
  });
  const smallRows = sortedHoldings.filter((entry: any) => {
    const quantity = parseNumericString(entry?.holding?.quantity);

    return !entry?.holding?.isStackedShare && quantity === 1;
  });
  const activeBoostCount = activeBoosts.filter((boost) => boost.status !== "cancelled").length;
  const cleanupLevers: string[] = [];

  if (leadConcentrationPercent >= 45) {
    cleanupLevers.push(
      `your biggest concentration is ${leadHolding.player.firstName} ${leadHolding.player.lastName} at roughly ${leadConcentrationPercent}% of visible shares`,
    );
  }
  if (stackReadyRows.length > 0) {
    cleanupLevers.push(
      `${stackReadyRows.length} raw holding row${stackReadyRows.length === 1 ? "" : "s"} can be stacked into stacked-share multipliers`,
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
      stackReadyRows.length > 0
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
      `${stackReadyRows.length} raw holding row${stackReadyRows.length === 1 ? "" : "s"} can be stacked right now.`,
      `${activeBoostCount} daily boost slot${activeBoostCount === 1 ? "" : "s"} are currently active today.`,
      `${smallRows.length} one-share row${smallRows.length === 1 ? "" : "s"} are sitting as small unstacked positions.`,
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
      stackReadyRows: stackReadyRows.length,
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
    userState,
    totalScouts,
    availableBalance,
    holdingsWithPlayers,
    watchlists,
    communitySharesAvailable,
    activeBoosts,
  ] = await Promise.all([
    loadUserEntitlements(storage, userId),
    storage.getTotalScoutsForUser(userId),
    storage.getAvailableBalance(userId),
    storage.getUserHoldingsWithPlayers(userId),
    storage.getWatchlists(userId),
    storage.getUserCommunityBoostShares(userId),
    storage.getDailyBoostsAllSports(userId, new Date()),
  ]);

  if (!userState) {
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
  const stackedRows = playerHoldings.filter((entry: any) =>
    Boolean(entry?.holding?.isStackedShare),
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
  const maxScouts = userState.entitlements.maxScouts;
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
      `${stackedRows} stacked holding row${stackedRows === 1 ? "" : "s"} currently give you boosted-share flexibility.`,
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

  const pool = await getPool(playerId);
  if (!pool) {
    return null;
  }
  const currentPrice = Number(
    (pool && "currentPrice" in pool ? pool.currentPrice : null) ||
      (pool && "playMoney" in pool && "shares" in pool && Number(pool.shares) > 0
        ? Number(pool.playMoney) / Number(pool.shares)
        : 0),
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

async function estimateMaxBuySpendWithinSlippage(
  playerId: string,
  maxBudget: number,
  maxSlippage = DEFAULT_MAX_SLIPPAGE,
) {
  const cappedBudget = roundCurrency(maxBudget);
  if (!Number.isFinite(cappedBudget) || cappedBudget < 0.01) {
    return null;
  }

  let low = 0.01;
  let high = cappedBudget;
  let bestAmount = 0;
  let bestQuote: Awaited<ReturnType<typeof getBuyQuote>> | null = null;

  const lowQuote = await getBuyQuote(playerId, low);
  if (!lowQuote || lowQuote.slippagePercent > maxSlippage) {
    return null;
  }

  bestAmount = low;
  bestQuote = lowQuote;

  const highQuote = await getBuyQuote(playerId, high);
  if (highQuote && highQuote.slippagePercent <= maxSlippage) {
    return {
      sbAmount: high,
      quote: highQuote,
      roundedSharesOut: Math.floor(highQuote.sharesOut),
    };
  }

  for (let iteration = 0; iteration < 20; iteration += 1) {
    const mid = roundCurrency((low + high) / 2);
    const quote = await getBuyQuote(playerId, mid);
    if (!quote) {
      high = mid;
      continue;
    }

    if (quote.slippagePercent <= maxSlippage) {
      bestAmount = mid;
      bestQuote = quote;
      low = mid;
    } else {
      high = mid;
    }
  }

  if (!bestQuote) {
    return null;
  }

  return {
    sbAmount: roundCurrency(bestAmount),
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

async function buildBuyStackBoostWorkflowPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const parserMessage = normalizeOperationalParserMessage(message);
  const hasStackIntent = /\b(?:stack(?:\s+shares?)?|stacking)\b/i.test(parserMessage);
  const slotMatch = parserMessage.match(/\b([2345])x\s+(?:daily\s+)?boost\s+slot\b/i);
  const buyMatch =
    parserMessage.match(/\b(?:buy|buying|get|grab|pick\s+up)\s+(\d+)\s+(.+?)\s+shares?\b/i) ||
    parserMessage.match(
      /\b(?:buy|buying|get|grab|pick\s+up)\s+(\d+)\s+shares?\s+of\s+(.+?)(?:\s+for\s+tomorrow|\s+for\s+today|\s+today|\s+tomorrow|$)/i,
    );

  if (!hasStackIntent || !slotMatch || !buyMatch) {
    return null;
  }

  const desiredShares = Number.parseInt(buyMatch[1], 10);
  if (!Number.isFinite(desiredShares) || desiredShares < 4) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: "I need at least 4 shares to stack them into a multiplier first.",
      replyText:
        "Stacking only works if at least 4 regular shares are being combined first, so I did not stage that workflow.",
      contextSnapshot: {
        intent: "buy_stack_boost",
        desiredShares,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_stack_boost",
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
        "I can stage the buy, stack-shares, and boost sequence, but I need the full player name first so I do not hit the wrong player.",
      prompt:
        "I can queue the full buy, stack-shares, and boost sequence as soon as you give me the full player name.",
      resumeMessageTemplate: `buy ${desiredShares} {player} shares, stack them all and put that stacked share into my ${slotTier}x boost slot ${resolvedDate.label}`,
      workflowTitle: "Build the buy, stack, and boost workflow",
      workflowPreviewSteps: [
        `Buy ${desiredShares} shares`,
        "Stack the new position",
        `Assign the top stacked share to the ${slotTier}x boost slot`,
      ],
      contextSnapshot: {
        intent: "buy_stack_boost",
        desiredShares,
        rawPlayerReference: sanitizeNameFragment(buyMatch[2]),
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_stack_boost",
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
        "That market is not giving me a reliable buy estimate right now, so I did not stage the full stack-and-boost workflow.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "buy_stack_boost",
        playerId: player.id,
        desiredShares,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_stack_boost",
        reason: "buy_estimate_unavailable",
      },
    });
  }

  if (estimate.quote.slippagePercent > DEFAULT_MAX_SLIPPAGE) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `That workflow would currently quote at about ${formatNumber(
        estimate.quote.slippagePercent * 100,
      )}% slippage, which is above the ${formatNumber(DEFAULT_MAX_SLIPPAGE * 100)}% execution guard.`,
      replyText:
        "That buy size is too large for the current pool depth to stage safely. Lower the share target or use a smaller buy size and I can rebuild the workflow.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "buy_stack_boost",
        playerId: player.id,
        desiredShares,
        estimatedSpend: estimate.sbAmount,
        estimatedSlippagePercent: estimate.quote.slippagePercent * 100,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_stack_boost",
        reason: "quote_slippage_too_high",
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
      )}, so I did not queue the buy-stack-boost workflow.`,
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "buy_stack_boost",
        playerId: player.id,
        desiredShares,
        estimatedSpend: estimate.sbAmount,
        availableBalance,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_stack_boost",
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
        intent: "buy_stack_boost",
        playerId: player.id,
        slotTier,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_stack_boost",
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
        intent: "buy_stack_boost",
        playerId: player.id,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_stack_boost",
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
        "I can buy and stack the shares, but I cannot finish the boost step because that player does not have a game in the requested window.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "buy_stack_boost",
        playerId: player.id,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_stack_boost",
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
        "That boost window is already closed because the game has started, so I did not stage the buy-stack-boost sequence.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "buy_stack_boost",
        playerId: player.id,
        boostDate: resolvedDate.dateStr,
        gameId: game.gameId,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "buy_stack_boost",
        reason: "game_started",
      },
    });
  }

  const stackableShares = desiredShares < 4 ? 0 : Math.max(0, desiredShares - (desiredShares % 2));
  const leftoverShares = desiredShares - stackableShares;
  const expectedMultiplierGained = stackableShares / 2;
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
      actionType: "holdings_stack_shares" as const,
      playerId: player.id,
      playerName: `${player.firstName} ${player.lastName}`,
      sharesToStack: stackableShares,
      expectedMultiplierGained,
      expectedStackedShareCount: 1,
      reasoning:
        leftoverShares > 0
          ? `Stack ${stackableShares} of the bought shares into 1 stacked share and leave ${leftoverShares} regular share${leftoverShares === 1 ? "" : "s"} unstacked.`
          : `Stack all ${stackableShares} bought shares into 1 stacked share.`,
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
      reasoning: `Use the highest-multiplier available ${player.firstName} ${player.lastName} share in the ${slotTier}x slot for ${resolvedDate.label}.`,
      confidence: 0.94,
    },
  ];

  const warnings = [
    ...playerResolution.warnings,
    "This is a 3-step workflow: the boost only happens after the buy and stack-shares steps succeed.",
  ];
  if (leftoverShares > 0) {
    warnings.push(
      `${leftoverShares} share${leftoverShares === 1 ? "" : "s"} would remain regular because Stack Shares only works on even share counts in the current system.`,
    );
  }

  const summary = `Buy ${desiredShares} ${player.firstName} ${player.lastName} shares, stack the position, then use the stacked share in your ${slotTier}x boost slot for ${resolvedDate.label}`;

  return {
    domain: "sportfolio",
    requestMessage: message,
    replyText:
      requestMode === "discussion"
        ? `${summary}. That would cost about ${formatMoney(estimate.sbAmount)} at current depth, create 1 stacked share at ${formatNumber(
            expectedMultiplierGained,
            2,
          )}x, and line up ${player.firstName} ${player.lastName} ${opponent} in your ${slotTier}x slot. ${buildStageNudge(requestMode)}`
        : `${summary}. I staged it as a 3-step workflow: buy about ${formatMoney(
            estimate.sbAmount,
          )}, stack ${stackableShares} shares into 1 stacked share, then slot that share into ${slotTier}x for ${resolvedDate.label}. ${buildStageNudge(
            requestMode,
          )}`,
    summary,
    observations: [
      `Estimated spend: ${formatMoney(estimate.sbAmount)} for about ${estimate.roundedSharesOut} shares at current pool depth.`,
      `Expected stacked-share multiplier after stacking: ${formatNumber(expectedMultiplierGained, 2)}x.`,
      `${player.firstName} ${player.lastName} is scheduled ${opponent} at ${new Date(game.startTime).toLocaleString()}.`,
    ],
    warnings,
    actions: requestMode === "commit" ? actions : [],
    errorMessage: null,
    contextSnapshot: {
      intent: "buy_stack_boost",
      playerId: player.id,
      desiredShares,
      stackableShares,
      slotTier,
      boostDate: resolvedDate.dateStr,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "buy_stack_boost",
      requestMode,
      actionTypes: actions.map((action) => action.actionType),
    },
  };
}

async function buildBuyFollowUpWorkflowPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const goal = parseStructuredBuyFollowUpGoal(message);
  if (!goal) {
    return null;
  }

  const evaluation = await evaluateStructuredBuyFollowUpWorkflow({
    userId,
    profile,
    requestMessage: message,
    goal,
    requestMode,
  });

  return evaluation.plan;
}

function parseStructuredBuyFollowUpGoal(message: string): StructuredBuyFollowUpGoal | null {
  const parserMessage = normalizeOperationalParserMessage(message);
  const buySegment = parserMessage
    .split(
      /(?:,?\s+(?:and then|then|and)\s+(?=(?:stack|put|assign|boost|place|slot|lock)\b)|,\s*(?=(?:stack|put|assign|boost|place|slot|lock)\b))/i,
    )[0]
    ?.trim();
  const hasStackIntent = /\bstack(?:\s+shares?)?\b/i.test(parserMessage);
  const stackOptional = hasStackIntent && /\bif possible\b/i.test(parserMessage);
  const slotMatch = parserMessage.match(/\b([2345])x\s+(?:daily\s+)?boost\s+slot\b/i);
  const boostOptional = Boolean(slotMatch) && /\bif eligible\b/i.test(parserMessage);

  if (!hasStackIntent && !slotMatch) {
    return null;
  }
  const buyDirective = buySegment ? parseBuyDirective(buySegment) : null;
  if (!buyDirective) {
    return null;
  }

  return {
    requestedShareCount: buyDirective.requestedShareCount,
    requestedDollarAmount: buyDirective.requestedDollarAmount,
    rawPlayerReference: buyDirective.rawPlayerReference,
    buyAssumptionMode: buyDirective.buyAssumptionMode,
    hasStackIntent,
    stackOptional,
    slotTier: slotMatch ? (Number(slotMatch[1]) as 2 | 3 | 4 | 5) : null,
    boostOptional,
    resolvedDate: resolveDateFromMessage(message),
  };
}

async function evaluateStructuredBuyFollowUpWorkflow(input: {
  userId: string;
  profile: UserAgentProfile;
  requestMessage: string;
  goal: StructuredBuyFollowUpGoal;
  requestMode: "discussion" | "commit";
  resolvedPlayer?: ResolvedPlayer | null;
  planningState?: CompoundPlanningState | null;
}): Promise<StructuredPlannerEvaluation> {
  const {
    userId,
    profile,
    requestMessage,
    goal,
    requestMode,
    resolvedPlayer,
    planningState = null,
  } = input;
  const {
    requestedShareCount,
    requestedDollarAmount,
    rawPlayerReference,
    buyAssumptionMode,
    hasStackIntent,
    stackOptional,
    slotTier,
    boostOptional,
    resolvedDate,
  } = goal;

  const playerResolution =
    resolvedPlayer ||
    (await resolvePlayerByReference(rawPlayerReference, { message: requestMessage, profile }));

  if (!playerResolution) {
    const workflowSteps = [
      requestedShareCount != null
        ? `Buy ${requestedShareCount} shares`
        : `Buy ${formatMoney(requestedDollarAmount || 0)}`,
      ...(hasStackIntent ? ["Stack the resulting position if possible"] : []),
      ...(slotTier != null ? [`Use the resulting share in your ${slotTier}x boost slot`] : []),
    ];

    return {
      status: "clarification",
      reason: "player_not_resolved",
      plan: buildPlayerClarificationResponse({
        domain: "sportfolio",
        requestMessage,
        summary: "I need the full player name before I can stage that workflow.",
        replyText:
          "I can stage that buy workflow, but I need the full player name first so I do not target the wrong player.",
        prompt: "Send the full player name and I'll queue that workflow for confirmation.",
        resumeMessageTemplate:
          requestedShareCount != null
            ? `buy ${requestedShareCount} {player} shares${hasStackIntent ? ", stack shares if possible" : ""}${slotTier != null ? ` and put ${hasStackIntent ? "that stacked share" : "{player}"} in my ${slotTier}x boost slot ${resolvedDate.label}` : ""}`
            : `buy $${requestedDollarAmount} of {player}${hasStackIntent ? ", stack shares if possible" : ""}${slotTier != null ? ` and put ${hasStackIntent ? "that stacked share" : "{player}"} in my ${slotTier}x boost slot ${resolvedDate.label}` : ""}`,
        workflowTitle:
          slotTier != null
            ? "Build the buy and boost workflow"
            : "Build the buy and stack workflow",
        workflowPreviewSteps: workflowSteps,
        contextSnapshot: {
          intent: "buy_follow_up_workflow",
          requestedShareCount,
          requestedDollarAmount,
          slotTier,
          rawPlayerReference: sanitizeNameFragment(rawPlayerReference),
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: "buy_follow_up_workflow",
          reason: "player_not_resolved",
        },
      }),
    };
  }

  const player = playerResolution.player;
  const rawAvailableBalance = planningState
    ? planningState.availableBalance
    : await storage.getAvailableBalance(userId);
  const availableBalance = roundCurrency(Number(rawAvailableBalance || 0));
  const assumedBuyTarget =
    buyAssumptionMode === "assumed_max_safe"
      ? availableBalance
      : Math.min(DEFAULT_ASSUMED_BUY_SB, availableBalance);
  const assumedBuyEstimate =
    requestedDollarAmount == null && requestedShareCount == null
      ? await estimateMaxBuySpendWithinSlippage(player.id, assumedBuyTarget)
      : null;
  const estimatedShareSpend =
    requestedDollarAmount == null && requestedShareCount != null
      ? await estimateSpendForTargetShares(player.id, requestedShareCount)
      : null;
  const sbAmount =
    requestedDollarAmount ??
    (estimatedShareSpend
      ? estimatedShareSpend.sbAmount
      : (assumedBuyEstimate?.sbAmount ?? Number.NaN));
  const quote =
    requestedDollarAmount != null
      ? await getBuyQuote(player.id, sbAmount)
      : estimatedShareSpend?.quote || assumedBuyEstimate?.quote || null;

  if (requestedDollarAmount == null && requestedShareCount == null && !assumedBuyEstimate) {
    return {
      status: "unavailable",
      reason: "buy_assumption_unavailable",
      plan: buildUnavailableResponse({
        domain: "sportfolio",
        requestMessage,
        summary:
          availableBalance <= 0
            ? "You do not have any available balance to open that position right now."
            : `I could not find a safe assumed buy size for ${player.firstName} ${player.lastName} at the current pool depth.`,
        replyText:
          availableBalance <= 0
            ? "I understood that as a buy request, but you do not have available balance to stage it right now."
            : "I understood that as a buy request, but even the assumed size would not clear the current slippage guard, so I did not stage it.",
        warnings: playerResolution.warnings,
        contextSnapshot: {
          intent: "buy_follow_up_workflow",
          playerId: player.id,
          buyAssumptionMode,
          availableBalance,
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: "buy_follow_up_workflow",
          reason: "buy_assumption_unavailable",
        },
      }),
    };
  }

  if (!quote) {
    return {
      status: "unavailable",
      reason: "quote_unavailable",
      plan: buildUnavailableResponse({
        domain: "sportfolio",
        requestMessage,
        summary: `I could not quote a buy for ${player.firstName} ${player.lastName} right now.`,
        replyText:
          "That player pool is not returning a usable buy quote right now, so I did not stage the workflow.",
        warnings: playerResolution.warnings,
        contextSnapshot: {
          intent: "buy_follow_up_workflow",
          playerId: player.id,
          requestedShareCount,
          requestedDollarAmount,
          buyAssumptionMode,
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: "buy_follow_up_workflow",
          reason: "quote_unavailable",
        },
      }),
    };
  }

  if (quote.slippagePercent > DEFAULT_MAX_SLIPPAGE) {
    return {
      status: "unavailable",
      reason: "quote_slippage_too_high",
      plan: buildUnavailableResponse({
        domain: "sportfolio",
        requestMessage,
        summary: `That workflow would currently quote at about ${formatNumber(
          quote.slippagePercent * 100,
        )}% slippage, which is above the ${formatNumber(DEFAULT_MAX_SLIPPAGE * 100)}% execution guard.`,
        replyText:
          "That buy size is too large for the current pool depth to stage safely. Lower the size and I can rebuild the workflow.",
        warnings: playerResolution.warnings,
        contextSnapshot: {
          intent: "buy_follow_up_workflow",
          playerId: player.id,
          requestedShareCount,
          requestedDollarAmount,
          buyAssumptionMode,
          estimatedSlippagePercent: quote.slippagePercent * 100,
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: "buy_follow_up_workflow",
          reason: "quote_slippage_too_high",
        },
      }),
    };
  }

  const [availableShares, breakdown, currentBoosts, game, currentOpenBoostWindowShares] =
    await Promise.all([
      storage.getAvailableShares(userId, "player", player.id),
      storage.getPlayerShareBreakdown(userId, player.id),
      slotTier != null ? storage.getDailyBoosts(userId, player.sport, resolvedDate.targetDate) : [],
      slotTier != null
        ? storage.getPlayerGameForDate(player.id, player.sport, resolvedDate.targetDate)
        : null,
      slotTier != null ? storage.getAvailableShares(userId, "player", player.id) : 0,
    ]);
  const reservedBoostSlots = new Set(planningState?.reservedBoostSlots || []);
  const reservedBoostPlayerIds = new Set(planningState?.reservedBoostPlayerIds || []);

  if (availableBalance < sbAmount) {
    return {
      status: "unavailable",
      reason: "insufficient_balance",
      plan: buildUnavailableResponse({
        domain: "sportfolio",
        requestMessage,
        summary: `That workflow needs ${formatMoney(sbAmount)}, but you only have ${formatMoney(availableBalance)} available.`,
        replyText: `That buy step needs ${formatMoney(sbAmount)}, but you currently have ${formatMoney(
          availableBalance,
        )} available, so I did not queue the rest of the workflow.`,
        warnings: playerResolution.warnings,
        contextSnapshot: {
          intent: "buy_follow_up_workflow",
          playerId: player.id,
          sbAmount,
          availableBalance,
          planningState,
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: "buy_follow_up_workflow",
          reason: "insufficient_balance",
        },
      }),
    };
  }

  const estimatedWholeShares =
    requestedShareCount != null
      ? (estimatedShareSpend?.roundedSharesOut ?? requestedShareCount)
      : Math.floor(quote.sharesOut);
  const currentRegularShares = getRegularShareCount(availableShares, breakdown);
  const projectedAvailableShares = availableShares + Math.max(estimatedWholeShares, 0);
  const projectedRegularShares = currentRegularShares + Math.max(estimatedWholeShares, 0);
  const stackableShares = Math.floor(projectedRegularShares / 2) * 2;
  const canStageStack = hasStackIntent && stackableShares >= 4;

  if (hasStackIntent && !stackOptional && !canStageStack) {
    return {
      status: "unavailable",
      reason: "insufficient_post_buy_regular_shares",
      plan: buildUnavailableResponse({
        domain: "sportfolio",
        requestMessage,
        summary: `That workflow would only leave about ${projectedRegularShares} regular shares available, which is not enough to stack cleanly.`,
        replyText:
          "Stack Shares needs at least 4 regular shares after the buy lands, and the current projected position is below that threshold.",
        warnings: playerResolution.warnings,
        contextSnapshot: {
          intent: "buy_then_stack",
          playerId: player.id,
          projectedRegularShares,
          estimatedWholeShares,
          planningState,
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: "buy_then_stack",
          reason: "insufficient_post_buy_regular_shares",
        },
      }),
    };
  }

  const warnings = [
    ...playerResolution.warnings,
    "The later steps in this workflow only execute after the earlier ones succeed on confirmation.",
  ];
  if (buyAssumptionMode === "assumed_starter") {
    warnings.push(
      `I assumed you wanted a starter buy and sized it to ${formatMoney(sbAmount)} under the current slippage guard.`,
    );
  } else if (buyAssumptionMode === "assumed_max_safe") {
    warnings.push(
      "I assumed you wanted the largest safe buy size the remaining balance and current pool depth allow.",
    );
  }
  const observations = [
    `Buy step estimates ${formatNumber(
      requestedShareCount != null && estimatedShareSpend
        ? estimatedShareSpend.roundedSharesOut
        : (assumedBuyEstimate?.roundedSharesOut ?? quote.sharesOut),
      4,
    )} share(s) at about ${formatMoney(quote.effectivePrice)} each with ${formatNumber(
      quote.slippagePercent * 100,
    )}% slippage.`,
  ];

  const actions: AgentAnalysisResult["actions"] = [
    {
      actionType: "pool_buy",
      playerId: player.id,
      playerName: `${player.firstName} ${player.lastName}`,
      sbAmount,
      availableBalanceBefore: availableBalance,
      availableBalanceAfter: roundCurrency(Math.max(0, availableBalance - sbAmount)),
      maxSlippage: DEFAULT_MAX_SLIPPAGE,
      estimatedSharesOut: quote.sharesOut,
      estimatedPricePerShare: quote.effectivePrice,
      estimatedSlippagePercent: quote.slippagePercent * 100,
      reasoning:
        requestMode === "discussion"
          ? "Previewing the opening buy step before the rest of the workflow."
          : "This stages the requested buy step before any follow-up stack or boost action.",
      confidence: 0.94,
    },
  ];

  let compoundIntent: "buy_then_boost" | "buy_then_stack" | "buy_then_stack_then_boost" =
    slotTier != null && canStageStack
      ? "buy_then_stack_then_boost"
      : slotTier != null
        ? "buy_then_boost"
        : "buy_then_stack";

  if (canStageStack) {
    actions.push({
      actionType: "holdings_stack_shares",
      playerId: player.id,
      playerName: `${player.firstName} ${player.lastName}`,
      sharesToStack: stackableShares,
      expectedMultiplierGained: stackableShares / 2,
      expectedStackedShareCount: 1,
      reasoning:
        stackableShares === projectedRegularShares
          ? `Stack ${stackableShares} projected regular shares into 1 stacked share.`
          : `Stack ${stackableShares} projected regular shares into 1 stacked share and leave ${projectedRegularShares - stackableShares} regular share${projectedRegularShares - stackableShares === 1 ? "" : "s"} unstacked.`,
      confidence: 0.92,
    });
    observations.push(
      `Projected post-buy regular shares let you stack ${stackableShares} into 1 share at ${formatNumber(
        stackableShares / 2,
        2,
      )}x.`,
    );
  } else if (hasStackIntent) {
    warnings.push(
      "I kept the stack step out of the staged bundle because the projected post-buy regular share count is still below 4.",
    );
    compoundIntent = slotTier != null ? "buy_then_boost" : "buy_then_stack";
  }

  let boostSkippedReason: string | null = null;
  if (slotTier != null) {
    const actualOccupiedSlots = new Set(
      currentBoosts
        .map((boost) => boost.slotTier)
        .filter((value): value is 2 | 3 | 4 | 5 => [2, 3, 4, 5].includes(value as 2 | 3 | 4 | 5)),
    );
    const occupiedSlotCount = new Set([...actualOccupiedSlots, ...reservedBoostSlots]).size;

    if (actualOccupiedSlots.has(slotTier) || reservedBoostSlots.has(slotTier)) {
      boostSkippedReason = `Your ${slotTier}x slot is already filled for ${resolvedDate.label}.`;
    } else if (
      currentBoosts.some((boost) => boost.playerId === player.id) ||
      reservedBoostPlayerIds.has(player.id)
    ) {
      boostSkippedReason = `${player.firstName} ${player.lastName} is already boosted for ${resolvedDate.label}.`;
    } else if (occupiedSlotCount >= DAILY_BOOST_SLOT_COUNT) {
      boostSkippedReason = `All four boost slots are already filled for ${resolvedDate.label}.`;
    } else if (!game) {
      boostSkippedReason = `${player.firstName} ${player.lastName} does not have a ${resolvedDate.label} game in scope.`;
    } else if (new Date(game.startTime) <= new Date()) {
      boostSkippedReason = `${player.firstName} ${player.lastName}'s game has already started.`;
    } else if (Math.max(currentOpenBoostWindowShares, projectedAvailableShares) < 1) {
      boostSkippedReason =
        "The projected workflow would not leave an available share for the boost step.";
    }

    if (boostSkippedReason) {
      if (!boostOptional) {
        return {
          status: "unavailable",
          reason: "boost_step_unavailable",
          plan: buildUnavailableResponse({
            domain: "sportfolio",
            requestMessage,
            summary: boostSkippedReason,
            replyText: `${boostSkippedReason} I did not stage a partial workflow because the boost step was part of the explicit request.`,
            warnings,
            contextSnapshot: {
              intent: compoundIntent,
              playerId: player.id,
              slotTier,
              boostDate: resolvedDate.dateStr,
              planningState,
            },
            trace: {
              framework: "deterministic-agent-operations",
              intent: compoundIntent,
              reason: "boost_step_unavailable",
            },
          }),
        };
      }

      warnings.push(`I skipped the boost step because ${boostSkippedReason.toLowerCase()}`);
    } else {
      const existingBestMultiplier = getHighestAvailableShareMultiplier(breakdown);
      const projectedMultiplier = canStageStack
        ? stackableShares / 2
        : projectedAvailableShares >= 1
          ? existingBestMultiplier
          : 1;
      const opponent =
        game!.homeTeam === player.team ? `vs ${game!.awayTeam}` : `@ ${game!.homeTeam}`;

      actions.push({
        actionType: "daily_boost_assign",
        playerId: player.id,
        playerName: `${player.firstName} ${player.lastName}`,
        sport: player.sport,
        slotTier,
        sharesEntered: 1,
        boostDate: resolvedDate.dateStr,
        gameId: game!.gameId,
        gameStartTime: new Date(game!.startTime).toISOString(),
        opponent,
        availableShares: Math.max(currentOpenBoostWindowShares, projectedAvailableShares),
        shareMultiplier: projectedMultiplier,
        reasoning: canStageStack
          ? `Use the newly stacked ${formatNumber(projectedMultiplier, 2)}x share in the ${slotTier}x slot after the buy and stack steps succeed.`
          : `Use the bought share in the ${slotTier}x slot after the buy step succeeds.`,
        confidence: 0.94,
      });
      observations.push(
        `${player.firstName} ${player.lastName} is scheduled ${opponent} at ${new Date(
          game!.startTime,
        ).toLocaleString()}.`,
      );
      observations.push(
        `Projected boost share multiplier: ${formatNumber(projectedMultiplier, 2)}x.`,
      );
    }
  }

  const summaryParts = [
    `Buy ${formatMoney(sbAmount)} of ${player.firstName} ${player.lastName}`,
    ...(canStageStack ? ["stack the resulting regular shares"] : []),
    ...(slotTier != null && !boostSkippedReason
      ? [`use the resulting share in your ${slotTier}x boost slot for ${resolvedDate.label}`]
      : []),
  ];
  const summary = summaryParts.join(", then ");
  const replyText =
    requestMode === "discussion"
      ? `${summary}. ${buildStageNudge(requestMode)}`
      : `${summary}. I staged the workflow in execution order so the later steps only run after the earlier ones succeed. ${buildStageNudge(
          requestMode,
        )}`;

  if (requestedShareCount != null && estimatedShareSpend) {
    warnings.push(
      `The buy step stages by spend and currently projects about ${estimatedShareSpend.roundedSharesOut} whole shares from the requested ${requestedShareCount}-share target.`,
    );
  } else if (buyAssumptionMode === "assumed_starter" || buyAssumptionMode === "assumed_max_safe") {
    observations.push(
      `The buy step used an assumption-driven spend of ${formatMoney(sbAmount)} and currently projects about ${formatNumber(
        assumedBuyEstimate?.roundedSharesOut ?? quote.sharesOut,
        0,
      )} whole shares.`,
    );
  }

  return {
    status: "supported",
    reason: "supported",
    plan: {
      domain: "sportfolio",
      requestMessage,
      replyText,
      summary,
      observations,
      warnings,
      actions: requestMode === "commit" ? actions : [],
      pendingClarification: null,
      errorMessage: null,
      contextSnapshot: {
        intent: compoundIntent,
        playerId: player.id,
        requestedShareCount,
        requestedDollarAmount,
        estimatedWholeShares,
        projectedAvailableShares,
        projectedRegularShares,
        stackableShares: canStageStack ? stackableShares : 0,
        slotTier,
        boostDate: slotTier != null ? resolvedDate.dateStr : null,
        planningState,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: compoundIntent,
        requestMode,
        actionTypes: actions.map((action) => action.actionType),
        planningState,
      },
    },
  };
}

async function buildStackBoostWorkflowPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const parserMessage = normalizeOperationalParserMessage(message);
  const clauses = splitCompoundFollowUpClauses(parserMessage);
  const slotMatch = parserMessage.match(/\b([2345])x\s+(?:daily\s+)?boost\s+slot\b/i);
  if (!slotMatch) {
    return null;
  }

  const stackClause = clauses.find((clause) => /\bstack(?:\s+shares?)?\b/i.test(clause)) || null;
  const stackDirective = parseStackDirective(stackClause, null);
  if (!stackDirective?.rawPlayerReference) {
    return null;
  }

  const playerResolution = await resolvePlayerByReference(stackDirective.rawPlayerReference, {
    message,
    profile,
  });
  const slotTier = Number(slotMatch[1]) as 2 | 3 | 4 | 5;
  const resolvedDate = resolveDateFromMessage(message);

  if (!playerResolution) {
    return buildPlayerClarificationResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: "I need the full player name before I can stage that stack-and-boost workflow.",
      replyText:
        "I can queue the stack and boost sequence, but I need the full player name first so I do not hit the wrong holding.",
      prompt: "Send the full player name and I'll queue that stack and boost workflow.",
      resumeMessageTemplate:
        stackDirective.mode === "explicit" && stackDirective.requestedShares != null
          ? `stack ${stackDirective.requestedShares} shares of {player} and put {player} in my ${slotTier}x boost slot ${resolvedDate.label}`
          : `stack {player} and put {player} in my ${slotTier}x boost slot ${resolvedDate.label}`,
      workflowTitle: "Build the stack and boost workflow",
      workflowPreviewSteps: [
        stackDirective.mode === "explicit" && stackDirective.requestedShares != null
          ? `Stack ${stackDirective.requestedShares} shares`
          : "Stack the available regular shares",
        `Assign the best share to the ${slotTier}x boost slot`,
      ],
      contextSnapshot: {
        intent: "stack_then_boost",
        slotTier,
        rawPlayerReference: stackDirective.rawPlayerReference,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "stack_then_boost",
        reason: "player_not_resolved",
      },
    });
  }

  const player = playerResolution.player;
  const [availableShares, breakdown, currentBoosts, game] = await Promise.all([
    storage.getAvailableShares(userId, "player", player.id),
    storage.getPlayerShareBreakdown(userId, player.id),
    storage.getDailyBoosts(userId, player.sport, resolvedDate.targetDate),
    storage.getPlayerGameForDate(player.id, player.sport, resolvedDate.targetDate),
  ]);
  const currentRegularShares = getRegularShareCount(availableShares, breakdown);
  const requestedShares =
    stackDirective.mode === "explicit" && stackDirective.requestedShares != null
      ? stackDirective.requestedShares
      : inferMaxStackableShares(currentRegularShares);

  if (requestedShares == null || !Number.isFinite(requestedShares)) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `${getPlayerDisplayName(player)} does not have at least 4 regular shares available to stack cleanly.`,
      replyText:
        "Stack Shares needs at least 4 regular shares, so I could not stage the stack-and-boost workflow from the current position.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "stack_then_boost",
        playerId: player.id,
        availableShares,
        currentRegularShares,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "stack_then_boost",
        reason: "insufficient_regular_shares",
      },
    });
  }

  const normalizedShares = requestedShares % 2 === 0 ? requestedShares : requestedShares - 1;
  if (normalizedShares < 4 || currentRegularShares < normalizedShares) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `You only have ${currentRegularShares} regular share${currentRegularShares === 1 ? "" : "s"} available for ${getPlayerDisplayName(player)} right now.`,
      replyText:
        "That stack step needs an even count of at least 4 regular shares, and the current unlocked regular-share count is below that request.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "stack_then_boost",
        playerId: player.id,
        requestedShares,
        normalizedShares,
        currentRegularShares,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "stack_then_boost",
        reason: "requested_stack_exceeds_regular_shares",
      },
    });
  }

  if (currentBoosts.some((boost) => boost.slotTier === slotTier)) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `Your ${slotTier}x slot is already filled for ${resolvedDate.label}.`,
      replyText: `That ${slotTier}x slot is already occupied for ${resolvedDate.label}, so I did not stage a partial workflow.`,
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "stack_then_boost",
        playerId: player.id,
        slotTier,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "stack_then_boost",
        reason: "slot_taken",
      },
    });
  }

  if (currentBoosts.some((boost) => boost.playerId === player.id)) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `${getPlayerDisplayName(player)} is already in one of your boost slots for ${resolvedDate.label}.`,
      replyText:
        "That player is already boosted in the target window, so I did not stage a duplicate stack-and-boost workflow.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "stack_then_boost",
        playerId: player.id,
        slotTier,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "stack_then_boost",
        reason: "player_already_boosted",
      },
    });
  }

  if (!game) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `${getPlayerDisplayName(player)} does not have a ${resolvedDate.label} game in scope.`,
      replyText:
        "That player does not have a game in the target boost window, so I did not stage the stack-and-boost workflow.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "stack_then_boost",
        playerId: player.id,
        slotTier,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "stack_then_boost",
        reason: "no_game",
      },
    });
  }

  if (new Date(game.startTime) <= new Date()) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `${getPlayerDisplayName(player)}'s game has already started.`,
      replyText:
        "That game has already started, so the boost window is closed and I did not stage the stack-and-boost workflow.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "stack_then_boost",
        playerId: player.id,
        slotTier,
        boostDate: resolvedDate.dateStr,
        gameId: game.gameId,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "stack_then_boost",
        reason: "game_started",
      },
    });
  }

  const projectedAvailableShares = availableShares - normalizedShares + 1;
  if (projectedAvailableShares < 1) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: "That workflow would not leave a share available for the boost step.",
      replyText:
        "Stacking that many shares would leave nothing available for the daily boost, so I did not stage the workflow.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "stack_then_boost",
        playerId: player.id,
        requestedShares,
        normalizedShares,
        projectedAvailableShares,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "stack_then_boost",
        reason: "no_share_left_for_boost",
      },
    });
  }

  const projectedMultiplier = Math.max(
    getHighestAvailableShareMultiplier(breakdown),
    normalizedShares / 2,
  );
  const playerName = getPlayerDisplayName(player);
  const opponent = game.homeTeam === player.team ? `vs ${game.awayTeam}` : `@ ${game.homeTeam}`;
  const actions: AgentAnalysisResult["actions"] = [
    {
      actionType: "holdings_stack_shares",
      playerId: player.id,
      playerName,
      sharesToStack: normalizedShares,
      expectedMultiplierGained: normalizedShares / 2,
      expectedStackedShareCount: 1,
      reasoning:
        normalizedShares === currentRegularShares
          ? `Stack ${normalizedShares} regular shares into 1 stacked share before boosting.`
          : `Stack ${normalizedShares} regular shares into 1 stacked share and leave ${currentRegularShares - normalizedShares} regular share${currentRegularShares - normalizedShares === 1 ? "" : "s"} available.`,
      confidence: 0.92,
    },
    {
      actionType: "daily_boost_assign",
      playerId: player.id,
      playerName,
      sport: player.sport,
      slotTier,
      sharesEntered: 1,
      boostDate: resolvedDate.dateStr,
      gameId: game.gameId,
      gameStartTime: new Date(game.startTime).toISOString(),
      opponent,
      availableShares: projectedAvailableShares,
      shareMultiplier: projectedMultiplier,
      reasoning: `Use the best available ${formatNumber(projectedMultiplier, 2)}x share in the ${slotTier}x slot after the stack step succeeds.`,
      confidence: 0.94,
    },
  ];

  const warnings = [...playerResolution.warnings];
  if (normalizedShares !== requestedShares) {
    warnings.push(
      "The stack step was normalized down to an even share count because Stack Shares only accepts even counts.",
    );
  }
  warnings.push("The boost step only runs after the stack step succeeds on confirmation.");

  return {
    domain: "sportfolio",
    requestMessage: message,
    replyText:
      requestMode === "discussion"
        ? `Stack ${normalizedShares} ${playerName} shares, then use the resulting share in your ${slotTier}x boost slot for ${resolvedDate.label}. ${buildStageNudge(
            requestMode,
          )}`
        : `I staged the stack-and-boost workflow for ${playerName}. The boost step only runs after the stack step succeeds. ${buildStageNudge(
            requestMode,
          )}`,
    summary: `Stack ${normalizedShares} shares of ${playerName}, then use the ${slotTier}x boost slot`,
    observations: [
      `Projected stacked share multiplier: ${formatNumber(normalizedShares / 2, 2)}x.`,
      `${playerName} is scheduled ${opponent} at ${new Date(game.startTime).toLocaleString()}.`,
      `Projected boost share multiplier: ${formatNumber(projectedMultiplier, 2)}x.`,
    ],
    warnings,
    actions: requestMode === "commit" ? actions : [],
    errorMessage: null,
    contextSnapshot: {
      intent: "stack_then_boost",
      playerId: player.id,
      sharesToStack: normalizedShares,
      slotTier,
      boostDate: resolvedDate.dateStr,
      projectedAvailableShares,
      projectedMultiplier,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "stack_then_boost",
      requestMode,
      actionTypes: actions.map((action) => action.actionType),
    },
  };
}

async function buildSellFollowUpWorkflowPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const parserMessage = normalizeOperationalParserMessage(message);
  const clauses = splitCompoundFollowUpClauses(parserMessage);
  const sellClause = clauses[0] || "";
  const slotMatch = parserMessage.match(/\b([2345])x\s+(?:daily\s+)?boost\s+slot\b/i);
  const stackClause =
    clauses.find((clause, index) => index > 0 && /\bstack(?:\s+shares?)?\b/i.test(clause)) || null;

  if (!slotMatch && !stackClause) {
    return null;
  }

  const sellMatch = sellClause.match(
    /\b(?:sell|selling|dump|liquidate|trim|trimming|cut|reduce|exit)\s+(\d+(?:\.\d+)?)\s+shares?\s+(?:of\s+)?(.+?)(?:\s+from\s+the\s+pool|\s+from\s+the\s+market|$)/i,
  );
  if (!sellMatch) {
    return null;
  }

  const sharesAmount = Number(sellMatch[1]);
  if (!Number.isInteger(sharesAmount)) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: "Pool sells must use whole shares.",
      replyText:
        "The opening sell step only accepts whole shares right now, so I did not stage the rest of that workflow.",
      contextSnapshot: {
        intent: "sell_follow_up_workflow",
        sharesAmount,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "sell_follow_up_workflow",
        reason: "non_integer_shares",
      },
    });
  }

  const rawPlayerReference = sanitizeNameFragment(sellMatch[2]);
  const playerResolution = await resolvePlayerByReference(rawPlayerReference, { message, profile });
  const slotTier = slotMatch ? (Number(slotMatch[1]) as 2 | 3 | 4 | 5) : null;
  const resolvedDate = resolveDateFromMessage(message);

  if (!playerResolution) {
    return buildPlayerClarificationResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: "I need the full player name before I can stage that sell workflow.",
      replyText:
        "I can queue the sell workflow, but I need the full player name first so I do not target the wrong holding.",
      prompt: "Send the full player name and I'll queue that sell workflow.",
      resumeMessageTemplate:
        slotTier != null
          ? `sell ${sharesAmount} shares of {player}, then put {player} in my ${slotTier}x boost slot ${resolvedDate.label}`
          : `sell ${sharesAmount} shares of {player}, then stack the rest`,
      workflowTitle: "Build the sell workflow",
      workflowPreviewSteps: [
        `Sell ${sharesAmount} share${sharesAmount === 1 ? "" : "s"}`,
        ...(stackClause ? ["Stack the remaining regular shares"] : []),
        ...(slotTier != null ? [`Use the remaining share in the ${slotTier}x boost slot`] : []),
      ],
      contextSnapshot: {
        intent: "sell_follow_up_workflow",
        rawPlayerReference,
        sharesAmount,
        slotTier,
        boostDate: slotTier != null ? resolvedDate.dateStr : null,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "sell_follow_up_workflow",
        reason: "player_not_resolved",
      },
    });
  }

  const stackDirective = parseStackDirective(stackClause, rawPlayerReference);
  const player = playerResolution.player;
  const pool = await getPool(player.id);
  if (!pool) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `I could not quote a sale for ${getPlayerDisplayName(player)} yet because the pool is not initialized.`,
      replyText:
        "That player does not have an active pool yet, so sell quotes are unavailable until liquidity is added.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "sell_follow_up_workflow",
        playerId: player.id,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "sell_follow_up_workflow",
        reason: "pool_not_initialized",
      },
    });
  }
  const [quote, availableShares, breakdown, availableBalance, currentBoosts, game] =
    await Promise.all([
      getSellQuote(player.id, sharesAmount),
      storage.getAvailableShares(userId, "player", player.id),
      storage.getPlayerShareBreakdown(userId, player.id),
      storage.getAvailableBalance(userId),
      slotTier != null ? storage.getDailyBoosts(userId, player.sport, resolvedDate.targetDate) : [],
      slotTier != null
        ? storage.getPlayerGameForDate(player.id, player.sport, resolvedDate.targetDate)
        : null,
    ]);

  if (!quote) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `I could not quote a sale for ${getPlayerDisplayName(player)} right now.`,
      replyText:
        "That player pool is not returning a usable sell quote right now, so I did not stage the follow-up workflow.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "sell_follow_up_workflow",
        playerId: player.id,
        sharesAmount,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "sell_follow_up_workflow",
        reason: "quote_unavailable",
      },
    });
  }

  if (availableShares < sharesAmount) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `You only have ${formatNumber(availableShares, 2)} share${availableShares === 1 ? "" : "s"} available for ${getPlayerDisplayName(player)}.`,
      replyText:
        "The opening sell step needs more available shares than you currently have, so I did not stage the rest of that workflow.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "sell_follow_up_workflow",
        playerId: player.id,
        sharesAmount,
        availableShares,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "sell_follow_up_workflow",
        reason: "insufficient_shares",
      },
    });
  }

  const currentRegularShares = getRegularShareCount(availableShares, breakdown);
  if (stackDirective && currentRegularShares < sharesAmount) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `I cannot safely stage a post-sell stack because only ${currentRegularShares} regular share${currentRegularShares === 1 ? "" : "s"} are unlocked before the sell.`,
      replyText:
        "That follow-up stack depends on regular shares remaining after the sell, and the current unlocked regular-share count is too low to predict that path cleanly.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "sell_then_stack",
        playerId: player.id,
        sharesAmount,
        currentRegularShares,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "sell_then_stack",
        reason: "insufficient_regular_shares_before_sell",
      },
    });
  }

  const projectedAvailableShares = availableShares - sharesAmount;
  const projectedRegularShares = Math.max(0, currentRegularShares - sharesAmount);
  const requestedStackShares =
    stackDirective?.mode === "explicit" && stackDirective.requestedShares != null
      ? stackDirective.requestedShares
      : inferMaxStackableShares(projectedRegularShares);
  const normalizedStackShares =
    requestedStackShares != null && Number.isFinite(requestedStackShares)
      ? requestedStackShares % 2 === 0
        ? requestedStackShares
        : requestedStackShares - 1
      : null;

  if (stackDirective) {
    if (normalizedStackShares == null || normalizedStackShares < 4) {
      return buildUnavailableResponse({
        domain: "sportfolio",
        requestMessage: message,
        summary: `That sell would leave only ${projectedRegularShares} regular share${projectedRegularShares === 1 ? "" : "s"}, which is not enough to stack.`,
        replyText:
          "Stack Shares needs at least 4 regular shares after the sell step, so I did not stage a partial workflow.",
        warnings: playerResolution.warnings,
        contextSnapshot: {
          intent: "sell_then_stack",
          playerId: player.id,
          sharesAmount,
          projectedRegularShares,
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: "sell_then_stack",
          reason: "insufficient_post_sell_regular_shares",
        },
      });
    }

    if (normalizedStackShares > projectedRegularShares) {
      return buildUnavailableResponse({
        domain: "sportfolio",
        requestMessage: message,
        summary: `That stack step asks for ${normalizedStackShares} shares, but only ${projectedRegularShares} regular shares should remain after the sell.`,
        replyText:
          "The requested stack step would exceed the projected regular shares left after the sell step, so I did not stage it.",
        warnings: playerResolution.warnings,
        contextSnapshot: {
          intent: "sell_then_stack",
          playerId: player.id,
          normalizedStackShares,
          projectedRegularShares,
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: "sell_then_stack",
          reason: "requested_stack_exceeds_post_sell_regular_shares",
        },
      });
    }
  }

  let projectedPostStackAvailableShares = projectedAvailableShares;
  if (normalizedStackShares != null) {
    projectedPostStackAvailableShares = projectedAvailableShares - normalizedStackShares + 1;
  }

  if (slotTier != null) {
    if (currentBoosts.some((boost) => boost.slotTier === slotTier)) {
      return buildUnavailableResponse({
        domain: "sportfolio",
        requestMessage: message,
        summary: `Your ${slotTier}x slot is already filled for ${resolvedDate.label}.`,
        replyText: `That ${slotTier}x slot is already occupied for ${resolvedDate.label}, so I did not stage a partial workflow.`,
        warnings: playerResolution.warnings,
        contextSnapshot: {
          intent: normalizedStackShares != null ? "sell_then_stack_then_boost" : "sell_then_boost",
          playerId: player.id,
          slotTier,
          boostDate: resolvedDate.dateStr,
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: normalizedStackShares != null ? "sell_then_stack_then_boost" : "sell_then_boost",
          reason: "slot_taken",
        },
      });
    }

    if (currentBoosts.some((boost) => boost.playerId === player.id)) {
      return buildUnavailableResponse({
        domain: "sportfolio",
        requestMessage: message,
        summary: `${getPlayerDisplayName(player)} is already boosted for ${resolvedDate.label}.`,
        replyText:
          "That player is already in one of your boost slots for the target day, so I did not stage a duplicate workflow.",
        warnings: playerResolution.warnings,
        contextSnapshot: {
          intent: normalizedStackShares != null ? "sell_then_stack_then_boost" : "sell_then_boost",
          playerId: player.id,
          slotTier,
          boostDate: resolvedDate.dateStr,
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: normalizedStackShares != null ? "sell_then_stack_then_boost" : "sell_then_boost",
          reason: "player_already_boosted",
        },
      });
    }

    if (!game) {
      return buildUnavailableResponse({
        domain: "sportfolio",
        requestMessage: message,
        summary: `${getPlayerDisplayName(player)} does not have a ${resolvedDate.label} game in scope.`,
        replyText:
          "That player does not have a game in the target boost window, so I did not stage the follow-up workflow.",
        warnings: playerResolution.warnings,
        contextSnapshot: {
          intent: normalizedStackShares != null ? "sell_then_stack_then_boost" : "sell_then_boost",
          playerId: player.id,
          slotTier,
          boostDate: resolvedDate.dateStr,
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: normalizedStackShares != null ? "sell_then_stack_then_boost" : "sell_then_boost",
          reason: "no_game",
        },
      });
    }

    if (new Date(game.startTime) <= new Date()) {
      return buildUnavailableResponse({
        domain: "sportfolio",
        requestMessage: message,
        summary: `${getPlayerDisplayName(player)}'s game has already started.`,
        replyText:
          "That game has already started, so the boost window is closed and I did not stage the follow-up workflow.",
        warnings: playerResolution.warnings,
        contextSnapshot: {
          intent: normalizedStackShares != null ? "sell_then_stack_then_boost" : "sell_then_boost",
          playerId: player.id,
          slotTier,
          boostDate: resolvedDate.dateStr,
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: normalizedStackShares != null ? "sell_then_stack_then_boost" : "sell_then_boost",
          reason: "game_started",
        },
      });
    }

    if (projectedPostStackAvailableShares < 1) {
      return buildUnavailableResponse({
        domain: "sportfolio",
        requestMessage: message,
        summary: "That workflow would not leave a share available for the boost step.",
        replyText:
          "The remaining position after the sell and stack steps would not leave a share available for the boost slot.",
        warnings: playerResolution.warnings,
        contextSnapshot: {
          intent: normalizedStackShares != null ? "sell_then_stack_then_boost" : "sell_then_boost",
          playerId: player.id,
          projectedPostStackAvailableShares,
          slotTier,
          boostDate: resolvedDate.dateStr,
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: normalizedStackShares != null ? "sell_then_stack_then_boost" : "sell_then_boost",
          reason: "no_share_left_for_boost",
        },
      });
    }
  }

  const playerName = getPlayerDisplayName(player);
  const actions: AgentAnalysisResult["actions"] = [
    {
      actionType: "pool_sell",
      playerId: player.id,
      playerName,
      sharesAmount,
      availableSharesBefore: availableShares,
      availableSharesAfter: projectedAvailableShares,
      estimatedSbOut: quote.sbOut,
      estimatedPricePerShare: quote.effectivePrice,
      maxSlippage: DEFAULT_MAX_SLIPPAGE,
      estimatedSlippagePercent: quote.slippagePercent * 100,
      reasoning:
        requestMode === "discussion"
          ? "Previewing the opening sell step before the rest of the workflow."
          : "This stages the requested sell step before any follow-up stack or boost action.",
      confidence: 0.93,
    },
  ];
  const observations = [
    `Sell step estimates ${formatMoney(quote.sbOut)} back at about ${formatMoney(quote.effectivePrice)} each with ${formatNumber(
      quote.slippagePercent * 100,
    )}% slippage.`,
  ];
  const warnings = [
    ...playerResolution.warnings,
    "The later steps in this workflow only execute after the earlier ones succeed on confirmation.",
  ];

  let intent: "sell_then_stack" | "sell_then_boost" | "sell_then_stack_then_boost" =
    normalizedStackShares != null && slotTier != null
      ? "sell_then_stack_then_boost"
      : normalizedStackShares != null
        ? "sell_then_stack"
        : "sell_then_boost";

  if (normalizedStackShares != null) {
    actions.push({
      actionType: "holdings_stack_shares",
      playerId: player.id,
      playerName,
      sharesToStack: normalizedStackShares,
      expectedMultiplierGained: normalizedStackShares / 2,
      expectedStackedShareCount: 1,
      reasoning:
        normalizedStackShares === projectedRegularShares
          ? `Stack the ${normalizedStackShares} projected regular shares left after the sell into 1 stacked share.`
          : `Stack ${normalizedStackShares} projected regular shares after the sell and leave ${projectedRegularShares - normalizedStackShares} regular share${projectedRegularShares - normalizedStackShares === 1 ? "" : "s"} unstacked.`,
      confidence: 0.92,
    });
    observations.push(
      `Projected post-sell regular shares let you stack ${normalizedStackShares} into 1 share at ${formatNumber(
        normalizedStackShares / 2,
        2,
      )}x.`,
    );
    if (requestedStackShares != null && normalizedStackShares !== requestedStackShares) {
      warnings.push(
        "The stack step was normalized down to an even share count because Stack Shares only accepts even counts.",
      );
    }
  }

  if (slotTier != null) {
    const opponent =
      game!.homeTeam === player.team ? `vs ${game!.awayTeam}` : `@ ${game!.homeTeam}`;
    const projectedMultiplier =
      normalizedStackShares != null
        ? Math.max(getHighestAvailableShareMultiplier(breakdown), normalizedStackShares / 2)
        : getHighestAvailableShareMultiplier(breakdown);
    actions.push({
      actionType: "daily_boost_assign",
      playerId: player.id,
      playerName,
      sport: player.sport,
      slotTier,
      sharesEntered: 1,
      boostDate: resolvedDate.dateStr,
      gameId: game!.gameId,
      gameStartTime: new Date(game!.startTime).toISOString(),
      opponent,
      availableShares: projectedPostStackAvailableShares,
      shareMultiplier: projectedMultiplier,
      reasoning:
        normalizedStackShares != null
          ? `Use the resulting ${formatNumber(projectedMultiplier, 2)}x share in the ${slotTier}x slot after the sell and stack steps succeed.`
          : `Use the remaining share in the ${slotTier}x slot after the sell step succeeds.`,
      confidence: 0.94,
    });
    observations.push(
      `${playerName} is scheduled ${opponent} at ${new Date(game!.startTime).toLocaleString()}.`,
    );
    observations.push(
      `Projected boost share multiplier: ${formatNumber(projectedMultiplier, 2)}x.`,
    );
  }

  const summaryParts = [
    `Sell ${sharesAmount} share${sharesAmount === 1 ? "" : "s"} of ${playerName}`,
    ...(normalizedStackShares != null ? ["stack the remaining regular shares"] : []),
    ...(slotTier != null
      ? [`use the remaining share in your ${slotTier}x boost slot for ${resolvedDate.label}`]
      : []),
  ];

  return {
    domain: "sportfolio",
    requestMessage: message,
    replyText:
      requestMode === "discussion"
        ? `${summaryParts.join(", then ")}. ${buildStageNudge(requestMode)}`
        : `${summaryParts.join(", then ")}. I staged the workflow in execution order so the later steps only run after the earlier ones succeed. ${buildStageNudge(
            requestMode,
          )}`,
    summary: summaryParts.join(", then "),
    observations,
    warnings,
    actions: requestMode === "commit" ? actions : [],
    errorMessage: null,
    contextSnapshot: {
      intent,
      playerId: player.id,
      sharesAmount,
      projectedAvailableShares,
      projectedRegularShares,
      stackableShares: normalizedStackShares ?? 0,
      slotTier,
      boostDate: slotTier != null ? resolvedDate.dateStr : null,
      availableBalance,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent,
      requestMode,
      actionTypes: actions.map((action) => action.actionType),
    },
  };
}

async function buildStackSharesPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const parserMessage = normalizeOperationalParserMessage(message);
  const explicitMatch =
    parserMessage.match(/\bstack(?:\s+shares)?\s+(\d+)\s+(.+?)\s+shares?\b/i) ||
    parserMessage.match(/\bstack(?:\s+shares)?\s+(\d+)\s+shares?\s+of\s+(.+?)$/i);
  const assumedMatch = parserMessage.match(
    /^(?:stack|stacking)(?:\s+shares)?\s+(?:my\s+)?(.+?)(?:\s+shares?)?$/i,
  );

  if (!explicitMatch && !assumedMatch) {
    return null;
  }

  const stackAssumptionMode = explicitMatch ? "explicit" : "assumed_max_stackable";
  const rawReference = explicitMatch ? explicitMatch[2] : (assumedMatch?.[1] as string);
  const requestedSharesToStack = explicitMatch ? Number.parseInt(explicitMatch[1], 10) : null;
  if (
    requestedSharesToStack != null &&
    (!Number.isFinite(requestedSharesToStack) || requestedSharesToStack < 4)
  ) {
    return null;
  }

  const playerResolution = await resolvePlayerByReference(rawReference, { message, profile });
  if (!playerResolution) {
    return buildPlayerClarificationResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: "I need a clearer player name before I can stack that position.",
      replyText:
        "I can stage Stack Shares for that holding, but I need the full player name first so I do not touch the wrong shares.",
      prompt: "Send the full player name and I'll queue the stack-shares move for confirmation.",
      resumeMessageTemplate:
        requestedSharesToStack != null
          ? `stack shares ${requestedSharesToStack} {player} shares`
          : "stack my {player} shares",
      contextSnapshot: {
        intent: "holdings_stack_shares",
        rawPlayerReference: sanitizeNameFragment(rawReference),
        sharesToStack: requestedSharesToStack,
        stackAssumptionMode,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "holdings_stack_shares",
        reason: "player_not_resolved",
      },
    });
  }

  const player = playerResolution.player;
  const [availableShares, breakdown] = await Promise.all([
    storage.getAvailableShares(userId, "player", player.id),
    storage.getPlayerShareBreakdown(userId, player.id),
  ]);
  const currentRegularShares = getRegularShareCount(availableShares, breakdown);
  const assumedSharesToStack = inferMaxStackableShares(currentRegularShares);
  const requestedOrAssumedShares = requestedSharesToStack ?? assumedSharesToStack ?? Number.NaN;
  const normalizedShares =
    requestedOrAssumedShares % 2 === 0 ? requestedOrAssumedShares : requestedOrAssumedShares - 1;

  if (requestedSharesToStack == null && !assumedSharesToStack) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `${getPlayerDisplayName(player)} does not have at least 4 regular shares available to stack cleanly.`,
      replyText:
        "I understood that as a stack request, but the current position does not have enough regular shares to form a valid stack.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "holdings_stack_shares",
        playerId: player.id,
        availableShares,
        currentRegularShares,
        stackAssumptionMode,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "holdings_stack_shares",
        reason: "not_enough_regular_shares_for_assumed_stack",
      },
    });
  }

  if (normalizedShares < 4) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: "Stack Shares needs at least 4 regular shares.",
      replyText:
        "I need at least 4 regular shares to stack into a multiplier, so I did not stage that move.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "holdings_stack_shares",
        playerId: player.id,
        sharesToStack: requestedOrAssumedShares,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "holdings_stack_shares",
        reason: "not_enough_shares",
      },
    });
  }

  const action = {
    actionType: "holdings_stack_shares" as const,
    playerId: player.id,
    playerName: `${player.firstName} ${player.lastName}`,
    sharesToStack: normalizedShares,
    expectedMultiplierGained: normalizedShares / 2,
    expectedStackedShareCount: 1,
    reasoning:
      normalizedShares === requestedOrAssumedShares
        ? `Stack ${normalizedShares} regular shares into 1 stacked share.`
        : `Stack ${normalizedShares} regular shares into 1 stacked share and leave 1 regular share untouched because the current rule requires an even share count.`,
    confidence: 0.92,
  };

  return {
    domain: "sportfolio",
    requestMessage: message,
    replyText:
      requestMode === "discussion"
        ? `Stacking ${action.playerName} using ${normalizedShares} shares would create 1 stacked share at ${formatNumber(
            action.expectedMultiplierGained,
            2,
          )}x. ${buildStageNudge(requestMode)}`
        : `I staged Stack Shares for ${action.playerName}: stack ${normalizedShares} regular shares into 1 stacked share worth ${formatNumber(
            action.expectedMultiplierGained,
            2,
          )}x. ${buildStageNudge(requestMode)}`,
    summary: `Stack Shares for ${action.playerName}`,
    observations: [
      `Expected output: 1 stacked share at ${formatNumber(action.expectedMultiplierGained, 2)}x.`,
    ],
    warnings:
      normalizedShares === requestedOrAssumedShares
        ? stackAssumptionMode === "assumed_max_stackable"
          ? [
              ...playerResolution.warnings,
              "I assumed you wanted the maximum stackable regular shares for that holding.",
            ]
          : playerResolution.warnings
        : [
            ...playerResolution.warnings,
            "The current Stack Shares rule only accepts even share counts, so one share would be left unstacked.",
            ...(stackAssumptionMode === "assumed_max_stackable"
              ? ["I assumed you wanted the maximum stackable regular shares for that holding."]
              : []),
          ],
    actions: requestMode === "commit" ? [action] : [],
    errorMessage: null,
    contextSnapshot: {
      intent: "holdings_stack_shares",
      playerId: player.id,
      sharesToStack: normalizedShares,
      stackAssumptionMode,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "holdings_stack_shares",
      requestMode,
    },
  };
}

async function buildScoutAssignmentPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const parserMessage = normalizeOperationalParserMessage(message);
  const removalMatch = parserMessage.match(
    /\b(?:remove|pull|take)\s+(?:all\s+)?scouts?\s+(?:from|off)\s+(.+?)$/i,
  );
  const match =
    removalMatch ||
    parserMessage.match(/\b(?:set|assign|move)\s+(.+?)\s+scouts?\s+to\s+(\d+)\b/i) ||
    parserMessage.match(/\b(?:set|assign|move)\s+(\d+)\s+scouts?\s+(?:on|to)\s+(.+?)$/i) ||
    parserMessage.match(/^(?:scout|scouting)\s+(.+?)$/i) ||
    parserMessage.match(/^(?:put|add)\s+scouts?\s+(?:on|to)\s+(.+?)$/i);

  if (!match) {
    return null;
  }

  const countFirstPattern = !removalMatch && /^\d+$/.test(match[1]);
  const hasExplicitCount = removalMatch || countFirstPattern || /^\d+$/.test(match[2] || "");
  const targetCount = removalMatch
    ? 0
    : hasExplicitCount
      ? Number.parseInt(countFirstPattern ? match[1] : match[2], 10)
      : DEFAULT_ASSUMED_SCOUT_COUNT;
  const rawReference = removalMatch
    ? match[1]
    : hasExplicitCount
      ? countFirstPattern
        ? match[2]
        : match[1]
      : match[1];
  const scoutAssumptionMode = removalMatch || hasExplicitCount ? "explicit" : "assumed_one_scout";
  if (!Number.isFinite(targetCount) || targetCount < 0) {
    return null;
  }

  const playerResolution = await resolvePlayerByReference(rawReference, { message, profile });
  if (!playerResolution) {
    return buildPlayerClarificationResponse({
      domain: "scouting",
      requestMessage: message,
      summary: "I need a clearer player name before I can reassign those scouts.",
      replyText:
        "I can stage that scout reassignment, but I need the full player name first so I do not move scouts onto the wrong player.",
      prompt: "Send the full player name and I'll queue that scout change for confirmation.",
      resumeMessageTemplate:
        scoutAssumptionMode === "explicit"
          ? `set {player} scouts to ${targetCount}`
          : "scout {player}",
      contextSnapshot: {
        intent: "scout_set_count",
        rawPlayerReference: sanitizeNameFragment(rawReference),
        targetCount,
        scoutAssumptionMode,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "scout_set_count",
        reason: "player_not_resolved",
      },
    });
  }

  const player = playerResolution.player;
  const [userState, assignments, totalAssigned] = await Promise.all([
    loadUserEntitlements(storage, userId),
    storage.getUserScoutAssignments(userId),
    storage.getTotalScoutsForUser(userId),
  ]);
  const maxScouts = userState?.entitlements.maxScouts ?? 5;
  const currentAssignment = assignments.find((entry) => entry.playerId === player.id);
  const currentCount = Number(currentAssignment?.scoutCount || 0);
  const resultingAssigned = totalAssigned - currentCount + targetCount;

  if (targetCount > maxScouts || resultingAssigned > maxScouts) {
    return buildUnavailableResponse({
      domain: "scouting",
      requestMessage: message,
      summary: `That scout assignment would exceed your ${maxScouts}-scout limit.`,
      replyText:
        "That reassignment would put you over your current scout cap, so I did not stage it.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "scout_set_count",
        playerId: player.id,
        targetCount,
        currentCount,
        totalAssigned,
        maxScouts,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "scout_set_count",
        reason: "limit_exceeded",
      },
    });
  }

  const action: ScoutProposalAction = {
    actionType: "scout_set_count",
    playerId: player.id,
    playerName: `${player.firstName} ${player.lastName}`,
    targetCount,
    currentCount,
    reasoning:
      targetCount === 0
        ? `Pull all scouts off ${player.firstName} ${player.lastName}.`
        : `Set ${player.firstName} ${player.lastName} to ${targetCount} scout${targetCount === 1 ? "" : "s"}.`,
    confidence: 0.9,
    evidence: {
      trend: null,
      injury: null,
      upcomingGame: null,
      performanceNote: null,
    },
    riskFlags: [],
  };

  return {
    domain: "scouting",
    requestMessage: message,
    replyText:
      requestMode === "discussion"
        ? `${action.reasoning} That would leave you using ${resultingAssigned}/${maxScouts} scouts. ${buildStageNudge(requestMode)}`
        : `${action.reasoning} I staged the change and it would leave you using ${resultingAssigned}/${maxScouts} scouts. ${buildStageNudge(
            requestMode,
          )}`,
    summary: `Set ${action.playerName} scouts to ${targetCount}`,
    observations: [
      `Current scout count on ${action.playerName}: ${currentCount}.`,
      `Resulting total assigned scouts: ${resultingAssigned}/${maxScouts}.`,
    ],
    warnings:
      scoutAssumptionMode === "assumed_one_scout"
        ? [...playerResolution.warnings, "I assumed you wanted to assign 1 scout."]
        : playerResolution.warnings,
    actions: requestMode === "commit" ? [action] : [],
    errorMessage: null,
    contextSnapshot: {
      intent: "scout_set_count",
      playerId: player.id,
      targetCount,
      currentCount,
      resultingAssigned,
      maxScouts,
      scoutAssumptionMode,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "scout_set_count",
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
    ) ||
    parserMessage.match(/^watchlist\s+(.+?)$/i) ||
    parserMessage.match(/^(?:track|save)\s+(.+?)$/i);
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
  allowAdvisoryResponses?: boolean;
}): Promise<DirectOperationPlan | null> {
  const requestMessage = normalizeWhitespace(input.message || "");
  if (!requestMessage) {
    return null;
  }

  const requestMode = isAdvisoryRequest(requestMessage) ? "discussion" : "commit";
  const advisoryPlanners = [
    buildCapabilityGuidePlan,
    buildPortfolioCleanupReviewPlan,
    buildIdleCapitalDeploymentPlan,
    buildCommunityBoostOpportunityScanPlan,
    buildBroadOperatorReviewPlan,
    buildMarketIntelligencePlan,
    buildGameplayStrategyPlan,
  ];
  const mutationPlanners = [
    buildRankedMlbWorkflowPlan,
    buildBuyStackBoostWorkflowPlan,
    buildBuyFollowUpWorkflowPlan,
    buildSellFollowUpWorkflowPlan,
    buildCommunityBoostPlan,
    buildWatchlistPlan,
    buildStackBoostWorkflowPlan,
    buildStackSharesPlan,
    buildScoutAssignmentPlan,
    buildBoostRemovePlan,
    buildBoostAssignPlan,
    buildRemoveLiquidityPlan,
    buildZapPlan,
    buildLiquidityPlan,
    buildSellPlan,
    buildBuyPlan,
  ];
  const planners = [
    ...(input.allowAdvisoryResponses === false ? [] : advisoryPlanners),
    ...mutationPlanners,
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

async function buildRankedMlbWorkflowPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const spec = parseRankedMlbWorkflowSpec(message);
  if (!spec) {
    return null;
  }

  if (spec.requiresBoost && spec.slotTiers.length < spec.playerCount) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `I need ${spec.playerCount} boost slots to map that ranked workflow cleanly.`,
      replyText: `That request names ${spec.playerCount} ranked players, but I only found ${spec.slotTiers.length} boost slot${spec.slotTiers.length === 1 ? "" : "s"} in the prompt, so I did not guess at the ordering.`,
      contextSnapshot: {
        intent: "ranked_stat_multi_player_workflow",
        playerCount: spec.playerCount,
        slotTiers: spec.slotTiers,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "ranked_stat_multi_player_workflow",
        reason: "slot_count_mismatch",
      },
    });
  }

  const availableBalance = roundCurrency(await storage.getAvailableBalance(userId));
  if (availableBalance <= 0) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: "You do not have any available balance to stage that ranked workflow right now.",
      replyText:
        "That ranked buy workflow needs available balance to split across the selected players, and you currently do not have any free cash to stage it.",
      contextSnapshot: {
        intent: "ranked_stat_multi_player_workflow",
        playerCount: spec.playerCount,
        availableBalance,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "ranked_stat_multi_player_workflow",
        reason: "no_available_balance",
      },
    });
  }

  if (spec.requiresBoost) {
    const existingBoosts = await storage.getDailyBoosts(
      userId,
      "MLB",
      spec.resolvedDate.targetDate,
    );
    const conflictingSlots = existingBoosts
      .map((boost) => boost.slotTier)
      .filter((slotTier): slotTier is 2 | 3 | 4 | 5 =>
        spec.slotTiers.includes(slotTier as 2 | 3 | 4 | 5),
      );

    if (conflictingSlots.length > 0) {
      const conflictLabels = [...new Set(conflictingSlots)].map((slot) => `${slot}x`);
      const summary =
        conflictLabels.length === 1
          ? `Your ${conflictLabels[0]} slot is already filled for ${spec.resolvedDate.label}.`
          : `Your ${conflictLabels.join(" and ")} slots are already filled for ${spec.resolvedDate.label}.`;

      return buildUnavailableResponse({
        domain: "sportfolio",
        requestMessage: message,
        summary,
        replyText: `${summary} That ranked workflow explicitly asked for ${spec.slotTiers.map((slot) => `${slot}x`).join(" and ")} respectively, so I did not stage a partial bundle.`,
        contextSnapshot: {
          intent: "ranked_stat_multi_player_workflow",
          leaderCategory: spec.leaderCategory,
          season: spec.season,
          slotTiers: spec.slotTiers,
          conflictingSlots: conflictLabels,
          boostDate: spec.resolvedDate.dateStr,
        },
        trace: {
          framework: "deterministic-agent-operations",
          intent: "ranked_stat_multi_player_workflow",
          reason: "requested_boost_slot_occupied",
          conflictingSlots: conflictLabels,
        },
      });
    }
  }

  let rankedRows: RankedMlbLeaderRow[];
  try {
    const leaderboardResult = await runInternalMlbMcpToolRaw({
      toolName: `${resolveInternalMlbMcpConfig().toolPrefix}get_league_leader_data`,
      args: {
        leader_categories: spec.leaderCategory,
        season: spec.season,
        limit: Math.max(spec.playerCount * 20, 40),
        stat_group: spec.statGroup,
      },
    });
    rankedRows = extractRankedMlbLeaderRows(leaderboardResult.structuredContent);
  } catch (error) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `I could not load the MLB ${spec.leaderLabel} leaderboard right now.`,
      replyText:
        "The in-house MLB leaderboard source did not return usable data for that ranked workflow, so I did not stage the buys.",
      contextSnapshot: {
        intent: "ranked_stat_multi_player_workflow",
        leaderCategory: spec.leaderCategory,
        season: spec.season,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "ranked_stat_multi_player_workflow",
        reason: "leaderboard_unavailable",
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }

  const mlbProfile = {
    ...profile,
    defaultSport: "MLB",
  } as UserAgentProfile;
  const selectedPlans: Array<{
    player: typeof players.$inferSelect;
    leader: RankedMlbLeaderRow;
    slotTier: 2 | 3 | 4 | 5 | null;
    budget: number;
    plan: DirectOperationPlan;
  }> = [];
  const selectionWarnings: string[] = [];
  const candidateAssessments: RankedWorkflowCandidateAssessment[] = [];
  const seenPlayerIds = new Set<string>();
  let planningState = createCompoundPlanningState(availableBalance);

  for (const row of rankedRows) {
    if (selectedPlans.length >= spec.playerCount) {
      break;
    }

    const slotTier = spec.requiresBoost ? spec.slotTiers[selectedPlans.length] || null : null;
    const remainingPlayerSlots = spec.playerCount - selectedPlans.length;
    const provisionalBudget =
      allocateEvenBuyBudgets(planningState.availableBalance, remainingPlayerSlots)[0] || 0;
    const resolved = await resolvePlayerByReference(row.playerName, {
      message: `MLB ${message}`,
      profile: mlbProfile,
    });

    if (!resolved) {
      const reason =
        "I skipped this leaderboard entry because there is no active Sportfolio MLB player match for it.";
      selectionWarnings.push(
        `I skipped ${row.playerName} because there is no active Sportfolio MLB player match for that leaderboard entry.`,
      );
      candidateAssessments.push({
        rank: row.rank,
        leaderboardPlayerName: row.playerName,
        playerId: null,
        playerName: null,
        slotTier,
        provisionalBudget,
        status: "skipped",
        reason: "player_not_resolved",
        summary: reason,
      });
      continue;
    }

    const resolvedPlayerId = resolved.player.id;
    if (!resolvedPlayerId) {
      candidateAssessments.push({
        rank: row.rank,
        leaderboardPlayerName: row.playerName,
        playerId: null,
        playerName: `${resolved.player.firstName} ${resolved.player.lastName}`,
        slotTier,
        provisionalBudget,
        status: "skipped",
        reason: "player_id_missing",
        summary:
          "I skipped this leaderboard entry because the matched Sportfolio player is missing a usable id.",
      });
      continue;
    }

    if (seenPlayerIds.has(resolvedPlayerId)) {
      candidateAssessments.push({
        rank: row.rank,
        leaderboardPlayerName: row.playerName,
        playerId: resolvedPlayerId,
        playerName: `${resolved.player.firstName} ${resolved.player.lastName}`,
        slotTier,
        provisionalBudget,
        status: "skipped",
        reason: "duplicate_player",
        summary:
          "I skipped this leaderboard entry because the same Sportfolio player was already selected earlier in the workflow.",
      });
      continue;
    }

    const safeBudgetEstimate = await estimateMaxBuySpendWithinSlippage(
      resolvedPlayerId,
      provisionalBudget,
    );

    if (!safeBudgetEstimate) {
      const reason =
        "I skipped this leaderboard entry because the maximum safe buy size still exceeded the execution slippage guard.";
      selectionWarnings.push(
        `I skipped ${getPlayerDisplayName(resolved.player)} because the current pool depth would exceed the slippage guard before the workflow could even start.`,
      );
      candidateAssessments.push({
        rank: row.rank,
        leaderboardPlayerName: row.playerName,
        playerId: resolvedPlayerId,
        playerName: getPlayerDisplayName(resolved.player),
        slotTier,
        provisionalBudget,
        status: "skipped",
        reason: "quote_slippage_too_high",
        summary: reason,
      });
      continue;
    }

    const safeBudget = safeBudgetEstimate.sbAmount;
    const goal: StructuredBuyFollowUpGoal = {
      rawPlayerReference: resolved.player.id,
      requestedShareCount: null,
      requestedDollarAmount: safeBudget,
      buyAssumptionMode: "explicit_dollars",
      hasStackIntent: spec.requiresStack,
      stackOptional: false,
      slotTier,
      boostOptional: false,
      resolvedDate: spec.resolvedDate,
    };
    const evaluation = await evaluateStructuredBuyFollowUpWorkflow({
      userId,
      profile: mlbProfile,
      requestMessage: buildRankedWorkflowSyntheticMessage({
        budget: safeBudget,
        playerReference: resolved.player.id,
        slotTier,
        resolvedDate: spec.resolvedDate,
        requiresStack: spec.requiresStack,
      }),
      goal,
      requestMode,
      resolvedPlayer: resolved,
      planningState,
    });
    const evaluationSummary =
      evaluation.plan.summary ||
      evaluation.plan.replyText ||
      "I could not stage this ranked candidate cleanly.";

    candidateAssessments.push({
      rank: row.rank,
      leaderboardPlayerName: row.playerName,
      playerId: resolvedPlayerId,
      playerName: `${resolved.player.firstName} ${resolved.player.lastName}`,
      slotTier,
      provisionalBudget,
      status: evaluation.status,
      reason: evaluation.reason,
      summary: evaluationSummary,
    });

    if (evaluation.status !== "supported") {
      selectionWarnings.push(evaluationSummary);
      continue;
    }

    seenPlayerIds.add(resolvedPlayerId);
    selectedPlans.push({
      player: resolved.player,
      leader: row,
      slotTier,
      budget: safeBudget,
      plan: evaluation.plan,
    });
    planningState = applyCompoundPlanningReservation({
      state: planningState,
      goal,
      playerId: resolvedPlayerId,
    });
  }

  if (selectedPlans.length < spec.playerCount) {
    return buildUnavailableResponse({
      domain: "sportfolio",
      requestMessage: message,
      summary: `I could only find ${selectedPlans.length} viable ranked MLB player${selectedPlans.length === 1 ? "" : "s"} for that workflow.`,
      replyText:
        "I found the MLB leaderboard signal, but I could not find enough ranked players who could complete the requested buy, stack, and boost workflow under the current Sportfolio constraints.",
      warnings: dedupeStrings(selectionWarnings),
      contextSnapshot: {
        intent: "ranked_stat_multi_player_workflow",
        leaderCategory: spec.leaderCategory,
        season: spec.season,
        resolvedPlayerIds: selectedPlans.map((entry) => entry.player.id),
        candidateAssessments,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "ranked_stat_multi_player_workflow",
        reason: "insufficient_viable_ranked_players",
        candidateAssessments,
      },
    });
  }

  const combinedActions: AgentAnalysisResult["actions"] = [];
  const combinedWarnings: string[] = [
    `I staged each ranked buy at the largest safe size the remaining balance and current pool depth allowed while keeping the leaderboard order intact.`,
  ];
  const combinedObservations: string[] = [
    `MLB ${spec.leaderLabel} leaderboard (${spec.season}) drove the selection order for this workflow.`,
  ];
  const playerSummaries: string[] = [];

  for (const selected of selectedPlans) {
    playerSummaries.push(
      `${selected.player.firstName} ${selected.player.lastName}${selected.slotTier != null ? ` -> ${selected.slotTier}x` : ""} (${selected.leader.valueLabel || "n/a"} ${spec.leaderLabel})`,
    );
    combinedWarnings.push(...selected.plan.warnings);
    combinedObservations.push(
      `${selected.player.firstName} ${selected.player.lastName} ranked ${selected.leader.rank ?? "?"} on the ${spec.leaderLabel} leaderboard at ${selected.leader.valueLabel || "n/a"}.`,
      ...selected.plan.observations,
    );
    combinedActions.push(...selected.plan.actions);
  }

  const summary = `Stage the ranked MLB ${spec.leaderLabel} workflow for ${playerSummaries.join(", then ")}`;
  const replyText =
    requestMode === "discussion"
      ? `${summary}. I would keep the sequence ordered by the leaderboard and size each buy to the largest safe amount the remaining balance and current pool depth allow. ${buildStageNudge(
          requestMode,
        )}`
      : `${summary}. I staged the buys first, then the stack and boost steps in leaderboard order. ${buildStageNudge(requestMode)}`;

  return {
    domain: "sportfolio",
    requestMessage: message,
    replyText,
    summary,
    observations: dedupeStrings(combinedObservations),
    warnings: dedupeStrings([...combinedWarnings, ...selectionWarnings]),
    actions: requestMode === "commit" ? combinedActions : [],
    pendingClarification: null,
    errorMessage: null,
    contextSnapshot: {
      intent: "ranked_stat_multi_player_workflow",
      leaderCategory: spec.leaderCategory,
      leaderLabel: spec.leaderLabel,
      season: spec.season,
      playerIds: selectedPlans.map((entry) => entry.player.id),
      slotTiers: spec.slotTiers,
      availableBalance,
      budgets: selectedPlans.map((entry) => entry.budget),
      boostDate: spec.requiresBoost ? spec.resolvedDate.dateStr : null,
      candidateAssessments,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "ranked_stat_multi_player_workflow",
      requestMode,
      actionTypes: combinedActions.map((action) => action.actionType),
      playerIds: selectedPlans.map((entry) => entry.player.id),
      candidateAssessments,
    },
  };
}

async function buildBuyPlan(
  userId: string,
  profile: UserAgentProfile,
  message: string,
  requestMode: "discussion" | "commit",
): Promise<DirectOperationPlan | null> {
  const buyDirective = parseBuyDirective(message);
  if (!buyDirective) {
    return null;
  }

  const { requestedShareCount, requestedDollarAmount, rawPlayerReference, buyAssumptionMode } =
    buyDirective;
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
          : buyAssumptionMode === "assumed_max_safe"
            ? "buy as much {player} as I can afford"
            : `buy $${requestedDollarAmount || DEFAULT_ASSUMED_BUY_SB} of {player}`,
      contextSnapshot: {
        intent: "pool_buy",
        sbAmount: requestedDollarAmount,
        requestedShareCount,
        buyAssumptionMode,
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
  const pool = await getPool(player.id);
  if (!pool) {
    return buildUnavailableResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: `I could not quote a buy for ${player.firstName} ${player.lastName} because the pool is not initialized.`,
      replyText:
        "That player has no active pool yet. Add initial liquidity first, then I can stage a buy.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "pool_buy",
        playerId: player.id,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_buy",
        reason: "pool_not_initialized",
      },
    });
  }
  const availableBalance = roundCurrency(await storage.getAvailableBalance(userId));
  const assumedBuyTarget =
    buyAssumptionMode === "assumed_max_safe"
      ? availableBalance
      : Math.min(DEFAULT_ASSUMED_BUY_SB, availableBalance);
  const assumedBuyEstimate =
    requestedDollarAmount == null && requestedShareCount == null
      ? await estimateMaxBuySpendWithinSlippage(player.id, assumedBuyTarget)
      : null;
  const estimatedShareSpend =
    requestedDollarAmount == null && requestedShareCount
      ? await estimateSpendForTargetShares(player.id, requestedShareCount)
      : null;
  const sbAmount =
    requestedDollarAmount ??
    (estimatedShareSpend
      ? estimatedShareSpend.sbAmount
      : (assumedBuyEstimate?.sbAmount ?? Number.NaN));
  const quote =
    requestedDollarAmount != null
      ? await getBuyQuote(player.id, sbAmount)
      : estimatedShareSpend?.quote || assumedBuyEstimate?.quote || null;

  if (requestedDollarAmount == null && requestedShareCount == null && !assumedBuyEstimate) {
    return buildUnavailableResponse({
      domain: "player_pools",
      requestMessage: message,
      summary:
        availableBalance <= 0
          ? "You do not have any available balance to open that position right now."
          : `I could not find a safe assumed buy size for ${player.firstName} ${player.lastName} at the current pool depth.`,
      replyText:
        availableBalance <= 0
          ? "I understood that as a buy request, but you do not have available balance to stage it right now."
          : "I understood that as a buy request, but even the assumed size would not clear the current slippage guard, so I did not stage it.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "pool_buy",
        playerId: player.id,
        buyAssumptionMode,
        availableBalance,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_buy",
        reason: "buy_assumption_unavailable",
      },
    });
  }

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
        buyAssumptionMode,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_buy",
        reason: "quote_unavailable",
      },
    });
  }

  if (quote.slippagePercent > DEFAULT_MAX_SLIPPAGE) {
    return buildUnavailableResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: `That buy would currently quote at about ${formatNumber(
        quote.slippagePercent * 100,
      )}% slippage, which is above the ${formatNumber(DEFAULT_MAX_SLIPPAGE * 100)}% execution guard.`,
      replyText:
        "That amount is too large for the current pool depth to stage safely. Lower the size and I can restage the buy.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "pool_buy",
        playerId: player.id,
        sbAmount,
        requestedShareCount,
        buyAssumptionMode,
        estimatedSlippagePercent: quote.slippagePercent * 100,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_buy",
        reason: "quote_slippage_too_high",
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
        buyAssumptionMode,
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
        : (assumedBuyEstimate?.roundedSharesOut ?? quote.sharesOut),
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
  if (buyAssumptionMode === "assumed_starter") {
    warnings.push(
      `I assumed you wanted a starter buy and sized it to ${formatMoney(sbAmount)} under the current slippage guard.`,
    );
  } else if (buyAssumptionMode === "assumed_max_safe") {
    warnings.push(
      "I assumed you wanted the largest safe buy size the current balance and pool depth allow.",
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
              : `${formatNumber(assumedBuyEstimate?.roundedSharesOut ?? quote.sharesOut, 4)} shares`
          } at about ${formatMoney(quote.effectivePrice)} each with ${formatNumber(
            quote.slippagePercent * 100,
          )}% slippage.${buyAssumptionMode === "assumed_starter" ? ` I assumed a starter size for you.` : buyAssumptionMode === "assumed_max_safe" ? " I assumed you wanted the largest safe size." : ""} ${buildStageNudge(requestMode)}`
        : `I can stage that buy. ${summary} currently estimates ${
            requestedShareCount != null && estimatedShareSpend
              ? `${estimatedShareSpend.roundedSharesOut} whole shares`
              : `${formatNumber(assumedBuyEstimate?.roundedSharesOut ?? quote.sharesOut, 4)} shares`
          } at about ${formatMoney(quote.effectivePrice)} each with ${formatNumber(
            quote.slippagePercent * 100,
          )}% slippage.${buyAssumptionMode === "assumed_starter" ? ` I assumed a starter size for you.` : buyAssumptionMode === "assumed_max_safe" ? " I assumed you wanted the largest safe size." : ""} ${buildStageNudge(requestMode)}`,
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
      buyAssumptionMode,
      availableBalance,
      quote: {
        sharesOut:
          requestedShareCount != null && estimatedShareSpend
            ? estimatedShareSpend.roundedSharesOut
            : (assumedBuyEstimate?.roundedSharesOut ?? quote.sharesOut),
        effectivePrice: quote.effectivePrice,
        slippagePercent: quote.slippagePercent * 100,
      },
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "pool_buy",
      requestMode,
      matchedPattern:
        buyAssumptionMode === "explicit_dollars"
          ? "buy_by_dollars"
          : buyAssumptionMode === "explicit_shares"
            ? "buy_by_shares"
            : buyAssumptionMode === "assumed_max_safe"
              ? "buy_assumed_max_safe"
              : "buy_assumed_starter",
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
  const explicitMatch = parserMessage.match(
    /\b(?:sell|selling|dump|liquidate|trim|trimming|cut|reduce|exit)\s+(\d+(?:\.\d+)?)\s+shares?\s+(?:of\s+)?(.+?)(?:\s+from\s+the\s+pool|\s+from\s+the\s+market|$)/i,
  );
  const assumedMatch = parserMessage.match(
    /^(?:sell|selling|dump|liquidate|trim|trimming|cut|reduce|exit)\s+(?:some\s+|my\s+)?(.+?)(?:\s+shares?)?$/i,
  );
  if (!explicitMatch && !assumedMatch) {
    return null;
  }

  const sharesAmount = explicitMatch ? Number(explicitMatch[1]) : DEFAULT_ASSUMED_SELL_SHARES;
  const sellAssumptionMode = explicitMatch ? "explicit" : "assumed_one_share";
  const playerReference = explicitMatch ? explicitMatch[2] : (assumedMatch?.[1] as string);
  const playerResolution = await resolvePlayerByReference(playerReference, { message, profile });
  if (!playerResolution) {
    return buildPlayerClarificationResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: "I need a clearer player name before I can stage that sale.",
      replyText:
        "I can stage that sale, but I need the full player name first so I do not sell the wrong holding.",
      prompt: "Send the full player name and I'll queue that sale for confirmation.",
      resumeMessageTemplate:
        sellAssumptionMode === "explicit"
          ? `sell ${sharesAmount} shares of {player}`
          : "sell {player}",
      contextSnapshot: {
        intent: "pool_sell",
        sharesAmount,
        sellAssumptionMode,
        rawPlayerReference: sanitizeNameFragment(playerReference),
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
  const pool = await getPool(player.id);
  if (!pool) {
    return buildUnavailableResponse({
      domain: "player_pools",
      requestMessage: message,
      summary: `I could not quote a sale for ${player.firstName} ${player.lastName} because the pool is not initialized.`,
      replyText:
        "That player has no active pool yet. Sell orders are unavailable until liquidity is added.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "pool_sell",
        playerId: player.id,
        sharesAmount,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_sell",
        reason: "pool_not_initialized",
      },
    });
  }
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
  if (sellAssumptionMode === "assumed_one_share") {
    warnings.push("I assumed you wanted to sell 1 available share.");
  }

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
      sellAssumptionMode,
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
      matchedPattern: sellAssumptionMode === "explicit" ? "sell" : "sell_assumed_one_share",
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
  const quantityFirstMatch = parserMessage.match(
    /\b(?:add|deposit|provide|supply)(?:\s+liquidity)?\s+(?:up to\s+|at most\s+|maximum\s+)?(\d+(?:\.\d+)?)\s+shares?\s+(?:and|with)\s+\$?(\d+(?:\.\d+)?)\s*(?:sb|bucks|dollars?)?\s+(?:to|into)\s+(.+?)(?:'s)?(?:\s+pool)?$/i,
  );
  const playerFirstMatch = parserMessage.match(
    /\b(?:add|deposit|provide|supply)(?:\s+liquidity)?\s+(?:to|into)\s+(.+?)\s+with\s+(?:up to\s+|at most\s+|maximum\s+)?(\d+(?:\.\d+)?)\s+shares?\s+(?:and|plus)\s+\$?(\d+(?:\.\d+)?)\s*(?:sb|bucks|dollars?)?(?:\s+in(?:to)?\s+(?:their\s+)?pool)?$/i,
  );
  const match = quantityFirstMatch || playerFirstMatch;
  if (!match) {
    return null;
  }

  const playerReference = quantityFirstMatch ? match[3] : match[1];
  const shares = Number(quantityFirstMatch ? match[1] : match[2]);
  const playMoney = Number(quantityFirstMatch ? match[2] : match[3]);
  const isOptimal = /\b(?:up to|at most|maximum|max)\b/i.test(message);
  const playerResolution = await resolvePlayerByReference(playerReference, { message, profile });

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
        rawPlayerReference: sanitizeNameFragment(playerReference),
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
    getPool(player.id),
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

  const hasInitializedPool = Boolean(pool);
  const currentPrice = pool
    ? pool.currentPrice
    : shares > 0 && playMoney > 0
      ? playMoney / shares
      : 0;

  const expectedPlayMoney = pool ? shares * pool.currentPrice : playMoney;
  if (
    hasInitializedPool &&
    !isOptimal &&
    Math.abs(expectedPlayMoney - playMoney) > LIQUIDITY_RATIO_TOLERANCE
  ) {
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
        currentPrice,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "pool_add_liquidity",
        reason: "ratio_mismatch",
      },
    });
  }

  const previewSharesUsed = isOptimal
    ? hasInitializedPool && pool
      ? Math.min(shares, playMoney / pool.currentPrice)
      : shares
    : shares;
  const previewPlayMoneyUsed = isOptimal
    ? hasInitializedPool && pool
      ? Math.min(playMoney, shares * pool.currentPrice)
      : playMoney
    : playMoney;
  const estimatedOwnershipPercent =
    hasInitializedPool && pool
      ? computeEstimatedOwnershipPercent({
          currentPoolShares: pool.shares,
          currentLpSharesTotal: pool.lpSharesTotal,
          depositedShares: previewSharesUsed,
        })
      : 100;

  const summary = isOptimal
    ? `Add up to ${formatNumber(shares, 2)} shares and ${formatMoney(playMoney)} to ${player.firstName} ${player.lastName}'s pool`
    : `Add ${formatNumber(shares, 2)} shares and ${formatMoney(playMoney)} to ${player.firstName} ${player.lastName}'s pool`;
  const warnings: string[] = [
    ...playerResolution.warnings,
    "LP ownership and final deposit amounts can shift if the pool moves before you confirm.",
  ];
  if (!hasInitializedPool) {
    warnings.push(
      "This pool is not initialized yet. The first LP deposit sets the initial market price.",
    );
  }

  const observations: string[] = hasInitializedPool
    ? [
        `Current pool price is ${formatMoney(currentPrice)}.`,
        estimatedOwnershipPercent == null
          ? "I could not estimate the post-deposit ownership cleanly from the current pool snapshot."
          : `Estimated ownership after execution: ${formatNumber(estimatedOwnershipPercent)}%.`,
      ]
    : [
        `Pool is not initialized yet. This deposit would bootstrap the pool at ${formatMoney(
          currentPrice,
        )}.`,
        "Estimated ownership after execution: 100.00% (first LP provider).",
      ];

  const basePlan = {
    domain: "player_pools" as const,
    requestMessage: message,
    summary,
    observations,
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
      currentPrice,
      estimatedOwnershipPercent,
      poolInitialized: hasInitializedPool,
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
      reasoning: hasInitializedPool
        ? requestMode === "discussion"
          ? "Previewing an optimal-ratio LP add using the current pool state."
          : "This stages an optimal-ratio LP add capped by the provided share and cash limits."
        : requestMode === "discussion"
          ? "Previewing a pool bootstrap using the provided share and cash caps."
          : "This stages a pool bootstrap using the provided share and cash caps.",
      confidence: 0.91,
    };

    return {
      ...basePlan,
      replyText:
        hasInitializedPool && pool
          ? requestMode === "discussion"
            ? `${summary}. At the current pool ratio, I would use up to ${formatNumber(
                Math.min(shares, playMoney / pool.currentPrice),
                2,
              )} shares inside that cap. ${buildStageNudge(requestMode)}`
            : `${summary}. I'll use the server-side optimal ratio at execution time so anything unused stays in your wallet. ${buildStageNudge(requestMode)}`
          : requestMode === "discussion"
            ? `${summary}. There is no active pool yet, so this would bootstrap the market at ${formatMoney(
                currentPrice,
              )} per share using your cap amounts. ${buildStageNudge(requestMode)}`
            : `${summary}. This will initialize the pool using your provided caps as the first ratio. ${buildStageNudge(requestMode)}`,
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
    reasoning: hasInitializedPool
      ? requestMode === "discussion"
        ? "Previewing a fixed-ratio LP add using the exact requested amounts."
        : "This stages the exact requested LP deposit into the player pool."
      : requestMode === "discussion"
        ? "Previewing a pool bootstrap using the exact requested amounts."
        : "This stages a pool bootstrap using the exact requested amounts.",
    confidence: 0.91,
  };

  return {
    ...basePlan,
    replyText: hasInitializedPool
      ? requestMode === "discussion"
        ? `${summary}. At the current pool price of ${formatMoney(
            currentPrice,
          )}, that is a direct fixed-size LP add. ${buildStageNudge(requestMode)}`
        : `${summary}. This uses the exact amounts you gave me at the current pool ratio. ${buildStageNudge(requestMode)}`
      : requestMode === "discussion"
        ? `${summary}. There is no active pool yet, so these exact amounts will set the initial price at ${formatMoney(
            currentPrice,
          )}. ${buildStageNudge(requestMode)}`
        : `${summary}. This will create the initial pool with your exact amounts. ${buildStageNudge(requestMode)}`,
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
  const explicitSlotMatch =
    parserMessage.match(
      /\b(?:put|putting|place|placing|assign|assigning|boost|boosting|slot|slotting|lock|locking|run)\s+(.+?)\s+(?:in|into|to)\s+(?:my\s+)?([2345])x\s+(?:(?:daily\s+)?boost\s+)?slot\b/i,
    ) ||
    parserMessage.match(
      /\b(?:use|using|throw)\s+(?:my\s+)?([2345])x\s+(?:(?:daily\s+)?boost\s+)?slot\s+(?:on|for)\s+(.+?)$/i,
    );
  const assumedSlotMatch =
    parserMessage.match(/^(?:boost|boosting)\s+(.+?)(?:\s+(?:today|tomorrow))?$/i) ||
    parserMessage.match(
      /^(?:put|putting|place|placing|assign|assigning|slot|slotting|lock|locking|run)\s+(.+?)\s+(?:in|into|to)\s+(?:my\s+)?(?:daily\s+)?boost(?:\s+slot)?(?:\s+(?:today|tomorrow))?$/i,
    );

  if (!explicitSlotMatch && !assumedSlotMatch) {
    return null;
  }

  const match = explicitSlotMatch || assumedSlotMatch;
  const slotFirstPattern = explicitSlotMatch ? /^[2345]$/.test(match?.[1] || "") : false;
  const playerReference = explicitSlotMatch
    ? slotFirstPattern
      ? (match?.[2] as string)
      : (match?.[1] as string)
    : (match?.[1] as string);
  const explicitSlotTier = explicitSlotMatch
    ? (Number(slotFirstPattern ? match?.[1] : match?.[2]) as 2 | 3 | 4 | 5)
    : null;
  const boostAssumptionMode = explicitSlotTier == null ? "assumed_highest_open_slot" : "explicit";
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
      resumeMessageTemplate:
        explicitSlotTier != null
          ? `put {player} in my ${explicitSlotTier}x boost slot ${resolvedDate.label}`
          : `boost {player} ${resolvedDate.label}`,
      contextSnapshot: {
        intent: "daily_boost_assign",
        slotTier: explicitSlotTier,
        boostAssumptionMode,
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
    storage.getPlayerShareBreakdown(userId, player.id),
  ]);
  const slotTier = explicitSlotTier ?? findHighestOpenBoostSlot(currentBoosts);

  if (slotTier == null) {
    return buildUnavailableResponse({
      domain: "daily_boosts",
      requestMessage: message,
      summary: `All four boost slots are already filled for ${resolvedDate.label}.`,
      replyText:
        "I understood that as a boost request, but all four daily boost slots are already occupied for that window.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "daily_boost_assign",
        playerId: player.id,
        slotTier: explicitSlotTier,
        boostAssumptionMode,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "daily_boost_assign",
        reason: "slots_full",
      },
    });
  }

  if (slotTier != null && currentBoosts.some((boost) => boost.slotTier === slotTier)) {
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
        boostAssumptionMode,
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
        boostAssumptionMode,
        boostDate: resolvedDate.dateStr,
      },
      trace: {
        framework: "deterministic-agent-operations",
        intent: "daily_boost_assign",
        reason: "player_already_boosted",
      },
    });
  }

  if (currentBoosts.length >= DAILY_BOOST_SLOT_COUNT) {
    return buildUnavailableResponse({
      domain: "daily_boosts",
      requestMessage: message,
      summary: `All four boost slots are already filled for ${resolvedDate.label}.`,
      replyText:
        explicitSlotTier == null
          ? "I understood that as a boost request, but all four daily boost slots are already occupied for that window."
          : "All four daily boost slots are already occupied, so I did not stage another one.",
      warnings: playerResolution.warnings,
      contextSnapshot: {
        intent: "daily_boost_assign",
        playerId: player.id,
        slotTier: explicitSlotTier,
        boostAssumptionMode,
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
        boostAssumptionMode,
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
        boostAssumptionMode,
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
        boostAssumptionMode,
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

  const stackedCandidates = [
    ...(breakdown.stacked || [])
      .filter((holding) => Number.parseFloat(holding.quantity) >= 1)
      .map((holding) => ({
        multiplier: Number.parseFloat(holding.multiplier || "1"),
      })),
    ...(breakdown.regular && Number.parseFloat(breakdown.regular.quantity) >= 1
      ? [{ multiplier: 1 }]
      : []),
  ].sort((left, right) => right.multiplier - left.multiplier);
  const selectedHolding = stackedCandidates[0];
  const multiplier = selectedHolding?.multiplier || 1;
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
    shareMultiplier: multiplier,
    reasoning:
      requestMode === "discussion"
        ? "Previewing a valid daily boost placement for the selected slot."
        : "This stages the requested daily boost using exactly one eligible share in the chosen slot.",
    confidence: 0.93,
  };

  const summary = `Put ${action.playerName} in your ${slotTier}x boost slot for ${resolvedDate.label}`;
  const observations = [
    `${action.playerName} is scheduled ${opponent} at ${new Date(game.startTime).toLocaleString()}.`,
    `The selected share would contribute ${formatNumber(multiplier, 2)} multiplier in that slot.`,
  ];
  const warnings = [
    ...playerResolution.warnings,
    "Daily boosts always use exactly one share and become locked when the game starts.",
  ];
  if (boostAssumptionMode === "assumed_highest_open_slot") {
    warnings.push(`I assumed you wanted the highest open boost slot and used ${slotTier}x.`);
  }

  return {
    domain: "daily_boosts",
    requestMessage: message,
    replyText:
      requestMode === "discussion"
        ? `${summary}. ${action.playerName} is eligible right now, and the best available share would carry ${formatNumber(
            multiplier,
            2,
          )}x into that slot. ${buildStageNudge(requestMode)}`
        : `${summary}. ${action.playerName} is eligible right now, and the best available share would carry ${formatNumber(
            multiplier,
            2,
          )}x into that slot. ${buildStageNudge(requestMode)}`,
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
      boostAssumptionMode,
      boostDate: resolvedDate.dateStr,
      gameId: game.gameId,
      availableShares,
      selectedMultiplier: multiplier,
    },
    trace: {
      framework: "deterministic-agent-operations",
      intent: "daily_boost_assign",
      requestMode,
      matchedPattern:
        boostAssumptionMode === "assumed_highest_open_slot"
          ? "boost_assign_assumed_slot"
          : "boost_assign",
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
    /\b(?:remove|clear|delete|cancel|pull|take|free\s+up|unslot)\s+(?:my\s+)?([2345])x\s+(?:(?:daily\s+)?boost\s+)?slot\b/i,
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
