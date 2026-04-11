import { getAgentCapabilities, getScoutAgentProfile } from "./service";
import { loadScoutAgentContext } from "./context-loader";
import { listAgentKnowledgeArticles } from "../docs-service";
import { getETDayBoundaries, getTodayET } from "../lib/time";
import { z } from "zod";
import {
  getBuyQuote,
  getLpPosition,
  getOrCreatePool,
  getSellQuote,
  getUserLpPositions,
  getZapAddQuoteSbOnly,
  getZapAddQuoteSharesOnly,
} from "../amm/pool";
import {
  buildHermesMemoryContext,
  persistProposedMemoryWrites,
  archiveUserAgentMemory,
} from "./memory";
import {
  cancelAgentThread,
  confirmAgentThread,
  createAgentThread,
  getAgentThread,
  listAgentThreadMessages,
  sendAgentThreadMessage,
} from "./thread-service";
import { planDirectAgentOperation } from "./operations-planner";
import { planHostedWebResearch } from "./research";
import { storage } from "../storage";
import {
  listAgentScheduleTemplates,
  listUserAgentSchedules,
  removeUserAgentSchedule,
  upsertUserAgentSchedule,
} from "./schedules";
import {
  archiveAgentSkill,
  createOrUpdateUserSkill,
  listAgentSkillCandidates,
  listAvailableAgentSkills,
  proposeGlobalSkillCandidate,
} from "./skills";
import {
  getCoreHermesToolCatalog,
  sportSlateSchema,
  teamRosterSchema,
} from "./hermes-tool-registry";
import { dailyGames, players } from "@shared/schema";
import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { db } from "../db";
import { queryExternalSource } from "./mcp-client";
import {
  getInternalMlbMcpToolCatalog,
  isInternalMlbMcpProjectedTool,
  resolveInternalMlbMcpConfig,
  runInternalMlbMcpReadTool,
  runInternalMlbMcpToolRaw,
} from "./internal-mlb-mcp";
import type {
  AgentChannel,
  AgentSkillStep,
  AgentScheduleJobType,
  AgentToolDefinition,
  ProposedMemoryWrite,
} from "./types";

type StructuredPlanPreview = {
  toolName: string;
  supported: boolean;
  canStage: boolean;
  requiresConfirmation: boolean;
  actionSummary: string;
  stageMessage: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  estimatedImpact: string | null;
  warnings: string[];
  quoteTimestamp: string;
};

type HermesScanResult = {
  toolName: string;
  domain: string;
  summary: string;
  replyText: string;
  observations: string[];
  warnings: string[];
  context: Record<string, unknown>;
  intentFocus?: string;
};

const MLB_TEAM_REFERENCES = [
  { code: "LAA", aliases: ["los angeles angels", "angels", "laa"] },
  { code: "ARI", aliases: ["arizona diamondbacks", "diamondbacks", "dbacks", "ari"] },
  { code: "BAL", aliases: ["baltimore orioles", "orioles", "bal"] },
  { code: "BOS", aliases: ["boston red sox", "red sox", "bos"] },
  { code: "CHC", aliases: ["chicago cubs", "cubs", "chc"] },
  { code: "CIN", aliases: ["cincinnati reds", "reds", "cin"] },
  { code: "CLE", aliases: ["cleveland guardians", "guardians", "cle"] },
  { code: "COL", aliases: ["colorado rockies", "rockies", "col"] },
  { code: "DET", aliases: ["detroit tigers", "tigers", "det"] },
  { code: "HOU", aliases: ["houston astros", "astros", "hou"] },
  { code: "KC", aliases: ["kansas city royals", "royals", "kc", "kcr"] },
  { code: "LAD", aliases: ["los angeles dodgers", "dodgers", "lad"] },
  { code: "WSH", aliases: ["washington nationals", "nationals", "nats", "wsh", "wsn"] },
  { code: "NYM", aliases: ["new york mets", "mets", "nym"] },
  { code: "ATH", aliases: ["athletics", "a's", "as", "oakland athletics", "ath", "oak"] },
  { code: "PIT", aliases: ["pittsburgh pirates", "pirates", "pit"] },
  { code: "SD", aliases: ["san diego padres", "padres", "sd", "sdp"] },
  { code: "SEA", aliases: ["seattle mariners", "mariners", "sea"] },
  { code: "SF", aliases: ["san francisco giants", "giants", "sf", "sfg"] },
  { code: "STL", aliases: ["st louis cardinals", "cardinals", "stl"] },
  { code: "TB", aliases: ["tampa bay rays", "rays", "tb", "tbr"] },
  { code: "TEX", aliases: ["texas rangers", "rangers", "tex"] },
  { code: "TOR", aliases: ["toronto blue jays", "blue jays", "jays", "tor"] },
  { code: "MIN", aliases: ["minnesota twins", "twins", "min"] },
  { code: "PHI", aliases: ["philadelphia phillies", "phillies", "phi"] },
  { code: "ATL", aliases: ["atlanta braves", "braves", "atl"] },
  { code: "CWS", aliases: ["chicago white sox", "white sox", "cws", "chw"] },
  { code: "MIA", aliases: ["miami marlins", "marlins", "mia", "fla"] },
  { code: "NYY", aliases: ["new york yankees", "yankees", "nyy"] },
  { code: "MIL", aliases: ["milwaukee brewers", "brewers", "mil"] },
] as const;

const proposedMemoryWritesSchema = z.array(
  z.object({
    scope: z.enum(["profile", "episodic", "semantic"]),
    kind: z.enum([
      "preference",
      "goal",
      "risk_tolerance",
      "favorite_entities",
      "habit",
      "interaction_style",
    ]),
    summary: z.string().trim().min(1),
    content: z.record(z.unknown()),
    confidence: z.number().finite().min(0).max(1),
    reason: z.string().trim().min(1),
  }),
);

const AGENT_TOOL_CATALOG: AgentToolDefinition[] = [
  {
    toolName: "scan_daily_boost_candidates",
    category: "scan",
    description:
      "Scan the user's current open daily boost slots and rank the best eligible boost candidates for the requested day.",
    whenToUse: [
      "The user asks who they can use in open boost slots.",
      "The user asks which players are eligible for a boost tonight or today.",
      "The user wants a recommendation before staging a specific boost assignment.",
    ],
    whenNotToUse: [
      "The user already named a specific player and wants you to stage the exact boost assignment.",
      "The user wants to remove an existing boost instead of finding candidates.",
    ],
    examplePrompts: [
      "who can i put in my boost slots for tonight?",
      "which players are eligible for a boost right now?",
    ],
    requiresConfirmation: false,
    riskLevel: "low",
    presentationProfile: "leaderboard",
    primaryEntityType: "player",
    preferredColumns: ["player", "team", "power", "boostSlot"],
  },
  {
    toolName: "scan_open_boost_slots",
    category: "scan",
    description:
      "Summarize the user's currently open and filled daily boost slots for the requested day.",
    whenToUse: [
      "The user asks how many boost slots are open.",
      "The user asks whether they still have room to place boosts.",
    ],
    whenNotToUse: [
      "The user wants a ranked list of eligible players.",
      "The user wants to stage a direct boost mutation.",
    ],
    examplePrompts: ["how many boost slots do i still have open tonight?"],
    requiresConfirmation: false,
    riskLevel: "low",
  },
  {
    toolName: "scan_scout_opportunities",
    category: "scan",
    description:
      "Summarize the strongest scout targets and reallocation opportunities from the user's current scout setup.",
    whenToUse: [
      "The user asks who they should scout.",
      "The user asks for the best scouting opportunities without asking for a direct mutation yet.",
    ],
    whenNotToUse: ["The user already requested a specific scout count change."],
    examplePrompts: ["what should i scout tonight?", "who are my best scout targets right now?"],
    requiresConfirmation: false,
    riskLevel: "low",
    presentationProfile: "leaderboard",
    primaryEntityType: "player",
    preferredColumns: ["player", "team", "scoutCount", "opportunity"],
  },
  {
    toolName: "scan_idle_balance_options",
    category: "scan",
    description:
      "Turn idle cash or idle balance questions into a concrete deployment-oriented advisory read.",
    whenToUse: ["The user asks what to do with idle balance, extra cash, or unused balance."],
    whenNotToUse: ["The user already named a player and amount for a direct trade."],
    examplePrompts: ["what should i do with my idle balance?"],
    requiresConfirmation: false,
    riskLevel: "low",
  },
  {
    toolName: "scan_portfolio_cleanup_levers",
    category: "scan",
    description:
      "Identify the main cleanup levers in the user's portfolio and explain what is stale, idle, or overconcentrated.",
    whenToUse: ["The user asks to clean up the portfolio or asks what is stale or overexposed."],
    whenNotToUse: ["The user wants to stage a specific market or boost action already."],
    examplePrompts: ["clean up my portfolio", "what am i overexposed to right now?"],
    requiresConfirmation: false,
    riskLevel: "low",
    presentationProfile: "leaderboard",
    primaryEntityType: "player",
    preferredColumns: ["player", "team", "quantity", "value", "issue"],
  },
  {
    toolName: "scan_watchlist_targets",
    category: "scan",
    description:
      "Review the user's watchlists and highlight the most relevant watchlist candidates or stale watchlist state.",
    whenToUse: ["The user asks who to add to a watchlist or what is worth tracking."],
    whenNotToUse: ["The user names a specific player and wants a direct watchlist mutation."],
    examplePrompts: ["who should i add to my watchlist?", "anything stale in my watchlists?"],
    requiresConfirmation: false,
    riskLevel: "low",
    presentationProfile: "leaderboard",
    primaryEntityType: "player",
    preferredColumns: ["player", "team", "price", "signal"],
  },
  {
    toolName: "scan_community_boost_candidates",
    category: "scan",
    description:
      "Identify the best current community boost opportunity from the user's eligible window.",
    whenToUse: ["The user asks who should get their community boost."],
    whenNotToUse: [
      "The user already named a specific player and wants the community boost staged.",
    ],
    examplePrompts: ["who should get my community boost today?"],
    requiresConfirmation: false,
    riskLevel: "low",
    presentationProfile: "leaderboard",
    primaryEntityType: "player",
    preferredColumns: ["player", "team", "boostImpact"],
  },
  {
    toolName: "scan_news_impact",
    category: "scan",
    description:
      "Blend current hosted research with the user's account context to explain what recent news changes for them.",
    whenToUse: [
      "The user asks what changed today or whether there is news affecting their players.",
    ],
    whenNotToUse: ["The user is only asking for raw headlines without account-specific impact."],
    examplePrompts: ["what changed for my players today?", "any news that affects my setup?"],
    requiresConfirmation: false,
    riskLevel: "low",
  },
  {
    toolName: "scan_top_market_opportunities",
    category: "scan",
    description:
      "Surface the strongest market-facing opportunities from the current board before staging a trade.",
    whenToUse: ["The user asks who is worth buying, watching, or starting a position in."],
    whenNotToUse: ["The user already supplied a direct market order."],
    examplePrompts: ["who is worth buying right now?", "who should i start a position in?"],
    requiresConfirmation: false,
    riskLevel: "low",
    presentationProfile: "leaderboard",
    primaryEntityType: "player",
    preferredColumns: ["player", "team", "price", "opportunity"],
  },
  {
    toolName: "scan_sport_slate",
    category: "scan",
    description:
      "Return the game slate for a specific sport and date range, including teams, start times, and game status. When filtering by team abbreviation (e.g., BOS), include sport to avoid cross-league collisions. Includes players on each team with their positions and recent stats.",
    whenToUse: [
      "The user asks about upcoming games for a sport.",
      "The user asks about a specific team's games (resolve team name to abbreviation first).",
      "The user asks who is playing tonight or this week.",
      "The user asks about starting pitchers, lineups, or matchups.",
      "A strategy stage needs to identify which players have games in a window.",
    ],
    whenNotToUse: [
      "The user is asking about account state or portfolio.",
      "The user already named specific players and wants a trade.",
    ],
    examplePrompts: [
      "what MLB games are on tonight?",
      "who are the starting pitchers this week?",
      "show me the NBA slate for tomorrow",
      "which NFL games are this Sunday?",
      "do the Red Sox play today?",
    ],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: sportSlateSchema,
    presentationProfile: "schedule",
    primaryEntityType: "game",
    preferredColumns: ["matchup", "status", "startTime", "venue"],
  },
  {
    toolName: "scan_mlb_stat_gameplan",
    category: "scan",
    description:
      "Build an MLB hitter or pitcher gameplan from internal MLB MCP leaderboard stats like OBP, OPS, ERA, and WHIP, filtered to active Sportfolio markets with a game in the requested window.",
    whenToUse: [
      "The user wants an MLB gameplan based on stat signals like OBP, OPS, ERA, or WHIP.",
      "The user asks who stands out for tomorrow's MLB slate based on leaderboard stats.",
      "The user wants a bounded MLB watchlist or buy list driven by the internal MLB MCP instead of generic opinion.",
    ],
    whenNotToUse: [
      "The user already named a specific player and wants a direct staged move.",
      "The user only wants a raw game schedule with no stat-based ranking.",
    ],
    examplePrompts: [
      "based on OBP and OPS, build me an MLB gameplan for tomorrow",
      "who stands out today by ERA and WHIP in MLB?",
    ],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: sportSlateSchema,
    presentationProfile: "leaderboard",
    primaryEntityType: "player",
    preferredColumns: ["player", "team", "metric", "game"],
  },
  {
    toolName: "scan_team_roster",
    category: "scan",
    description:
      "List all active players on a team's roster with their positions and market prices. Include sport with team abbreviation when possible (e.g., MLB + BOS) to avoid cross-league collisions. Resolve team names, cities, or nicknames to abbreviations before calling.",
    whenToUse: [
      "The user asks about a team's roster or players on a team.",
      "The user wants to buy players from a specific team equally.",
      "The user asks who plays for a team.",
    ],
    whenNotToUse: [
      "The user already named specific players.",
      "The user is asking about game schedules (use scan_sport_slate instead).",
    ],
    examplePrompts: [
      "show me the Red Sox roster",
      "who plays for the Dodgers?",
      "buy each Red Sox player equally",
      "list Yankees players and their prices",
    ],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: teamRosterSchema,
    presentationProfile: "leaderboard",
    primaryEntityType: "player",
    preferredColumns: ["player", "position", "team", "price"],
  },
  {
    toolName: "scan_player_upcoming_games",
    category: "scan",
    description:
      "For a given player or list of players, return their upcoming games within the next 7 days along with opponent, start time, and boost eligibility.",
    whenToUse: [
      "The user asks when a player plays next.",
      "The user wants to know a player's schedule this week.",
      "A strategy needs to plan boosts around upcoming game times.",
    ],
    whenNotToUse: ["The user is asking about historical stats or past games."],
    examplePrompts: ["when does LeBron play next?", "what's Shohei Ohtani's schedule this week?"],
    requiresConfirmation: false,
    riskLevel: "low",
    presentationProfile: "schedule",
    primaryEntityType: "game",
    preferredColumns: ["player", "opponent", "startTime", "boostEligible"],
  },
  {
    toolName: "query_external_source",
    category: "scan",
    description:
      "Query the user's configured external MCP data sources. Use this to fetch data from third-party services the user has connected (projections, analytics, custom feeds).",
    whenToUse: [
      "The user asks for data that isn't available through built-in Sportfolio tools.",
      "The user explicitly mentions an external data source by name.",
      "A strategy requires external projection or analytics data.",
    ],
    whenNotToUse: [
      "The data is available from built-in scan tools (portfolio, boosts, slate).",
      "The user has no external MCP sources configured.",
    ],
    examplePrompts: [
      "check my FanGraphs projections for tonight",
      "what does my external source say about starting pitchers?",
    ],
    requiresConfirmation: false,
    riskLevel: "low",
    exposure: "advanced",
  },
  {
    toolName: "preview_direct_operation",
    category: "plan",
    description:
      "Use the deterministic operation planner to interpret and preview a concrete user command. It can assume safe defaults for obvious bare-intent actions like buy, sell, stack, boost, or scout when the user leaves out size or slot details.",
    whenToUse: [
      "The user gave an explicit operational request and you need a confirmation-ready plan.",
    ],
    whenNotToUse: ["The user is still asking an advisory who/what/which question."],
    examplePrompts: [
      "buy Aaron Judge",
      "buy $25 of Austin Hill",
      "stack my Fried shares",
      "boost Aaron Judge",
    ],
    requiresConfirmation: true,
    riskLevel: "medium",
    presentationProfile: "execution",
  },
  {
    toolName: "preview_multi_action_bundle",
    category: "plan",
    description:
      "Break a compound multi-step request into a staged confirmation-ready bundle by chaining existing approved plan tools.",
    whenToUse: [
      "The user asks for multiple linked actions in one sentence.",
      "The user uses follow-up pronouns like him after resolving a player in the same request.",
    ],
    whenNotToUse: [
      "The user is only asking a vague advisory question and needs a scan first.",
      "The user only wants a single direct action preview.",
    ],
    examplePrompts: [
      "buy Aaron Judge and put him in my boost slot",
      "stack shares Amen and put him at 4x, then stack Jokic and put him at 5x",
      "buy 16 Austin Hill shares, stack them, then put the stacked share in my 5x slot",
    ],
    requiresConfirmation: true,
    riskLevel: "high",
    presentationProfile: "execution",
  },
  {
    toolName: "stage_action_bundle",
    category: "action",
    description:
      "Send a concrete action request through the normal agent thread flow so the backend stages a pending bundle.",
    whenToUse: ["You have enough information and want the standard staged confirmation flow."],
    whenNotToUse: ["You are still gathering information or running advisory scans."],
    examplePrompts: ["stage a buy for Austin Hill", "queue the best boost candidate"],
    requiresConfirmation: true,
    riskLevel: "medium",
  },
  {
    toolName: "confirm_pending_bundle",
    category: "action",
    description: "Confirm the currently staged pending bundle on a thread.",
    whenToUse: ["The user explicitly approves a staged pending plan."],
    whenNotToUse: ["There is no pending bundle to confirm."],
    examplePrompts: ["yes do it", "confirm"],
    requiresConfirmation: false,
    riskLevel: "high",
  },
  {
    toolName: "cancel_pending_bundle",
    category: "action",
    description: "Cancel the currently staged pending bundle on a thread.",
    whenToUse: ["The user explicitly rejects a staged pending plan."],
    whenNotToUse: ["There is no pending bundle to cancel."],
    examplePrompts: ["cancel that", "no don't do it"],
    requiresConfirmation: false,
    riskLevel: "low",
  },
  {
    toolName: "create_watchlist",
    category: "action",
    description: "Create a new watchlist for player tracking.",
    whenToUse: ["The user explicitly wants a new watchlist."],
    whenNotToUse: ["The user only wants to add a player to an existing watchlist."],
    examplePrompts: ["create a watchlist for tonight's boost targets"],
    requiresConfirmation: false,
    riskLevel: "low",
    exposure: "advanced",
  },
  {
    toolName: "update_watchlist",
    category: "action",
    description: "Rename or recolor an existing watchlist.",
    whenToUse: ["The user explicitly wants to edit a watchlist."],
    whenNotToUse: ["The user wants to add or remove players instead."],
    examplePrompts: ["rename my value watchlist to nba value"],
    requiresConfirmation: false,
    riskLevel: "low",
    exposure: "advanced",
  },
  {
    toolName: "delete_watchlist",
    category: "action",
    description: "Delete an existing watchlist.",
    whenToUse: ["The user explicitly wants to remove a watchlist."],
    whenNotToUse: ["The user only wants to clear one player from it."],
    examplePrompts: ["delete my stale watchlist"],
    requiresConfirmation: false,
    riskLevel: "low",
    exposure: "advanced",
  },
  {
    toolName: "add_watchlist_player",
    category: "action",
    description: "Add a player to a watchlist immediately.",
    whenToUse: ["The user explicitly wants a player tracked in a watchlist."],
    whenNotToUse: ["The user is still asking who should be tracked."],
    examplePrompts: ["add Austin Hill to my nascar watchlist"],
    requiresConfirmation: false,
    riskLevel: "low",
  },
  {
    toolName: "remove_watchlist_player",
    category: "action",
    description: "Remove a player from a watchlist immediately.",
    whenToUse: ["The user explicitly wants a player removed from tracking."],
    whenNotToUse: ["The user is only reviewing watchlist state."],
    examplePrompts: ["remove Austin Hill from my watchlist"],
    requiresConfirmation: false,
    riskLevel: "low",
  },
  {
    toolName: "upsert_user_schedule",
    category: "action",
    description: "Create or update a recurring Hermes advisory schedule.",
    whenToUse: ["The user explicitly wants recurring proactive Hermes check-ins."],
    whenNotToUse: ["The user only wants to know what schedule templates exist."],
    examplePrompts: ["set up a daily setup review for me"],
    requiresConfirmation: false,
    riskLevel: "low",
    exposure: "advanced",
  },
  {
    toolName: "delete_user_schedule",
    category: "action",
    description: "Delete a recurring Hermes advisory schedule.",
    whenToUse: ["The user explicitly wants to remove a recurring advisory schedule."],
    whenNotToUse: ["The user is only reviewing current schedules."],
    examplePrompts: ["remove my idle balance nudge"],
    requiresConfirmation: false,
    riskLevel: "low",
    exposure: "advanced",
  },
  {
    toolName: "list_runtime_skills",
    category: "memory",
    description:
      "List the current user-scoped and approved global skills available to help with repeated workflows.",
    whenToUse: ["Hermes wants to reuse a prior successful workflow before improvising a new one."],
    whenNotToUse: ["The user only needs a one-off direct response."],
    examplePrompts: ["have i solved something like this before?"],
    requiresConfirmation: false,
    riskLevel: "low",
    exposure: "advanced",
  },
  {
    toolName: "create_runtime_skill",
    category: "memory",
    description:
      "Persist a user-scoped reusable skill over already approved tools after Hermes resolves a new workflow cleanly.",
    whenToUse: [
      "Hermes successfully resolves a novel workflow and wants to reuse that tool sequence for the same user.",
    ],
    whenNotToUse: [
      "The workflow depends on an unapproved tool or would expand the user's capability surface.",
    ],
    examplePrompts: ["save this as a reusable workflow for this user"],
    requiresConfirmation: false,
    riskLevel: "low",
    exposure: "internal_only",
  },
  {
    toolName: "propose_global_pattern",
    category: "memory",
    description:
      "Propose a global skill candidate for admin review after a user-scoped skill proves useful. This does not auto-activate globally.",
    whenToUse: ["Hermes sees a repeatable workflow pattern worth submitting for admin review."],
    whenNotToUse: ["The pattern includes user-private context or unapproved tools."],
    examplePrompts: ["flag this workflow pattern for admin review"],
    requiresConfirmation: false,
    riskLevel: "low",
    exposure: "internal_only",
  },
];

