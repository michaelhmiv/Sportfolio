import {
  botActionsLog,
  botCycleBriefs,
  botProfiles,
  botRunLogs,
  jobExecutionLogs,
  userAgentThreads,
  users,
  type UserAgentProfile,
} from "@shared/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { persistProposedMemoryWrites } from "../agent/memory";
import { loadScoutAgentContext } from "../agent/context-loader";
import { planDirectAgentOperation } from "../agent/operations-planner";
import { runHermesAgentTurn } from "../agent/hermes-client";
import { isHostedWebResearchAvailable, planHostedWebResearch } from "../agent/research";
import { getScoutAgentProfile } from "../agent/service";
import { ensureAgentThreadSchema } from "../agent/thread-service";
import type {
  AgentAction,
  AgentCitation,
  AgentDomain,
  AgentToolTrace,
  HermesRespondResult,
  ScoutAgentContext,
} from "../agent/types";
import { executeAgentActions } from "../agent/executor";
import { db } from "../db";
import { storage } from "../storage";

const DEFAULT_ALLOWED_MECHANICS = ["market", "liquidity", "scouting", "boosts"] as const;
const MAX_RECENT_RUN_SUMMARIES = 2;
const MAX_RECENT_ACTIONS = 4;
const DEFAULT_BOT_CYCLE_INTERVAL_MINUTES = process.env.NODE_ENV === "development" ? 1 : 15;
const DEFAULT_BOT_SLICE_SIZE = process.env.NODE_ENV === "development" ? 1 : 0;
const DEFAULT_BOT_TURN_TIMEOUT_MS = process.env.NODE_ENV === "development" ? 22_000 : 30_000;
const DEFAULT_SHARED_BRIEF_TIMEOUT_MS = process.env.NODE_ENV === "development" ? 12_000 : 15_000;
const BOT_NO_ACTION_PATTERN = /\bNO_ACTION\b/i;
const DIRECT_TOOL_LOOP_FAILURE_PATTERN = /direct tool loop/i;
const GENERIC_BRIEF_PATTERN = /\bmodel answered directly\b/i;
const MAX_SYNTHETIC_BRIEF_PLAYERS = 4;
const MAX_FALLBACK_CANDIDATES = 6;

type BotMechanic = (typeof DEFAULT_ALLOWED_MECHANICS)[number];
type BotRunFailureClass =
  | "direct_loop_unusable"
  | "advisory_only"
  | "policy_filtered"
  | "execution_failed"
  | "planning_error";

type BotRunMetrics = {
  planningLatencyMs: number;
  executionLatencyMs: number;
  totalLatencyMs: number;
  proposedActionCount: number;
  executableActionCount: number;
  droppedActionCount: number;
  successfulActionCount: number;
  failedActionCount: number;
  timedOut: boolean;
  fallbackUsed: boolean;
  hermesNative: boolean;
  actionTypes: AgentAction["actionType"][];
  mechanicCounts: Partial<Record<BotMechanic, number>>;
  usedSharedResearch: boolean;
  usedSyntheticBrief: boolean;
};

type BotRuntimeProfile = typeof botProfiles.$inferSelect & {
  user: typeof users.$inferSelect;
};

type RoleDefaults = {
  strategyPrompt: string;
  allowedMechanics: BotMechanic[];
  objectiveWeights: {
    priceMovement: number;
    liquidityCoverage: number;
    variety: number;
  };
  researchEnabled: boolean;
  researchQueryBudget: number;
  maxActionsPerTick: number;
};

type SharedBriefRecord = typeof botCycleBriefs.$inferSelect;

type SharedMarketSnapshot = {
  generatedAt: string;
  activeBots: number;
  liveGames: number;
  upcomingGames: number;
  pools: {
    total: number;
    lowTradeCount: number;
    avgTrades: number;
  };
  coldPools: Array<{
    playerId: string;
    playerName: string;
    sport: string;
    team: string;
    totalTrades: number;
    lastPrice: number | null;
    lastUpdated: string | null;
  }>;
  movers: Array<{
    playerId: string;
    playerName: string;
    sport: string;
    team: string;
    priceChange24h: number;
    volume24h: number;
    currentPrice: number | null;
  }>;
};

type ExecutedBotAction = {
  actionType: AgentAction["actionType"];
  success: boolean;
  errorMessage?: string;
};

type BotPlanResult = {
  status: "executed" | "planned_no_fill" | "policy_filtered" | "no_action" | "failed";
  failureClass: BotRunFailureClass | null;
  summary: string;
  warnings: string[];
  plannedActions: AgentAction[];
  executedActions: ExecutedBotAction[];
  citations: AgentCitation[];
  toolTrace: AgentToolTrace[];
  usedResearch: boolean;
  researchQueryCount: number;
  threadId: string | null;
  errorMessage?: string | null;
  metrics: BotRunMetrics;
};

const BOT_ROLE_DEFAULTS: Record<string, RoleDefaults> = {
  market_maker: {
    strategyPrompt:
      "Operate as a market maker. Keep visible markets alive, provide two-sided activity, and smooth dead zones without mindless churn. Prefer clean directional nudges, balanced LP support, and low-noise price discovery.",
    allowedMechanics: ["market", "liquidity", "boosts"],
    objectiveWeights: {
      priceMovement: 0.4,
      liquidityCoverage: 0.4,
      variety: 0.2,
    },
    researchEnabled: false,
    researchQueryBudget: 0,
    maxActionsPerTick: 2,
  },
  trader: {
    strategyPrompt:
      "Operate as a research-driven opportunist. Use the shared brief to express directional views, react to catalysts, and create visible movement when conviction is high. Avoid redundant trades that do not change the market meaningfully.",
    allowedMechanics: ["market", "liquidity", "boosts"],
    objectiveWeights: {
      priceMovement: 0.55,
      liquidityCoverage: 0.15,
      variety: 0.3,
    },
    researchEnabled: true,
    researchQueryBudget: 1,
    maxActionsPerTick: 2,
  },
  casual: {
    strategyPrompt:
      "Operate as a cold-market stimulator. Reach stale and undertraded pools, add believable low-to-medium conviction activity, and spread attention beyond the obvious names.",
    allowedMechanics: ["market", "liquidity", "scouting"],
    objectiveWeights: {
      priceMovement: 0.25,
      liquidityCoverage: 0.5,
      variety: 0.25,
    },
    researchEnabled: false,
    researchQueryBudget: 0,
    maxActionsPerTick: 2,
  },
  contest: {
    strategyPrompt:
      "Operate as a slate tactician. Use scouting and daily boosts to keep game loops active around live and upcoming slates, but only take clean market actions when they reinforce the setup.",
    allowedMechanics: ["market", "scouting", "boosts"],
    objectiveWeights: {
      priceMovement: 0.3,
      liquidityCoverage: 0.15,
      variety: 0.55,
    },
    researchEnabled: true,
    researchQueryBudget: 1,
    maxActionsPerTick: 2,
  },
};

function getRoleDefaults(role: string): RoleDefaults {
  return (
    BOT_ROLE_DEFAULTS[role] || {
      strategyPrompt:
        "Operate as a flexible market bot. Create movement when it matters, touch stale zones, and avoid repetitive low-signal loops.",
      allowedMechanics: ["market", "liquidity", "scouting", "boosts"],
      objectiveWeights: {
        priceMovement: 0.4,
        liquidityCoverage: 0.3,
        variety: 0.3,
      },
      researchEnabled: false,
      researchQueryBudget: 0,
      maxActionsPerTick: 2,
    }
  );
}

function safeJsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getBotCycleIntervalMinutes() {
  return parsePositiveInt(process.env.BOT_ENGINE_CYCLE_MINUTES, DEFAULT_BOT_CYCLE_INTERVAL_MINUTES);
}

function getBotSliceSize(totalBots: number) {
  const configured = parsePositiveInt(process.env.BOT_ENGINE_BOTS_PER_TICK, DEFAULT_BOT_SLICE_SIZE);
  if (configured <= 0) {
    return totalBots;
  }

  return Math.max(1, Math.min(totalBots, configured));
}

function getBotTurnTimeoutMs() {
  return parsePositiveInt(process.env.BOT_ENGINE_TURN_TIMEOUT_MS, DEFAULT_BOT_TURN_TIMEOUT_MS);
}

function getSharedBriefTimeoutMs() {
  return parsePositiveInt(
    process.env.BOT_ENGINE_SHARED_BRIEF_TIMEOUT_MS,
    DEFAULT_SHARED_BRIEF_TIMEOUT_MS,
  );
}

function shouldUseSyntheticSharedBriefRuntime() {
  const configured = String(process.env.BOT_ENGINE_SYNTHETIC_SHARED_BRIEF || "").trim();
  if (configured) {
    return configured === "1" || configured.toLowerCase() === "true";
  }

  return process.env.NODE_ENV === "development";
}

function buildEmptyMemoryContext() {
  return {
    profile: [],
    episodic: [],
    semantic: [],
  };
}

function buildCoordinatorSystemPrompt() {
  return [
    "Operate as the Sportfolio bot coordinator, not a user-facing scout assistant.",
    "Produce one reusable cycle brief for the bot population.",
    "Use hosted research only when one shared external check can improve decisions for multiple bots.",
    "Focus on market movement, cold-zone coverage, scouting opportunities, liquidity posture, and daily boost timing.",
    "Do not answer like a chat assistant and do not ask clarifying questions.",
  ].join(" ");
}

function buildBotSystemPrompt(input: {
  botName: string;
  botRole: string;
  strategyPrompt: string;
  allowedMechanics: BotMechanic[];
}) {
  return [
    `You are ${input.botName}, an autonomous Sportfolio gameplay bot operating as ${input.botRole}.`,
    input.strategyPrompt,
    buildRoleGuidance(input.botRole, input.allowedMechanics),
    "You are not a user-facing scout assistant.",
    "Use Hermes tools to produce executable gameplay actions, not generic advice.",
    "When you call a preview tool, always provide complete arguments that satisfy the tool schema.",
    "Allowed gameplay mechanics are market trades, LP actions, scout adjustments, and daily boost assignment or removal.",
    "Never use community boosts, watchlists, stacking, or retired mechanics in this runtime.",
  ].join(" ");
}

function buildRuntimeProfile(
  baseProfile: UserAgentProfile,
  overrides: {
    displayName: string;
    systemPrompt: string;
    temperature: string;
    maxTokens: number;
  },
): UserAgentProfile {
  return {
    ...baseProfile,
    displayName: overrides.displayName,
    systemPrompt: overrides.systemPrompt,
    temperature: overrides.temperature,
    maxTokens: overrides.maxTokens,
  };
}

function compactBotContext(
  context: ScoutAgentContext,
  limits: {
    assignments: number;
    candidates: number;
    recommendedTargets: number;
    topHoldings: number;
    nextBestLevers: number;
    knowledgeBrief: number;
  },
): ScoutAgentContext {
  return {
    ...context,
    assignments: context.assignments.slice(0, limits.assignments),
    candidates: context.candidates.slice(0, limits.candidates),
    recommendedTargets: context.recommendedTargets.slice(0, limits.recommendedTargets),
    operatorOverview: {
      ...context.operatorOverview,
      topHoldings: context.operatorOverview.topHoldings.slice(0, limits.topHoldings),
      nextBestLevers: context.operatorOverview.nextBestLevers.slice(0, limits.nextBestLevers),
    },
    knowledgeBrief: context.knowledgeBrief.slice(0, limits.knowledgeBrief),
  };
}

function floorCycleDate(now = new Date(), cycleIntervalMinutes = getBotCycleIntervalMinutes()) {
  const cycle = new Date(now);
  const minutes = cycle.getUTCMinutes();
  cycle.setUTCMinutes(minutes - (minutes % cycleIntervalMinutes), 0, 0);
  return cycle;
}

function buildCycleKey(now = new Date(), cycleIntervalMinutes = getBotCycleIntervalMinutes()) {
  return floorCycleDate(now, cycleIntervalMinutes).toISOString();
}

function buildCycleExpiry(now = new Date(), cycleIntervalMinutes = getBotCycleIntervalMinutes()) {
  return new Date(
    floorCycleDate(now, cycleIntervalMinutes).getTime() + cycleIntervalMinutes * 60 * 1000,
  );
}