const BOOST_SLOT_TIERS = [5, 4, 3, 2] as const;

function cloneToolCatalogEntry(entry: AgentToolDefinition): AgentToolDefinition {
  return {
    ...entry,
    whenToUse: [...entry.whenToUse],
    whenNotToUse: [...entry.whenNotToUse],
    examplePrompts: [...entry.examplePrompts],
    preferredColumns: [...(entry.preferredColumns || [])],
    autoContextArgs: [...(entry.autoContextArgs || [])],
    inputSchema: entry.inputSchema
      ? (JSON.parse(JSON.stringify(entry.inputSchema)) as Record<string, unknown>)
      : null,
  };
}

function buildMergedToolCatalog(entries: AgentToolDefinition[]): AgentToolDefinition[] {
  const merged = new Map<string, AgentToolDefinition>();

  for (const entry of entries) {
    merged.set(entry.toolName, cloneToolCatalogEntry(entry));
  }

  return [...merged.values()];
}

export function getAgentToolCatalog(): AgentToolDefinition[] {
  return buildMergedToolCatalog([...AGENT_TOOL_CATALOG, ...getCoreHermesToolCatalog()]);
}

export async function getAgentRuntimeToolCatalog(options?: {
  includeInternalMlbMcp?: boolean;
}): Promise<AgentToolDefinition[]> {
  const internalMlbTools =
    options?.includeInternalMlbMcp === false ? [] : await getInternalMlbMcpToolCatalog();
  return buildMergedToolCatalog([
    ...AGENT_TOOL_CATALOG,
    ...getCoreHermesToolCatalog(),
    ...internalMlbTools,
  ]);
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toOptionalString(value: unknown): string | null {
  const normalized = toStringValue(value);
  return normalized || null;
}

function toNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = toNumberValue(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = toPositiveNumber(value);
  return parsed != null ? Math.floor(parsed) : null;
}

function toBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  return null;
}

function toChannelValue(value: unknown): AgentChannel | null {
  return value === "in_app" || value === "sms" || value === "cli" ? value : null;
}

function toScheduleJobType(value: unknown): AgentScheduleJobType | null {
  return value === "daily_setup_review" ||
    value === "pre_lock_nudge" ||
    value === "injury_watch" ||
    value === "idle_balance_nudge" ||
    value === "boost_window"
    ? value
    : null;
}

function buildDisabledWorkflowResult(feature: string) {
  return {
    supported: false,
    reason: `${feature} is not part of the active Sportfolio agent surface right now.`,
  };
}

function buildStructuredPreview(
  input: Omit<StructuredPlanPreview, "supported" | "quoteTimestamp">,
): StructuredPlanPreview {
  return {
    supported: true,
    quoteTimestamp: new Date().toISOString(),
    ...input,
  };
}

async function materializeStructuredPreviewPlan(input: {
  userId: string;
  toolName: string;
  preview: StructuredPlanPreview;
}): Promise<unknown> {
  const previewObservations = input.preview.estimatedImpact ? [input.preview.estimatedImpact] : [];

  if (!input.preview.canStage) {
    return {
      domain: "sportfolio",
      requestMessage: input.preview.stageMessage,
      replyText: `${input.preview.actionSummary}. ${input.preview.warnings[0] || "That preview cannot be staged in the current account state."}`,
      summary: input.preview.actionSummary,
      observations: previewObservations,
      warnings: input.preview.warnings,
      actions: [],
      citations: [],
      pendingClarification: null,
      errorMessage: null,
      contextSnapshot: {
        preview: input.preview,
      },
      trace: {
        framework: "structured-preview-materializer",
        toolName: input.toolName,
        canStage: false,
      },
    };
  }

  const profile = (await getScoutAgentProfile(input.userId)).profile;
  const staged = await planDirectAgentOperation({
    userId: input.userId,
    message: input.preview.stageMessage,
    profile,
    allowAdvisoryResponses: false,
  });

  if (!staged) {
    return {
      domain: "sportfolio",
      requestMessage: input.preview.stageMessage,
      replyText:
        `${input.preview.actionSummary}. ` +
        (input.preview.estimatedImpact ||
          "I built the preview but could not reconstruct a staged action from it."),
      summary: input.preview.actionSummary,
      observations: previewObservations,
      warnings: input.preview.warnings,
      actions: [],
      citations: [],
      pendingClarification: null,
      errorMessage: null,
      contextSnapshot: {
        preview: input.preview,
      },
      trace: {
        framework: "structured-preview-materializer",
        toolName: input.toolName,
        canStage: true,
        stageMessage: input.preview.stageMessage,
        stageMaterialization: "not_resolved",
      },
    };
  }

  return {
    ...staged,
    requestMessage: staged.requestMessage || input.preview.stageMessage,
    replyText: staged.replyText || input.preview.actionSummary,
    summary: staged.summary || input.preview.actionSummary,
    observations: [
      ...(Array.isArray(staged.observations) ? staged.observations : []),
      ...previewObservations,
    ],
    warnings: Array.from(
      new Set([
        ...(Array.isArray(staged.warnings) ? staged.warnings : []),
        ...input.preview.warnings,
      ]),
    ),
    contextSnapshot: {
      ...(staged.contextSnapshot && typeof staged.contextSnapshot === "object"
        ? staged.contextSnapshot
        : {}),
      preview: input.preview,
    },
    trace: {
      ...(staged.trace && typeof staged.trace === "object" ? staged.trace : {}),
      framework: "structured-preview-materializer",
      toolName: input.toolName,
      quoteTimestamp: input.preview.quoteTimestamp,
      stageMessage: input.preview.stageMessage,
    },
  };
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function parseProposedMemoryWrites(value: unknown): ProposedMemoryWrite[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return proposedMemoryWritesSchema.parse(value);
}

async function loadOperatorToolContext(userId: string, message: string, rawSport?: unknown) {
  const profile = (await getScoutAgentProfile(userId)).profile;
  const sportOverride = toStringValue(rawSport).toUpperCase() || null;
  const context = await loadScoutAgentContext(userId, profile, {
    chatRequest: message,
    sportOverride,
  });

  return {
    profile,
    context,
  };
}

function buildScanResult(input: HermesScanResult): HermesScanResult {
  return input;
}

async function resolvePreferredSport(userId: string, rawSport: unknown): Promise<string> {
  const explicitSport = toStringValue(rawSport).toUpperCase();
  if (explicitSport) {
    return explicitSport;
  }

  const { profile } = await getScoutAgentProfile(userId);
  const defaultSport = toStringValue(
    (profile as { defaultSport?: string | null }).defaultSport,
  ).toUpperCase();

  return defaultSport || "NBA";
}

function formatCandidateList(values: string[]): string {
  if (values.length === 0) {
    return "";
  }
  if (values.length === 1) {
    return values[0];
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

async function requirePlayer(playerId: string) {
  const player = await storage.getPlayer(playerId);
  if (!player) {
    throw new Error("Player not found");
  }

  return player;
}

function buildPlayerLabel(
  player: { firstName?: string | null; lastName?: string | null },
  fallback: string,
) {
  const fullName = `${toStringValue(player.firstName)} ${toStringValue(player.lastName)}`.trim();
  return fullName || fallback;
}

function scorePlayerReferenceMatch(input: {
  query: string;
  playerId: string;
  playerName: string;
  lastName: string;
}) {
  const normalizedQuery = normalizeNameFragment(input.query);
  const normalizedPlayerId = normalizeNameFragment(input.playerId);
  const normalizedPlayerName = normalizeNameFragment(input.playerName);
  const normalizedLastName = normalizeNameFragment(input.lastName);

  if (!normalizedQuery) {
    return 0;
  }
  if (normalizedPlayerId === normalizedQuery) {
    return 120;
  }
  if (normalizedPlayerName === normalizedQuery) {
    return 110;
  }
  if (normalizedPlayerName.startsWith(normalizedQuery)) {
    return 90;
  }
  if (normalizedPlayerName.includes(normalizedQuery)) {
    return 80;
  }
  if (normalizedLastName && normalizedLastName === normalizedQuery) {
    return 70;
  }
  if (normalizedLastName && normalizedQuery.includes(normalizedLastName)) {
    return 60;
  }
  if (normalizedPlayerId.includes(normalizedQuery)) {
    return 50;
  }

  return 0;
}

async function resolvePlayerReference(input: { args?: Record<string, unknown> }): Promise<{
  playerId: string;
  playerName: string;
}> {
  const explicitPlayerId = toStringValue(input.args?.playerId);
  const explicitPlayerName = toStringValue(input.args?.playerName);

  if (explicitPlayerId) {
    const directPlayer = await storage.getPlayer(explicitPlayerId);
    if (directPlayer) {
      return {
        playerId: directPlayer.id,
        playerName: buildPlayerLabel(directPlayer, directPlayer.id),
      };
    }
  }

  const query = explicitPlayerName || explicitPlayerId;
  if (!query) {
    throw new Error("playerId or playerName is required");
  }

  const candidates = (await storage.getPlayers({ search: query }))
    .map((player) => {
      const playerName = buildPlayerLabel(player, player.id);
      return {
        player,
        playerId: player.id,
        playerName,
        score: scorePlayerReferenceMatch({
          query,
          playerId: player.id,
          playerName,
          lastName: toStringValue(player.lastName),
        }),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)[0];

  if (!candidates) {
    throw new Error("Player not found");
  }

  return {
    playerId: candidates.playerId,
    playerName: candidates.playerName,
  };
}

function resolveTargetDate(rawDate: unknown): Date {
  const requestedDate = toStringValue(rawDate);
  const normalizedDate =
    requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : getTodayET();
  const { startOfDay } = getETDayBoundaries(normalizedDate);
  return new Date(startOfDay.getTime() + 12 * 60 * 60 * 1000);
}

function resolveDateLabel(targetDate: Date) {
  const requestedDate = targetDate.toISOString().slice(0, 10);
  const today = getTodayET();
  if (requestedDate === today) {
    return "today";
  }

  const { startOfDay } = getETDayBoundaries(today);
  const tomorrow = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000).toLocaleDateString(
    "en-CA",
    {
      timeZone: "America/New_York",
    },
  );

  return requestedDate === tomorrow ? "tomorrow" : requestedDate;
}

type MlbGameplanStatSpec = {
  leaderCategory: string;
  label: "OBP" | "OPS" | "ERA" | "WHIP";
  statGroup: "hitting" | "pitching";
};

type MlbGameplanLeaderRow = {
  rank: number | null;
  playerName: string;
  teamName: string | null;
  valueLabel: string | null;
  numericValue: number | null;
};

function normalizeNameKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferMlbTeamsFromMessage(message: string) {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  return MLB_TEAM_REFERENCES.filter((team) =>
    team.aliases.some((alias) => new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(normalized)),
  );
}

function parseMlbGameplanStatSpecs(message: string): MlbGameplanStatSpec[] {
  const lower = toStringValue(message).toLowerCase();
  const specs: MlbGameplanStatSpec[] = [];

  if (/\bobp\b/.test(lower)) {
    specs.push({
      leaderCategory: "onBasePercentage",
      label: "OBP",
      statGroup: "hitting",
    });
  }
  if (/\bops\b/.test(lower)) {
    specs.push({
      leaderCategory: "ops",
      label: "OPS",
      statGroup: "hitting",
    });
  }
  if (/\beras?\b/.test(lower)) {
    specs.push({
      leaderCategory: "earnedRunAverage",
      label: "ERA",
      statGroup: "pitching",
    });
  }
  if (/\bwhip\b/.test(lower)) {
    specs.push({
      leaderCategory: "whip",
      label: "WHIP",
      statGroup: "pitching",
    });
  }

  return specs;
}

function extractMlbLeaderboardRows(payload: unknown): MlbGameplanLeaderRow[] {
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
        playerName: toStringValue(entry[1]),
        teamName: toOptionalString(entry[2]),
        valueLabel: toOptionalString(entry[3]),
        numericValue: Number.isFinite(numericValue) ? numericValue : null,
      };
    })
    .filter((entry): entry is MlbGameplanLeaderRow => Boolean(entry?.playerName));
}

function extractExplicitIsoDateFromMessage(message: string): string | null {
  const match = message.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return match?.[1] || null;
}

function messageUsesCurrentSlateDate(message: string) {
  return /\b(?:later today|today|today's|todays|tonight|right now|current slate|this slate|this afternoon|this evening)\b/i.test(
    message,
  );
}

function resolveMessageTargetDate(rawDate: unknown, message: string): Date {
  const explicitDateInMessage = extractExplicitIsoDateFromMessage(message);
  if (explicitDateInMessage) {
    return resolveTargetDate(explicitDateInMessage);
  }

  if (/\btomorrow\b/i.test(message)) {
    const { startOfDay } = getETDayBoundaries(getTodayET());
    return new Date(startOfDay.getTime() + 36 * 60 * 60 * 1000);
  }

  if (messageUsesCurrentSlateDate(message)) {
    return resolveTargetDate(null);
  }

  const requestedDate = toStringValue(rawDate);
  if (requestedDate) {
    return resolveTargetDate(requestedDate);
  }

  return resolveTargetDate(null);
}

async function buildMlbTeamGameMap(targetDate: Date, teamFilter: Set<string>) {
  const requestedDate = targetDate.toISOString().slice(0, 10);
  const { startOfDay } = getETDayBoundaries(requestedDate);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);
  const games = (await storage.getDailyGames(startOfDay, endOfDay, "MLB")).filter((game) =>
    teamFilter.size > 0 ? teamFilter.has(game.homeTeam) || teamFilter.has(game.awayTeam) : true,
  );

  const teamGameMap = new Map<
    string,
    { gameId: string; opponent: string; startTime: string; status: string | null }
  >();

  for (const game of games) {
    teamGameMap.set(game.homeTeam, {
      gameId: game.gameId,
      opponent: `vs ${game.awayTeam}`,
      startTime: game.startTime.toISOString(),
      status: game.status,
    });
    teamGameMap.set(game.awayTeam, {
      gameId: game.gameId,
      opponent: `@ ${game.homeTeam}`,
      startTime: game.startTime.toISOString(),
      status: game.status,
    });
  }

  return teamGameMap;
}