function selectBotsForTick(
  activeBots: BotRuntimeProfile[],
  now = new Date(),
  cycleIntervalMinutes = getBotCycleIntervalMinutes(),
) {
  const sortedBots = [...activeBots].sort(
    (left, right) => left.botName.localeCompare(right.botName) || left.id.localeCompare(right.id),
  );
  const sliceSize = getBotSliceSize(sortedBots.length);
  if (sliceSize >= sortedBots.length) {
    return sortedBots;
  }

  const cycleSeed = Math.floor(
    floorCycleDate(now, cycleIntervalMinutes).getTime() / (cycleIntervalMinutes * 60 * 1000),
  );
  const startIndex = (cycleSeed * sliceSize) % sortedBots.length;

  return Array.from({ length: sliceSize }, (_, index) => {
    return sortedBots[(startIndex + index) % sortedBots.length]!;
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function countResearchCalls(toolTrace: AgentToolTrace[]) {
  return toolTrace.filter((entry) => entry.toolName === "get_hosted_research").length;
}

function normalizeAllowedMechanics(
  value: string[] | null | undefined,
  fallback: readonly BotMechanic[],
): BotMechanic[] {
  const selected = Array.isArray(value)
    ? value.filter((entry): entry is BotMechanic =>
        DEFAULT_ALLOWED_MECHANICS.includes(entry as BotMechanic),
      )
    : [];

  return selected.length > 0 ? selected : [...fallback];
}

function normalizeObjectiveWeights(
  raw: unknown,
  fallback: RoleDefaults["objectiveWeights"],
): RoleDefaults["objectiveWeights"] {
  if (!raw || typeof raw !== "object") {
    return fallback;
  }

  const value = raw as Record<string, unknown>;
  const normalize = (key: keyof RoleDefaults["objectiveWeights"], current: number) => {
    const candidate = value[key];
    return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : current;
  };

  return {
    priceMovement: normalize("priceMovement", fallback.priceMovement),
    liquidityCoverage: normalize("liquidityCoverage", fallback.liquidityCoverage),
    variety: normalize("variety", fallback.variety),
  };
}

function mapActionToMechanic(action: AgentAction): BotMechanic | null {
  switch (action.actionType) {
    case "pool_buy":
    case "pool_sell":
      return "market";
    case "pool_add_liquidity":
    case "pool_add_liquidity_optimal":
    case "pool_zap_add_shares":
    case "pool_zap_add_sb":
    case "pool_remove_liquidity":
      return "liquidity";
    case "scout_set_count":
      return "scouting";
    case "daily_boost_assign":
    case "daily_boost_remove":
      return "boosts";
    default:
      return null;
  }
}

function filterExecutableActions(
  actions: AgentAction[],
  allowedMechanics: BotMechanic[],
  maxActionsPerTick: number,
): { executable: AgentAction[]; dropped: AgentAction[] } {
  const executable: AgentAction[] = [];
  const dropped: AgentAction[] = [];

  for (const action of actions) {
    const mechanic = mapActionToMechanic(action);
    if (!mechanic || !allowedMechanics.includes(mechanic)) {
      dropped.push(action);
      continue;
    }

    if (executable.length >= Math.max(0, maxActionsPerTick)) {
      dropped.push(action);
      continue;
    }

    executable.push(action);
  }

  return { executable, dropped };
}

function estimateActionVolume(action: AgentAction): number {
  switch (action.actionType) {
    case "pool_buy":
      return Math.max(0, action.sbAmount || 0);
    case "pool_sell":
      return Math.max(0, action.estimatedSbOut || action.sharesAmount || 0);
    case "pool_add_liquidity":
      return Math.max(0, (action.playMoney || 0) + (action.shares || 0));
    case "pool_add_liquidity_optimal":
      return Math.max(0, (action.maxPlayMoney || 0) + (action.maxShares || 0));
    case "pool_zap_add_shares":
      return Math.max(0, action.shares || 0);
    case "pool_zap_add_sb":
      return Math.max(0, action.sb || 0);
    case "pool_remove_liquidity":
      return Math.max(0, action.estimatedPlayMoneyOut || action.lpShares || 0);
    default:
      return 0;
  }
}

function buildSharedBriefToolAllowlist(allowResearch = true) {
  const tools = [
    "get_operator_overview",
    "get_holdings",
    "get_amm_pool_state",
    "get_daily_boost_state",
    "get_daily_boost_eligibility",
    "get_lp_positions",
  ];

  if (allowResearch) {
    tools.push("get_hosted_research");
  }

  return tools;
}

function buildBotToolAllowlist(allowedMechanics: BotMechanic[]) {
  const baseTools = [
    "get_operator_overview",
    "get_balance_state",
    "get_holdings",
    "get_daily_boost_state",
    "get_daily_boost_eligibility",
    "get_lp_positions",
    "get_amm_pool_state",
  ];
  const planTools: string[] = [];

  if (allowedMechanics.includes("market")) {
    planTools.push("preview_pool_buy", "preview_pool_sell");
  }

  if (allowedMechanics.includes("liquidity")) {
    planTools.push(
      "preview_lp_add",
      "preview_lp_add_optimal",
      "preview_lp_remove",
      "preview_lp_zap",
    );
  }

  if (allowedMechanics.includes("scouting")) {
    planTools.push("preview_scout_adjustment");
  }

  if (allowedMechanics.includes("boosts")) {
    planTools.push("preview_daily_boost_assign", "preview_daily_boost_remove");
  }

  return [...new Set([...baseTools, ...planTools])];
}

function buildBotPlanningDomains(allowedMechanics: BotMechanic[]): AgentDomain[] {
  const domains = new Set<AgentDomain>(["sportfolio", "player_pools"]);
  if (allowedMechanics.includes("scouting")) {
    domains.add("scouting");
  }
  if (allowedMechanics.includes("boosts")) {
    domains.add("daily_boosts");
  }
  return Array.from(domains);
}

function buildBotPlanningActionTypes(allowedMechanics: BotMechanic[]) {
  const actionTypes: AgentAction["actionType"][] = [];

  if (allowedMechanics.includes("market")) {
    actionTypes.push("pool_buy", "pool_sell");
  }
  if (allowedMechanics.includes("liquidity")) {
    actionTypes.push(
      "pool_add_liquidity",
      "pool_add_liquidity_optimal",
      "pool_zap_add_shares",
      "pool_zap_add_sb",
      "pool_remove_liquidity",
    );
  }
  if (allowedMechanics.includes("scouting")) {
    actionTypes.push("scout_set_count");
  }
  if (allowedMechanics.includes("boosts")) {
    actionTypes.push("daily_boost_assign", "daily_boost_remove");
  }

  return actionTypes;
}

function buildRoleGuidance(role: string, allowedMechanics: BotMechanic[]) {
  const roleSpecific =
    role === "market_maker"
      ? "Bias toward two-sided activity, visible names, and LP support without repetitive churn."
      : role === "trader"
        ? "Bias toward catalyst-driven directional moves and sharper price movement when the shared brief gives you a real edge."
        : role === "contest"
          ? "Bias toward live or near-lock slate setup, pairing boosts and scouts with reinforcing market actions."
          : "Bias toward cold and undertraded pools, spreading believable activity deeper into the market.";

  const mechanicSpecific = [
    allowedMechanics.includes("market")
      ? "Use market trades when you can create real movement or wake up a stale pool."
      : null,
    allowedMechanics.includes("liquidity")
      ? "Use LP adds, removals, or zaps when they improve pool health or support your role."
      : null,
    allowedMechanics.includes("scouting")
      ? "Use scouting to push attention into undercovered or slate-relevant players."
      : null,
    allowedMechanics.includes("boosts")
      ? "Use daily boosts when slot state and game timing make that a cleaner lever than another trade."
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return [roleSpecific, mechanicSpecific].filter(Boolean).join(" ");
}

function buildSharedBriefRequest(snapshot: SharedMarketSnapshot, activeBots: BotRuntimeProfile[]) {
  const roleCounts = activeBots.reduce<Record<string, number>>((acc, bot) => {
    acc[bot.botRole] = (acc[bot.botRole] || 0) + 1;
    return acc;
  }, {});

  return [
    "You are coordinating the Sportfolio bot population for this cycle.",
    "Goal: create meaningful market movement, cover colder market zones, and keep bot behavior varied without running repetitive loops.",
    "Research cost matters. Only use hosted research if the result is likely to improve decisions for multiple bots in this cycle. Reuse one shared set of findings across the whole population.",
    "Output a reusable market brief for bot personas, not a user-facing chat response.",
    "Include: top market themes, cold/stale zones, live or upcoming slate windows, which role families should press action, and risks to avoid.",
    "Call out where market trades, LP support, scouting, or daily boosts are the cleanest lever for the current cycle.",
    "If hosted research is unnecessary, keep the brief internal-only and say so explicitly.",
    "Internal market snapshot:",
    JSON.stringify(
      {
        generatedAt: snapshot.generatedAt,
        activeBots: snapshot.activeBots,
        roleCounts,
        pools: snapshot.pools,
        liveGames: snapshot.liveGames,
        upcomingGames: snapshot.upcomingGames,
        coldPools: snapshot.coldPools.slice(0, 4),
        movers: snapshot.movers.slice(0, 4),
      },
      null,
      2,
    ),
  ].join("\n");
}

function buildSharedResearchRequest(
  snapshot: SharedMarketSnapshot,
  activeBots: BotRuntimeProfile[],
) {
  const roleCounts = activeBots.reduce<Record<string, number>>((acc, bot) => {
    acc[bot.botRole] = (acc[bot.botRole] || 0) + 1;
    return acc;
  }, {});

  const moverNames = snapshot.movers
    .slice(0, 4)
    .map((entry) => entry.playerName)
    .join(", ");
  const coldNames = snapshot.coldPools
    .slice(0, 4)
    .map((entry) => entry.playerName)
    .join(", ");

  return [
    "Research the latest sports catalysts that could affect multiple Sportfolio bot strategies in the next 12 hours.",
    "Only include reusable signals that matter across the bot population: injuries, lineup or workload changes, late-breaking availability, and major live/pregame catalysts.",
    `Live games: ${snapshot.liveGames}. Upcoming games in 12h: ${snapshot.upcomingGames}.`,
    `Role mix: ${JSON.stringify(roleCounts)}.`,
    moverNames ? `Current mover focus: ${moverNames}.` : null,
    coldNames ? `Cold-market focus: ${coldNames}.` : null,
    "Keep the findings concise and reusable across market-making, cold-market, research, scouting, and boost decisions.",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildBotPlanningRequest(input: {
  profile: BotRuntimeProfile;
  sharedBrief: SharedBriefRecord;
  recentActions: (typeof botActionsLog.$inferSelect)[];
  recentRuns: (typeof botRunLogs.$inferSelect)[];
  allowedMechanics: BotMechanic[];
  maxActionsPerTick: number;
  objectiveWeights: RoleDefaults["objectiveWeights"];
}) {
  const recentActionSummaries = input.recentActions.map((entry) => ({
    actionType: entry.actionType,
    triggerReason: entry.triggerReason,
    createdAt: entry.createdAt.toISOString(),
  }));

  return [
    `You are ${input.profile.botName}, a Sportfolio bot operating as ${input.profile.botRole}.`,
    "Decide concrete actions for this cycle using the shared brief and your account state.",
    "Act like an adaptive operator, not a fixed script. Variety matters, but only if the actions are coherent and executable.",
    "Do not request external research in this turn. Shared research is already handled at the cycle level.",
    "Use only the allowed mechanics and stay within the action cap.",
    "A valid turn must do exactly one of these:",
    "1. Use preview tools and return one or more concrete executable actions.",
    "2. Return `NO_ACTION: <brief reason>` if there is no coherent move worth taking.",
    "Freeform advisory text without actions or `NO_ACTION` will be treated as a failed bot turn.",
    "Allowed gameplay actions for bots are market trades, LP adds/removals/zaps, scout adjustments, and daily boost assignment/removal.",
    "Do not use community boosts, watchlists, stacking, or any retired mechanics outside the current gameplay loop.",
    `Allowed mechanics: ${input.allowedMechanics.join(", ")}.`,
    `Max actions this tick: ${input.maxActionsPerTick}.`,
    `Objective weights: ${JSON.stringify(input.objectiveWeights)}.`,
    `Role prompt: ${input.profile.strategyPrompt || getRoleDefaults(input.profile.botRole).strategyPrompt}`,
    `Role execution guidance: ${buildRoleGuidance(input.profile.botRole, input.allowedMechanics)}`,
    "Prefer a small coherent bundle over isolated noise when multiple actions clearly reinforce the same thesis.",
    "If you do not see a meaningful move, return no plan rather than forcing activity.",
    "Shared market brief:",
    input.sharedBrief.sharedPrompt,
    "Recent actions:",
    JSON.stringify(recentActionSummaries, null, 2),
    "Recent run summaries:",
    JSON.stringify(
      input.recentRuns.map((entry) => ({
        createdAt: entry.createdAt.toISOString(),
        summary: entry.summary,
        status: entry.status,
      })),
      null,
      2,
    ),
    "If you choose no action, start the summary with `NO_ACTION:` and give one concrete reason tied to the shared brief or account state.",
  ].join("\n");
}

function getSnapshotFromBrief(brief: SharedBriefRecord): SharedMarketSnapshot | null {
  const payload =
    brief.briefPayload && typeof brief.briefPayload === "object"
      ? (brief.briefPayload as Record<string, unknown>)
      : null;
  const snapshot =
    payload?.snapshot && typeof payload.snapshot === "object"
      ? (payload.snapshot as SharedMarketSnapshot)
      : null;

  if (!snapshot || !Array.isArray(snapshot.coldPools) || !Array.isArray(snapshot.movers)) {
    return null;
  }

  return snapshot;
}

function summarizePlayerTargets<T>(
  entries: T[],
  formatter: (entry: T) => string,
  maxEntries = MAX_SYNTHETIC_BRIEF_PLAYERS,
) {
  return entries.slice(0, maxEntries).map(formatter).join(", ");
}

function buildSyntheticSharedBrief(
  snapshot: SharedMarketSnapshot,
  activeBots: BotRuntimeProfile[],
  reason: string,
  options?: {
    researchSummary?: string | null;
    citations?: AgentCitation[];
    warnings?: string[];
    usedResearch?: boolean;
    researchQueryCount?: number;
  },
) {
  const marketMakerBots = activeBots.filter((bot) => bot.botRole === "market_maker").length;
  const traderBots = activeBots.filter((bot) => bot.botRole === "trader").length;
  const coldBots = activeBots.filter((bot) => bot.botRole === "casual").length;
  const slateBots = activeBots.filter((bot) => bot.botRole === "contest").length;
  const coldPoolSummary =
    summarizePlayerTargets(
      snapshot.coldPools,
      (entry) => `${entry.playerName} (${entry.sport} ${entry.team}, trades=${entry.totalTrades})`,
    ) || "none";
  const moverSummary =
    summarizePlayerTargets(
      snapshot.movers,
      (entry) =>
        `${entry.playerName} (${entry.sport} ${entry.team}, change24h=${entry.priceChange24h.toFixed(2)}%)`,
    ) || "none";
  const sharedPrompt = [
    "Synthetic shared market brief generated from internal Sportfolio data.",
    `Reason: ${reason}`,
    options?.researchSummary ? `Shared external research: ${options.researchSummary}` : null,
    `Market state: ${snapshot.pools.lowTradeCount}/${snapshot.pools.total} pools remain cold, average trades ${snapshot.pools.avgTrades.toFixed(2)}.`,
    `Slate state: ${snapshot.liveGames} live games and ${snapshot.upcomingGames} upcoming games inside the next 12 hours.`,
    `Cold pools to touch first: ${coldPoolSummary}.`,
    `Players with visible price movement: ${moverSummary}.`,
    `Role emphasis: market makers (${marketMakerBots}) should keep visible pools moving, cold-market bots (${coldBots}) should seed undertraded names, traders (${traderBots}) should press the strongest mover, slate bots (${slateBots}) should prefer live or near-lock names.`,
    "Avoid repeating the same player immediately after a recent bot action unless the market snapshot still strongly supports it.",
    "If no coherent move exists, return NO_ACTION with one explicit reason.",
  ].join("\n");

  return {
    status: "ready" as const,
    summary: "Synthetic internal market brief",
    sharedPrompt,
    briefPayload: {
      snapshot,
      synthetic: true,
      syntheticReason: reason,
      metrics: {
        latencyMs: 0,
        activeBotCount: activeBots.length,
        cycleIntervalMinutes: getBotCycleIntervalMinutes(),
      },
    },
    warnings: [`Synthetic brief used: ${reason}`, ...(options?.warnings || [])],
    citations: options?.citations || ([] as AgentCitation[]),
    toolTrace: [] as AgentToolTrace[],
    usedResearch: Boolean(options?.usedResearch),
    researchQueryCount: options?.researchQueryCount || 0,
  };
}

function shouldUseSyntheticSharedBrief(turn: HermesRespondResult) {
  const combined = `${turn.summary || ""}\n${turn.assistantText || ""}`;
  return (
    turn.outcome === "error" || GENERIC_BRIEF_PATTERN.test(combined) || combined.trim().length < 80
  );
}

function getRecentActionPlayerIds(recentActions: (typeof botActionsLog.$inferSelect)[]) {
  const playerIds = new Set<string>();

  for (const entry of recentActions) {
    const details =
      entry.actionDetails && typeof entry.actionDetails === "object"
        ? (entry.actionDetails as Record<string, unknown>)
        : null;
    const action =
      details?.action && typeof details.action === "object"
        ? (details.action as Record<string, unknown>)
        : null;
    const candidate = action?.playerId ?? details?.playerId;
    if (typeof candidate === "string" && candidate.trim()) {
      playerIds.add(candidate);
    }
  }

  return playerIds;
}

function resolveFallbackBuySize(
  profile: BotRuntimeProfile,
  availableBalance: number,
  estimatedSharePrice?: number | null,
) {
  const minOrder = Math.max(1, Number(profile.minOrderSize || 0));
  const maxOrder = Math.max(minOrder, Number(profile.maxOrderSize || minOrder));
  const roleMultiplier =
    profile.botRole === "trader"
      ? 0.8
      : profile.botRole === "market_maker"
        ? 0.65
        : profile.botRole === "contest"
          ? 0.45
          : 0.35;
  const desired = Math.round(minOrder + (maxOrder - minOrder) * roleMultiplier);
  const priceFloor =
    typeof estimatedSharePrice === "number" &&
    isFinite(estimatedSharePrice) &&
    estimatedSharePrice > 0
      ? Math.ceil(estimatedSharePrice * 1.05)
      : 0;
  const softCap = Math.max(maxOrder, minOrder * 2, Math.ceil(maxOrder * 1.5));

  if (priceFloor > 0 && (priceFloor > softCap || priceFloor > availableBalance)) {
    return 0;
  }

  const minimumExecutable = priceFloor > 0 ? Math.max(minOrder, priceFloor) : minOrder;
  const targetSpend = Math.max(desired, minimumExecutable);
  return Math.max(0, Math.min(softCap, targetSpend, Math.floor(availableBalance)));
}

type FallbackPlanChoice = {
  plannedActions: AgentAction[];
  warnings: string[];
  summary: string;
};

function toFiniteNumber(value: unknown) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatFallbackNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function getEstimatedPlayerPrice(
  snapshot: SharedMarketSnapshot | null,
  playerId: string,
  fallback = 0,
) {
  const moverMatch = snapshot?.movers.find((entry) => entry.playerId === playerId);
  if (typeof moverMatch?.currentPrice === "number" && moverMatch.currentPrice > 0) {
    return moverMatch.currentPrice;
  }

  const coldMatch = snapshot?.coldPools.find((entry) => entry.playerId === playerId);
  if (typeof coldMatch?.lastPrice === "number" && coldMatch.lastPrice > 0) {
    return coldMatch.lastPrice;
  }

  return fallback;
}

function getNextOpenBoostSlotTier(
  boosts: Array<{
    slotTier: number;
    status?: string | null;
  }>,
): 2 | 3 | 4 | 5 | null {
  const occupied = new Set(
    boosts
      .filter((boost) => boost.status !== "cancelled")
      .map((boost) => Number(boost.slotTier))
      .filter((slotTier) => Number.isFinite(slotTier)),
  );

  for (const slotTier of [5, 4, 3, 2] as const) {
    if (!occupied.has(slotTier)) {
      return slotTier;
    }
  }

  return null;
}

function buildBoostHoldingCandidates(input: {
  context: ScoutAgentContext;
  recentPlayerIds: Set<string>;
  activeBoostPlayerIds: Set<string>;
}) {
  const candidateMap = new Map(input.context.candidates.map((entry) => [entry.playerId, entry]));

  return input.context.operatorOverview.topHoldings
    .filter(
      (holding) =>
        holding.availableShares > 0 &&
        !input.recentPlayerIds.has(holding.playerId) &&
        !input.activeBoostPlayerIds.has(holding.playerId),
    )
    .map((holding) => ({
      ...holding,
      candidate: candidateMap.get(holding.playerId) || null,
    }))
    .sort((left, right) => {
      const leftScore =
        (left.candidate?.hasGameInFocusWindow ? 100 : 0) +
        (left.candidate?.scoutOpportunityScore || 0) +
        (left.nextGameAt ? 20 : 0) +
        Math.min(20, left.availableShares);
      const rightScore =
        (right.candidate?.hasGameInFocusWindow ? 100 : 0) +
        (right.candidate?.scoutOpportunityScore || 0) +
        (right.nextGameAt ? 20 : 0) +
        Math.min(20, right.availableShares);

      return rightScore - leftScore;
    });
}

async function tryFallbackDirectPlan(input: {
  userId: string;
  profile: UserAgentProfile;
  messages: string[];
  allowedMechanics: BotMechanic[];
  maxActionsPerTick: number;
  warning: string;
}): Promise<FallbackPlanChoice | null> {
  const collected: AgentAction[] = [];
  const warnings = [input.warning];
  const summaries: string[] = [];

  for (const message of input.messages) {
    const plan = await planDirectAgentOperation({
      userId: input.userId,
      message,
      profile: input.profile,
    });
    if (!plan || plan.actions.length === 0) {
      return null;
    }

    collected.push(...plan.actions);
    if (Array.isArray(plan.warnings)) {
      warnings.push(...plan.warnings);
    }
    if (plan.summary) {
      summaries.push(plan.summary);
    }
  }

  const { executable, dropped } = filterExecutableActions(
    collected,
    input.allowedMechanics,
    input.maxActionsPerTick,
  );
  if (executable.length === 0) {
    return null;
  }

  if (dropped.length > 0) {
    warnings.push(`Dropped ${dropped.length} fallback action(s) outside the bot policy or cap.`);
  }

  return {
    plannedActions: executable,
    warnings: warnings.filter(
      (entry, index, collection) => Boolean(entry) && collection.indexOf(entry) === index,
    ),
    summary:
      summaries.join(" | ") ||
      `Fallback direct planner generated ${executable.length} executable action${executable.length === 1 ? "" : "s"}.`,
  };
}

async function chooseFallbackPlan(input: {
  profile: BotRuntimeProfile;
  runtimeProfile: UserAgentProfile;
  sharedBrief: SharedBriefRecord;
  context: ScoutAgentContext;
  recentActions: (typeof botActionsLog.$inferSelect)[];
  allowedMechanics: BotMechanic[];
  maxActionsPerTick: number;
}): Promise<FallbackPlanChoice | null> {
  const recentPlayerIds = getRecentActionPlayerIds(input.recentActions);
  const snapshot = getSnapshotFromBrief(input.sharedBrief);
  const availableBalance = Math.max(
    0,
    Math.floor(input.context.operatorOverview.availableBalance || 0),
  );

  const liquidityCandidate =
    snapshot?.coldPools.find((entry) => !recentPlayerIds.has(entry.playerId)) ||
    snapshot?.movers.find((entry) => !recentPlayerIds.has(entry.playerId)) ||
    input.context.recommendedTargets.find((entry) => !recentPlayerIds.has(entry.playerId)) ||
    null;
  const moverMap = new Map(
    (snapshot?.movers || []).map((entry) => [entry.playerId, entry.priceChange24h]),
  );
  const holdingCandidates = input.context.operatorOverview.topHoldings
    .filter((holding) => holding.availableShares > 0 && !recentPlayerIds.has(holding.playerId))
    .sort((left, right) => {
      const leftScore =
        Math.abs(moverMap.get(left.playerId) || 0) +
        Math.min(20, left.availableShares) +
        (left.nextGameAt ? 10 : 0);
      const rightScore =
        Math.abs(moverMap.get(right.playerId) || 0) +
        Math.min(20, right.availableShares) +
        (right.nextGameAt ? 10 : 0);
      return rightScore - leftScore;
    });
  const scoutFallback = chooseFallbackAction({
    profile: input.profile,
    sharedBrief: input.sharedBrief,
    context: input.context,
    recentActions: input.recentActions,
    allowedMechanics: ["scouting"],
  });

  let currentBoosts: Awaited<ReturnType<typeof storage.getDailyBoostsAllSports>> = [];
  let lpPositions: Awaited<ReturnType<typeof storage.getUserLpPositions>> = [];

  if (input.allowedMechanics.includes("boosts")) {
    currentBoosts = await storage.getDailyBoostsAllSports(input.profile.userId, new Date());
  }
  if (input.allowedMechanics.includes("liquidity")) {
    lpPositions = await storage.getUserLpPositions(input.profile.userId);
  }

  const activeBoostPlayerIds = new Set(
    currentBoosts
      .filter((boost) => boost.status !== "cancelled")
      .map((boost) => boost.playerId)
      .filter((playerId): playerId is string => Boolean(playerId)),
  );
  const boostCandidates = buildBoostHoldingCandidates({
    context: input.context,
    recentPlayerIds,
    activeBoostPlayerIds,
  });
  const openBoostSlotTier = getNextOpenBoostSlotTier(currentBoosts);
  const activeBoosts = currentBoosts
    .filter((boost) => boost.status !== "cancelled")
    .sort((left, right) => Number(left.slotTier) - Number(right.slotTier));
  const removableLpPositions = lpPositions
    .map((position) => ({
      playerId: position.playerId,
      lpShares: toFiniteNumber(position.lpShares),
    }))
    .filter((position) => position.lpShares > 0.25 && !recentPlayerIds.has(position.playerId))
    .sort((left, right) => right.lpShares - left.lpShares);

  const lpAddHolding = holdingCandidates[0] || null;
  const sellHolding = holdingCandidates.find(
    (holding) => Math.abs(moverMap.get(holding.playerId) || 0) >= 3 && holding.availableShares >= 1,
  );

  const buySpend =
    liquidityCandidate || holdingCandidates[0]
      ? resolveFallbackBuySize(
          input.profile,
          availableBalance,
          getEstimatedPlayerPrice(
            snapshot,
            (liquidityCandidate || holdingCandidates[0])!.playerId,
            0,
          ),
        )
      : 0;
  const liquidityBudget = Math.max(
    0,
    Math.min(
      availableBalance,
      Math.max(
        Math.max(10, Number(input.profile.minOrderSize || 0)),
        buySpend > 0 ? Math.round(buySpend * 0.9) : 0,
      ),
    ),
  );

  const tryBoostAssign = async () => {
    if (!input.allowedMechanics.includes("boosts")) {
      return null;
    }

    const target = boostCandidates[0];
    if (!target) {
      return null;
    }

    const boostBuySpend =
      input.allowedMechanics.includes("market") && input.maxActionsPerTick >= 2
        ? resolveFallbackBuySize(
            input.profile,
            availableBalance,
            getEstimatedPlayerPrice(snapshot, target.playerId, 0),
          )
        : 0;

    if (openBoostSlotTier) {
      return tryFallbackDirectPlan({
        userId: input.profile.userId,
        profile: input.runtimeProfile,
        messages:
          boostBuySpend > 0
            ? [
                `put ${target.playerId} in my ${openBoostSlotTier}x boost slot today`,
                `buy $${boostBuySpend} of ${target.playerId}`,
              ]
            : [`put ${target.playerId} in my ${openBoostSlotTier}x boost slot today`],
        allowedMechanics: input.allowedMechanics,
        maxActionsPerTick: input.maxActionsPerTick,
        warning:
          boostBuySpend > 0
            ? `Used fallback boost-plus-buy bundle for ${target.name}.`
            : `Used fallback boost assignment for ${target.name}.`,
      });
    }

    const replaceableBoost = activeBoosts[0];
    if (!replaceableBoost || input.maxActionsPerTick < 2) {
      return null;
    }
    if (replaceableBoost.playerId === target.playerId) {
      return null;
    }

    return tryFallbackDirectPlan({
      userId: input.profile.userId,
      profile: input.runtimeProfile,
      messages: [
        `remove my ${replaceableBoost.slotTier}x boost slot`,
        `put ${target.playerId} in my ${replaceableBoost.slotTier}x boost slot today`,
      ],
      allowedMechanics: input.allowedMechanics,
      maxActionsPerTick: input.maxActionsPerTick,
      warning: `Used fallback boost rebalance into ${target.name}.`,
    });
  };

  const tryLiquidityAdd = async () => {
    if (
      !input.allowedMechanics.includes("liquidity") ||
      !lpAddHolding ||
      availableBalance < 10 ||
      lpAddHolding.availableShares < 1
    ) {
      return null;
    }

    const maxShares = Math.min(3, Math.max(1, Math.floor(lpAddHolding.availableShares)));
    const estimatedPrice = Math.max(
      1,
      getEstimatedPlayerPrice(snapshot, lpAddHolding.playerId, 10),
    );
    const maxPlayMoney = Math.max(
      10,
      Math.min(availableBalance, Math.ceil(maxShares * estimatedPrice * 1.15)),
    );
    const trailingBuyBudget =
      input.allowedMechanics.includes("market") && input.maxActionsPerTick >= 2
        ? resolveFallbackBuySize(
            input.profile,
            Math.max(0, availableBalance - maxPlayMoney),
            estimatedPrice,
          )
        : 0;

    return tryFallbackDirectPlan({
      userId: input.profile.userId,
      profile: input.runtimeProfile,
      messages:
        trailingBuyBudget > 0
          ? [
              `add up to ${maxShares} shares and $${maxPlayMoney} into ${lpAddHolding.playerId} pool`,
              `buy $${trailingBuyBudget} of ${lpAddHolding.playerId}`,
            ]
          : [
              `add up to ${maxShares} shares and $${maxPlayMoney} into ${lpAddHolding.playerId} pool`,
            ],
      allowedMechanics: input.allowedMechanics,
      maxActionsPerTick: input.maxActionsPerTick,
      warning:
        trailingBuyBudget > 0
          ? `Used fallback LP-plus-buy bundle for ${lpAddHolding.name}.`
          : `Used fallback LP add for ${lpAddHolding.name}.`,
    });
  };

  const tryLiquidityZap = async () => {
    if (
      !input.allowedMechanics.includes("liquidity") ||
      !liquidityCandidate ||
      liquidityBudget < 10
    ) {
      return null;
    }

    return tryFallbackDirectPlan({
      userId: input.profile.userId,
      profile: input.runtimeProfile,
      messages: [`zap $${liquidityBudget} into ${liquidityCandidate.playerId} pool`],
      allowedMechanics: input.allowedMechanics,
      maxActionsPerTick: input.maxActionsPerTick,
      warning: `Used fallback LP zap for ${"playerName" in liquidityCandidate ? liquidityCandidate.playerName : liquidityCandidate.name}.`,
    });
  };

  const tryLiquidityRemove = async () => {
    if (!input.allowedMechanics.includes("liquidity") || removableLpPositions.length === 0) {
      return null;
    }

    const target = removableLpPositions[0];
    const lpShares = Math.min(5, Math.max(0.25, Number((target.lpShares * 0.15).toFixed(2))));

    return tryFallbackDirectPlan({
      userId: input.profile.userId,
      profile: input.runtimeProfile,
      messages: [`remove ${formatFallbackNumber(lpShares)} lp shares from ${target.playerId} pool`],
      allowedMechanics: input.allowedMechanics,
      maxActionsPerTick: input.maxActionsPerTick,
      warning: `Used fallback LP removal for ${target.playerId}.`,
    });
  };

  const tryMarketSell = async () => {
    if (!input.allowedMechanics.includes("market") || !sellHolding) {
      return null;
    }

    const sharesToSell = Math.min(3, Math.max(1, Math.floor(sellHolding.availableShares * 0.1)));
    return tryFallbackDirectPlan({
      userId: input.profile.userId,
      profile: input.runtimeProfile,
      messages: [`sell ${sharesToSell} shares of ${sellHolding.playerId}`],
      allowedMechanics: input.allowedMechanics,
      maxActionsPerTick: input.maxActionsPerTick,
      warning: `Used fallback trim on ${sellHolding.name}.`,
    });
  };

  const tryScoutAction = async () => {
    if (!input.allowedMechanics.includes("scouting") || !scoutFallback.action) {
      return null;
    }

    return {
      plannedActions: [scoutFallback.action],
      warnings: [scoutFallback.warning || "Used fallback scout adjustment."],
      summary: `Fallback staged a scout adjustment on ${"playerName" in scoutFallback.action ? scoutFallback.action.playerName : "the target player"}.`,
    } satisfies FallbackPlanChoice;
  };

  const roleAttempts: Record<string, Array<() => Promise<FallbackPlanChoice | null>>> = {
    contest: [tryBoostAssign, tryScoutAction, tryMarketSell, tryLiquidityAdd],
    market_maker: [tryLiquidityAdd, tryLiquidityZap, tryLiquidityRemove, tryBoostAssign],
    casual: [tryScoutAction, tryLiquidityAdd, tryBoostAssign, tryLiquidityZap],
    trader: [tryMarketSell, tryBoostAssign, tryLiquidityRemove, tryLiquidityAdd],
  };

  const attempts = roleAttempts[input.profile.botRole] || [
    tryBoostAssign,
    tryLiquidityAdd,
    tryScoutAction,
    tryMarketSell,
  ];

  for (const attempt of attempts) {
    const plan = await attempt();
    if (plan && plan.plannedActions.length > 0) {
      return plan;
    }
  }

  const directFallback = chooseFallbackAction({
    profile: input.profile,
    sharedBrief: input.sharedBrief,
    context: input.context,
    recentActions: input.recentActions,
    allowedMechanics: input.allowedMechanics,
  });

  if (directFallback.action) {
    return {
      plannedActions: [directFallback.action],
      warnings: [directFallback.warning || "Used deterministic fallback action."],
      summary: `Fallback staged ${directFallback.action.actionType} after Hermes planning failed.`,
    };
  }

  return null;
}

function chooseFallbackAction(input: {
  profile: BotRuntimeProfile;
  sharedBrief: SharedBriefRecord;
  context: ScoutAgentContext;
  recentActions: (typeof botActionsLog.$inferSelect)[];
  allowedMechanics: BotMechanic[];
}): { action: AgentAction | null; warning?: string } {
  const recentPlayerIds = getRecentActionPlayerIds(input.recentActions);
  const snapshot = getSnapshotFromBrief(input.sharedBrief);
  const coldPools = (snapshot?.coldPools || [])
    .filter((entry) => !recentPlayerIds.has(entry.playerId))
    .slice(0, MAX_FALLBACK_CANDIDATES);
  const movers = [...(snapshot?.movers || [])]
    .sort((left, right) => Math.abs(right.priceChange24h) - Math.abs(left.priceChange24h))
    .filter((entry) => !recentPlayerIds.has(entry.playerId))
    .slice(0, MAX_FALLBACK_CANDIDATES)
    .map((entry) => ({
      playerId: entry.playerId,
      playerName: entry.playerName,
      estimatedPrice: entry.currentPrice,
    }));
  const focusCandidates = input.context.candidates
    .filter((entry) => entry.hasGameInFocusWindow && !recentPlayerIds.has(entry.playerId))
    .sort((left, right) => right.scoutOpportunityScore - left.scoutOpportunityScore)
    .slice(0, MAX_FALLBACK_CANDIDATES);
  const scoutCandidates = input.context.candidates
    .filter((entry) => !recentPlayerIds.has(entry.playerId))
    .sort((left, right) => right.scoutOpportunityScore - left.scoutOpportunityScore)
    .slice(0, MAX_FALLBACK_CANDIDATES);
  const focusMarkets = focusCandidates.map((entry) => ({
    playerId: entry.playerId,
    playerName: entry.name,
    estimatedPrice: null,
  }));
  const availableBalance = Math.max(
    0,
    Math.floor(input.context.operatorOverview.availableBalance || 0),
  );
  const prioritizedMarkets =
    input.profile.botRole === "trader"
      ? [...movers, ...coldPools]
      : input.profile.botRole === "contest"
        ? [...movers, ...focusMarkets, ...coldPools]
        : [...coldPools, ...movers];

  const marketPreferred = prioritizedMarkets.find((candidate) => {
    const estimatedPrice =
      "lastPrice" in candidate ? candidate.lastPrice : (candidate.estimatedPrice ?? null);
    return resolveFallbackBuySize(input.profile, availableBalance, estimatedPrice) > 0;
  });

  if (input.allowedMechanics.includes("market") && marketPreferred) {
    const estimatedPrice =
      "lastPrice" in marketPreferred
        ? marketPreferred.lastPrice
        : (marketPreferred.estimatedPrice ?? null);
    const buySize = resolveFallbackBuySize(input.profile, availableBalance, estimatedPrice);
    return {
      action: {
        actionType: "pool_buy",
        playerId: marketPreferred.playerId,
        playerName: marketPreferred.playerName,
        sbAmount: buySize,
        maxSlippage: input.profile.botRole === "trader" ? 0.1 : 0.12,
        reasoning:
          input.profile.botRole === "trader"
            ? "Fallback trade based on the strongest current market mover from the shared internal brief."
            : "Fallback trade to seed a colder market while Hermes planning is unavailable.",
        confidence: 0.52,
      },
      warning: `Used deterministic fallback planning for ${marketPreferred.playerName}.`,
    };
  }

  if (input.allowedMechanics.includes("scouting") && input.context.remainingScouts > 0) {
    const scoutTarget = focusCandidates[0] || scoutCandidates[0];
    if (scoutTarget) {
      return {
        action: {
          actionType: "scout_set_count",
          playerId: scoutTarget.playerId,
          playerName: scoutTarget.name,
          currentCount: scoutTarget.currentScoutCount,
          targetCount: scoutTarget.currentScoutCount + 1,
          reasoning:
            "Fallback scout adjustment based on the highest current scout opportunity when Hermes planning is unavailable.",
          confidence: 0.5,
          evidence: {
            nextGameAt: scoutTarget.upcomingGame,
            sport: scoutTarget.sport,
            team: scoutTarget.team,
          },
          riskFlags: scoutTarget.injuryStatus ? [`injury: ${scoutTarget.injuryStatus}`] : [],
        },
        warning: `Used deterministic fallback scouting for ${scoutTarget.name}.`,
      };
    }
  }

  return {
    action: null,
    warning: "Fallback planner found no coherent market or scouting action.",
  };
}

async function ensureHermesBotRuntimeSchema() {
  await db.execute(sql`
    ALTER TABLE "bot_profiles"
      ADD COLUMN IF NOT EXISTS "strategy_prompt" text NOT NULL DEFAULT '';
  `);
  await db.execute(sql`
    ALTER TABLE "bot_profiles"
      ADD COLUMN IF NOT EXISTS "allowed_mechanics" text[] NOT NULL DEFAULT ARRAY['market','liquidity','scouting','boosts']::text[];
  `);
  await db.execute(sql`
    ALTER TABLE "bot_profiles"
      ADD COLUMN IF NOT EXISTS "objective_weights" jsonb NOT NULL DEFAULT '{"priceMovement":0.45,"liquidityCoverage":0.35,"variety":0.20}'::jsonb;
  `);
  await db.execute(sql`
    ALTER TABLE "bot_profiles"
      ADD COLUMN IF NOT EXISTS "research_enabled" boolean NOT NULL DEFAULT false;
  `);
  await db.execute(sql`
    ALTER TABLE "bot_profiles"
      ADD COLUMN IF NOT EXISTS "research_query_budget" integer NOT NULL DEFAULT 1;
  `);
  await db.execute(sql`
    ALTER TABLE "bot_profiles"
      ADD COLUMN IF NOT EXISTS "research_ttl_minutes" integer NOT NULL DEFAULT 90;
  `);
  await db.execute(sql`
    ALTER TABLE "bot_profiles"
      ADD COLUMN IF NOT EXISTS "max_actions_per_tick" integer NOT NULL DEFAULT 2;
  `);
  await db.execute(sql`
    ALTER TABLE "bot_profiles"
      ADD COLUMN IF NOT EXISTS "max_player_exposure_percent" numeric(5, 2) NOT NULL DEFAULT 25.00;
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "bot_cycle_briefs" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "cycle_key" text NOT NULL UNIQUE,
      "coordinator_bot_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "status" text NOT NULL DEFAULT 'ready',
      "summary" text NOT NULL,
      "shared_prompt" text NOT NULL,
      "brief_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "citations" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "tool_trace" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "used_research" boolean NOT NULL DEFAULT false,
      "research_query_count" integer NOT NULL DEFAULT 0,
      "expires_at" timestamp NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "bot_run_logs" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "cycle_key" text NOT NULL,
      "bot_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "bot_profile_id" varchar NOT NULL REFERENCES "bot_profiles"("id") ON DELETE CASCADE,
      "cycle_brief_id" varchar REFERENCES "bot_cycle_briefs"("id") ON DELETE SET NULL,
      "thread_id" varchar,
      "status" text NOT NULL DEFAULT 'pending',
      "role" text NOT NULL,
      "summary" text,
      "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "planned_actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "executed_actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "citations" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "tool_trace" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "used_research" boolean NOT NULL DEFAULT false,
      "research_query_count" integer NOT NULL DEFAULT 0,
      "failure_class" text,
      "metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "error_message" text,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "completed_at" timestamp
    );
  `);
  await db.execute(sql`
    ALTER TABLE "bot_run_logs"
      ADD COLUMN IF NOT EXISTS "failure_class" text;
  `);
  await db.execute(sql`
    ALTER TABLE "bot_run_logs"
      ADD COLUMN IF NOT EXISTS "metrics" jsonb NOT NULL DEFAULT '{}'::jsonb;
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "bot_cycle_briefs_expires_idx"
      ON "bot_cycle_briefs" ("expires_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "bot_cycle_briefs_created_idx"
      ON "bot_cycle_briefs" ("created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "bot_run_logs_bot_created_idx"
      ON "bot_run_logs" ("bot_user_id", "created_at");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "bot_run_logs_cycle_idx"
      ON "bot_run_logs" ("cycle_key");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "bot_run_logs_status_idx"
      ON "bot_run_logs" ("status");
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "bot_run_logs_failure_class_idx"
      ON "bot_run_logs" ("failure_class");
  `);
}

async function getActiveBots(): Promise<BotRuntimeProfile[]> {
  const rows = await db
    .select()
    .from(botProfiles)
    .innerJoin(users, eq(botProfiles.userId, users.id))
    .where(eq(botProfiles.isActive, true));

  return rows.map((row) => ({
    ...row.bot_profiles,
    user: row.users,
  }));
}

async function getSharedMarketSnapshot(activeBots: number): Promise<SharedMarketSnapshot> {
  const [poolSummary, coldPools, movers, liveGameStats] = await Promise.all([
    db.execute(sql`
      select
        count(*)::int as total,
        count(*) filter (where coalesce(total_trades, 0) <= 5)::int as low_trade_count,
        coalesce(avg(total_trades), 0)::float as avg_trades
      from player_pools
    `),
    db.execute(sql`
      select
        p.id as player_id,
        p.first_name || ' ' || p.last_name as player_name,
        p.sport,
        p.team,
        pp.total_trades,
        cast(p.last_trade_price as numeric) as last_price,
        pp.updated_at
      from player_pools pp
      inner join players p on p.id = pp.player_id
      where p.is_active = true
      order by pp.total_trades asc, pp.updated_at asc
      limit 10
    `),
    db.execute(sql`
      select
        id as player_id,
        first_name || ' ' || last_name as player_name,
        sport,
        team,
        cast(price_change_24h as numeric) as price_change_24h,
        volume_24h,
        cast(current_price as numeric) as current_price
      from players
      where is_active = true
      order by abs(cast(price_change_24h as numeric)) desc, volume_24h desc
      limit 10
    `),
    db.execute(sql`
      select
        count(*) filter (where status = 'inprogress')::int as live_games,
        count(*) filter (
          where status = 'scheduled'
            and start_time > now()
            and start_time <= now() + interval '12 hours'
        )::int as upcoming_games
      from daily_games
    `),
  ]);

  const summaryRow = poolSummary.rows[0] as
    | {
        total: number;
        low_trade_count: number;
        avg_trades: number;
      }
    | undefined;
  const gamesRow = liveGameStats.rows[0] as
    | {
        live_games: number;
        upcoming_games: number;
      }
    | undefined;

  return {
    generatedAt: new Date().toISOString(),
    activeBots,
    liveGames: gamesRow?.live_games || 0,
    upcomingGames: gamesRow?.upcoming_games || 0,
    pools: {
      total: summaryRow?.total || 0,
      lowTradeCount: summaryRow?.low_trade_count || 0,
      avgTrades: Number(summaryRow?.avg_trades || 0),
    },
    coldPools: coldPools.rows.map((row) => {
      const entry = row as {
        player_id: string;
        player_name: string;
        sport: string;
        team: string;
        total_trades: number;
        last_price: string | number | null;
        updated_at: Date | string | null;
      };

      return {
        playerId: entry.player_id,
        playerName: entry.player_name,
        sport: entry.sport,
        team: entry.team,
        totalTrades: entry.total_trades,
        lastPrice: entry.last_price == null ? null : Number(entry.last_price),
        lastUpdated:
          entry.updated_at instanceof Date
            ? entry.updated_at.toISOString()
            : entry.updated_at
              ? new Date(entry.updated_at).toISOString()
              : null,
      };
    }),
    movers: movers.rows.map((row) => {
      const entry = row as {
        player_id: string;
        player_name: string;
        sport: string;
        team: string;
        price_change_24h: string | number;
        volume_24h: number;
        current_price: string | number | null;
      };

      return {
        playerId: entry.player_id,
        playerName: entry.player_name,
        sport: entry.sport,
        team: entry.team,
        priceChange24h: Number(entry.price_change_24h || 0),
        volume24h: entry.volume_24h || 0,
        currentPrice: entry.current_price == null ? null : Number(entry.current_price),
      };
    }),
  };
}

async function getOrCreateBotThread(userId: string, botName: string) {
  await ensureAgentThreadSchema();

  const externalThreadKey = `bot-runtime:${userId}`;
  const [existingThread] = await db
    .select()
    .from(userAgentThreads)
    .where(
      and(
        eq(userAgentThreads.userId, userId),
        eq(userAgentThreads.status, "active"),
        eq(userAgentThreads.externalThreadKey, externalThreadKey),
      ),
    )
    .orderBy(desc(userAgentThreads.updatedAt))
    .limit(1);

  if (existingThread) {
    return existingThread;
  }

  const [thread] = await db
    .insert(userAgentThreads)
    .values({
      userId,
      channel: "cli",
      domain: "sportfolio",
      status: "active",
      title: `${botName} Runtime`,
      externalThreadKey,
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return thread;
}

function getSharedResearchTtlMinutes(activeBots: BotRuntimeProfile[]) {
  const ttlCandidates = activeBots
    .map((bot) => {
      const defaults = getRoleDefaults(bot.botRole);
      const researchEnabled =
        Boolean(bot.researchEnabled || defaults.researchEnabled) &&
        (bot.researchQueryBudget || defaults.researchQueryBudget) > 0;
      if (!researchEnabled) {
        return 0;
      }

      return bot.researchTtlMinutes || 90;
    })
    .filter((value): value is number => Number.isFinite(value) && value > 0);

  if (ttlCandidates.length === 0) {
    return 0;
  }

  return Math.min(...ttlCandidates);
}

async function getCachedSharedResearch(ttlMinutes: number) {
  if (ttlMinutes <= 0) {
    return null;
  }

  const [brief] = await db
    .select()
    .from(botCycleBriefs)
    .where(
      sql`${botCycleBriefs.usedResearch} = true and ${botCycleBriefs.createdAt} >= now() - (${ttlMinutes} || ' minutes')::interval`,
    )
    .orderBy(desc(botCycleBriefs.createdAt))
    .limit(1);

  return brief || null;
}

async function maybeLoadSharedResearch(input: {
  activeBots: BotRuntimeProfile[];
  snapshot: SharedMarketSnapshot;
  coordinatorProfile: UserAgentProfile;
}) {
  if (!isHostedWebResearchAvailable()) {
    return null;
  }

  const ttlMinutes = getSharedResearchTtlMinutes(input.activeBots);
  const cached = await getCachedSharedResearch(ttlMinutes);
  if (cached) {
    return {
      summary: cached.summary,
      citations: (cached.citations as AgentCitation[] | null) || [],
      warnings: (cached.warnings as string[] | null) || [],
      queryCount: 0,
      reused: true,
    };
  }

  const plan = await planHostedWebResearch({
    message: buildSharedResearchRequest(input.snapshot, input.activeBots),
    profile: input.coordinatorProfile,
  });

  if (!plan) {
    return null;
  }

  return {
    summary: plan.summary || plan.replyText || null,
    citations: plan.citations || [],
    warnings: plan.warnings || [],
    queryCount:
      plan.trace && typeof plan.trace === "object" && "queryCount" in plan.trace
        ? Number((plan.trace as Record<string, unknown>).queryCount || 1)
        : 1,
    reused: false,
  };
}

async function getSharedBrief(cycleKey: string) {
  const [brief] = await db
    .select()
    .from(botCycleBriefs)
    .where(eq(botCycleBriefs.cycleKey, cycleKey))
    .limit(1);

  return brief || null;
}

async function createSharedBrief(activeBots: BotRuntimeProfile[], cycleKey: string) {
  const startedAt = Date.now();
  const coordinator = activeBots.find((bot) => bot.botRole === "market_maker") || activeBots[0];
  const allowResearch =
    isHostedWebResearchAvailable() &&
    activeBots.some((bot) => {
      const defaults = getRoleDefaults(bot.botRole);
      return (
        Boolean(bot.researchEnabled || defaults.researchEnabled) &&
        (bot.researchQueryBudget || defaults.researchQueryBudget) > 0
      );
    });
  const profileView = await getScoutAgentProfile(coordinator.userId);
  const snapshot = await getSharedMarketSnapshot(activeBots.length);
  const coordinatorProfile = buildRuntimeProfile(profileView.profile, {
    displayName: "Hermes Bot Coordinator",
    systemPrompt: buildCoordinatorSystemPrompt(),
    temperature: "0.15",
    maxTokens: 900,
  });
  const sharedResearch = allowResearch
    ? await maybeLoadSharedResearch({
        activeBots,
        snapshot,
        coordinatorProfile,
      })
    : null;

  if (shouldUseSyntheticSharedBriefRuntime()) {
    const syntheticBrief = buildSyntheticSharedBrief(
      snapshot,
      activeBots,
      sharedResearch?.reused
        ? "Reused cached shared research and internal market state."
        : "Shared brief generated from internal market state.",
      {
        researchSummary: sharedResearch?.summary || null,
        citations: sharedResearch?.citations || [],
        warnings: sharedResearch?.warnings || [],
        usedResearch: Boolean(sharedResearch),
        researchQueryCount: sharedResearch?.queryCount || 0,
      },
    );

    const [brief] = await db
      .insert(botCycleBriefs)
      .values({
        cycleKey,
        coordinatorBotUserId: coordinator.userId,
        status: "ready",
        summary: syntheticBrief.summary,
        sharedPrompt: syntheticBrief.sharedPrompt,
        briefPayload: safeJsonClone({
          ...(syntheticBrief.briefPayload || {
            snapshot,
          }),
          metrics: {
            latencyMs: Math.max(0, Date.now() - startedAt),
            activeBotCount: activeBots.length,
            cycleIntervalMinutes: getBotCycleIntervalMinutes(),
          },
        }),
        warnings: safeJsonClone(syntheticBrief.warnings || []),
        citations: safeJsonClone(syntheticBrief.citations || []),
        toolTrace: safeJsonClone(syntheticBrief.toolTrace || []),
        usedResearch: Boolean(syntheticBrief.usedResearch),
        researchQueryCount: syntheticBrief.researchQueryCount || 0,
        expiresAt: buildCycleExpiry(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: botCycleBriefs.cycleKey,
        set: {
          coordinatorBotUserId: coordinator.userId,
          status: "ready",
          summary: syntheticBrief.summary,
          sharedPrompt: syntheticBrief.sharedPrompt,
          briefPayload: safeJsonClone({
            ...(syntheticBrief.briefPayload || {
              snapshot,
            }),
            metrics: {
              latencyMs: Math.max(0, Date.now() - startedAt),
              activeBotCount: activeBots.length,
              cycleIntervalMinutes: getBotCycleIntervalMinutes(),
            },
          }),
          warnings: safeJsonClone(syntheticBrief.warnings || []),
          citations: safeJsonClone(syntheticBrief.citations || []),
          toolTrace: safeJsonClone(syntheticBrief.toolTrace || []),
          usedResearch: Boolean(syntheticBrief.usedResearch),
          researchQueryCount: syntheticBrief.researchQueryCount || 0,
          expiresAt: buildCycleExpiry(),
          updatedAt: new Date(),
        },
      })
      .returning();

    return brief;
  }

  const rawContext = await loadScoutAgentContext(coordinator.userId, coordinatorProfile, {
    chatRequest: "shared bot market brief",
  });
  const context = compactBotContext(rawContext, {
    assignments: 4,
    candidates: 8,
    recommendedTargets: 4,
    topHoldings: 4,
    nextBestLevers: 3,
    knowledgeBrief: 3,
  });
  const requestMessage = buildSharedBriefRequest(snapshot, activeBots);
  let briefTurn: HermesRespondResult | null = null;
  let syntheticBriefReason: string | null = null;

  try {
    const candidateTurn = await withTimeout(
      runHermesAgentTurn({
        userId: coordinator.userId,
        threadId: null,
        channel: "cli",
        message: requestMessage,
        requestMode: "discussion",
        profile: coordinatorProfile,
        context,
        capabilities: {
          domains: ["sportfolio", "player_pools", "daily_boosts", "scouting"],
          actionTypes: [],
          canAnalyze: true,
          canAutoExecute: false,
          canUseWebResearch: allowResearch,
          runtime: "hermes",
          hasDurableMemory: true,
          canScheduleAdvisories: false,
        },
        memoryContext: buildEmptyMemoryContext(),
        toolAllowlist: buildSharedBriefToolAllowlist(allowResearch),
        autoExecutionPolicy: {
          allowAdvisoryJobs: true,
          allowRiskyActions: false,
        },
        confirmationPolicy: {
          requireExplicitConfirmation: false,
          preferredChannel: "cli",
        },
        externalResearch: sharedResearch?.citations || [],
      }),
      getSharedBriefTimeoutMs(),
      `Shared brief generation timed out after ${getSharedBriefTimeoutMs()}ms`,
    );

    if (shouldUseSyntheticSharedBrief(candidateTurn)) {
      syntheticBriefReason =
        candidateTurn.summary ||
        candidateTurn.assistantText ||
        "Hermes shared brief returned an unusably generic summary.";
    } else {
      briefTurn = candidateTurn;
    }
  } catch (error: any) {
    syntheticBriefReason = error?.message || "Hermes shared brief failed";
  }

  const syntheticBrief =
    syntheticBriefReason != null
      ? buildSyntheticSharedBrief(snapshot, activeBots, syntheticBriefReason)
      : null;
  const briefSummary = briefTurn?.summary || syntheticBrief?.summary || "Shared market brief";
  const sharedPrompt =
    briefTurn != null
      ? [briefTurn.summary || "Shared market brief", briefTurn.assistantText || ""]
          .filter(Boolean)
          .join("\n\n")
      : (syntheticBrief?.sharedPrompt ?? requestMessage);

  const [brief] = await db
    .insert(botCycleBriefs)
    .values({
      cycleKey,
      coordinatorBotUserId: coordinator.userId,
      status: briefTurn?.outcome === "error" ? "failed" : "ready",
      summary: briefSummary,
      sharedPrompt,
      briefPayload: safeJsonClone({
        ...(syntheticBrief?.briefPayload || {
          snapshot,
          assistantText: briefTurn?.assistantText || "",
          warnings: briefTurn?.warnings || [],
        }),
        metrics: {
          latencyMs: Math.max(0, Date.now() - startedAt),
          activeBotCount: activeBots.length,
          cycleIntervalMinutes: getBotCycleIntervalMinutes(),
        },
      }),
      warnings: safeJsonClone(syntheticBrief?.warnings || briefTurn?.warnings || []),
      citations: safeJsonClone(syntheticBrief?.citations || briefTurn?.citations || []),
      toolTrace: safeJsonClone(syntheticBrief?.toolTrace || briefTurn?.toolTrace || []),
      usedResearch:
        syntheticBrief?.usedResearch ||
        Boolean(briefTurn?.toolCallsUsed.includes("get_hosted_research")),
      researchQueryCount:
        syntheticBrief?.researchQueryCount || countResearchCalls(briefTurn?.toolTrace || []),
      expiresAt: buildCycleExpiry(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: botCycleBriefs.cycleKey,
      set: {
        coordinatorBotUserId: coordinator.userId,
        status: briefTurn?.outcome === "error" ? "failed" : "ready",
        summary: briefSummary,
        sharedPrompt,
        briefPayload: safeJsonClone({
          ...(syntheticBrief?.briefPayload || {
            snapshot,
            assistantText: briefTurn?.assistantText || "",
            warnings: briefTurn?.warnings || [],
          }),
          metrics: {
            latencyMs: Math.max(0, Date.now() - startedAt),
            activeBotCount: activeBots.length,
            cycleIntervalMinutes: getBotCycleIntervalMinutes(),
          },
        }),
        warnings: safeJsonClone(syntheticBrief?.warnings || briefTurn?.warnings || []),
        citations: safeJsonClone(syntheticBrief?.citations || briefTurn?.citations || []),
        toolTrace: safeJsonClone(syntheticBrief?.toolTrace || briefTurn?.toolTrace || []),
        usedResearch:
          syntheticBrief?.usedResearch ||
          Boolean(briefTurn?.toolCallsUsed.includes("get_hosted_research")),
        researchQueryCount:
          syntheticBrief?.researchQueryCount || countResearchCalls(briefTurn?.toolTrace || []),
        expiresAt: buildCycleExpiry(),
        updatedAt: new Date(),
      },
    })
    .returning();

  return brief;
}

async function getOrCreateSharedBrief(activeBots: BotRuntimeProfile[], cycleKey: string) {
  const existing = await getSharedBrief(cycleKey);
  if (existing && existing.expiresAt > new Date()) {
    return existing;
  }

  return createSharedBrief(activeBots, cycleKey);
}

function isExplicitNoAction(
  summary: string | null | undefined,
  assistantText: string | null | undefined,
) {
  return BOT_NO_ACTION_PATTERN.test(`${summary || ""}\n${assistantText || ""}`);
}

function classifyPlanningFailure(turn: {
  outcome: string;
  summary: string | null;
  assistantText: string;
  toolCallsUsed: string[];
  fallbackUsed?: boolean;
}): BotRunFailureClass {
  const combined = `${turn.summary || ""}\n${turn.assistantText || ""}`;
  if (
    DIRECT_TOOL_LOOP_FAILURE_PATTERN.test(combined) ||
    turn.toolCallsUsed.includes("model_first_fallback") ||
    turn.fallbackUsed
  ) {
    return "direct_loop_unusable";
  }

  if (
    turn.outcome === "advisory" ||
    turn.outcome === "unsupported" ||
    turn.outcome === "clarification"
  ) {
    return "advisory_only";
  }

  return "planning_error";
}

function summarizeTurn(turn: { summary: string | null; assistantText: string }, fallback: string) {
  return turn.summary || turn.assistantText || fallback;
}

function summarizeMechanicCounts(actions: AgentAction[]) {
  const counts: Partial<Record<BotMechanic, number>> = {};

  for (const action of actions) {
    const mechanic = mapActionToMechanic(action);
    if (!mechanic) {
      continue;
    }
    counts[mechanic] = (counts[mechanic] || 0) + 1;
  }

  return counts;
}

function buildRunMetrics(input: {
  planningLatencyMs: number;
  executionLatencyMs: number;
  proposedActionCount: number;
  executableActionCount: number;
  droppedActionCount: number;
  successfulActionCount: number;
  failedActionCount: number;
  timedOut: boolean;
  plannedActions?: AgentAction[];
  fallbackUsed?: boolean;
  hermesNative?: boolean;
  usedSharedResearch?: boolean;
  usedSyntheticBrief?: boolean;
}): BotRunMetrics {
  const plannedActions = input.plannedActions || [];
  return {
    planningLatencyMs: input.planningLatencyMs,
    executionLatencyMs: input.executionLatencyMs,
    totalLatencyMs: input.planningLatencyMs + input.executionLatencyMs,
    proposedActionCount: input.proposedActionCount,
    executableActionCount: input.executableActionCount,
    droppedActionCount: input.droppedActionCount,
    successfulActionCount: input.successfulActionCount,
    failedActionCount: input.failedActionCount,
    timedOut: input.timedOut,
    fallbackUsed: Boolean(input.fallbackUsed),
    hermesNative: input.hermesNative !== false,
    actionTypes: plannedActions.map((action) => action.actionType),
    mechanicCounts: summarizeMechanicCounts(plannedActions),
    usedSharedResearch: Boolean(input.usedSharedResearch),
    usedSyntheticBrief: Boolean(input.usedSyntheticBrief),
  };
}

async function getRecentRunSummaries(userId: string) {
  return db
    .select()
    .from(botRunLogs)
    .where(eq(botRunLogs.botUserId, userId))
    .orderBy(desc(botRunLogs.createdAt))
    .limit(MAX_RECENT_RUN_SUMMARIES);
}

async function getRecentBotActions(userId: string) {
  return db
    .select()
    .from(botActionsLog)
    .where(eq(botActionsLog.botUserId, userId))
    .orderBy(desc(botActionsLog.createdAt))
    .limit(MAX_RECENT_ACTIONS);
}

async function executeFallbackPlan(input: {
  profile: BotRuntimeProfile;
  runtimeProfile: UserAgentProfile;
  cycleBrief: SharedBriefRecord;
  context: ScoutAgentContext;
  recentActions: (typeof botActionsLog.$inferSelect)[];
  allowedMechanics: BotMechanic[];
  maxActionsPerTick: number;
  threadId: string | null;
  planningLatencyMs: number;
  reason: string;
}): Promise<BotPlanResult> {
  const fallback = await chooseFallbackPlan({
    profile: input.profile,
    runtimeProfile: input.runtimeProfile,
    sharedBrief: input.cycleBrief,
    context: input.context,
    recentActions: input.recentActions,
    allowedMechanics: input.allowedMechanics,
    maxActionsPerTick: input.maxActionsPerTick,
  });
  const plannedActions = fallback?.plannedActions || [];
  const executionStartedAt = Date.now();
  const executedActions =
    plannedActions.length > 0
      ? await executePlannedActions(input.profile, input.cycleBrief, plannedActions)
      : [];
  const executionLatencyMs = Math.max(0, Date.now() - executionStartedAt);
  const successfulActionCount = executedActions.filter((entry) => entry.success).length;
  const failedActionCount = executedActions.length - successfulActionCount;
  const metrics = buildRunMetrics({
    planningLatencyMs: input.planningLatencyMs,
    executionLatencyMs,
    proposedActionCount: plannedActions.length,
    executableActionCount: plannedActions.length,
    droppedActionCount: 0,
    successfulActionCount,
    failedActionCount,
    timedOut: /timed out/i.test(input.reason),
    plannedActions,
    fallbackUsed: true,
    hermesNative: false,
    usedSharedResearch: Boolean(input.cycleBrief.usedResearch),
    usedSyntheticBrief: Boolean(
      (input.cycleBrief.briefPayload as Record<string, unknown> | null)?.synthetic,
    ),
  });
  const warnings = [...(fallback?.warnings || []), `Fallback reason: ${input.reason}`].filter(
    (entry): entry is string => Boolean(entry),
  );

  if (successfulActionCount > 0) {
    return {
      status: "executed",
      failureClass: null,
      summary:
        fallback?.summary || `Fallback executed after Hermes planning failed: ${input.reason}`,
      warnings,
      plannedActions,
      executedActions,
      citations: [],
      toolTrace: [],
      usedResearch: Boolean(input.cycleBrief.usedResearch),
      researchQueryCount: input.cycleBrief.researchQueryCount || 0,
      threadId: input.threadId,
      metrics,
    };
  }

  if (plannedActions.length > 0) {
    return {
      status: "planned_no_fill",
      failureClass: "execution_failed",
      summary:
        fallback?.summary ||
        `Fallback planned an action, but execution did not complete: ${input.reason}`,
      warnings,
      plannedActions,
      executedActions,
      citations: [],
      toolTrace: [],
      usedResearch: Boolean(input.cycleBrief.usedResearch),
      researchQueryCount: input.cycleBrief.researchQueryCount || 0,
      threadId: input.threadId,
      errorMessage: "Fallback action failed during execution.",
      metrics,
    };
  }

  return {
    status: "no_action",
    failureClass: null,
    summary: `NO_ACTION: ${fallback?.warnings[0] || "Fallback planner found no coherent action."}`,
    warnings,
    plannedActions: [],
    executedActions: [],
    citations: [],
    toolTrace: [],
    usedResearch: Boolean(input.cycleBrief.usedResearch),
    researchQueryCount: input.cycleBrief.researchQueryCount || 0,
    threadId: input.threadId,
    metrics,
  };
}

async function logBotAction(
  botUserId: string,
  actionType: string,
  actionDetails: Record<string, unknown>,
  triggerReason: string,
  success: boolean,
  errorMessage?: string | null,
) {
  await db.insert(botActionsLog).values({
    botUserId,
    actionType,
    actionDetails: safeJsonClone(actionDetails),
    triggerReason,
    success,
    errorMessage: errorMessage || null,
  });
}

async function updateBotCounters(profileId: string, orderDelta: number, volumeDelta: number) {
  await db
    .update(botProfiles)
    .set({
      ordersToday: sql`${botProfiles.ordersToday} + ${Math.max(0, Math.round(orderDelta))}`,
      volumeToday: sql`${botProfiles.volumeToday} + ${Math.max(0, Math.round(volumeDelta))}`,
      updatedAt: new Date(),
    })
    .where(eq(botProfiles.id, profileId));
}

async function maybeResetDailyCounters(profile: BotRuntimeProfile) {
  const now = new Date();
  const lastReset = new Date(profile.lastResetDate);
  if (
    now.getUTCFullYear() !== lastReset.getUTCFullYear() ||
    now.getUTCMonth() !== lastReset.getUTCMonth() ||
    now.getUTCDate() !== lastReset.getUTCDate()
  ) {
    await db
      .update(botProfiles)
      .set({
        ordersToday: 0,
        volumeToday: 0,
        lastResetDate: now,
        updatedAt: now,
      })
      .where(eq(botProfiles.id, profile.id));

    return {
      ...profile,
      ordersToday: 0,
      volumeToday: 0,
      lastResetDate: now,
    };
  }

  return profile;
}

async function executePlannedActions(
  profile: BotRuntimeProfile,
  cycleBrief: SharedBriefRecord,
  actions: AgentAction[],
) {
  const executedActions: ExecutedBotAction[] = [];
  let successfulOrders = 0;
  let successfulVolume = 0;

  for (const action of actions) {
    try {
      await executeAgentActions(profile.userId, [action]);
      successfulOrders += 1;
      successfulVolume += estimateActionVolume(action);
      executedActions.push({
        actionType: action.actionType,
        success: true,
      });
      await logBotAction(
        profile.userId,
        action.actionType,
        {
          cycleKey: cycleBrief.cycleKey,
          action,
        },
        cycleBrief.summary,
        true,
      );
    } catch (error: any) {
      const message = error?.message || "Execution failed";
      executedActions.push({
        actionType: action.actionType,
        success: false,
        errorMessage: message,
      });
      await logBotAction(
        profile.userId,
        action.actionType,
        {
          cycleKey: cycleBrief.cycleKey,
          action,
        },
        cycleBrief.summary,
        false,
        message,
      );
    }
  }

  if (successfulOrders > 0 || successfulVolume > 0) {
    await updateBotCounters(profile.id, successfulOrders, successfulVolume);
    await db
      .update(botProfiles)
      .set({
        lastActionAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(botProfiles.id, profile.id));
  }

  return executedActions;
}

async function runBotPlan(profile: BotRuntimeProfile, cycleBrief: SharedBriefRecord) {
  const normalizedProfile = await maybeResetDailyCounters(profile);
  const roleDefaults = getRoleDefaults(normalizedProfile.botRole);
  const allowedMechanics = normalizeAllowedMechanics(
    normalizedProfile.allowedMechanics,
    roleDefaults.allowedMechanics,
  );
  const objectiveWeights = normalizeObjectiveWeights(
    normalizedProfile.objectiveWeights,
    roleDefaults.objectiveWeights,
  );
  const maxActionsPerTick = Math.max(
    0,
    normalizedProfile.maxActionsPerTick || roleDefaults.maxActionsPerTick,
  );

  if (
    normalizedProfile.maxDailyOrders > 0 &&
    normalizedProfile.ordersToday >= normalizedProfile.maxDailyOrders
  ) {
    return {
      status: "no_action",
      failureClass: null,
      summary: `${normalizedProfile.botName} hit the daily order cap.`,
      warnings: ["Daily order cap reached."],
      plannedActions: [] as AgentAction[],
      executedActions: [] as ExecutedBotAction[],
      citations: [] as AgentCitation[],
      toolTrace: [] as AgentToolTrace[],
      usedResearch: false,
      researchQueryCount: 0,
      threadId: null as string | null,
      metrics: buildRunMetrics({
        planningLatencyMs: 0,
        executionLatencyMs: 0,
        proposedActionCount: 0,
        executableActionCount: 0,
        droppedActionCount: 0,
        successfulActionCount: 0,
        failedActionCount: 0,
        timedOut: false,
        usedSyntheticBrief: Boolean(
          (cycleBrief.briefPayload as Record<string, unknown> | null)?.synthetic,
        ),
        usedSharedResearch: Boolean(cycleBrief.usedResearch),
      }),
    } satisfies BotPlanResult;
  }

  if (
    normalizedProfile.maxDailyVolume > 0 &&
    normalizedProfile.volumeToday >= normalizedProfile.maxDailyVolume
  ) {
    return {
      status: "no_action",
      failureClass: null,
      summary: `${normalizedProfile.botName} hit the daily volume cap.`,
      warnings: ["Daily volume cap reached."],
      plannedActions: [] as AgentAction[],
      executedActions: [] as ExecutedBotAction[],
      citations: [] as AgentCitation[],
      toolTrace: [] as AgentToolTrace[],
      usedResearch: false,
      researchQueryCount: 0,
      threadId: null as string | null,
      metrics: buildRunMetrics({
        planningLatencyMs: 0,
        executionLatencyMs: 0,
        proposedActionCount: 0,
        executableActionCount: 0,
        droppedActionCount: 0,
        successfulActionCount: 0,
        failedActionCount: 0,
        timedOut: false,
        usedSyntheticBrief: Boolean(
          (cycleBrief.briefPayload as Record<string, unknown> | null)?.synthetic,
        ),
        usedSharedResearch: Boolean(cycleBrief.usedResearch),
      }),
    } satisfies BotPlanResult;
  }

  const [thread, profileView, recentRuns, recentActions] = await Promise.all([
    getOrCreateBotThread(normalizedProfile.userId, normalizedProfile.botName),
    getScoutAgentProfile(normalizedProfile.userId),
    getRecentRunSummaries(normalizedProfile.userId),
    getRecentBotActions(normalizedProfile.userId),
  ]);

  const requestMessage = buildBotPlanningRequest({
    profile: {
      ...normalizedProfile,
      strategyPrompt: normalizedProfile.strategyPrompt || roleDefaults.strategyPrompt,
    },
    sharedBrief: cycleBrief,
    recentActions,
    recentRuns,
    allowedMechanics,
    maxActionsPerTick,
    objectiveWeights,
  });

  const runtimeProfile = buildRuntimeProfile(profileView.profile, {
    displayName: normalizedProfile.botName,
    systemPrompt: buildBotSystemPrompt({
      botName: normalizedProfile.botName,
      botRole: normalizedProfile.botRole,
      strategyPrompt: normalizedProfile.strategyPrompt || roleDefaults.strategyPrompt,
      allowedMechanics,
    }),
    temperature: normalizedProfile.botRole === "trader" ? "0.25" : "0.18",
    maxTokens: 900,
  });
  const rawContext = await loadScoutAgentContext(normalizedProfile.userId, runtimeProfile, {
    chatRequest: requestMessage,
  });
  const context = compactBotContext(rawContext, {
    assignments: 6,
    candidates: 12,
    recommendedTargets: 6,
    topHoldings: 6,
    nextBestLevers: 4,
    knowledgeBrief: 4,
  });

  const planningStartedAt = Date.now();
  let timedOut = false;
  let planTurn: HermesRespondResult;
  try {
    planTurn = await withTimeout(
      runHermesAgentTurn({
        userId: normalizedProfile.userId,
        threadId: thread.id,
        channel: "cli",
        message: requestMessage,
        requestMode: "plan",
        profile: runtimeProfile,
        context,
        capabilities: {
          domains: buildBotPlanningDomains(allowedMechanics),
          actionTypes: buildBotPlanningActionTypes(allowedMechanics),
          canAnalyze: true,
          canAutoExecute: true,
          canUseWebResearch: false,
          runtime: "hermes",
          hasDurableMemory: true,
          canScheduleAdvisories: false,
        },
        memoryContext: buildEmptyMemoryContext(),
        toolAllowlist: buildBotToolAllowlist(allowedMechanics),
        autoExecutionPolicy: {
          allowAdvisoryJobs: true,
          allowRiskyActions: true,
        },
        confirmationPolicy: {
          requireExplicitConfirmation: false,
          preferredChannel: "cli",
        },
        externalResearch: cycleBrief.citations as AgentCitation[],
      }),
      getBotTurnTimeoutMs(),
      `${normalizedProfile.botName} planning timed out after ${getBotTurnTimeoutMs()}ms`,
    );
  } catch (error: any) {
    timedOut = /timed out/i.test(error?.message || "");
    return executeFallbackPlan({
      profile: normalizedProfile,
      runtimeProfile,
      cycleBrief,
      context,
      recentActions,
      allowedMechanics,
      maxActionsPerTick,
      threadId: thread.id,
      planningLatencyMs: Math.max(0, Date.now() - planningStartedAt),
      reason: error?.message || `${normalizedProfile.botName} planning failed`,
    });
  }
  const planningLatencyMs = Math.max(0, Date.now() - planningStartedAt);

  if (
    planTurn.outcome === "error" ||
    (planTurn.proposedActions.length === 0 &&
      !isExplicitNoAction(planTurn.summary, planTurn.assistantText))
  ) {
    const failureClass = classifyPlanningFailure(planTurn);
    if (failureClass === "planning_error" || failureClass === "direct_loop_unusable") {
      return executeFallbackPlan({
        profile: normalizedProfile,
        runtimeProfile,
        cycleBrief,
        context,
        recentActions,
        allowedMechanics,
        maxActionsPerTick,
        threadId: thread.id,
        planningLatencyMs,
        reason: summarizeTurn(planTurn, `${normalizedProfile.botName} planning failed`),
      });
    }
  }

  const { executable, dropped } = filterExecutableActions(
    planTurn.proposedActions,
    allowedMechanics,
    maxActionsPerTick,
  );
  const executionStartedAt = Date.now();
  const executedActions = await executePlannedActions(normalizedProfile, cycleBrief, executable);
  const executionLatencyMs = Math.max(0, Date.now() - executionStartedAt);
  const successfulActionCount = executedActions.filter((entry) => entry.success).length;
  const failedActionCount = executedActions.length - successfulActionCount;
  const metrics = buildRunMetrics({
    planningLatencyMs,
    executionLatencyMs,
    proposedActionCount: planTurn.proposedActions.length,
    executableActionCount: executable.length,
    droppedActionCount: dropped.length,
    successfulActionCount,
    failedActionCount,
    timedOut,
    plannedActions: planTurn.proposedActions,
    fallbackUsed: false,
    hermesNative: true,
    usedSharedResearch: Boolean(cycleBrief.usedResearch),
    usedSyntheticBrief: Boolean(
      (cycleBrief.briefPayload as Record<string, unknown> | null)?.synthetic,
    ),
  });

  if (planTurn.proposedMemoryWrites.length > 0) {
    await persistProposedMemoryWrites({
      userId: normalizedProfile.userId,
      threadId: thread.id,
      writes: planTurn.proposedMemoryWrites,
    });
  }

  const summary = summarizeTurn(planTurn, `${normalizedProfile.botName} cycle`);
  const warnings = [
    ...planTurn.warnings,
    ...(dropped.length > 0
      ? [`Dropped ${dropped.length} action(s) outside the bot policy or action cap.`]
      : []),
  ];

  if (successfulActionCount > 0) {
    return {
      status: "executed",
      failureClass: null,
      summary,
      warnings,
      plannedActions: planTurn.proposedActions,
      executedActions,
      citations: planTurn.citations,
      toolTrace: planTurn.toolTrace,
      usedResearch: Boolean(cycleBrief.usedResearch),
      researchQueryCount: cycleBrief.researchQueryCount || 0,
      threadId: thread.id,
      metrics,
    } satisfies BotPlanResult;
  }

  if (planTurn.proposedActions.length > 0 && executable.length === 0 && dropped.length > 0) {
    return {
      status: "policy_filtered",
      failureClass: "policy_filtered",
      summary,
      warnings,
      plannedActions: planTurn.proposedActions,
      executedActions,
      citations: planTurn.citations,
      toolTrace: planTurn.toolTrace,
      usedResearch: Boolean(cycleBrief.usedResearch),
      researchQueryCount: cycleBrief.researchQueryCount || 0,
      threadId: thread.id,
      errorMessage: "All proposed actions were filtered by the bot policy or action cap.",
      metrics,
    } satisfies BotPlanResult;
  }

  if (executable.length > 0) {
    return {
      status: "planned_no_fill",
      failureClass: failedActionCount > 0 ? "execution_failed" : null,
      summary,
      warnings,
      plannedActions: planTurn.proposedActions,
      executedActions,
      citations: planTurn.citations,
      toolTrace: planTurn.toolTrace,
      usedResearch: Boolean(cycleBrief.usedResearch),
      researchQueryCount: cycleBrief.researchQueryCount || 0,
      threadId: thread.id,
      errorMessage: failedActionCount > 0 ? "Planned actions did not execute successfully." : null,
      metrics,
    } satisfies BotPlanResult;
  }

  if (isExplicitNoAction(planTurn.summary, planTurn.assistantText)) {
    return {
      status: "no_action",
      failureClass: null,
      summary,
      warnings,
      plannedActions: planTurn.proposedActions,
      executedActions,
      citations: planTurn.citations,
      toolTrace: planTurn.toolTrace,
      usedResearch: Boolean(cycleBrief.usedResearch),
      researchQueryCount: cycleBrief.researchQueryCount || 0,
      threadId: thread.id,
      metrics,
    } satisfies BotPlanResult;
  }

  return executeFallbackPlan({
    profile: normalizedProfile,
    runtimeProfile,
    cycleBrief,
    context,
    recentActions,
    allowedMechanics,
    maxActionsPerTick,
    threadId: thread.id,
    planningLatencyMs,
    reason: "Bot turn did not produce executable actions or an explicit no-action reason.",
  });
}

async function persistBotRunLog(input: {
  profile: BotRuntimeProfile;
  cycleKey: string;
  cycleBrief: SharedBriefRecord;
  status: BotPlanResult["status"];
  failureClass: BotPlanResult["failureClass"];
  summary: string;
  warnings: string[];
  plannedActions: AgentAction[];
  executedActions: ExecutedBotAction[];
  citations: AgentCitation[];
  toolTrace: AgentToolTrace[];
  usedResearch: boolean;
  researchQueryCount: number;
  threadId: string | null;
  metrics: BotRunMetrics;
  errorMessage?: string | null;
}) {
  await db.insert(botRunLogs).values({
    cycleKey: input.cycleKey,
    botUserId: input.profile.userId,
    botProfileId: input.profile.id,
    cycleBriefId: input.cycleBrief.id,
    threadId: input.threadId,
    status: input.status,
    role: input.profile.botRole,
    summary: input.summary,
    warnings: safeJsonClone(input.warnings),
    plannedActions: safeJsonClone(input.plannedActions),
    executedActions: safeJsonClone(input.executedActions),
    citations: safeJsonClone(input.citations),
    toolTrace: safeJsonClone(input.toolTrace),
    usedResearch: input.usedResearch,
    researchQueryCount: input.researchQueryCount,
    failureClass: input.failureClass,
    metrics: safeJsonClone(input.metrics),
    errorMessage: input.errorMessage || null,
    completedAt: new Date(),
  });
}

export async function runHermesBotEngineTick(): Promise<{
  botsProcessed: number;
  botsSkipped: number;
  errors: number;
}> {
  await ensureHermesBotRuntimeSchema();
  const activeBots = await getActiveBots();
  if (activeBots.length === 0) {
    return { botsProcessed: 0, botsSkipped: 0, errors: 0 };
  }

  const cycleIntervalMinutes = getBotCycleIntervalMinutes();
  const selectedBots = selectBotsForTick(activeBots, new Date(), cycleIntervalMinutes);
  const cycleKey = buildCycleKey(new Date(), cycleIntervalMinutes);
  const cycleBrief = await getOrCreateSharedBrief(selectedBots, cycleKey);
  let botsProcessed = 0;
  let botsSkipped = 0;
  let errors = 0;

  for (const profile of selectedBots) {
    try {
      const result = await runBotPlan(profile, cycleBrief);
      await persistBotRunLog({
        profile,
        cycleKey,
        cycleBrief,
        status: result.status,
        failureClass: result.failureClass,
        summary: result.summary,
        warnings: result.warnings,
        plannedActions: result.plannedActions,
        executedActions: result.executedActions,
        citations: result.citations,
        toolTrace: result.toolTrace,
        usedResearch: result.usedResearch,
        researchQueryCount: result.researchQueryCount,
        threadId: result.threadId,
        metrics: result.metrics,
        errorMessage: result.errorMessage || (result.status === "failed" ? result.summary : null),
      });

      if (result.status === "executed") {
        botsProcessed += 1;
      } else if (result.status === "failed") {
        errors += 1;
      } else {
        botsSkipped += 1;
      }
    } catch (error: any) {
      errors += 1;
      await persistBotRunLog({
        profile,
        cycleKey,
        cycleBrief,
        status: "failed",
        failureClass: "planning_error",
        summary: error?.message || "Bot cycle failed",
        warnings: [],
        plannedActions: [],
        executedActions: [],
        citations: [],
        toolTrace: [],
        usedResearch: false,
        researchQueryCount: 0,
        threadId: null,
        metrics: buildRunMetrics({
          planningLatencyMs: 0,
          executionLatencyMs: 0,
          proposedActionCount: 0,
          executableActionCount: 0,
          droppedActionCount: 0,
          successfulActionCount: 0,
          failedActionCount: 0,
          timedOut: false,
          usedSharedResearch: Boolean(cycleBrief.usedResearch),
          usedSyntheticBrief: Boolean(
            (cycleBrief.briefPayload as Record<string, unknown> | null)?.synthetic,
          ),
        }),
        errorMessage: error?.message || "Bot cycle failed",
      });
    }
  }

  return { botsProcessed, botsSkipped, errors };
}

export async function getHermesBotRuntimeStatus() {
  await ensureHermesBotRuntimeSchema();

  const [
    stats,
    lastBrief,
    recentRuns,
    lastJob,
    lastExecutedAction,
    runStats,
    tickStats,
    failureBreakdown,
    executionMix,
    mechanicMix,
    actionMix,
  ] = await Promise.all([
    db.execute(sql`
      select
        count(*)::int as total_bots,
        count(*) filter (where is_active = true)::int as active_bots,
        count(*) filter (where research_enabled = true)::int as research_bots,
        coalesce(sum(max_actions_per_tick), 0)::int as action_budget_per_cycle
      from bot_profiles
    `),
    db.select().from(botCycleBriefs).orderBy(desc(botCycleBriefs.createdAt)).limit(1),
    db.select().from(botRunLogs).orderBy(desc(botRunLogs.createdAt)).limit(12),
    db
      .select()
      .from(jobExecutionLogs)
      .where(eq(jobExecutionLogs.jobName, "bot_engine"))
      .orderBy(desc(jobExecutionLogs.startedAt))
      .limit(1),
    db
      .select()
      .from(botActionsLog)
      .where(eq(botActionsLog.success, true))
      .orderBy(desc(botActionsLog.createdAt))
      .limit(1),
    db.execute(sql`
      select
        count(*)::int as total_runs,
        count(*) filter (where status = 'executed')::int as executed_runs,
        count(*) filter (where status = 'failed')::int as failed_runs,
        count(*) filter (where status = 'no_action')::int as no_action_runs,
        count(*) filter (where status = 'policy_filtered')::int as policy_filtered_runs,
        coalesce(avg(nullif(metrics->>'planningLatencyMs', '')::numeric), 0)::float as avg_planning_latency_ms,
        coalesce(avg(nullif(metrics->>'totalLatencyMs', '')::numeric), 0)::float as avg_total_latency_ms
      from bot_run_logs
      where bot_run_logs.created_at > now() - interval '2 hours'
    `),
    db.execute(sql`
      select
        coalesce(avg(extract(epoch from (finished_at - started_at)) * 1000) filter (
          where finished_at is not null
        ), 0)::float as avg_tick_duration_ms
      from job_execution_logs
      where job_name = 'bot_engine'
        and started_at > now() - interval '2 hours'
    `),
    db.execute(sql`
      select
        coalesce(failure_class, 'none') as failure_class,
        count(*)::int as run_count
      from bot_run_logs
      where created_at > now() - interval '2 hours'
      group by failure_class
      order by run_count desc, failure_class asc
      limit 8
    `),
    db.execute(sql`
      select
        count(*) filter (where coalesce((metrics->>'fallbackUsed')::boolean, false))::int as fallback_runs,
        count(*) filter (where coalesce((metrics->>'hermesNative')::boolean, false))::int as hermes_native_runs,
        count(*) filter (where coalesce((metrics->>'usedSharedResearch')::boolean, false))::int as shared_research_runs,
        count(*) filter (where coalesce((metrics->>'usedSyntheticBrief')::boolean, false))::int as synthetic_brief_runs
      from bot_run_logs
      where created_at > now() - interval '2 hours'
    `),
    db.execute(sql`
      select
        coalesce(sum(nullif(metrics->'mechanicCounts'->>'market', '')::int), 0)::int as market_actions,
        coalesce(sum(nullif(metrics->'mechanicCounts'->>'liquidity', '')::int), 0)::int as liquidity_actions,
        coalesce(sum(nullif(metrics->'mechanicCounts'->>'scouting', '')::int), 0)::int as scouting_actions,
        coalesce(sum(nullif(metrics->'mechanicCounts'->>'boosts', '')::int), 0)::int as boost_actions
      from bot_run_logs
      where created_at > now() - interval '2 hours'
    `),
    db.execute(sql`
      select
        action_type,
        count(*)::int as action_count
      from bot_actions_log
      where success = true
        and created_at > now() - interval '2 hours'
      group by action_type
      order by action_count desc, action_type asc
      limit 12
    `),
  ]);

  const statsRow = (stats.rows[0] as
    | {
        total_bots: number;
        active_bots: number;
        research_bots: number;
        action_budget_per_cycle: number;
      }
    | undefined) || {
    total_bots: 0,
    active_bots: 0,
    research_bots: 0,
    action_budget_per_cycle: 0,
  };

  return {
    totalBots: statsRow.total_bots,
    activeBots: statsRow.active_bots,
    researchBots: statsRow.research_bots,
    actionBudgetPerCycle: statsRow.action_budget_per_cycle,
    cycleIntervalMinutes: getBotCycleIntervalMinutes(),
    botsPerTick: statsRow.active_bots > 0 ? getBotSliceSize(statsRow.active_bots) : 0,
    lastBrief: lastBrief[0] || null,
    lastBriefAgeMs: lastBrief[0] ? Date.now() - lastBrief[0].createdAt.getTime() : null,
    recentRuns,
    lastJob: lastJob[0] || null,
    lastSuccessfulAction: lastExecutedAction[0] || null,
    recentRunStats: {
      ...(runStats.rows[0] || {}),
      avgTickDurationMs:
        (tickStats.rows[0] as { avg_tick_duration_ms?: number } | undefined)
          ?.avg_tick_duration_ms || 0,
    },
    recentExecutionMix: executionMix.rows[0] || {
      fallback_runs: 0,
      hermes_native_runs: 0,
      shared_research_runs: 0,
      synthetic_brief_runs: 0,
    },
    recentMechanicMix: mechanicMix.rows[0] || {
      market_actions: 0,
      liquidity_actions: 0,
      scouting_actions: 0,
      boost_actions: 0,
    },
    recentActionMix: actionMix.rows,
    failureBreakdown: failureBreakdown.rows,
  };
}

export const __botRuntime = {
  buildCycleKey,
  getBotCycleIntervalMinutes,
  getBotSliceSize,
  selectBotsForTick,
  buildSharedBriefToolAllowlist,
  buildBotToolAllowlist,
  filterExecutableActions,
  estimateActionVolume,
  classifyPlanningFailure,
  isExplicitNoAction,
  normalizeAllowedMechanics,
  normalizeObjectiveWeights,
  buildSyntheticSharedBrief,
  chooseFallbackAction,
  chooseFallbackPlan,
  getNextOpenBoostSlotTier,
  resolveFallbackBuySize,
};