function selectScannerBackedUpcomingCandidate(input: {
  allPlayers: Array<{
    id?: string | null;
    isActive?: boolean | null;
    sport?: string | null;
    team?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  }>;
  games: Array<{
    sport?: string | null;
    startTime: Date | string;
    homeTeam?: string | null;
    awayTeam?: string | null;
  }>;
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

async function getHoldingAvailability(userId: string, playerId: string) {
  const holding = await storage.getHoldingMultiplierState(userId, playerId);
  if (!holding) {
    return {
      hasHolding: false,
      quantity: 0,
      effectiveShares: 0,
      multiplier: "0.00",
      availableShares: 0,
      canStackShares: false,
      maxStackable: 0,
    };
  }

  return {
    hasHolding: true,
    quantity: holding.quantity,
    effectiveShares: holding.effectiveShares,
    multiplier: holding.multiplier,
    availableShares: holding.availableShares,
    canStackShares: holding.canStackShares,
    maxStackable: holding.maxStackable,
  };
}

async function buildDailyBoostCandidateScan(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<HermesScanResult> {
  const sport = await resolvePreferredSport(input.userId, input.args?.sport);
  const targetDate = resolveTargetDate(input.args?.date);
  const [eligiblePlayers, currentBoosts] = await Promise.all([
    storage.getEligiblePlayersForBoost(input.userId, sport, targetDate),
    storage.getDailyBoostsAllSports(input.userId, targetDate),
  ]);

  const occupiedSlots = new Set(
    currentBoosts
      .map((entry) => Number(entry.slotTier))
      .filter((entry) => BOOST_SLOT_TIERS.includes(entry as (typeof BOOST_SLOT_TIERS)[number])),
  );
  const openSlots = BOOST_SLOT_TIERS.filter((entry) => !occupiedSlots.has(entry));
  const boostedPlayerIds = new Set(currentBoosts.map((entry) => entry.playerId));
  const candidates = eligiblePlayers
    .map((entry) => ({
      playerId: entry.player.id,
      playerName: buildPlayerLabel(entry.player, entry.player.id),
      availableShares: Number(entry.availableShares || 0),
      multiplier: Number(entry.multiplier || 0),
      gameStartTime: entry.gameStartTime,
      alreadyBoosted: boostedPlayerIds.has(entry.player.id),
    }))
    .sort((left, right) => {
      if (left.alreadyBoosted !== right.alreadyBoosted) {
        return left.alreadyBoosted ? 1 : -1;
      }
      if (right.multiplier !== left.multiplier) {
        return right.multiplier - left.multiplier;
      }
      return right.availableShares - left.availableShares;
    })
    .slice(0, 3);

  const candidateSummary = candidates
    .map((entry) => {
      const timing = entry.gameStartTime
        ? `, locks at ${new Date(entry.gameStartTime).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/New_York",
          })} ET`
        : "";
      const boosted = entry.alreadyBoosted ? ", already boosted" : "";
      return `${entry.playerName} (${entry.availableShares.toFixed(2)} available, ${entry.multiplier.toFixed(2)}x multiplier${timing}${boosted})`;
    })
    .join("; ");
  const warnings: string[] = [];

  if (openSlots.length === 0) {
    warnings.push("All four daily boost slots are currently filled in that window.");
  }
  if (candidates.length === 0) {
    warnings.push(`No eligible ${sport} holdings are available for a new boost right now.`);
  }

  return buildScanResult({
    toolName: "scan_daily_boost_candidates",
    domain: "daily_boosts",
    summary: `Scanned ${sport} daily boost eligibility for ${targetDate.toISOString().slice(0, 10)}.`,
    replyText:
      candidates.length > 0
        ? `You have ${openSlots.length} open daily boost slot${openSlots.length === 1 ? "" : "s"} for ${sport}. The best candidates right now are ${candidateSummary}. If you want, I can stage one of those players into a specific slot next.`
        : openSlots.length === 0
          ? `All of your daily boost slots are already filled for ${sport} in that window. If you want to change the board, the next move is removing one of the current boosts before lock.`
          : `You still have ${openSlots.length} open daily boost slot${openSlots.length === 1 ? "" : "s"}, but I do not see an eligible ${sport} holding to place right now. The next move is either wait for a qualifying holding or buy into the player you want to boost first.`,
    observations: [
      `${eligiblePlayers.length} eligible holding row${eligiblePlayers.length === 1 ? "" : "s"} matched ${sport}.`,
      `${openSlots.length} boost slot${openSlots.length === 1 ? "" : "s"} remain open.`,
    ],
    warnings,
    context: {
      sport,
      date: targetDate.toISOString(),
      openSlots,
      currentBoosts,
      candidates,
    },
  });
}

async function buildOpenBoostSlotScan(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<HermesScanResult> {
  const targetDate = resolveTargetDate(input.args?.date);
  const currentBoosts = await storage.getDailyBoostsAllSports(input.userId, targetDate);
  const occupiedSlots = new Set(
    currentBoosts
      .map((entry) => Number(entry.slotTier))
      .filter((entry) => BOOST_SLOT_TIERS.includes(entry as (typeof BOOST_SLOT_TIERS)[number])),
  );
  const openSlots = BOOST_SLOT_TIERS.filter((entry) => !occupiedSlots.has(entry));

  return buildScanResult({
    toolName: "scan_open_boost_slots",
    domain: "daily_boosts",
    summary: `Identified ${openSlots.length} open daily boost slot(s).`,
    replyText:
      openSlots.length > 0
        ? `You still have ${openSlots.length} open boost slot${openSlots.length === 1 ? "" : "s"} right now: ${openSlots.map((entry) => `${entry}x`).join(", ")}. If you want, I can scan the best eligible players for those slots next.`
        : "All four daily boost slots are already occupied in the current window. If you want to change the board, I can help you remove one before lock.",
    observations: [
      `${currentBoosts.length} boost slot${currentBoosts.length === 1 ? "" : "s"} are currently filled.`,
    ],
    warnings: [],
    context: {
      date: targetDate.toISOString(),
      openSlots,
      currentBoosts,
    },
  });
}

async function buildOperatorScan(
  input: {
    userId: string;
    args?: Record<string, unknown>;
  },
  toolName:
    | "scan_scout_opportunities"
    | "scan_portfolio_cleanup_levers"
    | "scan_watchlist_targets"
    | "scan_top_market_opportunities",
): Promise<HermesScanResult> {
  const { context } = await loadOperatorToolContext(
    input.userId,
    toStringValue(input.args?.message),
    input.args?.sport,
  );
  const assignedScouts = Math.max(0, context.maxScouts - context.remainingScouts);
  const candidateNames = context.recommendedTargets
    .slice(0, 3)
    .map((entry) => entry.name.trim())
    .filter(Boolean);
  const leadLevers = context.operatorOverview.nextBestLevers.slice(0, 3);

  switch (toolName) {
    case "scan_scout_opportunities":
      return buildScanResult({
        toolName,
        domain: "scouting",
        summary: `Ranked ${candidateNames.length} scout target(s) from the current board.`,
        replyText:
          candidateNames.length > 0
            ? `The clearest scout targets right now are ${formatCandidateList(candidateNames)}. You are using ${assignedScouts}/${context.maxScouts} scouts, so the next move is either assign your remaining scouts or reallocate an existing one.`
            : `You are using ${assignedScouts}/${context.maxScouts} scouts. I do not see a standout new scout target right now, so the cleaner move is to hold or reshuffle an existing allocation.`,
        observations: [
          `${assignedScouts}/${context.maxScouts} scouts currently assigned.`,
          `${context.remainingScouts} scout${context.remainingScouts === 1 ? "" : "s"} remain unassigned.`,
        ],
        warnings: [],
        context: {
          recommendedTargets: context.recommendedTargets.slice(0, 5),
          remainingScouts: context.remainingScouts,
        },
      });
    case "scan_portfolio_cleanup_levers":
      return buildScanResult({
        toolName,
        domain: "portfolio",
        summary: "Reviewed portfolio cleanup levers.",
        replyText:
          leadLevers.length > 0
            ? `The main cleanup levers I see are ${formatCandidateList(leadLevers)}. Your top holdings are ${
                formatCandidateList(
                  context.operatorOverview.topHoldings.slice(0, 3).map((entry) => entry.name),
                ) || "not overly concentrated right now"
              }.`
            : "I do not see a single urgent cleanup problem right now. The current portfolio shape looks fairly balanced, so any cleanup is more about preference than a hard risk issue.",
        observations: [
          `${context.operatorOverview.portfolioPlayerCount} active player position${context.operatorOverview.portfolioPlayerCount === 1 ? "" : "s"}.`,
        ],
        warnings: [],
        context: {
          topHoldings: context.operatorOverview.topHoldings,
          nextBestLevers: leadLevers,
        },
      });
    case "scan_watchlist_targets": {
      const watchlists = await storage.getWatchlists(input.userId);

      return buildScanResult({
        toolName,
        domain: "watchlists",
        summary: `Reviewed ${watchlists.length} watchlist(s) and current tracking candidates.`,
        replyText:
          candidateNames.length > 0
            ? `The most interesting names to track right now are ${formatCandidateList(candidateNames)}. You currently have ${watchlists.length} watchlist${watchlists.length === 1 ? "" : "s"} and ${context.operatorOverview.watchlistEntryCount} total tracked entries.`
            : `You currently have ${watchlists.length} watchlist${watchlists.length === 1 ? "" : "s"} and ${context.operatorOverview.watchlistEntryCount} tracked entries. Nothing obviously new is jumping out right now, so the better move may be cleaning up stale names instead of adding more.`,
        observations: [`${context.operatorOverview.watchlistEntryCount} total watchlist entries.`],
        warnings: [],
        context: {
          watchlists,
          recommendedTargets: context.recommendedTargets.slice(0, 5),
        },
      });
    }
    case "scan_top_market_opportunities":
      return buildScanResult({
        toolName,
        domain: "market",
        summary: `Surfaced ${candidateNames.length} market-facing opportunity candidate(s).`,
        replyText:
          candidateNames.length > 0
            ? `The cleanest market names to look at right now are ${formatCandidateList(candidateNames)}. If you want, I can next turn one of those into a quote-backed buy or sell preview.`
            : "I do not see a standout fresh entry opportunity right now. The cleaner move is to wait for better price or news context before forcing a new trade.",
        observations: [
          `${context.recommendedTargets.length} ranked target${context.recommendedTargets.length === 1 ? "" : "s"} considered.`,
        ],
        warnings: [],
        context: {
          recommendedTargets: context.recommendedTargets.slice(0, 5),
        },
      });
  }
}

async function buildIdleBalanceDeploymentScan(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<HermesScanResult> {
  const requestedMessage = toStringValue(input.args?.message);
  const requestedSport = toStringValue(input.args?.sport).toUpperCase();
  const message =
    requestedMessage ||
    (requestedSport
      ? `what should i do with my idle balance in ${requestedSport}?`
      : "what should i do with my idle balance?");
  const { context } = await loadOperatorToolContext(input.userId, message, input.args?.sport);
  const availableBalance = context.operatorOverview.availableBalance;
  const recommendedTargets = context.recommendedTargets.slice(0, 5);
  const candidateNames = recommendedTargets
    .slice(0, 3)
    .map((entry) => entry.name.trim())
    .filter(Boolean);
  const warnings: string[] = [];

  if (availableBalance < 10) {
    warnings.push("Available balance is already mostly deployed.");
  }
  if (candidateNames.length === 0 && availableBalance >= 10) {
    warnings.push("No standout deployment candidate is surfacing from the current ranked board.");
  }

  return buildScanResult({
    toolName: "scan_idle_balance_options",
    domain: "portfolio",
    intentFocus: "cash_deployment",
    summary:
      availableBalance < 10
        ? "Available balance is already mostly deployed."
        : "Reviewed idle-balance deployment options.",
    replyText:
      availableBalance < 10
        ? `You only have ${formatMoney(availableBalance)} available right now, so there is no meaningful idle-balance decision to force.`
        : candidateNames.length > 0
          ? `You have ${formatMoney(availableBalance)} available. The cleanest current deployment candidates are ${formatCandidateList(candidateNames)}.`
          : `You have ${formatMoney(availableBalance)} available, but there is no standout deployment candidate from the current ranked board right now.`,
    observations: [
      `${formatMoney(availableBalance)} is currently available to deploy.`,
      `${context.operatorOverview.openDailyBoostSlots} daily boost slot${context.operatorOverview.openDailyBoostSlots === 1 ? "" : "s"} remain open.`,
      `${context.remainingScouts} scout${context.remainingScouts === 1 ? "" : "s"} remain unassigned.`,
    ],
    warnings,
    context: {
      availableBalance,
      selectionWindow: context.selectionWindow,
      operatorOverview: context.operatorOverview,
      recommendedTargets,
      defaultSport: context.defaultSport,
    },
  });
}

async function buildCommunityBoostCandidateScan(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<HermesScanResult> {
  const profile = (await getScoutAgentProfile(input.userId)).profile;
  const requestedSport = toStringValue(input.args?.sport).toUpperCase();
  const targetDate = resolveTargetDate(input.args?.date);
  const dateLabel = resolveDateLabel(targetDate);
  const sportHint = requestedSport || toStringValue(profile.defaultSport).toUpperCase() || null;
  const [communitySharesAvailable, allPlayers, games, scanners, existingBoosts] = await Promise.all(
    [
      storage.getUserCommunityBoostShares(input.userId),
      storage.getPlayers(),
      storage.getDailyGames(new Date(), new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)),
      storage.getFinancialMarketScanners(sportHint || "ALL"),
      storage.getCommunityBoostsForDate(
        sportHint || toStringValue(profile.defaultSport).toUpperCase() || "NBA",
        targetDate,
      ),
    ],
  );
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
  const warnings: string[] = [];

  if (communitySharesAvailable < 1) {
    warnings.push("No community shares are currently available.");
  }
  if (!candidate && communitySharesAvailable > 0) {
    warnings.push("No clean scanner-backed community boost candidate is available right now.");
  }

  const opponent =
    candidate && candidate.game.homeTeam === candidate.player.team
      ? `vs ${candidate.game.awayTeam}`
      : candidate
        ? `@ ${candidate.game.homeTeam}`
        : null;
  const candidateName =
    candidate && candidate.player.id
      ? buildPlayerLabel(candidate.player, candidate.player.id)
      : null;

  return buildScanResult({
    toolName: "scan_community_boost_candidates",
    domain: "community_boosts",
    summary:
      communitySharesAvailable < 1
        ? "No community shares are currently available."
        : candidate
          ? `Reviewed the best ${dateLabel} community boost opportunity.`
          : "Reviewed the current community boost window.",
    replyText:
      communitySharesAvailable < 1
        ? "You do not have a community share available right now, so there is nothing to assign."
        : candidateName && opponent
          ? `${candidateName} is the cleanest ${dateLabel} community boost look right now ${opponent}.`
          : "You have a community share available, but there is no clean scanner-backed candidate in the current window right now.",
    observations: [
      `${communitySharesAvailable} community share${communitySharesAvailable === 1 ? "" : "s"} available.`,
      `${existingBoosts.length} community boost${existingBoosts.length === 1 ? "" : "s"} already exist in that window.`,
      candidateName && candidate?.game.startTime
        ? `${candidateName} is scheduled ${opponent} at ${new Date(candidate.game.startTime).toLocaleString()}.`
        : "No unclaimed scanner-backed player is standing out from the current window.",
    ],
    warnings,
    context: {
      sport: sportHint,
      date: targetDate.toISOString(),
      communitySharesAvailable,
      existingBoosts,
      candidate:
        candidateName && candidate?.player.id
          ? {
              playerId: candidate.player.id,
              playerName: candidateName,
              opponent,
              gameStartTime: candidate.game.startTime,
            }
          : null,
    },
  });
}

async function buildNewsImpactScan(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<HermesScanResult> {
  const profile = (await getScoutAgentProfile(input.userId)).profile;
  const message =
    toStringValue(input.args?.message) || "What changed today that affects my players?";
  const research = await planHostedWebResearch({
    message,
    profile,
  });

  if (!research) {
    return buildScanResult({
      toolName: "scan_news_impact",
      domain: "research",
      summary: "Hosted research did not return a usable result.",
      replyText:
        "I did not pull a clean hosted research result right now. If you want, I can still review your setup using only internal account state.",
      observations: [],
      warnings: ["No hosted research result was available for that request."],
      context: {},
    });
  }

  return buildScanResult({
    toolName: "scan_news_impact",
    domain: "research",
    summary: research.summary || "Reviewed current hosted research for account impact.",
    replyText:
      research.replyText ||
      research.summary ||
      "I reviewed the current external context and translated it into an account-specific read.",
    observations: research.observations || [],
    warnings: research.warnings || [],
    context: {
      citations: research.citations || [],
    },
  });
}

function resolvePreviewMessage(input: {
  toolName: string;
  args?: Record<string, unknown>;
}): string {
  const rawMessage = toStringValue(input.args?.message);
  if (rawMessage) {
    return rawMessage;
  }

  const playerLabel =
    toStringValue(input.args?.playerName) || toStringValue(input.args?.playerId) || "that player";
  const dollarAmount =
    typeof input.args?.amount === "number"
      ? input.args.amount
      : typeof input.args?.sbAmount === "number"
        ? input.args.sbAmount
        : null;
  const shares =
    typeof input.args?.shares === "number"
      ? input.args.shares
      : typeof input.args?.sharesAmount === "number"
        ? input.args.sharesAmount
        : null;
  const slotTier =
    typeof input.args?.slotTier === "number" ? Math.max(2, Math.min(5, input.args.slotTier)) : 2;
  const requestedDate = toStringValue(input.args?.date);
  const today = getTodayET();
  const { startOfDay } = getETDayBoundaries(today);
  const tomorrow = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000).toLocaleDateString(
    "en-CA",
    {
      timeZone: "America/New_York",
    },
  );
  const dateLabel = requestedDate === tomorrow ? "tomorrow" : "today";

  switch (input.toolName) {
    case "preview_pool_buy":
      if (shares != null) {
        return `buy ${shares} ${playerLabel} shares`;
      }
      if (dollarAmount != null) {
        return `buy $${dollarAmount} of ${playerLabel}`;
      }
      break;
    case "preview_pool_sell":
      if (shares != null) {
        return `sell ${shares} ${playerLabel} shares`;
      }
      break;
    case "preview_lp_add":
      if (shares != null && dollarAmount != null) {
        return `add ${shares} ${playerLabel} shares and $${dollarAmount} to liquidity`;
      }
      if (shares != null || dollarAmount != null) {
        return `add optimal liquidity on ${playerLabel}`;
      }
      break;
    case "preview_lp_add_optimal": {
      const maxShares = toPositiveNumber(input.args?.maxShares);
      const maxPlayMoney = toPositiveNumber(input.args?.maxPlayMoney);
      if (maxShares != null && maxPlayMoney != null) {
        return `add optimal liquidity on ${playerLabel} using up to ${maxShares} shares and $${maxPlayMoney}`;
      }
      break;
    }
    case "preview_lp_remove":
      if (shares != null) {
        return `remove ${shares} lp shares from ${playerLabel}`;
      }
      break;
    case "preview_lp_zap":
      if (shares != null) {
        return `zap ${shares} ${playerLabel} shares into liquidity`;
      }
      if (dollarAmount != null) {
        return `zap $${dollarAmount} into ${playerLabel} liquidity`;
      }
      break;
    case "preview_stack_shares":
      if (shares != null) {
        return `stack shares ${shares} ${playerLabel} shares`;
      }
      break;
    case "preview_daily_boost_assign":
      return `put ${playerLabel} in my ${slotTier}x boost slot ${dateLabel}`;
    case "preview_daily_boost_remove":
      return `remove ${playerLabel} from my boosts ${dateLabel}`;
    case "preview_watchlist_add":
      return `add ${playerLabel} to my watchlist`;
    case "preview_watchlist_remove":
      return `remove ${playerLabel} from my watchlist`;
    case "preview_community_boost_create":
      return `create a community boost for ${playerLabel} ${dateLabel}`;
    case "preview_scout_adjustment":
      if (typeof input.args?.targetCount === "number") {
        return `set ${playerLabel} scouts to ${input.args.targetCount}`;
      }
      break;
    case "preview_multi_action_bundle":
      return "";
    default:
      break;
  }

  throw new Error(`message is required for ${input.toolName}`);
}

async function getOrCreateThreadIdForAction(input: {
  userId: string;
  threadId?: string | null;
  args?: Record<string, unknown>;
}) {
  if (input.threadId) {
    return input.threadId;
  }

  const thread = await createAgentThread(input.userId, {
    channel: toChannelValue(input.args?.channel) || "in_app",
    domain: "sportfolio",
    title: toOptionalString(input.args?.title) || undefined,
  });

  return thread.id;
}

async function runParserBackedPreview(input: {
  toolName: string;
  userId: string;
  args?: Record<string, unknown>;
}) {
  const profile = (await getScoutAgentProfile(input.userId)).profile;
  const previewArgs = { ...(input.args || {}) };
  const playerId = toStringValue(previewArgs.playerId);
  if (playerId && !toStringValue(previewArgs.playerName)) {
    const player = await storage.getPlayer(playerId);
    if (player) {
      previewArgs.playerName = buildPlayerLabel(player, playerId);
    }
  }
  const message = resolvePreviewMessage({
    toolName: input.toolName,
    args: previewArgs,
  });
  if (!message) {
    throw new Error("message is required for preview_direct_operation");
  }

  return planDirectAgentOperation({
    userId: input.userId,
    message,
    profile,
    allowAdvisoryResponses: false,
  });
}

function normalizeNameFragment(value: string): string {
  return value
    .replace(/[^a-z0-9\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function findPlayerHoldingByName(input: { userId: string; rawName: string }): Promise<{
  playerId: string;
  playerName: string;
  availableShares: number;
} | null> {
  const normalizedQuery = normalizeNameFragment(input.rawName);
  if (!normalizedQuery) {
    return null;
  }

  const holdings = await storage.getUserHoldingsWithPlayers(input.userId);
  const match = holdings
    .map((entry) => {
      const player = entry.player as {
        id?: string;
        firstName?: string | null;
        lastName?: string | null;
      } | null;
      if (!player?.id) {
        return null;
      }
      const playerName = buildPlayerLabel(player, player.id);
      const fullName = normalizeNameFragment(playerName);
      const lastName = normalizeNameFragment(toStringValue(player.lastName));
      const availableShares = Math.max(
        0,
        Number((entry.holding as { quantity?: number }).quantity || 0) -
          Number(entry.totalLocked || 0),
      );
      const score =
        fullName === normalizedQuery
          ? 100
          : fullName.includes(normalizedQuery)
            ? 80
            : lastName && normalizedQuery.includes(lastName)
              ? 60
              : normalizedQuery.includes(lastName)
                ? 50
                : 0;
      if (score <= 0) {
        return null;
      }

      return {
        playerId: player.id,
        playerName,
        availableShares,
        score,
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        playerId: string;
        playerName: string;
        availableShares: number;
        score: number;
      } => Boolean(entry),
    )
    .sort(
      (left, right) => right.score - left.score || right.availableShares - left.availableShares,
    )[0];

  return match
    ? {
        playerId: match.playerId,
        playerName: match.playerName,
        availableShares: match.availableShares,
      }
    : null;
}

function inferMaxStackShareCount(availableShares: number): number | null {
  const maxEvenShares = Math.floor(Math.max(0, availableShares) / 2) * 2;
  return maxEvenShares >= 4 ? maxEvenShares : null;
}

function stripBundleNoiseWords(text: string): string {
  return text
    .replace(
      /\b(my|the|his|her|their|all|some|rest|remainder|remaining|them|him|it|as many|as possible|if possible|if eligible|possible|eligible|of)\b/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function splitMultiActionClauses(message: string): string[] {
  const normalized = message
    .replace(/[;]+/g, " and ")
    .replace(
      /,\s*(?=(?:then\s+)?(?:buy|stack|put|assign|boost|place|slot|lock|add|remove|sell|zap|create|set|move)\b)/gi,
      " and ",
    );

  return normalized
    .split(/\b(?:and then|then|and)\b/i)
    .map((entry) => entry.trim().replace(/^[,.\s]+|[,.\s]+$/g, ""))
    .filter(Boolean);
}

async function buildMultiActionBundlePreview(input: {
  userId: string;
  args?: Record<string, unknown>;
}) {
  const rawMessage = toStringValue(input.args?.message);
  if (!rawMessage) {
    throw new Error("message is required for preview_multi_action_bundle");
  }

  const profile = (await getScoutAgentProfile(input.userId)).profile;
  const holisticPlan = await planDirectAgentOperation({
    userId: input.userId,
    message: rawMessage,
    profile,
    allowAdvisoryResponses: false,
  });
  const holisticIntent =
    typeof holisticPlan?.contextSnapshot?.intent === "string"
      ? holisticPlan.contextSnapshot.intent
      : null;

  if (
    holisticPlan &&
    (holisticPlan.pendingClarification ||
      (holisticPlan.actions || []).length > 1 ||
      (holisticIntent != null &&
        new Set([
          "buy_stack_boost",
          "buy_then_boost",
          "buy_then_stack",
          "buy_then_stack_then_boost",
          "stack_then_boost",
          "sell_then_stack",
          "sell_then_boost",
          "sell_then_stack_then_boost",
          "ranked_stat_multi_player_workflow",
        ]).has(holisticIntent)))
  ) {
    return {
      ...holisticPlan,
      generatedMessages: [rawMessage],
      contextSnapshot: {
        ...(holisticPlan.contextSnapshot || {}),
        generatedMessages: [rawMessage],
      },
    };
  }

  const normalized = rawMessage.toLowerCase();
  const clauses = splitMultiActionClauses(normalized);

  if (clauses.length < 2) {
    throw new Error("preview_multi_action_bundle requires a compound multi-step request");
  }

  const generatedMessages: string[] = [];
  const blockingReasons: string[] = [];
  let lastResolvedPlayerName: string | null = null;
  let lastResolvedPlayerId: string | null = null;

  for (const clause of clauses) {
    const buyMatch =
      clause.match(
        /\bbuy\s+\$?\d+(?:\.\d+)?\s+(?:of\s+)?([a-z .'-]+?)(?:\s+from\s+the\s+pool|\s+in\s+the\s+pool|\s+in\s+pool|$)/i,
      ) ||
      clause.match(
        /\bbuy\s+(?:as\s+many\s+)?([a-z .'-]+?)(?:\s+shares?)?\s*(?:as\s+(?:possible|i\s+can(?:\s+afford)?))?$/i,
      ) ||
      clause.match(/\bbuy\s+\d+\s+(.+?)\s+shares?\b/i) ||
      clause.match(/\bbuy\s+\d+\s+shares?\s+of\s+(.+?)$/i);
    if (buyMatch) {
      const rawName = stripBundleNoiseWords(buyMatch[1]);
      if (rawName) {
        generatedMessages.push(clause);
        lastResolvedPlayerName = rawName;
      } else {
        generatedMessages.push(clause);
      }
      continue;
    }

    const sellMatch =
      clause.match(
        /\bsell\s+\d+(?:\.\d+)?\s+shares?\s+(?:of\s+)?([a-z .'-]+?)(?:\s+from\s+the\s+pool|\s+from\s+the\s+market|$)/i,
      ) || clause.match(/\bsell\s+\d+(?:\.\d+)?\s+([a-z .'-]+?)\s+shares?\b/i);
    if (sellMatch) {
      const rawName = stripBundleNoiseWords(sellMatch[1]);
      generatedMessages.push(clause);
      if (rawName) {
        lastResolvedPlayerName = rawName;
      }
      continue;
    }

    const stackMatch = clause.match(/\bstack(?:\s+shares?)?\s*([a-z .'-]*)/i);
    if (stackMatch) {
      const rawName = stripBundleNoiseWords(stackMatch[1])
        .replace(/\bshares?\b/gi, "")
        .trim();
      const nameToResolve = rawName || lastResolvedPlayerName;
      if (!nameToResolve) {
        blockingReasons.push(
          "I need a player name to stack shares for. Tell me which player to stack.",
        );
        continue;
      }
      const holding = await findPlayerHoldingByName({
        userId: input.userId,
        rawName: nameToResolve,
      });
      if (!holding) {
        blockingReasons.push(
          `I could not find an unlocked holding for "${stackMatch[1].trim()}" to stack.`,
        );
        continue;
      }

      const sharesToStack = inferMaxStackShareCount(holding.availableShares);
      if (sharesToStack == null) {
        blockingReasons.push(
          `${holding.playerName} does not have at least 4 unlocked shares available to stack.`,
        );
        continue;
      }

      generatedMessages.push(`stack shares ${sharesToStack} ${holding.playerName} shares`);
      lastResolvedPlayerName = holding.playerName;
      lastResolvedPlayerId = holding.playerId;
      continue;
    }

    const slotMatch = clause.match(
      /\b(?:put|assign)\s+(?:him|them|it|([a-z .'-]+))?.*?\b(?:at|in(?:to)?)\s+(?:my\s+)?([2-5])x\b/i,
    );
    if (slotMatch) {
      let playerName = slotMatch[1] ? null : lastResolvedPlayerName;
      if (slotMatch[1]) {
        const holding = await findPlayerHoldingByName({
          userId: input.userId,
          rawName: slotMatch[1],
        });
        if (holding) {
          playerName = holding.playerName;
          lastResolvedPlayerId = holding.playerId;
        } else {
          blockingReasons.push(
            `I could not find an unlocked holding for "${slotMatch[1].trim()}" to place in a boost slot.`,
          );
          continue;
        }
      }

      if (!playerName) {
        blockingReasons.push(
          "I need the player tied to that boost slot request before I can build the multi-step preview.",
        );
        continue;
      }

      generatedMessages.push(`put ${playerName} in my ${slotMatch[2]}x boost slot today`);
      lastResolvedPlayerName = playerName;
      continue;
    }

    const explicitPlayerMatch = clause.match(
      /\b(?:put|assign)\s+([a-z .'-]+)\s+(?:at|in(?:to)?)\s+(?:my\s+)?([2-5])x\b/i,
    );
    if (explicitPlayerMatch) {
      const holding = await findPlayerHoldingByName({
        userId: input.userId,
        rawName: explicitPlayerMatch[1],
      });
      if (!holding) {
        blockingReasons.push(
          `I could not find an unlocked holding for "${explicitPlayerMatch[1].trim()}" to place in a boost slot.`,
        );
        continue;
      }

      generatedMessages.push(
        `put ${holding.playerName} in my ${explicitPlayerMatch[2]}x boost slot today`,
      );
      lastResolvedPlayerName = holding.playerName;
      lastResolvedPlayerId = holding.playerId;
      continue;
    }

    generatedMessages.push(clause);
  }

  if (generatedMessages.length === 0 && blockingReasons.length > 0) {
    return {
      replyText: blockingReasons.join(" "),
      summary: "Could not build a multi-step workflow from the current holdings.",
      warnings: Array.from(new Set(blockingReasons)),
      observations: [],
      actions: [],
      citations: [],
      pendingClarification: null,
      trace: [],
      generatedMessages: [],
      contextSnapshot: {
        generatedMessages: [],
        blockingReasons,
      },
      domain: "sportfolio",
    };
  }

  const combinedActions: any[] = [];
  const warnings: string[] = [];
  const observations: string[] = [];
  const citations: any[] = [];
  const trace: any[] = [];
  let pendingClarification: any = null;

  for (const message of generatedMessages) {
    const plan = await planDirectAgentOperation({
      userId: input.userId,
      message,
      profile,
      allowAdvisoryResponses: false,
    });

    if (!plan) {
      blockingReasons.push(`I could not build the "${message}" step with the current toolset.`);
      continue;
    }
    if (plan.pendingClarification) {
      pendingClarification = plan.pendingClarification;
      warnings.push(...(plan.warnings || []));
      observations.push(
        `The step "${message}" still needs clarification before the full bundle can be staged.`,
      );
      break;
    }
    combinedActions.push(...(plan.actions || []));
    warnings.push(...(plan.warnings || []));
    observations.push(...(plan.observations || []));
    citations.push(...(plan.citations || []));
    if (Array.isArray(plan.trace)) {
      trace.push(...plan.trace);
    }
  }

  return {
    replyText:
      pendingClarification && combinedActions.length === 0
        ? "I broke that into a multi-step workflow, but I still need one clarification before I can stage it."
        : combinedActions.length === 0 && blockingReasons.length > 0
          ? blockingReasons.join(" ")
          : `I broke that into ${generatedMessages.length} linked step${generatedMessages.length === 1 ? "" : "s"} and prepared ${combinedActions.length} confirmation-gated action${combinedActions.length === 1 ? "" : "s"}.`,
    summary:
      combinedActions.length === 0 && blockingReasons.length > 0
        ? "Could not complete the requested multi-step workflow."
        : "Prepared a multi-step Hermes workflow preview.",
    warnings: Array.from(new Set([...warnings, ...blockingReasons])),
    observations,
    actions: combinedActions,
    citations,
    pendingClarification,
    trace,
    generatedMessages,
    contextSnapshot: {
      generatedMessages,
    },
    domain: "sportfolio",
  };
}

async function buildPoolBuyPreview(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<StructuredPlanPreview> {
  const sbAmount = toPositiveNumber(input.args?.sbAmount ?? input.args?.amount);
  if (sbAmount == null) {
    throw new Error("playerId or playerName and sbAmount are required for preview_pool_buy");
  }

  const { playerId, playerName } = await resolvePlayerReference(input);
  const [availableBalance, pool, quote] = await Promise.all([
    storage.getAvailableBalance(input.userId),
    getOrCreatePool(playerId),
    getBuyQuote(playerId, sbAmount),
  ]);

  if (!quote) {
    throw new Error("Could not calculate a buy quote");
  }

  const warnings: string[] = [];
  const canStage = availableBalance >= sbAmount;
  if (!canStage) {
    warnings.push(
      `Available balance is ${formatMoney(availableBalance)}, which is below the requested ${formatMoney(sbAmount)}.`,
    );
  }

  return buildStructuredPreview({
    toolName: "preview_pool_buy",
    canStage,
    requiresConfirmation: true,
    actionSummary: `Buy ${formatMoney(sbAmount)} of ${playerName}`,
    stageMessage: `buy $${sbAmount} of ${playerName}`,
    beforeState: {
      availableBalance,
      currentPrice: pool.currentPrice,
    },
    afterState: {
      availableBalance: Math.max(0, availableBalance - sbAmount),
      estimatedSharesOut: quote.sharesOut,
      projectedPoolPrice: quote.newPoolPrice,
    },
    estimatedImpact: `Estimated fill at ${formatMoney(quote.effectivePrice)} per share with ${(quote.slippagePercent * 100).toFixed(2)}% slippage.`,
    warnings,
  });
}

async function buildPoolSellPreview(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<StructuredPlanPreview> {
  const sharesAmount = toPositiveInteger(input.args?.sharesAmount ?? input.args?.shares);
  if (sharesAmount == null) {
    throw new Error("playerId or playerName and sharesAmount are required for preview_pool_sell");
  }

  const { playerId, playerName } = await resolvePlayerReference(input);
  const [availableBalance, holdingInfo, quote] = await Promise.all([
    storage.getAvailableBalance(input.userId),
    storage.getHoldingMultiplierState(input.userId, playerId),
    getSellQuote(playerId, sharesAmount),
  ]);

  if (!quote) {
    throw new Error("Could not calculate a sell quote");
  }

  const availableShares = Number(holdingInfo?.availableShares || 0);
  const warnings: string[] = [];
  const canStage = availableShares >= sharesAmount;
  if (!canStage) {
    warnings.push(
      `Available shares are ${availableShares}, which is below the requested ${sharesAmount}.`,
    );
  }

  return buildStructuredPreview({
    toolName: "preview_pool_sell",
    canStage,
    requiresConfirmation: true,
    actionSummary: `Sell ${sharesAmount} ${playerName} share${sharesAmount === 1 ? "" : "s"}`,
    stageMessage: `sell ${sharesAmount} ${playerName} shares`,
    beforeState: {
      availableBalance,
      availableShares,
      currentEffectiveShares: holdingInfo?.effectiveShares?.toFixed(2) || "0.00",
      currentMultiplier: holdingInfo?.multiplier || "0.00",
    },
    afterState: {
      availableBalance: availableBalance + quote.sellerReceives,
      availableShares: Math.max(0, availableShares - sharesAmount),
      estimatedSbOut: quote.sellerReceives,
      projectedPoolPrice: quote.newPoolPrice,
    },
    estimatedImpact: `Estimated proceeds ${formatMoney(quote.sellerReceives)} at ${formatMoney(quote.effectivePrice)} per share.`,
    warnings,
  });
}

async function buildLpAddPreview(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<StructuredPlanPreview> {
  const shares = toPositiveNumber(input.args?.shares);
  const playMoney = toPositiveNumber(input.args?.playMoney);
  if (shares == null || playMoney == null) {
    throw new Error(
      "playerId or playerName, shares, and playMoney are required for preview_lp_add",
    );
  }

  const { playerId, playerName } = await resolvePlayerReference(input);
  const [pool, availableBalance, holdingInfo, existingPosition] = await Promise.all([
    getOrCreatePool(playerId),
    storage.getAvailableBalance(input.userId),
    storage.getHoldingMultiplierState(input.userId, playerId),
    getLpPosition(playerId, input.userId),
  ]);

  const expectedPlayMoney = shares * pool.currentPrice;
  const ratioDiff =
    expectedPlayMoney > 0 ? Math.abs(playMoney - expectedPlayMoney) / expectedPlayMoney : 0;
  const lpSharesMinted =
    pool.lpSharesTotal <= 0 || pool.shares <= 0
      ? shares
      : (shares / pool.shares) * pool.lpSharesTotal;
  const ownershipPercentage =
    lpSharesMinted / Math.max(pool.lpSharesTotal + lpSharesMinted, Number.EPSILON);
  const availableShares = Number(holdingInfo?.availableShares || 0);
  const warnings: string[] = [];
  let canStage = true;

  if (availableShares < shares) {
    canStage = false;
    warnings.push(`Available shares are ${availableShares}, below the requested ${shares}.`);
  }
  if (availableBalance < playMoney) {
    canStage = false;
    warnings.push(
      `Available balance is ${formatMoney(availableBalance)}, below the requested ${formatMoney(playMoney)}.`,
    );
  }
  if (ratioDiff > 0.01) {
    canStage = false;
    warnings.push(
      `Current pool ratio implies ${formatMoney(expectedPlayMoney)} for ${shares} shares, so the request is off-ratio.`,
    );
  }

  return buildStructuredPreview({
    toolName: "preview_lp_add",
    canStage,
    requiresConfirmation: true,
    actionSummary: `Add liquidity on ${playerName}`,
    stageMessage: `add ${shares} shares and $${playMoney} into ${playerName} pool`,
    beforeState: {
      availableBalance,
      availableShares,
      currentLpShares: existingPosition?.lpShares ?? 0,
      currentPrice: pool.currentPrice,
    },
    afterState: {
      availableBalance: Math.max(0, availableBalance - playMoney),
      availableShares: Math.max(0, availableShares - shares),
      estimatedLpSharesMinted: lpSharesMinted,
      projectedOwnershipPercent: ownershipPercentage * 100,
    },
    estimatedImpact: `At the current ratio, ${shares} shares should pair with ${formatMoney(expectedPlayMoney)} and mint about ${lpSharesMinted.toFixed(2)} LP shares.`,
    warnings,
  });
}

async function buildLpAddOptimalPreview(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<StructuredPlanPreview> {
  const maxShares = toPositiveNumber(input.args?.maxShares);
  const maxPlayMoney = toPositiveNumber(input.args?.maxPlayMoney);
  if (maxShares == null || maxPlayMoney == null) {
    throw new Error(
      "playerId or playerName, maxShares, and maxPlayMoney are required for preview_lp_add_optimal",
    );
  }

  const { playerId, playerName } = await resolvePlayerReference(input);
  const [pool, availableBalance, holdingInfo, existingPosition] = await Promise.all([
    getOrCreatePool(playerId),
    storage.getAvailableBalance(input.userId),
    storage.getHoldingMultiplierState(input.userId, playerId),
    getLpPosition(playerId, input.userId),
  ]);

  const sharesToDeposit = Math.min(maxShares, maxPlayMoney / pool.currentPrice);
  const playMoneyToDeposit = sharesToDeposit * pool.currentPrice;
  const lpSharesMinted =
    pool.lpSharesTotal <= 0 || pool.shares <= 0
      ? sharesToDeposit
      : (sharesToDeposit / pool.shares) * pool.lpSharesTotal;
  const ownershipPercentage =
    lpSharesMinted / Math.max(pool.lpSharesTotal + lpSharesMinted, Number.EPSILON);
  const availableShares = Number(holdingInfo?.availableShares || 0);
  const warnings: string[] = [];
  let canStage = sharesToDeposit > 0;

  if (availableShares < sharesToDeposit) {
    canStage = false;
    warnings.push(
      `Available shares are ${availableShares}, below the computed ${sharesToDeposit.toFixed(2)} share deposit.`,
    );
  }
  if (availableBalance < playMoneyToDeposit) {
    canStage = false;
    warnings.push(
      `Available balance is ${formatMoney(availableBalance)}, below the computed ${formatMoney(playMoneyToDeposit)} deposit.`,
    );
  }

  return buildStructuredPreview({
    toolName: "preview_lp_add_optimal",
    canStage,
    requiresConfirmation: true,
    actionSummary: `Add optimal liquidity on ${playerName}`,
    stageMessage: `add up to ${maxShares} shares and $${maxPlayMoney} into ${playerName} pool`,
    beforeState: {
      availableBalance,
      availableShares,
      currentLpShares: existingPosition?.lpShares ?? 0,
      currentPrice: pool.currentPrice,
    },
    afterState: {
      availableBalance: Math.max(0, availableBalance - playMoneyToDeposit),
      availableShares: Math.max(0, availableShares - sharesToDeposit),
      estimatedLpSharesMinted: lpSharesMinted,
      projectedOwnershipPercent: ownershipPercentage * 100,
      sharesUnused: Math.max(0, maxShares - sharesToDeposit),
      playMoneyUnused: Math.max(0, maxPlayMoney - playMoneyToDeposit),
    },
    estimatedImpact: `At the current ratio this should use ${sharesToDeposit.toFixed(2)} shares and ${formatMoney(playMoneyToDeposit)}.`,
    warnings,
  });
}

async function buildLpRemovePreview(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<StructuredPlanPreview> {
  const lpShares = toPositiveNumber(input.args?.lpShares ?? input.args?.shares);
  if (lpShares == null) {
    throw new Error("playerId or playerName and lpShares are required for preview_lp_remove");
  }

  const { playerId, playerName } = await resolvePlayerReference(input);
  const [pool, position, availableBalance] = await Promise.all([
    getOrCreatePool(playerId),
    getLpPosition(playerId, input.userId),
    storage.getAvailableBalance(input.userId),
  ]);

  const currentLpShares = position?.lpShares ?? 0;
  const warnings: string[] = [];
  const canStage = Boolean(position) && currentLpShares >= lpShares;
  if (!position) {
    warnings.push("There is no active LP position for this player right now.");
  } else if (currentLpShares < lpShares) {
    warnings.push(
      `Current LP shares are ${currentLpShares.toFixed(2)}, below the requested ${lpShares.toFixed(2)}.`,
    );
  }

  const ownershipPercentage = lpShares / Math.max(pool.lpSharesTotal, Number.EPSILON);
  const sharesOut = pool.shares * ownershipPercentage;
  const playMoneyOut = pool.playMoney * ownershipPercentage;

  return buildStructuredPreview({
    toolName: "preview_lp_remove",
    canStage,
    requiresConfirmation: true,
    actionSummary: `Remove ${lpShares.toFixed(2)} LP shares from ${playerName}`,
    stageMessage: `remove ${lpShares} lp shares from ${playerName}`,
    beforeState: {
      availableBalance,
      currentLpShares,
      positionValue: position?.positionValue ?? 0,
    },
    afterState: {
      availableBalance: availableBalance + playMoneyOut,
      remainingLpShares: Math.max(0, currentLpShares - lpShares),
      estimatedSharesOut: sharesOut,
      estimatedPlayMoneyOut: playMoneyOut,
    },
    estimatedImpact: `This should return about ${sharesOut.toFixed(2)} shares and ${formatMoney(playMoneyOut)}.`,
    warnings,
  });
}

async function buildLpZapPreview(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<StructuredPlanPreview> {
  const shares = toPositiveNumber(input.args?.shares);
  const sb = toPositiveNumber(input.args?.sb ?? input.args?.amount ?? input.args?.sbAmount);
  if (shares == null && sb == null) {
    throw new Error("shares or sb is required for preview_lp_zap");
  }

  const { playerId, playerName } = await resolvePlayerReference(input);
  const [availableBalance, holdingInfo] = await Promise.all([
    storage.getAvailableBalance(input.userId),
    storage.getHoldingMultiplierState(input.userId, playerId),
  ]);

  if (shares != null) {
    const availableShares = Number(holdingInfo?.availableShares || 0);
    if (availableShares < shares) {
      return buildStructuredPreview({
        toolName: "preview_lp_zap",
        canStage: false,
        requiresConfirmation: true,
        actionSummary: `Zap ${shares} ${playerName} shares into liquidity`,
        stageMessage: `zap ${shares} shares into ${playerName} pool`,
        beforeState: {
          availableShares,
        },
        afterState: {
          availableShares,
        },
        estimatedImpact: null,
        warnings: [`Available shares are ${availableShares}, below the requested ${shares}.`],
      });
    }

    const quote = await getZapAddQuoteSharesOnly(playerId, input.userId, shares);

    return buildStructuredPreview({
      toolName: "preview_lp_zap",
      canStage: true,
      requiresConfirmation: true,
      actionSummary: `Zap ${shares} ${playerName} shares into liquidity`,
      stageMessage: `zap ${shares} shares into ${playerName} pool`,
      beforeState: {
        availableShares,
      },
      afterState: {
        availableShares: Math.max(0, availableShares - shares),
        estimatedLpSharesMinted: quote.estimatedLpSharesMinted,
        sharesSoldInternally: quote.sharesSold,
        projectedOwnershipPercent: quote.estimatedOwnershipPercentage * 100,
      },
      estimatedImpact: `The zap internally sells ${quote.sharesSold.toFixed(2)} share(s) before depositing.`,
      warnings: [],
    });
  }

  if (availableBalance < sb!) {
    return buildStructuredPreview({
      toolName: "preview_lp_zap",
      canStage: false,
      requiresConfirmation: true,
      actionSummary: `Zap ${formatMoney(sb!)} into ${playerName} liquidity`,
      stageMessage: `zap $${sb} into ${playerName} pool`,
      beforeState: {
        availableBalance,
      },
      afterState: {
        availableBalance,
      },
      estimatedImpact: null,
      warnings: [
        `Available balance is ${formatMoney(availableBalance)}, below the requested ${formatMoney(sb!)}.`,
      ],
    });
  }

  const quote = await getZapAddQuoteSbOnly(playerId, input.userId, sb!);

  return buildStructuredPreview({
    toolName: "preview_lp_zap",
    canStage: true,
    requiresConfirmation: true,
    actionSummary: `Zap ${formatMoney(sb!)} into ${playerName} liquidity`,
    stageMessage: `zap $${sb} into ${playerName} pool`,
    beforeState: {
      availableBalance,
    },
    afterState: {
      availableBalance: Math.max(0, availableBalance - sb!),
      estimatedLpSharesMinted: quote.estimatedLpSharesMinted,
      sharesBoughtInternally: quote.sharesBought,
      projectedOwnershipPercent: quote.estimatedOwnershipPercentage * 100,
    },
    estimatedImpact: `The zap internally buys ${quote.sharesBought.toFixed(2)} share(s) before depositing.`,
    warnings: [],
  });
}

async function buildSportSlateScan(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<HermesScanResult> {
  let sport = toStringValue(input.args?.sport)?.toUpperCase() || null;
  const dateArg = toStringValue(input.args?.date) || null;
  const teamFilter = toStringValue(input.args?.team)?.toUpperCase() || null;

  const now = new Date();
  let startDate: Date;
  let endDate: Date;

  if (dateArg?.toLowerCase() === "this week" || dateArg?.toLowerCase() === "week") {
    startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 7);
  } else if (dateArg?.toLowerCase() === "tomorrow") {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() + 1);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 1);
  } else {
    const { startOfDay, endOfDay } = getETDayBoundaries(getTodayET());
    startDate = startOfDay;
    endDate = endOfDay;
  }

  if (teamFilter && !sport) {
    const candidateSports = await db
      .select({ sport: dailyGames.sport })
      .from(dailyGames)
      .where(
        and(
          gte(dailyGames.startTime, startDate),
          lte(dailyGames.startTime, endDate),
          or(eq(dailyGames.homeTeam, teamFilter), eq(dailyGames.awayTeam, teamFilter)),
        ),
      )
      .groupBy(dailyGames.sport)
      .limit(2);

    if (candidateSports.length === 1) {
      sport = candidateSports[0].sport;
    } else if (candidateSports.length > 1) {
      return {
        toolName: "scan_sport_slate",
        domain: "sportfolio",
        summary: "Team abbreviation is ambiguous across multiple sports.",
        replyText: `I found multiple sports for team abbreviation ${teamFilter} in this date range. Please include sport (for example sport=MLB, team=${teamFilter}).`,
        observations: [],
        warnings: [`Ambiguous team abbreviation ${teamFilter}; sport is required.`],
        context: { team: teamFilter },
      };
    }
  }
  const conditions = [gte(dailyGames.startTime, startDate), lte(dailyGames.startTime, endDate)];
  if (sport) {
    conditions.push(eq(dailyGames.sport, sport));
  }
  if (teamFilter) {
    conditions.push(or(eq(dailyGames.homeTeam, teamFilter), eq(dailyGames.awayTeam, teamFilter))!);
  }

  const games = await db
    .select({
      gameId: dailyGames.gameId,
      sport: dailyGames.sport,
      homeTeam: dailyGames.homeTeam,
      awayTeam: dailyGames.awayTeam,
      startTime: dailyGames.startTime,
      status: dailyGames.status,
      homeScore: dailyGames.homeScore,
      awayScore: dailyGames.awayScore,
    })
    .from(dailyGames)
    .where(and(...conditions))
    .orderBy(dailyGames.startTime)
    .limit(50);

  const allTeams = new Set<string>();
  for (const game of games) {
    allTeams.add(game.homeTeam);
    allTeams.add(game.awayTeam);
  }

  const teamPlayers =
    allTeams.size > 0
      ? await db
          .select({
            id: players.id,
            firstName: players.firstName,
            lastName: players.lastName,
            team: players.team,
            position: players.position,
            sport: players.sport,
            injuryStatus: players.injuryStatus,
            currentPrice: players.currentPrice,
            lastTradePrice: players.lastTradePrice,
          })
          .from(players)
          .where(
            and(
              inArray(players.team, Array.from(allTeams)),
              eq(players.isActive, true),
              ...(sport ? [eq(players.sport, sport)] : []),
            ),
          )
          .limit(300)
      : [];

  const gameEntries = games.map((game) => {
    const homePlayers = teamPlayers
      .filter((player) => player.team === game.homeTeam)
      .map((player) => ({
        id: player.id,
        name: `${player.firstName} ${player.lastName}`,
        position: player.position,
        injuryStatus: player.injuryStatus,
        price: player.lastTradePrice || player.currentPrice,
      }));
    const awayPlayers = teamPlayers
      .filter((player) => player.team === game.awayTeam)
      .map((player) => ({
        id: player.id,
        name: `${player.firstName} ${player.lastName}`,
        position: player.position,
        injuryStatus: player.injuryStatus,
        price: player.lastTradePrice || player.currentPrice,
      }));

    return {
      gameId: game.gameId,
      sport: game.sport,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      startTime: game.startTime.toISOString(),
      status: game.status,
      score:
        game.homeScore != null && game.awayScore != null
          ? `${game.homeScore}-${game.awayScore}`
          : null,
      homePlayers: homePlayers.slice(0, 15),
      awayPlayers: awayPlayers.slice(0, 15),
    };
  });

  const sportLabel = sport || "all sports";
  const dateLabel = dateArg || "today";

  return {
    toolName: "scan_sport_slate",
    domain: "sportfolio",
    summary: `Found ${games.length} ${sportLabel} game${games.length === 1 ? "" : "s"} for ${dateLabel} with ${teamPlayers.length} active players.`,
    replyText: `Here are the ${sportLabel} games for ${dateLabel}:\n${gameEntries.map((g) => `${g.awayTeam} @ ${g.homeTeam} (${new Date(g.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET) - ${g.status}`).join("\n")}`,
    observations: [
      `${games.length} games found for ${sportLabel} ${dateLabel}.`,
      `${teamPlayers.length} active players across participating teams.`,
      ...(teamPlayers.filter((p) => p.injuryStatus).length > 0
        ? [
            `${teamPlayers.filter((p) => p.injuryStatus).length} player${teamPlayers.filter((p) => p.injuryStatus).length === 1 ? "" : "s"} with injury designations.`,
          ]
        : []),
    ],
    warnings: games.length === 0 ? [`No ${sportLabel} games found for ${dateLabel}.`] : [],
    context: { games: gameEntries, sport: sportLabel, dateRange: dateLabel },
  };
}

async function buildMlbStatGameplanScan(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<HermesScanResult> {
  const message = toStringValue(input.args?.message) || "Build an MLB stat gameplan.";
  const statSpecs = parseMlbGameplanStatSpecs(message);
  const targetDate = resolveMessageTargetDate(input.args?.date, message);
  const dateLabel = resolveDateLabel(targetDate);
  const season = Number.parseInt(targetDate.toISOString().slice(0, 4), 10);
  const requestedTeamCodes = new Set<string>(
    inferMlbTeamsFromMessage(message).map((team) => team.code),
  );

  if (statSpecs.length === 0) {
    return {
      toolName: "scan_mlb_stat_gameplan",
      domain: "sportfolio",
      summary: "I need at least one supported MLB stat signal to build that gameplan.",
      replyText:
        "Use an MLB stat signal like OBP, OPS, ERA, or WHIP so I can build a leaderboard-driven gameplan from the internal MLB feed.",
      observations: [],
      warnings: ["Missing supported MLB stat signal."],
      context: { supportedStats: ["OBP", "OPS", "ERA", "WHIP"] },
    };
  }

  const allMlbPlayers = (await storage.getPlayersBySport("MLB")).filter(
    (player) => player.isActive,
  );
  const playerByName = new Map<string, (typeof allMlbPlayers)[number]>();
  for (const player of allMlbPlayers) {
    const key = normalizeNameKey(`${player.firstName} ${player.lastName}`);
    if (!playerByName.has(key)) {
      playerByName.set(key, player);
    }
  }

  const leaderboards: Array<{ spec: MlbGameplanStatSpec; rows: MlbGameplanLeaderRow[] }> = [];
  for (const spec of statSpecs) {
    const result = await runInternalMlbMcpToolRaw({
      toolName: `${resolveInternalMlbMcpConfig().toolPrefix}get_league_leader_data`,
      args: {
        leader_categories: spec.leaderCategory,
        season,
        limit: 15,
        stat_group: spec.statGroup,
      },
    });

    leaderboards.push({
      spec,
      rows: extractMlbLeaderboardRows(result.structuredContent),
    });
  }

  const relevantTeams = new Set<string>();
  for (const board of leaderboards) {
    for (const row of board.rows) {
      const matchedPlayer = playerByName.get(normalizeNameKey(row.playerName));
      if (matchedPlayer?.team) {
        relevantTeams.add(matchedPlayer.team);
      }
    }
  }

  const teamGameMap = await buildMlbTeamGameMap(targetDate, relevantTeams);
  const candidateMap = new Map<
    string,
    {
      player: (typeof allMlbPlayers)[number];
      score: number;
      stats: Array<{ label: string; rank: number | null; valueLabel: string | null }>;
      game: {
        gameId: string;
        opponent: string;
        startTime: string;
        status: string | null;
      } | null;
    }
  >();
  const warnings: string[] = [];

  for (const board of leaderboards) {
    for (const row of board.rows) {
      const matchedPlayer = playerByName.get(normalizeNameKey(row.playerName));
      if (!matchedPlayer) {
        continue;
      }
      if (requestedTeamCodes.size > 0 && !requestedTeamCodes.has(matchedPlayer.team)) {
        continue;
      }

      const game = teamGameMap.get(matchedPlayer.team) || null;
      if (relevantTeams.size > 0 && teamGameMap.size > 0 && !game) {
        continue;
      }

      const existing = candidateMap.get(matchedPlayer.id) || {
        player: matchedPlayer,
        score: 0,
        stats: [],
        game,
      };
      existing.score += Math.max(0, 20 - (row.rank || 20));
      existing.stats.push({
        label: board.spec.label,
        rank: row.rank,
        valueLabel: row.valueLabel,
      });
      existing.game = existing.game || game;
      candidateMap.set(matchedPlayer.id, existing);
    }
  }

  const candidates = [...candidateMap.values()]
    .filter((entry) => entry.stats.length > 0)
    .sort((left, right) => {
      if (right.stats.length !== left.stats.length) {
        return right.stats.length - left.stats.length;
      }
      return right.score - left.score;
    })
    .slice(0, 4);

  if (candidates.length === 0) {
    return {
      toolName: "scan_mlb_stat_gameplan",
      domain: "sportfolio",
      summary:
        "I could not map enough MLB leaderboard names into active Sportfolio markets for that gameplan.",
      replyText:
        "The internal MLB stat feed responded, but I could not turn those leaderboard names into active Sportfolio MLB markets with a usable game window.",
      observations: [],
      warnings: ["No active Sportfolio MLB markets matched the requested leaderboard signals."],
      context: {
        stats: statSpecs.map((spec) => spec.label),
        season,
        date: targetDate.toISOString().slice(0, 10),
      },
    };
  }

  if (teamGameMap.size === 0) {
    warnings.push(
      `I did not find any MLB games on the board for ${dateLabel}, so this is a pure leaderboard watchlist.`,
    );
  }

  const focusLabel = statSpecs.every((spec) => spec.statGroup === "pitching")
    ? "pitching"
    : statSpecs.every((spec) => spec.statGroup === "hitting")
      ? "hitting"
      : "mixed";

  const replyLines = candidates.map((entry, index) => {
    const statLine = entry.stats
      .map(
        (stat) =>
          `${stat.label} #${stat.rank || "?"}${stat.valueLabel ? ` (${stat.valueLabel})` : ""}`,
      )
      .join(", ");
    const gameLine = entry.game
      ? `${entry.game.opponent} at ${new Date(entry.game.startTime).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/New_York",
        })} ET`
      : "no game confirmed in the requested window";
    const price = Number(entry.player.lastTradePrice || entry.player.currentPrice || 0);
    return `${index + 1}. ${entry.player.firstName} ${entry.player.lastName} (${entry.player.team}) - ${statLine}; ${gameLine}; price $${price.toFixed(2)}`;
  });

  return {
    toolName: "scan_mlb_stat_gameplan",
    domain: "sportfolio",
    summary: `Built an MLB ${focusLabel} gameplan for ${dateLabel} from ${statSpecs.map((spec) => spec.label).join(" + ")} leaderboard data.`,
    replyText: `For ${dateLabel}'s MLB ${focusLabel} gameplan, start here:\n${replyLines.join("\n")}`,
    observations: [
      `Internal MLB MCP leaderboard categories used: ${statSpecs.map((spec) => spec.label).join(", ")}.`,
      `${candidates.length} active Sportfolio MLB market${candidates.length === 1 ? "" : "s"} matched the requested stat signals.`,
      ...(requestedTeamCodes.size > 0
        ? [`Applied an MLB team filter for ${[...requestedTeamCodes].join(", ")} from the prompt.`]
        : []),
      ...(teamGameMap.size > 0
        ? [`${teamGameMap.size} MLB team game context entries were confirmed for ${dateLabel}.`]
        : []),
    ],
    warnings,
    context: {
      date: targetDate.toISOString().slice(0, 10),
      dateLabel,
      season,
      focus: focusLabel,
      stats: statSpecs.map((spec) => spec.label),
      candidates: candidates.map((entry) => ({
        playerId: entry.player.id,
        name: `${entry.player.firstName} ${entry.player.lastName}`,
        team: entry.player.team,
        position: entry.player.position,
        price: entry.player.lastTradePrice || entry.player.currentPrice,
        stats: entry.stats,
        game: entry.game,
      })),
    },
  };
}

async function buildTeamRosterScan(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<HermesScanResult> {
  const team = toStringValue(input.args?.team)?.toUpperCase();
  let sport = toStringValue(input.args?.sport)?.toUpperCase() || null;

  if (!team) {
    return {
      toolName: "scan_team_roster",
      domain: "sportfolio",
      summary: "Missing team abbreviation.",
      replyText: "Please provide a team abbreviation (e.g., BOS, NYY, LAD).",
      observations: [],
      warnings: ["No team abbreviation provided."],
      context: {},
    };
  }

  if (!sport) {
    const candidateSports = await db
      .select({ sport: players.sport })
      .from(players)
      .where(and(eq(players.team, team), eq(players.isActive, true)))
      .groupBy(players.sport)
      .limit(2);

    if (candidateSports.length === 1) {
      sport = candidateSports[0].sport;
    } else if (candidateSports.length > 1) {
      return {
        toolName: "scan_team_roster",
        domain: "sportfolio",
        summary: "Team abbreviation is ambiguous across multiple sports.",
        replyText: `I found multiple sports for team abbreviation ${team}. Please include sport (for example sport=MLB, team=${team}).`,
        observations: [],
        warnings: [`Ambiguous team abbreviation ${team}; sport is required.`],
        context: { team },
      };
    }
  }

  const conditions = [eq(players.team, team), eq(players.isActive, true)];
  if (sport) {
    conditions.push(eq(players.sport, sport));
  }

  const rosterPlayers = await db
    .select({
      id: players.id,
      firstName: players.firstName,
      lastName: players.lastName,
      team: players.team,
      position: players.position,
      sport: players.sport,
      injuryStatus: players.injuryStatus,
      currentPrice: players.currentPrice,
      lastTradePrice: players.lastTradePrice,
    })
    .from(players)
    .where(and(...conditions))
    .limit(60);

  const rosterEntries = rosterPlayers.map((p) => ({
    id: p.id,
    name: `${p.firstName} ${p.lastName}`,
    position: p.position,
    sport: p.sport,
    price: p.lastTradePrice || p.currentPrice,
    injuryStatus: p.injuryStatus,
  }));

  const sportLabel = sport || (rosterPlayers[0]?.sport ?? "unknown");

  return {
    toolName: "scan_team_roster",
    domain: "sportfolio",
    summary: `Found ${rosterPlayers.length} active ${team} player${rosterPlayers.length === 1 ? "" : "s"} on the market.`,
    replyText:
      rosterPlayers.length > 0
        ? `${team} roster (${rosterPlayers.length} players):\n${rosterEntries.map((p) => `${p.name} (${p.position}) - $${Number(p.price ?? 0).toFixed(2)}${p.injuryStatus ? ` [${p.injuryStatus}]` : ""}`).join("\n")}`
        : `No active ${team} players found on the market.`,
    observations: [
      `${rosterPlayers.length} active players for ${team}.`,
      ...(rosterPlayers.filter((p) => p.injuryStatus).length > 0
        ? [
            `${rosterPlayers.filter((p) => p.injuryStatus).length} player(s) with injury designations.`,
          ]
        : []),
    ],
    warnings:
      rosterPlayers.length === 0
        ? [`No active players found for team ${team}. Check abbreviation.`]
        : [],
    context: { team, sport: sportLabel, players: rosterEntries },
  };
}

async function buildPlayerUpcomingGamesScan(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<HermesScanResult> {
  const playerIdArg = toStringValue(input.args?.playerId) || null;
  const playerNameArg =
    toStringValue(input.args?.playerName) || toStringValue(input.args?.message) || null;

  let targetPlayers: Array<{
    id: string;
    firstName: string;
    lastName: string;
    team: string;
    sport: string;
    position: string;
  }> = [];

  if (playerIdArg) {
    const [found] = await db
      .select({
        id: players.id,
        firstName: players.firstName,
        lastName: players.lastName,
        team: players.team,
        sport: players.sport,
        position: players.position,
      })
      .from(players)
      .where(eq(players.id, playerIdArg))
      .limit(1);
    if (found) targetPlayers.push(found);
  } else if (playerNameArg) {
    const nameParts = playerNameArg.toLowerCase().split(/\s+/);
    const found = await db
      .select({
        id: players.id,
        firstName: players.firstName,
        lastName: players.lastName,
        team: players.team,
        sport: players.sport,
        position: players.position,
      })
      .from(players)
      .where(eq(players.isActive, true))
      .limit(500);
    targetPlayers = found
      .filter((p) =>
        nameParts.every(
          (part) =>
            p.firstName.toLowerCase().includes(part) || p.lastName.toLowerCase().includes(part),
        ),
      )
      .slice(0, 5);
  }

  if (targetPlayers.length === 0) {
    return {
      toolName: "scan_player_upcoming_games",
      domain: "sportfolio",
      summary: "Could not find the requested player.",
      replyText:
        "I could not find a matching player. Try providing a more specific name or player ID.",
      observations: [],
      warnings: ["Player not found."],
      context: {},
    };
  }

  const now = new Date();
  const weekFromNow = new Date(now);
  weekFromNow.setDate(weekFromNow.getDate() + 7);

  const teams = [...new Set(targetPlayers.map((p) => p.team))];
  const upcomingGames = await db
    .select({
      gameId: dailyGames.gameId,
      sport: dailyGames.sport,
      homeTeam: dailyGames.homeTeam,
      awayTeam: dailyGames.awayTeam,
      startTime: dailyGames.startTime,
      status: dailyGames.status,
    })
    .from(dailyGames)
    .where(
      and(
        gte(dailyGames.startTime, now),
        lte(dailyGames.startTime, weekFromNow),
        or(inArray(dailyGames.homeTeam, teams), inArray(dailyGames.awayTeam, teams)),
      ),
    )
    .orderBy(dailyGames.startTime)
    .limit(20);

  const results = targetPlayers.map((player) => ({
    playerId: player.id,
    name: `${player.firstName} ${player.lastName}`,
    team: player.team,
    sport: player.sport,
    position: player.position,
    upcomingGames: upcomingGames
      .filter((g) => g.homeTeam === player.team || g.awayTeam === player.team)
      .map((g) => ({
        gameId: g.gameId,
        opponent: g.homeTeam === player.team ? g.awayTeam : g.homeTeam,
        isHome: g.homeTeam === player.team,
        startTime: g.startTime.toISOString(),
        status: g.status,
      })),
  }));

  const totalGames = results.reduce((sum, r) => sum + r.upcomingGames.length, 0);

  return {
    toolName: "scan_player_upcoming_games",
    domain: "sportfolio",
    summary: `Found ${totalGames} upcoming game${totalGames === 1 ? "" : "s"} for ${results.map((r) => r.name).join(", ")} in the next 7 days.`,
    replyText: results
      .map(
        (r) =>
          `${r.name} (${r.team}, ${r.position}):\n${r.upcomingGames.length > 0 ? r.upcomingGames.map((g) => `  ${g.isHome ? "vs" : "@"} ${g.opponent} - ${new Date(g.startTime).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" })} ${new Date(g.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET (${g.status})`).join("\n") : "  No games scheduled in the next 7 days."}`,
      )
      .join("\n\n"),
    observations: [
      `${targetPlayers.length} player${targetPlayers.length === 1 ? "" : "s"} matched.`,
      `${totalGames} total upcoming games in the next 7 days.`,
    ],
    warnings: totalGames === 0 ? ["No upcoming games found for these players."] : [],
    context: { players: results },
  };
}

async function buildExternalSourceScan(input: {
  userId: string;
  args?: Record<string, unknown>;
}): Promise<HermesScanResult> {
  const sourceName = toStringValue(input.args?.sourceName) || undefined;
  const toolName = toStringValue(input.args?.toolName) || toStringValue(input.args?.message) || "";

  if (!toolName) {
    return {
      toolName: "query_external_source",
      domain: "external",
      summary: "No tool name specified for external source query.",
      replyText:
        "Please specify which tool to call on the external source (e.g., toolName: 'get_projections').",
      observations: [],
      warnings: ["Missing toolName parameter."],
      context: {},
    };
  }

  const toolArgs: Record<string, unknown> = {};
  if (input.args) {
    for (const [key, value] of Object.entries(input.args)) {
      if (key !== "sourceName" && key !== "toolName" && key !== "message") {
        toolArgs[key] = value;
      }
    }
  }

  try {
    const { results, errors } = await queryExternalSource({
      userId: input.userId,
      sourceName,
      toolName,
      args: toolArgs,
    });

    const observations: string[] = [];
    const warnings: string[] = [...errors];

    if (results.length === 0 && errors.length > 0) {
      return {
        toolName: "query_external_source",
        domain: "external",
        summary: `External source query failed: ${errors.join("; ")}`,
        replyText: errors.join("\n"),
        observations,
        warnings,
        context: {},
      };
    }

    for (const result of results) {
      observations.push(
        `${result.sourceName}/${result.toolName}: ${result.isError ? "error" : "success"}`,
      );
    }

    const contentParts = results.map((r) => {
      const text = Array.isArray(r.content)
        ? r.content
            .filter((c: any) => c?.type === "text")
            .map((c: any) => c.text)
            .join("\n")
        : JSON.stringify(r.content);
      return `[${r.sourceName}] ${text}`;
    });

    return {
      toolName: "query_external_source",
      domain: "external",
      summary: `Queried ${results.length} external source${results.length === 1 ? "" : "s"} for "${toolName}".`,
      replyText: contentParts.join("\n\n") || "No data returned.",
      observations,
      warnings,
      context: {
        results: results.map((r) => ({
          source: r.sourceName,
          tool: r.toolName,
          content: r.content,
        })),
      },
    };
  } catch (err: any) {
    return {
      toolName: "query_external_source",
      domain: "external",
      summary: `External source query error: ${err.message}`,
      replyText: `Failed to query external source: ${err.message}`,
      observations: [],
      warnings: [err.message],
      context: {},
    };
  }
}

export async function runHermesScanTool(input: {
  toolName: string;
  userId: string;
  args?: Record<string, unknown>;
}): Promise<HermesScanResult> {
  switch (input.toolName) {
    case "scan_daily_boost_candidates":
      return buildDailyBoostCandidateScan(input);
    case "scan_open_boost_slots":
      return buildOpenBoostSlotScan(input);
    case "scan_idle_balance_options":
      return buildIdleBalanceDeploymentScan(input);
    case "scan_scout_opportunities":
    case "scan_portfolio_cleanup_levers":
    case "scan_watchlist_targets":
    case "scan_top_market_opportunities":
      return buildOperatorScan(input, input.toolName);
    case "scan_community_boost_candidates":
      return buildCommunityBoostCandidateScan(input);
    case "scan_news_impact":
      return buildNewsImpactScan(input);
    case "scan_sport_slate":
      return buildSportSlateScan(input);
    case "scan_mlb_stat_gameplan":
      return buildMlbStatGameplanScan(input);
    case "scan_team_roster":
      return buildTeamRosterScan(input);
    case "scan_player_upcoming_games":
      return buildPlayerUpcomingGamesScan(input);
    case "query_external_source":
      return buildExternalSourceScan(input);
    default:
      throw new Error(`Unsupported Hermes scan tool: ${input.toolName}`);
  }
}

export async function runHermesReadTool(input: {
  toolName: string;
  userId: string;
  threadId?: string | null;
  args?: Record<string, unknown>;
}): Promise<unknown> {
  switch (input.toolName) {
    case "get_tool_catalog":
      return getAgentRuntimeToolCatalog({
        includeInternalMlbMcp: (await getScoutAgentProfile(input.userId)).profile
          .internalMlbMcpEnabled,
      });
    case "get_agent_capabilities":
      return getAgentCapabilities(input.userId);
    case "get_thread_state":
      if (!input.threadId) {
        throw new Error("threadId is required for get_thread_state");
      }

      return {
        thread: await getAgentThread(input.userId, input.threadId),
        messages: await listAgentThreadMessages(input.userId, input.threadId),
      };
    case "get_portfolio_summary": {
      const { context } = await loadOperatorToolContext(
        input.userId,
        toStringValue(input.args?.message),
        input.args?.sport,
      );

      return {
        summary: "Loaded portfolio summary.",
        operatorOverview: context.operatorOverview,
        selectionWindow: context.selectionWindow,
        recommendedTargets: context.recommendedTargets,
      };
    }
    case "get_user_profile_summary": {
      const { profile } = await getScoutAgentProfile(input.userId);

      return {
        displayName: profile.displayName,
        providerMode: profile.providerMode,
        model: profile.model,
        defaultSport: profile.defaultSport,
        analysisWindowMinutes: profile.analysisWindowMinutes,
      };
    }
    case "get_operator_overview": {
      const { context } = await loadOperatorToolContext(
        input.userId,
        toStringValue(input.args?.message),
        input.args?.sport,
      );
      return context.operatorOverview;
    }
    case "get_balance_state": {
      const { context } = await loadOperatorToolContext(
        input.userId,
        toStringValue(input.args?.message),
        input.args?.sport,
      );
      return {
        availableBalance: context.operatorOverview.availableBalance,
        openDailyBoostSlots: context.operatorOverview.openDailyBoostSlots,
        communitySharesAvailable: context.operatorOverview.communitySharesAvailable,
      };
    }
    case "get_holdings": {
      const limit = toPositiveInteger(input.args?.limit) || 25;
      const requestedSport = toOptionalString(input.args?.sport)?.toUpperCase() || null;
      const holdings = await storage.getUserHoldingsWithPlayers(input.userId);
      return holdings
        .filter((entry) => entry?.holding?.assetType === "player" && entry?.player?.id)
        .filter((entry) =>
          requestedSport ? (entry.player.sport || "").toUpperCase() === requestedSport : true,
        )
        .slice(0, limit)
        .map((entry) => ({
          playerId: entry.player.id,
          name: `${entry.player.firstName} ${entry.player.lastName}`,
          sport: entry.player.sport,
          team: entry.player.team,
          quantity: Number(entry.holding.quantity || 0),
          multiplier: Number(entry.holding.multiplier || 1),
          effectiveShares: entry.holding.effectiveShares,
          availableShares:
            Number(entry.holding.quantity || 0) - Math.max(0, Number(entry.totalLocked || 0)),
          avgCostBasis: entry.holding.avgCostBasis,
        }));
    }
    case "get_watchlists":
      return storage.getWatchlists(input.userId);
    case "get_watchlist_items": {
      const watchlistId = toStringValue(input.args?.watchlistId);
      if (!watchlistId) {
        throw new Error("watchlistId is required for get_watchlist_items");
      }
      const watchlists = await storage.getWatchlists(input.userId);
      if (!watchlists.some((entry) => entry.id === watchlistId)) {
        throw new Error("Watchlist not found");
      }
      return {
        watchlistId,
        playerIds: await storage.getWatchlistItems(watchlistId),
      };
    }
    case "get_player_watchlists": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_player_watchlists");
      }
      return {
        playerId,
        watchlistIds: await storage.getPlayerWatchlists(input.userId, playerId),
      };
    }
    case "get_player_detail":
    case "get_player_market_context": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_player_detail");
      }
      const player = await requirePlayer(playerId);
      const [financialMetrics, stats, recentGames, holdingAvailability] = await Promise.all([
        storage.getPlayerFinancialMetrics(playerId),
        storage.getPlayerSeasonStatsFromLogs(playerId),
        storage.getPlayerRecentGamesFromLogs(playerId, toPositiveInteger(input.args?.limit) || 5),
        getHoldingAvailability(input.userId, playerId),
      ]);
      const lastTradePrice = player.lastTradePrice ? Number(player.lastTradePrice) : null;
      const marketCap = player.marketCap ? Number(player.marketCap) : null;
      const totalSharesOutstanding =
        lastTradePrice && marketCap ? Math.round((marketCap / lastTradePrice) * 100) / 100 : null;

      return {
        player: {
          id: player.id,
          firstName: player.firstName,
          lastName: player.lastName,
          team: player.team,
          sport: player.sport,
          position: player.position,
          lastTradePrice: player.lastTradePrice,
          volume24h: player.volume24h,
          priceChange24h: player.priceChange24h,
          injuryStatus: player.injuryStatus,
          marketCap: player.marketCap,
        },
        financialMetrics,
        stats,
        recentGames,
        sharesInfo: {
          totalSharesOutstanding,
          marketCap,
          holderCount: null,
        },
        userHolding: holdingAvailability,
      };
    }
    case "get_player_stats": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_player_stats");
      }
      return storage.getPlayerSeasonStatsFromLogs(playerId);
    }
    case "get_player_recent_games": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_player_recent_games");
      }
      return storage.getPlayerRecentGamesFromLogs(
        playerId,
        toPositiveInteger(input.args?.limit) || 10,
      );
    }
    case "get_player_financial_metrics": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_player_financial_metrics");
      }
      return storage.getPlayerFinancialMetrics(playerId);
    }
    case "get_player_shares_info": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_player_shares_info");
      }
      const player = await requirePlayer(playerId);
      const lastTradePrice = player.lastTradePrice ? Number(player.lastTradePrice) : null;
      const marketCap = player.marketCap ? Number(player.marketCap) : null;
      return {
        playerId,
        lastTradePrice,
        marketCap,
        totalSharesOutstanding:
          lastTradePrice && marketCap ? Math.round((marketCap / lastTradePrice) * 100) / 100 : null,
      };
    }
    case "get_holding_multiplier_state": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_holding_multiplier_state");
      }
      return getHoldingAvailability(input.userId, playerId);
    }
    case "get_daily_boost_state":
      return storage.getDailyBoostsAllSports(input.userId, resolveTargetDate(input.args?.date));
    case "get_daily_boost_history":
      return storage.getBoostPayoutHistory(
        input.userId,
        toPositiveInteger(input.args?.limit) || 50,
      );
    case "get_daily_boost_eligibility": {
      const sport = toStringValue(input.args?.sport).toUpperCase();
      if (!sport) {
        throw new Error("sport is required for get_daily_boost_eligibility");
      }
      const targetDate = resolveTargetDate(input.args?.date);
      return {
        sport,
        date: targetDate.toISOString(),
        eligiblePlayers: await storage.getEligiblePlayersForBoost(input.userId, sport, targetDate),
      };
    }
    case "get_community_boost_state": {
      const [communityShares, communityBoosts] = await Promise.all([
        storage.getUserCommunityBoostShares(input.userId),
        storage.getCommunityBoostsAllSports(resolveTargetDate(input.args?.date)),
      ]);
      return {
        communitySharesAvailable: communityShares,
        communityBoosts,
      };
    }
    case "get_community_boosts_all":
      return storage.getCommunityBoostsAllSports(resolveTargetDate(input.args?.date));
    case "get_canonical_knowledge":
      return listAgentKnowledgeArticles(true);
    case "get_hosted_research": {
      const profile = (await getScoutAgentProfile(input.userId)).profile;
      const message = toStringValue(input.args?.message);
      if (!message) {
        throw new Error("message is required for get_hosted_research");
      }

      return planHostedWebResearch({
        message,
        profile,
      });
    }
    case "list_user_memories":
    case "search_user_memories":
    case "get_user_memory_context":
      return buildHermesMemoryContext({
        userId: input.userId,
        query: toStringValue(input.args?.query),
      });
    case "list_runtime_skills":
      return listAvailableAgentSkills(input.userId);
    case "list_pattern_candidates":
      return listAgentSkillCandidates();
    case "get_trade_history":
      return storage.getMarketActivity({
        userId: input.userId,
        limit: toPositiveInteger(input.args?.limit) || 100,
        sport: toOptionalString(input.args?.sport) || undefined,
      });
    case "get_portfolio_history": {
      const timeRange = toStringValue(input.args?.timeRange) || "1M";
      const now = new Date();
      const startDate = new Date(now);
      switch (timeRange) {
        case "1D":
          startDate.setDate(now.getDate() - 1);
          break;
        case "7D":
          startDate.setDate(now.getDate() - 7);
          break;
        case "1M":
          startDate.setMonth(now.getMonth() - 1);
          break;
        case "1Y":
          startDate.setFullYear(now.getFullYear() - 1);
          break;
        case "ALL":
          startDate.setTime(new Date(2020, 0, 1).getTime());
          break;
        default:
          throw new Error("Invalid timeRange. Use 1D, 7D, 1M, 1Y, or ALL");
      }

      const snapshots = await storage.getPortfolioSnapshotsInRange(input.userId, startDate, now);
      return {
        timeRange,
        history: snapshots.map((snapshot) => ({
          date: snapshot.snapshotDate.toISOString(),
          cashBalance: Number(snapshot.cashBalance),
          portfolioValue: Number(snapshot.portfolioValue),
          netWorth: Number(snapshot.totalNetWorth),
          cashRank: snapshot.cashRank,
          portfolioRank: snapshot.portfolioRank,
        })),
      };
    }
    case "get_amm_pool_state": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_amm_pool_state");
      }
      await requirePlayer(playerId);
      return getOrCreatePool(playerId);
    }
    case "get_amm_trade_quote": {
      const playerId = toStringValue(input.args?.playerId);
      const quoteType = toStringValue(input.args?.type).toLowerCase();
      const amount = toPositiveNumber(input.args?.amount);
      if (!playerId || amount == null || (quoteType !== "buy" && quoteType !== "sell")) {
        throw new Error("playerId, type=buy|sell, and amount are required for get_amm_trade_quote");
      }
      await requirePlayer(playerId);
      return quoteType === "buy"
        ? { type: "buy", quote: await getBuyQuote(playerId, amount) }
        : { type: "sell", quote: await getSellQuote(playerId, amount) };
    }
    case "get_lp_positions":
      return getUserLpPositions(input.userId);
    case "get_lp_position": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for get_lp_position");
      }
      return getLpPosition(playerId, input.userId);
    }
    case "get_lp_history":
      return storage.getLpTransactionHistory(
        input.userId,
        toOptionalString(input.args?.playerId) || undefined,
        toPositiveInteger(input.args?.limit) || 50,
      );
    case "get_user_schedules":
      return listUserAgentSchedules(input.userId);
    case "get_schedule_templates":
      return listAgentScheduleTemplates();
    case "get_pending_bundle":
      if (!input.threadId) {
        throw new Error("threadId is required for get_pending_bundle");
      }

      return {
        pendingActionBundle: (await getAgentThread(input.userId, input.threadId))
          .pendingActionBundle,
      };
    default:
      if (isInternalMlbMcpProjectedTool(input.toolName)) {
        const { profile } = await getScoutAgentProfile(input.userId);
        if (!profile.internalMlbMcpEnabled) {
          throw new Error("The built-in MLB data source is disabled for this user.");
        }

        return runInternalMlbMcpReadTool({
          toolName: input.toolName,
          args: input.args,
        });
      }
      throw new Error(`Unsupported Hermes read tool: ${input.toolName}`);
  }
}

export async function runHermesPlanTool(input: {
  toolName: string;
  userId: string;
  args?: Record<string, unknown>;
}): Promise<unknown> {
  switch (input.toolName) {
    case "preview_pool_buy": {
      const preview = await buildPoolBuyPreview(input);
      return materializeStructuredPreviewPlan({
        userId: input.userId,
        toolName: input.toolName,
        preview,
      });
    }
    case "preview_pool_sell": {
      const preview = await buildPoolSellPreview(input);
      return materializeStructuredPreviewPlan({
        userId: input.userId,
        toolName: input.toolName,
        preview,
      });
    }
    case "preview_lp_add": {
      const preview = await buildLpAddPreview(input);
      return materializeStructuredPreviewPlan({
        userId: input.userId,
        toolName: input.toolName,
        preview,
      });
    }
    case "preview_lp_add_optimal": {
      const preview = await buildLpAddOptimalPreview(input);
      return materializeStructuredPreviewPlan({
        userId: input.userId,
        toolName: input.toolName,
        preview,
      });
    }
    case "preview_lp_remove": {
      const preview = await buildLpRemovePreview(input);
      return materializeStructuredPreviewPlan({
        userId: input.userId,
        toolName: input.toolName,
        preview,
      });
    }
    case "preview_lp_zap": {
      const preview = await buildLpZapPreview(input);
      return materializeStructuredPreviewPlan({
        userId: input.userId,
        toolName: input.toolName,
        preview,
      });
    }
    case "preview_direct_operation":
    case "preview_stack_shares":
    case "preview_daily_boost_assign":
    case "preview_daily_boost_remove":
    case "preview_watchlist_add":
    case "preview_watchlist_remove":
    case "preview_community_boost_create":
    case "preview_scout_adjustment":
      return runParserBackedPreview(input);
    case "preview_multi_action_bundle":
      return buildMultiActionBundlePreview(input);
    default:
      throw new Error(`Unsupported Hermes plan tool: ${input.toolName}`);
  }
}

export async function runHermesActionTool(input: {
  toolName: string;
  userId: string;
  threadId?: string | null;
  args?: Record<string, unknown>;
}): Promise<unknown> {
  switch (input.toolName) {
    case "create_agent_thread":
      return createAgentThread(input.userId, {
        channel: toChannelValue(input.args?.channel) || "in_app",
        domain: "sportfolio",
        title: toOptionalString(input.args?.title) || undefined,
      });
    case "stage_action_bundle": {
      const message = toStringValue(input.args?.message);
      if (!message) {
        throw new Error("message is required for stage_action_bundle");
      }
      const threadId = await getOrCreateThreadIdForAction(input);
      return {
        threadId,
        turn: await sendAgentThreadMessage(input.userId, threadId, { message }),
      };
    }
    case "confirm_pending_bundle":
      if (!input.threadId) {
        throw new Error("threadId is required for confirm_pending_bundle");
      }
      return confirmAgentThread(input.userId, input.threadId);
    case "cancel_pending_bundle":
      if (!input.threadId) {
        throw new Error("threadId is required for cancel_pending_bundle");
      }
      return cancelAgentThread(input.userId, input.threadId);
    case "create_watchlist": {
      const name = toStringValue(input.args?.name);
      if (!name) {
        throw new Error("name is required for create_watchlist");
      }
      return storage.createWatchlist(
        input.userId,
        name,
        false,
        toOptionalString(input.args?.color) || undefined,
      );
    }
    case "update_watchlist": {
      const watchlistId = toStringValue(input.args?.watchlistId);
      const name = toOptionalString(input.args?.name) || undefined;
      const color = toOptionalString(input.args?.color) || undefined;
      if (!watchlistId || (!name && !color)) {
        throw new Error(
          "watchlistId and at least one update field are required for update_watchlist",
        );
      }
      const watchlists = await storage.getWatchlists(input.userId);
      if (!watchlists.some((entry) => entry.id === watchlistId)) {
        throw new Error("Watchlist not found");
      }
      await storage.updateWatchlist(watchlistId, {
        name,
        color,
      });
      return {
        success: true,
        watchlistId,
      };
    }
    case "delete_watchlist": {
      const watchlistId = toStringValue(input.args?.watchlistId);
      if (!watchlistId) {
        throw new Error("watchlistId is required for delete_watchlist");
      }
      const watchlists = await storage.getWatchlists(input.userId);
      if (!watchlists.some((entry) => entry.id === watchlistId)) {
        throw new Error("Watchlist not found");
      }
      await storage.deleteWatchlist(watchlistId);
      return {
        success: true,
        watchlistId,
      };
    }
    case "add_watchlist_player": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for add_watchlist_player");
      }
      await storage.addToWatchList(
        input.userId,
        playerId,
        toOptionalString(input.args?.watchlistId) || undefined,
      );
      return {
        success: true,
        playerId,
      };
    }
    case "remove_watchlist_player": {
      const playerId = toStringValue(input.args?.playerId);
      if (!playerId) {
        throw new Error("playerId is required for remove_watchlist_player");
      }
      await storage.removeFromWatchList(
        input.userId,
        playerId,
        toOptionalString(input.args?.watchlistId) || undefined,
      );
      return {
        success: true,
        playerId,
      };
    }
    case "upsert_user_schedule": {
      const jobType = toScheduleJobType(input.args?.jobType);
      const rawChannelTargets = Array.isArray(input.args?.channelTargets)
        ? input.args.channelTargets
        : null;
      if (!jobType) {
        throw new Error("A supported jobType is required for upsert_user_schedule");
      }
      return upsertUserAgentSchedule({
        userId: input.userId,
        jobType,
        enabled: toBooleanValue(input.args?.enabled) ?? true,
        scheduleCron: toOptionalString(input.args?.scheduleCron) || undefined,
        channelTargets: rawChannelTargets
          ? rawChannelTargets
              .map((entry) => toChannelValue(entry))
              .filter((entry): entry is AgentChannel => Boolean(entry))
          : undefined,
        policy:
          input.args?.policy && typeof input.args.policy === "object"
            ? (input.args.policy as Record<string, unknown>)
            : {},
      });
    }
    case "delete_user_schedule": {
      const jobType = toScheduleJobType(input.args?.jobType);
      if (!jobType) {
        throw new Error("A supported jobType is required for delete_user_schedule");
      }
      return removeUserAgentSchedule(input.userId, jobType);
    }
    default:
      throw new Error(`Unsupported Hermes action tool: ${input.toolName}`);
  }
}

export async function runHermesMemoryTool(input: {
  toolName: string;
  userId: string;
  threadId?: string | null;
  args?: Record<string, unknown>;
}): Promise<unknown> {
  switch (input.toolName) {
    case "write_user_memory":
    case "supersede_user_memory": {
      const writes = parseProposedMemoryWrites(input.args?.writes);

      return persistProposedMemoryWrites({
        userId: input.userId,
        threadId: input.threadId || null,
        writes,
      });
    }
    case "archive_user_memory": {
      const memoryId = toStringValue(input.args?.memoryId);
      if (!memoryId) {
        throw new Error("memoryId is required for archive_user_memory");
      }

      return archiveUserAgentMemory(input.userId, memoryId);
    }
    case "create_runtime_skill": {
      const name = toStringValue(input.args?.name);
      const description = toStringValue(input.args?.description);
      const triggerExamples = Array.isArray(input.args?.triggerExamples)
        ? input.args.triggerExamples.filter((entry): entry is string => typeof entry === "string")
        : [];
      const toolSequence = Array.isArray(input.args?.toolSequence)
        ? (input.args.toolSequence as AgentSkillStep[])
        : [];
      if (!name || !description || toolSequence.length === 0) {
        throw new Error(
          "name, description, and toolSequence are required for create_runtime_skill",
        );
      }

      return createOrUpdateUserSkill({
        userId: input.userId,
        threadId: input.threadId || null,
        name,
        description,
        triggerExamples,
        toolSequence,
        confidence: toPositiveNumber(input.args?.confidence) ?? 0.7,
      });
    }
    case "archive_runtime_skill": {
      const skillId = toStringValue(input.args?.skillId);
      if (!skillId) {
        throw new Error("skillId is required for archive_runtime_skill");
      }

      return archiveAgentSkill({
        skillId,
        userId: input.userId,
      });
    }
    case "propose_global_pattern": {
      const skillId = toStringValue(input.args?.skillId);
      if (!skillId) {
        throw new Error("skillId is required for propose_global_pattern");
      }

      const skills = await listAvailableAgentSkills(input.userId);
      const skill = skills.find((entry) => entry.id === skillId);
      if (!skill) {
        throw new Error("Skill not found");
      }

      return proposeGlobalSkillCandidate({
        sourceSkill: skill,
      });
    }
    default:
      throw new Error(`Unsupported Hermes memory tool: ${input.toolName}`);
  }
}
