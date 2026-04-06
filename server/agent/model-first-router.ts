import type { UserAgentProfile, UserAgentSecret } from "@shared/schema";
import type { AgentUiBlock } from "@shared/agent-ui";
import { type AssistantMessage, type Message } from "@mariozechner/pi-ai";
import {
  callAgentModel,
  classifyAgentProviderFailure,
  stripHiddenReasoningText,
} from "./agent-model";
import { resolveHermesToolCatalog } from "./hermes-tool-registry";
import {
  runHermesActionTool,
  runHermesMemoryTool,
  runHermesReadTool,
  runHermesScanTool,
} from "./hermes-tools";
import { buildToolResultUiBlocks } from "./ui-blocks";
import type {
  AgentCitation,
  AgentModelUsage,
  AgentProviderFailureClass,
  AgentSkillDefinition,
  AgentToolDefinition,
  AgentToolTrace,
  HermesRespondRequest,
} from "./types";

type ModelFirstToolCategory = "read" | "scan" | "plan" | "action" | "memory";
type CompressionLevel = 0 | 1 | 2;

type ModelFirstRouteMetadata = {
  terminationReason: string | null;
  compressionApplied: boolean;
  repairAttempts: number;
  providerFailureClass: AgentProviderFailureClass | null;
};

export type ModelFirstRouteResult =
  | (ModelFirstRouteMetadata & {
      outcome: "answer";
      replyText: string;
      summary: string | null;
      warnings: string[];
      citations: AgentCitation[];
      toolTrace: AgentToolTrace[];
      uiBlocks?: AgentUiBlock[];
      usage?: AgentModelUsage;
    })
  | (ModelFirstRouteMetadata & {
      outcome: "tool";
      toolName: string;
      toolCategory: ModelFirstToolCategory;
      toolArgs: Record<string, unknown>;
      summary: string | null;
      warnings: string[];
      citations: AgentCitation[];
      toolTrace: AgentToolTrace[];
      usage?: AgentModelUsage;
    })
  | (ModelFirstRouteMetadata & {
      outcome: "unsupported";
      replyText: string | null;
      summary: string | null;
      warnings: string[];
      citations: AgentCitation[];
      toolTrace: AgentToolTrace[];
      uiBlocks?: AgentUiBlock[];
      usage?: AgentModelUsage;
    })
  | (ModelFirstRouteMetadata & {
      outcome: "error";
      errorMessage: string;
      warnings: string[];
      citations: AgentCitation[];
      toolTrace: AgentToolTrace[];
      usage?: AgentModelUsage;
    });

const noArgsSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const MAX_MODEL_PASSES = 8;
const MAX_TOOL_CALLS = 7;
const BASE_PROMPT_CHAR_BUDGET = 5_400;
const AGENT_TIMEZONE = "America/New_York";
const MLB_TEAM_REFERENCES = [
  { id: 108, code: "LAA", aliases: ["los angeles angels", "angels", "laa"] },
  { id: 109, code: "ARI", aliases: ["arizona diamondbacks", "diamondbacks", "dbacks", "ari"] },
  { id: 110, code: "BAL", aliases: ["baltimore orioles", "orioles", "bal"] },
  { id: 111, code: "BOS", aliases: ["boston red sox", "red sox", "bos"] },
  { id: 112, code: "CHC", aliases: ["chicago cubs", "cubs", "chc"] },
  { id: 113, code: "CIN", aliases: ["cincinnati reds", "reds", "cin"] },
  { id: 114, code: "CLE", aliases: ["cleveland guardians", "guardians", "cle"] },
  { id: 115, code: "COL", aliases: ["colorado rockies", "rockies", "col"] },
  { id: 116, code: "DET", aliases: ["detroit tigers", "tigers", "det"] },
  { id: 117, code: "HOU", aliases: ["houston astros", "astros", "hou"] },
  { id: 118, code: "KC", aliases: ["kansas city royals", "royals", "kc", "kcr"] },
  { id: 119, code: "LAD", aliases: ["los angeles dodgers", "dodgers", "lad"] },
  { id: 120, code: "WSH", aliases: ["washington nationals", "nationals", "nats", "wsh", "wsn"] },
  { id: 121, code: "NYM", aliases: ["new york mets", "mets", "nym"] },
  { id: 133, code: "ATH", aliases: ["athletics", "a's", "as", "oakland athletics", "ath", "oak"] },
  { id: 134, code: "PIT", aliases: ["pittsburgh pirates", "pirates", "pit"] },
  { id: 135, code: "SD", aliases: ["san diego padres", "padres", "sd", "sdp"] },
  { id: 136, code: "SEA", aliases: ["seattle mariners", "mariners", "sea"] },
  { id: 137, code: "SF", aliases: ["san francisco giants", "giants", "sf", "sfg"] },
  { id: 138, code: "STL", aliases: ["st louis cardinals", "cardinals", "stl"] },
  { id: 139, code: "TB", aliases: ["tampa bay rays", "rays", "tb", "tbr"] },
  { id: 140, code: "TEX", aliases: ["texas rangers", "rangers", "tex"] },
  { id: 141, code: "TOR", aliases: ["toronto blue jays", "blue jays", "jays", "tor"] },
  { id: 142, code: "MIN", aliases: ["minnesota twins", "twins", "min"] },
  { id: 143, code: "PHI", aliases: ["philadelphia phillies", "phillies", "phi"] },
  { id: 144, code: "ATL", aliases: ["atlanta braves", "braves", "atl"] },
  { id: 145, code: "CWS", aliases: ["chicago white sox", "white sox", "cws", "chw"] },
  { id: 146, code: "MIA", aliases: ["miami marlins", "marlins", "mia", "fla"] },
  { id: 147, code: "NYY", aliases: ["new york yankees", "yankees", "nyy"] },
  { id: 158, code: "MIL", aliases: ["milwaukee brewers", "brewers", "mil"] },
] as const;

function hasInternalMlbEnrichmentTools(tools: AgentToolDefinition[]) {
  return tools.some((tool) => tool.toolName.startsWith("mlb_mcp__"));
}

function buildInternalMlbGroundingRules() {
  return [
    "When you use MLB MCP tools, only name players, teams, lineup spots, or matchups that appear in the current tool results for this turn.",
    "For hitter or pitcher gameplans, confirm the current matchup first, then verify roster or lineup context before ranking players.",
    "If an MLB stat lookup fails or is incomplete, say that directly instead of backfilling missing baseball facts from memory.",
    "Internal MLB MCP lookup tools return MLB identifiers, not Sportfolio player IDs. Do not pass MLB IDs into Sportfolio-native tools. Use message-based preview tools when turning MLB reads into staged Sportfolio actions.",
  ];
}

function getCurrentAgentDateIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: AGENT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getCurrentAgentTimeLabel() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: AGENT_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
}

function getCurrentAgentYear() {
  const parsed = Number(getCurrentAgentDateIso().slice(0, 4));
  return Number.isInteger(parsed) ? parsed : new Date().getFullYear();
}

function usesCurrentSlateLanguage(message: string) {
  return /\b(today|today's|todays|tonight|right now|current slate|this slate)\b/i.test(message);
}

function mentionsExplicitYear(message: string) {
  return /\b20\d{2}\b/.test(message);
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

function buildToolTraceEntry(input: {
  toolName: string;
  phase: AgentToolTrace["phase"];
  status: AgentToolTrace["status"];
  startedAt: number;
  summary: string;
  details?: Record<string, unknown> | null;
}): AgentToolTrace {
  return {
    toolName: input.toolName,
    phase: input.phase,
    status: input.status,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    summary: input.summary,
    details: input.details || null,
  };
}

function clampMaxTokens(profile: UserAgentProfile) {
  if (!Number.isFinite(profile.maxTokens)) {
    return 900;
  }

  return Math.max(250, Math.min(profile.maxTokens, 1400));
}

function clampTemperature(profile: UserAgentProfile) {
  const parsed = Number(profile.temperature);
  if (!Number.isFinite(parsed)) {
    return 0.2;
  }

  return Math.max(0, Math.min(parsed, 0.35));
}

function summarizeUsage(message: AssistantMessage | null): AgentModelUsage | undefined {
  if (!message) {
    return undefined;
  }

  return {
    promptTokens: message.usage.input,
    completionTokens: message.usage.output,
    totalTokens: message.usage.totalTokens,
  };
}

function extractAssistantText(message: AssistantMessage): string | null {
  const text = message.content
    .filter((block): block is Extract<(typeof message.content)[number], { type: "text" }> => {
      return block.type === "text";
    })
    .map((block) => block.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const sanitized = stripHiddenReasoningText(text);

  return sanitized || null;
}

function extractToolCalls(message: AssistantMessage) {
  return message.content.filter(
    (
      block,
    ): block is Extract<
      (typeof message.content)[number],
      { type: "toolCall"; arguments: unknown }
    > => block.type === "toolCall",
  );
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function safeJson(value: unknown, maxLength: number) {
  try {
    return truncate(JSON.stringify(value, null, 2), maxLength);
  } catch {
    return truncate(String(value), maxLength);
  }
}

function estimatePromptChars(input: {
  request: HermesRespondRequest;
  matchedSkill: AgentSkillDefinition | null;
  tools: AgentToolDefinition[];
}) {
  const operatorChars = JSON.stringify(input.request.canonicalState.operatorOverview || {}).length;
  const continuityChars = JSON.stringify(input.request.continuityState || {}).length;
  const memoryChars = JSON.stringify(input.request.memoryContext || {}).length;
  const historyChars = (input.request.conversationHistory || []).reduce(
    (total, entry) => total + (entry.contentText?.length || 0),
    0,
  );
  const knowledgeChars = JSON.stringify(
    input.request.externalContext.canonicalKnowledge || [],
  ).length;
  const toolChars = input.tools.reduce(
    (total, tool) => total + tool.toolName.length + tool.description.length,
    0,
  );

  return (
    input.request.message.length +
    operatorChars +
    continuityChars +
    memoryChars +
    historyChars +
    knowledgeChars +
    toolChars +
    (input.matchedSkill?.description.length || 0)
  );
}

function summarizeHistory(
  entries: HermesRespondRequest["conversationHistory"],
  input: { limit: number; entryMaxLength: number; compressed: boolean },
) {
  const tail = (entries || []).slice(-input.limit);
  if (tail.length === 0) {
    return "None.";
  }

  const summarized = tail
    .map(
      (entry, index) =>
        `${index + 1}. ${entry.role.toUpperCase()}: ${truncate(entry.contentText.trim(), input.entryMaxLength)}`,
    )
    .join("\n");

  if (!input.compressed || (entries || []).length <= tail.length) {
    return summarized;
  }

  return `Earlier conversation compressed from ${(entries || []).length} turns to the latest ${tail.length} turns.\n${summarized}`;
}

function summarizeKnowledge(
  entries: HermesRespondRequest["externalContext"]["canonicalKnowledge"],
  limit = 6,
) {
  const visible = (entries || []).slice(0, limit);
  if (visible.length === 0) {
    return "None.";
  }

  return visible
    .map((entry, index) => {
      const title =
        typeof entry?.title === "string" && entry.title.trim()
          ? entry.title.trim()
          : typeof entry?.id === "string" && entry.id.trim()
            ? entry.id.trim()
            : `Article ${index + 1}`;

      const summary =
        typeof (entry as { summary?: string })?.summary === "string"
          ? (entry as { summary?: string }).summary!.trim()
          : "";
      const notes = Array.isArray((entry as { notes?: string[] })?.notes)
        ? (entry as { notes?: string[] })
            .notes!.filter((note) => typeof note === "string" && note.trim())
            .slice(0, 3)
            .join(" ")
        : "";

      const parts = [title];
      if (summary) {
        parts.push(summary);
      }
      if (notes) {
        parts.push(notes);
      }

      return `${index + 1}. ${parts.join(" — ")}`;
    })
    .join("\n");
}

function summarizeMatchedSkill(skill: AgentSkillDefinition | null) {
  if (!skill) {
    return "None.";
  }

  return `${skill.name}: ${truncate(skill.description, 220)}`;
}

function summarizeContinuityState(
  continuityState: HermesRespondRequest["continuityState"],
  input: { compressed: boolean; limit: number },
) {
  if (!continuityState) {
    return "None.";
  }

  const lines = [continuityState.headline, continuityState.summary].filter(Boolean);

  if (continuityState.openLoops.length > 0) {
    lines.push(
      `Open loops: ${continuityState.openLoops
        .slice(0, input.limit)
        .map((item) => `${item.title} [${item.status}]`)
        .join(" | ")}`,
    );
  }

  if (continuityState.activeStrategies.length > 0) {
    lines.push(
      `Active strategies: ${continuityState.activeStrategies
        .slice(0, input.limit)
        .map((item) => `${item.name} (${item.status})`)
        .join(" | ")}`,
    );
  }

  if (continuityState.recentActions.length > 0) {
    lines.push(
      `Recent actions: ${continuityState.recentActions
        .slice(0, input.limit)
        .map((item) => item.title)
        .join(" | ")}`,
    );
  }

  if (continuityState.evidenceUpdates.length > 0) {
    lines.push(
      `Fresh evidence: ${continuityState.evidenceUpdates
        .slice(0, input.limit)
        .map((item) => item.title)
        .join(" | ")}`,
    );
  }

  return lines.map((line) => truncate(line, input.compressed ? 140 : 220)).join("\n");
}

function summarizeMemoryContext(
  request: HermesRespondRequest,
  input: { limitPerScope: number; compressed: boolean },
) {
  const sections: string[] = [];
  const scopes = [
    ["profile", request.memoryContext.profile],
    ["episodic", request.memoryContext.episodic],
    ["semantic", request.memoryContext.semantic],
  ] as const;

  for (const [label, entries] of scopes) {
    const visible = entries.slice(0, input.limitPerScope);
    if (visible.length === 0) {
      continue;
    }

    const lines = visible.map((entry, index) => {
      const confidence = Number.isFinite(entry.confidence)
        ? ` (${entry.confidence.toFixed(2)})`
        : "";
      return `${index + 1}. ${truncate(entry.summary, input.compressed ? 120 : 180)}${confidence}`;
    });
    sections.push(`${label}: ${lines.join(" | ")}`);
  }

  return sections.length > 0 ? sections.join("\n") : "None.";
}

function summarizeDataConnections(
  capabilities: HermesRespondRequest["canonicalState"]["capabilities"],
) {
  const dataSources = capabilities.dataSources;
  if (!dataSources) {
    return "None.";
  }

  const builtInLines = dataSources.builtIn.map((source) => {
    const status = [
      source.enabled ? "enabled" : "disabled",
      source.available ? "available" : "unavailable",
    ].join(", ");
    return `${source.name} [built-in, ${status}]`;
  });
  const externalLines = dataSources.external.map((source) => {
    const status = [
      source.enabled ? "enabled" : "disabled",
      source.available ? "available" : "unavailable",
    ].join(", ");
    return `${source.name} [external, ${status}]`;
  });
  const lines = [];

  if (builtInLines.length > 0) {
    lines.push(`Built-in: ${builtInLines.join(" | ")}`);
  }
  if (externalLines.length > 0) {
    lines.push(`External: ${externalLines.join(" | ")}`);
  }

  return lines.length > 0 ? lines.join("\n") : "None.";
}

function resolveInitialCompressionLevel(input: {
  request: HermesRespondRequest;
  matchedSkill: AgentSkillDefinition | null;
  tools: AgentToolDefinition[];
}): CompressionLevel {
  const estimatedChars = estimatePromptChars(input);
  if (estimatedChars > BASE_PROMPT_CHAR_BUDGET * 1.55) {
    return 2;
  }
  if (
    estimatedChars > BASE_PROMPT_CHAR_BUDGET ||
    input.request.conversationHistory.length > 8 ||
    input.request.memoryContext.semantic.length > 6
  ) {
    return 1;
  }

  return 0;
}

function normalizeArgs(
  tool: AgentToolDefinition,
  request: HermesRespondRequest,
  rawArgs: unknown,
): Record<string, unknown> {
  const args =
    rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? { ...(rawArgs as Record<string, unknown>) }
      : {};

  const autoArgs = new Set(tool.autoContextArgs || []);
  if (autoArgs.has("message") && (typeof args.message !== "string" || !args.message.trim())) {
    args.message = request.message;
  }
  if (autoArgs.has("threadId") && request.threadId && !args.threadId) {
    args.threadId = request.threadId;
  }
  if (autoArgs.has("query") && (typeof args.query !== "string" || !args.query.trim())) {
    args.query = request.message;
  }
  if (autoArgs.has("sport") && (typeof args.sport !== "string" || !args.sport.trim())) {
    const sportNameMap: Record<string, string> = {
      baseball: "MLB",
      basketball: "NBA",
      football: "NFL",
      nascar: "NASCAR",
      nba: "NBA",
      nfl: "NFL",
      mlb: "MLB",
    };
    const sportMatch = request.message.match(
      /\b(nba|nfl|mlb|nascar|baseball|basketball|football)\b/i,
    )?.[1];
    if (sportMatch) {
      args.sport = sportNameMap[sportMatch.toLowerCase()] || sportMatch.toUpperCase();
    }
  }

  if (
    tool.toolName.startsWith("mlb_mcp__") &&
    usesCurrentSlateLanguage(request.message) &&
    !mentionsExplicitYear(request.message)
  ) {
    const currentDate = getCurrentAgentDateIso();
    const currentYear = getCurrentAgentYear();
    const currentSeason = String(currentYear);
    const inferredTeams = inferMlbTeamsFromMessage(request.message);
    const primaryTeam = inferredTeams[0] || null;
    const opponentTeam = inferredTeams[1] || null;

    if (tool.toolName === "mlb_mcp__get_schedule") {
      if ((typeof args.team_id !== "number" || !Number.isInteger(args.team_id)) && primaryTeam) {
        args.team_id = primaryTeam.id;
      }
      if (
        (typeof args.opponent_id !== "number" || !Number.isInteger(args.opponent_id)) &&
        opponentTeam
      ) {
        args.opponent_id = opponentTeam.id;
      }
      if (!args.game_id && !args.date && !args.start_date && !args.end_date) {
        args.date = currentDate;
      }
      if (typeof args.season !== "string" || !args.season.trim() || args.season !== currentSeason) {
        args.season = currentSeason;
      }
    }

    if (
      (tool.toolName === "mlb_mcp__get_team_roster" ||
        tool.toolName === "mlb_mcp__get_team_leaders") &&
      (typeof args.team_id !== "number" || !Number.isInteger(args.team_id)) &&
      primaryTeam
    ) {
      args.team_id = primaryTeam.id;
    }

    if (
      tool.toolName === "mlb_mcp__get_schedule_and_record" &&
      (typeof args.team !== "string" || !args.team.trim()) &&
      primaryTeam
    ) {
      args.team = primaryTeam.code;
    }

    if ("season" in args || tool.toolName !== "mlb_mcp__get_schedule") {
      if (
        args.season == null ||
        (typeof args.season === "string" && args.season.trim() !== currentSeason) ||
        (typeof args.season === "number" && args.season !== currentYear)
      ) {
        args.season = typeof args.season === "number" ? currentYear : currentSeason;
      }
    }

    if (
      (tool.toolName === "mlb_mcp__get_team_batting" ||
        tool.toolName === "mlb_mcp__get_team_pitching" ||
        tool.toolName === "mlb_mcp__get_team_fielding") &&
      (typeof args.start_season !== "number" || !Number.isInteger(args.start_season))
    ) {
      args.start_season = currentYear;
    }
  }

  return args;
}

function normalizeToolLookupName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function includesIntentKeyword(message: string, keywords: readonly string[]) {
  return keywords.some((keyword) => new RegExp(`\\b${keyword}\\b`, "i").test(message));
}

function stripLeadingCommandPreamble(message: string) {
  let normalized = message.trim().toLowerCase();
  if (!normalized) {
    return normalized;
  }

  const prefixPatterns = [
    /^(?:hey|hi|hello)\s+/i,
    /^(?:okay|ok|so|now|then)\b[,:-]?\s*/i,
    /^(?:hermes|agent|sportfolio)(?:\s+operator)?\b[,:-]?\s*/i,
  ] as const;

  let changed = true;
  while (changed && normalized) {
    changed = false;
    for (const pattern of prefixPatterns) {
      const next = normalized.replace(pattern, "").trimStart();
      if (next !== normalized) {
        normalized = next;
        changed = true;
      }
    }
  }

  const firstComma = normalized.indexOf(",");
  if (firstComma > 0) {
    const preamble = normalized.slice(0, firstComma).trim();
    const remainder = normalized.slice(firstComma + 1).trimStart();
    if (remainder && preamble.split(/\s+/).filter(Boolean).length <= 4) {
      return remainder;
    }
  }

  return normalized;
}

function hasDirectActionCommand(message: string) {
  const normalized = stripLeadingCommandPreamble(message);
  const directCommandPatterns = [
    /^(?:please\s+)?(?:buy|sell|add|remove|set|assign|boost|stack|zap|condense|place|put|move|lock|scout|track|save|watchlist|unwatch)\b/i,
    /^(?:please\s+)?(?:can|could|will)\s+you\s+(?:buy|sell|add|remove|set|assign|boost|stack|zap|condense|place|put|move|lock|scout|track|save|watchlist|unwatch)\b/i,
    /^(?:please\s+)?(?:i want you to|i'd like you to|id like you to)\s+(?:buy|sell|add|remove|set|assign|boost|stack|zap|condense|place|put|move|lock|scout|track|save|watchlist|unwatch)\b/i,
    /^(?:please\s+)?(?:create|make|activate|redeem)\s+(?:(?:a|my)\s+)?community\s+(?:boost|share)\b/i,
    /^(?:please\s+)?(?:can|could|will)\s+you\s+(?:create|make|activate|redeem)\s+(?:(?:a|my)\s+)?community\s+(?:boost|share)\b/i,
    /^(?:please\s+)?(?:i want you to|i'd like you to|id like you to)\s+(?:create|make|activate|redeem)\s+(?:(?:a|my)\s+)?community\s+(?:boost|share)\b/i,
  ] as const;

  return directCommandPatterns.some((pattern) => pattern.test(normalized));
}

function isExplicitPlanningIntent(message: string) {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const explicitExecutionPhrases = [
    "stage",
    "queue",
    "execute",
    "go ahead",
    "do it",
    "set up",
  ] as const;
  const planningPhrases = [
    "plan a trade",
    "plan my trade",
    "plan this trade",
    "can you plan",
    "help me plan",
    "build a trade plan",
    "prepare a trade plan",
    "stage a plan",
  ] as const;
  const planningActionTargets = [
    "trade",
    "buy",
    "sell",
    "position",
    "allocation",
    "order",
    "boost",
    "scout",
    "liquidity",
    "lp",
  ] as const;
  const advisoryDecisionPatterns = [
    /\bwho should i\b/i,
    /\bwhat should i\b/i,
    /\bshould i\b/i,
    /\bwho\b.*\b(?:buy|sell|boost|scout|avoid)\b/i,
    /\bwhat\b.*\b(?:buy|sell|boost|scout|avoid)\b/i,
    /\bcompare\b/i,
    /\bwalk me through\b/i,
    /\btalk me through\b/i,
    /\bhelp me decide\b/i,
  ] as const;

  if (hasDirectActionCommand(normalized)) {
    return true;
  }

  const hasPlanningPhrase = planningPhrases.some((phrase) => normalized.includes(phrase));
  if (hasPlanningPhrase && includesIntentKeyword(normalized, planningActionTargets)) {
    return true;
  }

  if (
    advisoryDecisionPatterns.some((pattern) => pattern.test(normalized)) ||
    normalized.endsWith("?")
  ) {
    return false;
  }

  return explicitExecutionPhrases.some((phrase) => normalized.includes(phrase));
}

function canProceedWithPlanTool(input: {
  request: HermesRespondRequest;
  args: Record<string, unknown>;
}) {
  if (
    input.request.requestMode === "plan" ||
    input.request.requestMode === "clarification_resume"
  ) {
    return true;
  }

  const hasConcreteActionArgs =
    typeof input.args.playerId === "string" ||
    typeof input.args.playerName === "string" ||
    typeof input.args.targetCount === "number" ||
    typeof input.args.shares === "number" ||
    typeof input.args.sharesAmount === "number" ||
    typeof input.args.sb === "number" ||
    typeof input.args.sbAmount === "number" ||
    typeof input.args.maxShares === "number" ||
    typeof input.args.maxPlayMoney === "number" ||
    typeof input.args.lpShares === "number" ||
    typeof input.args.slotTier === "number";
  if (hasConcreteActionArgs) {
    return true;
  }

  const message =
    typeof input.args.message === "string" && input.args.message.trim()
      ? input.args.message
      : input.request.message;

  return isExplicitPlanningIntent(message);
}

function findSelectedTool(tools: AgentToolDefinition[], requestedName: string) {
  const exact = tools.find((entry) => entry.toolName === requestedName);
  if (exact) {
    return {
      tool: exact,
      repaired: false,
    };
  }

  const normalizedRequested = normalizeToolLookupName(requestedName);
  const repaired = tools.find(
    (entry) => normalizeToolLookupName(entry.toolName) === normalizedRequested,
  );

  return {
    tool: repaired || null,
    repaired: Boolean(repaired),
  };
}

function coerceValueBySchema(
  value: unknown,
  schema: Record<string, unknown>,
): { value: unknown; repaired: boolean; issue: string | null } {
  const type = typeof schema.type === "string" ? schema.type : null;
  if (!type) {
    return { value, repaired: false, issue: null };
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    if (schema.enum.includes(value as never)) {
      return { value, repaired: false, issue: null };
    }
    if (typeof value === "string") {
      const matched = schema.enum.find(
        (entry) => typeof entry === "string" && entry.toLowerCase() === value.trim().toLowerCase(),
      );
      if (matched !== undefined) {
        return { value: matched, repaired: true, issue: null };
      }
    }
    return { value, repaired: false, issue: `Expected one of ${schema.enum.join(", ")}.` };
  }

  switch (type) {
    case "string":
      if (typeof value === "string") {
        return { value: value.trim(), repaired: value !== value.trim(), issue: null };
      }
      return { value, repaired: false, issue: "Expected a string." };
    case "number": {
      if (typeof value === "number" && Number.isFinite(value)) {
        return { value, repaired: false, issue: null };
      }
      if (typeof value === "string") {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) {
          return { value: parsed, repaired: true, issue: null };
        }
      }
      return { value, repaired: false, issue: "Expected a number." };
    }
    case "integer": {
      if (typeof value === "number" && Number.isInteger(value)) {
        return { value, repaired: false, issue: null };
      }
      if (typeof value === "string") {
        const parsed = Number(value.trim());
        if (Number.isInteger(parsed)) {
          return { value: parsed, repaired: true, issue: null };
        }
      }
      return { value, repaired: false, issue: "Expected an integer." };
    }
    case "boolean":
      if (typeof value === "boolean") {
        return { value, repaired: false, issue: null };
      }
      if (typeof value === "string") {
        if (/^true$/i.test(value.trim())) {
          return { value: true, repaired: true, issue: null };
        }
        if (/^false$/i.test(value.trim())) {
          return { value: false, repaired: true, issue: null };
        }
      }
      return { value, repaired: false, issue: "Expected a boolean." };
    case "array":
      return {
        value,
        repaired: false,
        issue: Array.isArray(value) ? null : "Expected an array.",
      };
    case "object":
      return {
        value,
        repaired: false,
        issue:
          value && typeof value === "object" && !Array.isArray(value)
            ? null
            : "Expected an object.",
      };
    default:
      return { value, repaired: false, issue: null };
  }
}

function validateToolArgs(
  tool: AgentToolDefinition,
  args: Record<string, unknown>,
): {
  valid: boolean;
  normalizedArgs: Record<string, unknown>;
  repaired: boolean;
  notes: string[];
} {
  if (
    !tool.inputSchema ||
    typeof tool.inputSchema !== "object" ||
    Array.isArray(tool.inputSchema)
  ) {
    return {
      valid: true,
      normalizedArgs: args,
      repaired: false,
      notes: [],
    };
  }

  const schema = tool.inputSchema as Record<string, unknown>;
  const normalizedArgs = { ...args };
  const notes: string[] = [];
  let repaired = false;

  const properties =
    schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === "string")
    : [];

  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!(key in normalizedArgs)) {
      continue;
    }

    const result = coerceValueBySchema(normalizedArgs[key], propertySchema);
    if (result.issue) {
      notes.push(`${key}: ${result.issue}`);
      continue;
    }
    if (result.repaired) {
      repaired = true;
      notes.push(`Coerced ${key} to match the tool schema.`);
    }
    normalizedArgs[key] = result.value;
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(normalizedArgs)) {
      if (!(key in properties)) {
        delete normalizedArgs[key];
        repaired = true;
        notes.push(`Dropped unexpected argument ${key}.`);
      }
    }
  }

  const missing = required.filter(
    (key) =>
      normalizedArgs[key] === undefined ||
      normalizedArgs[key] === null ||
      normalizedArgs[key] === "",
  );
  if (missing.length > 0) {
    notes.push(
      `Missing required argument${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
    );
  }

  return {
    valid: missing.length === 0 && !notes.some((entry) => entry.includes("Expected")),
    normalizedArgs,
    repaired,
    notes,
  };
}

function buildToolDescription(tool: AgentToolDefinition) {
  const lines = [tool.description];
  if (tool.whenToUse[0]) {
    lines.push(`Use when: ${tool.whenToUse[0]}`);
  }
  if (tool.presentationProfile) {
    lines.push(`Presentation profile: ${tool.presentationProfile}`);
  }
  if (tool.primaryEntityType) {
    lines.push(`Primary entity: ${tool.primaryEntityType}`);
  }
  if (tool.preferredColumns && tool.preferredColumns.length > 0) {
    lines.push(`Preferred columns: ${tool.preferredColumns.join(", ")}`);
  }
  if (tool.examplePrompts.length > 0) {
    lines.push(`Examples: ${tool.examplePrompts.slice(0, 2).join(" | ")}`);
  }

  return lines.join("\n");
}

function collectCitations(result: unknown): AgentCitation[] {
  if (!result || typeof result !== "object") {
    return [];
  }

  const direct = (result as { citations?: unknown }).citations;
  if (Array.isArray(direct)) {
    return direct as AgentCitation[];
  }

  const nested = (result as { context?: { citations?: unknown } }).context?.citations;
  if (Array.isArray(nested)) {
    return nested as AgentCitation[];
  }

  return [];
}

function isStructuredScanResult(value: unknown): value is {
  summary?: string | null;
  replyText?: string;
  observations?: string[];
  warnings?: string[];
  context?: Record<string, unknown>;
  intentFocus?: string;
} {
  return Boolean(
    value &&
    typeof value === "object" &&
    ("observations" in (value as Record<string, unknown>) ||
      "context" in (value as Record<string, unknown>) ||
      "intentFocus" in (value as Record<string, unknown>)),
  );
}

function buildStructuredToolContextText(input: {
  toolName: string;
  summary?: string | null;
  observations?: string[];
  warnings?: string[];
  context?: unknown;
  intentFocus?: string;
  fallbackNarrative?: string | null;
}) {
  const parts: string[] = [];

  if (input.summary) {
    parts.push(`Summary: ${input.summary}`);
  }
  if (input.intentFocus) {
    parts.push(`Intent focus: ${input.intentFocus}`);
  }
  if (input.observations && input.observations.length > 0) {
    parts.push(`Observations:\n- ${input.observations.join("\n- ")}`);
  }
  if (input.warnings && input.warnings.length > 0) {
    parts.push(`Warnings:\n- ${input.warnings.join("\n- ")}`);
  }
  if (input.context && typeof input.context === "object") {
    parts.push(`Structured context:\n${safeJson(input.context, 2200)}`);
  }
  if (parts.length === 0 && input.fallbackNarrative) {
    parts.push(input.fallbackNarrative);
  }

  return parts.join("\n\n") || `Result from ${input.toolName}.`;
}

function buildToolFallbackText(tool: AgentToolDefinition, result: unknown): string {
  if (tool.category === "scan" && result && typeof result === "object") {
    const scan = result as { replyText?: unknown; summary?: unknown };
    if (typeof scan.replyText === "string" && scan.replyText.trim()) {
      return scan.replyText.trim();
    }
    if (typeof scan.summary === "string" && scan.summary.trim()) {
      return scan.summary.trim();
    }
  }

  if (isStructuredReadResult(result)) {
    if (result.replyText) {
      return result.replyText;
    }
    if (result.summary) {
      return result.summary;
    }
  }

  return `Result from ${tool.toolName}:\n${safeJson(result, 2800)}`;
}

function buildToolResultText(tool: AgentToolDefinition, result: unknown): string {
  if (tool.category === "scan" && isStructuredScanResult(result)) {
    return buildStructuredToolContextText({
      toolName: tool.toolName,
      summary: result.summary || null,
      observations: Array.isArray(result.observations) ? result.observations : [],
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
      context: result.context || {},
      intentFocus: result.intentFocus,
      fallbackNarrative: typeof result.replyText === "string" ? result.replyText.trim() : null,
    });
  }

  if (isStructuredReadResult(result)) {
    const record = result as Record<string, unknown>;
    const { replyText, summary, warnings, citations, ...data } = record;

    return buildStructuredToolContextText({
      toolName: tool.toolName,
      summary: typeof summary === "string" ? summary : null,
      warnings: Array.isArray(warnings)
        ? warnings.filter((entry): entry is string => typeof entry === "string")
        : [],
      context: {
        ...data,
        ...(Array.isArray(citations) && citations.length > 0 ? { citations } : {}),
      },
      fallbackNarrative: typeof replyText === "string" ? replyText : null,
    });
  }

  return `Result from ${tool.toolName}:\n${safeJson(result, 2800)}`;
}

function formatOperatorOverviewFallback(result: unknown): string | null {
  const source =
    result &&
    typeof result === "object" &&
    "operatorOverview" in (result as Record<string, unknown>)
      ? ((result as Record<string, unknown>).operatorOverview as Record<string, unknown> | null)
      : (result as Record<string, unknown> | null);

  if (!source || typeof source !== "object") {
    return null;
  }

  const availableBalance =
    typeof source.availableBalance === "number" ? source.availableBalance : null;
  const openDailyBoostSlots =
    typeof source.openDailyBoostSlots === "number" ? source.openDailyBoostSlots : null;
  const communitySharesAvailable =
    typeof source.communitySharesAvailable === "number" ? source.communitySharesAvailable : null;
  const stackReadyHoldingRows =
    typeof source.stackReadyHoldingRows === "number" ? source.stackReadyHoldingRows : null;
  const nextBestLevers = Array.isArray(source.nextBestLevers)
    ? source.nextBestLevers
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .slice(0, 3)
    : [];
  const topHoldings = Array.isArray(source.topHoldings)
    ? source.topHoldings
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          const name = (entry as Record<string, unknown>).name;
          return typeof name === "string" && name.trim() ? name.trim() : null;
        })
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, 3)
    : [];

  const parts = [
    "Setup review:",
    availableBalance != null ? `$${availableBalance.toFixed(2)} available balance.` : null,
    openDailyBoostSlots != null
      ? `${openDailyBoostSlots} open daily boost slot${openDailyBoostSlots === 1 ? "" : "s"}.`
      : null,
    communitySharesAvailable != null
      ? `${communitySharesAvailable} community share${communitySharesAvailable === 1 ? "" : "s"} available.`
      : null,
    stackReadyHoldingRows != null
      ? `${stackReadyHoldingRows} stack-ready holding row${stackReadyHoldingRows === 1 ? "" : "s"}.`
      : null,
    nextBestLevers.length > 0 ? `Next levers: ${nextBestLevers.join("; ")}.` : null,
    topHoldings.length > 0 ? `Top holdings: ${topHoldings.join(", ")}.` : null,
  ].filter(Boolean);

  return parts.join(" ") || null;
}

function selectDeterministicAdvisoryTool(
  tools: AgentToolDefinition[],
  message: string,
): AgentToolDefinition | null {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const findTool = (toolName: string) => tools.find((tool) => tool.toolName === toolName) || null;

  if (
    /\b(?:obp|ops|era|whip)\b/i.test(normalized) &&
    /\b(?:mlb|baseball|gameplan|slate|today|tonight|tomorrow)\b/i.test(normalized)
  ) {
    return findTool("scan_mlb_stat_gameplan");
  }

  if (
    /\b(?:review|talk me through|walk me through|setup|portfolio)\b/i.test(normalized) &&
    /\b(?:setup|portfolio|look|review)\b/i.test(normalized)
  ) {
    return findTool("get_operator_overview") || findTool("get_portfolio_summary");
  }

  if (/\b(?:idle balance|idle cash|unused balance|extra cash)\b/i.test(normalized)) {
    return findTool("scan_idle_balance_options");
  }

  if (/\bcommunity boost\b/i.test(normalized)) {
    return findTool("scan_community_boost_candidates");
  }

  if (/\bwatchlist\b/i.test(normalized)) {
    return findTool("scan_watchlist_targets");
  }

  if (/\b(?:scout|scouting)\b/i.test(normalized)) {
    return findTool("scan_scout_opportunities");
  }

  if (/\b(?:boost slot|boost slots|eligible for a boost|who can i boost)\b/i.test(normalized)) {
    return findTool("scan_daily_boost_candidates") || findTool("scan_open_boost_slots");
  }

  if (
    /\b(?:buy|worth buying|start a position|market opportunities|who should i buy)\b/i.test(
      normalized,
    )
  ) {
    return findTool("scan_top_market_opportunities");
  }

  if (/\b(?:slate|games|matchup|matchups|lineup|lineups|probable pitchers?)\b/i.test(normalized)) {
    return findTool("scan_sport_slate");
  }

  if (/\b(?:clean up|overexposed|stale)\b/i.test(normalized)) {
    return findTool("scan_portfolio_cleanup_levers");
  }

  return null;
}

function buildLoopPrompt(input: {
  request: HermesRespondRequest;
  matchedSkill: AgentSkillDefinition | null;
  tools: AgentToolDefinition[];
  compressionLevel: CompressionLevel;
}) {
  const compressed = input.compressionLevel > 0;
  const currentDate = getCurrentAgentDateIso();
  const currentTime = getCurrentAgentTimeLabel();
  const internalMlbGroundingRules = hasInternalMlbEnrichmentTools(input.tools)
    ? buildInternalMlbGroundingRules()
    : [];
  const availableTools =
    input.tools.length === 0
      ? "No tools available."
      : input.tools
          .map((tool, index) => `${index + 1}. ${tool.toolName} [${tool.category}]`)
          .join("\n");

  return [
    "<request_mode>",
    input.request.requestMode,
    "</request_mode>",
    "<available_tools>",
    availableTools,
    "</available_tools>",
    "<current_time_context>",
    `Current ET date: ${currentDate}. Current ET time: ${currentTime}.`,
    "Interpret relative time phrases like today, later today, tonight, tomorrow, and this slate using America/New_York unless the user explicitly names a different date.",
    "</current_time_context>",
    "<routing_rules>",
    "Use the real Hermes tools directly when the user needs account-specific, market-specific, or time-sensitive data.",
    "You may call up to one tool per pass. After a tool result, continue reasoning and either call another tool or answer directly.",
    "Use plan tools for confirmation-ready previews or staged bundle planning.",
    "When you call a plan tool, include every required argument exactly as named by the tool schema. If you do not know a required argument yet, use a read or scan tool first instead of guessing.",
    "Preview tool argument reminders: preview_pool_buy needs playerId + sbAmount; preview_pool_sell needs playerId + sharesAmount; preview_lp_add_optimal needs playerId + maxShares + maxPlayMoney; preview_lp_remove needs playerId + lpShares; preview_lp_zap needs playerId plus shares or sb; preview_daily_boost_assign/remove and preview_scout_adjustment can use a concrete message when needed.",
    "Use action tools only when the user explicitly wants a pending bundle staged, confirmed, canceled, or another real mutation executed.",
    "Use memory mutation tools only when the user explicitly manages memory or skills, or when a workflow is clearly worth saving.",
    "For compound requests with multiple linked steps (buy + stack, buy + boost, buy + stack + boost), prefer preview_multi_action_bundle with a clear message describing all steps rather than calling individual preview tools separately.",
    "If you need to resolve a player name first, use a read tool, then call the compound preview tool on the next pass.",
    "For capability, tool, MCP connection, or data-source questions, prefer get_tool_catalog and get_agent_capabilities before answering if you need to verify runtime truth.",
    "For broad setup reviews, prefer get_portfolio_summary or get_operator_overview before answering.",
    "For cleanup, cash deployment, market-opportunity, and community-boost recommendation questions, prefer the matching scan tools instead of a plan tool.",
    "When the user asks what tools, MCP connections, or data sources are available, answer from the real tool list and data-connection state below. Do not claim there are none if either section is populated.",
    ...internalMlbGroundingRules,
    "When you have enough context, answer directly in plain text and do not call another tool.",
    "</routing_rules>",
    "<matched_skill_hint>",
    summarizeMatchedSkill(input.matchedSkill),
    "</matched_skill_hint>",
    "<operator_continuity>",
    summarizeContinuityState(input.request.continuityState, {
      compressed,
      limit: input.compressionLevel === 2 ? 1 : input.compressionLevel === 1 ? 2 : 3,
    }),
    "</operator_continuity>",
    "<operator_overview>",
    safeJson(
      input.request.canonicalState.operatorOverview || {},
      input.compressionLevel === 2 ? 650 : input.compressionLevel === 1 ? 900 : 1400,
    ),
    "</operator_overview>",
    "<memory_context>",
    summarizeMemoryContext(input.request, {
      limitPerScope: input.compressionLevel === 2 ? 1 : input.compressionLevel === 1 ? 2 : 4,
      compressed,
    }),
    "</memory_context>",
    "<data_connections>",
    summarizeDataConnections(input.request.canonicalState.capabilities),
    "</data_connections>",
    "<conversation_history>",
    summarizeHistory(input.request.conversationHistory, {
      limit: input.compressionLevel === 2 ? 2 : input.compressionLevel === 1 ? 3 : 4,
      entryMaxLength: input.compressionLevel === 2 ? 90 : input.compressionLevel === 1 ? 150 : 220,
      compressed,
    }),
    "</conversation_history>",
    "<canonical_knowledge>",
    summarizeKnowledge(
      input.request.externalContext.canonicalKnowledge,
      input.compressionLevel === 2 ? 2 : input.compressionLevel === 1 ? 4 : 6,
    ),
    "</canonical_knowledge>",
    "<current_user_message>",
    input.request.message,
    "</current_user_message>",
  ].join("\n");
}

function cloneMessageWithTrimmedContent(message: Message, maxLength: number): Message {
  if (!Array.isArray(message.content)) {
    return message;
  }

  return {
    ...message,
    content: message.content.map((block) =>
      block.type === "text"
        ? {
            ...block,
            text: truncate(block.text, maxLength),
          }
        : block,
    ),
    details: undefined,
  } as Message;
}

function rebuildLoopMessages(input: {
  request: HermesRespondRequest;
  matchedSkill: AgentSkillDefinition | null;
  tools: AgentToolDefinition[];
  compressionLevel: CompressionLevel;
  messages: Message[];
}) {
  const promptMessage: Message = {
    role: "user",
    content: buildLoopPrompt({
      request: input.request,
      matchedSkill: input.matchedSkill,
      tools: input.tools,
      compressionLevel: input.compressionLevel,
    }),
    timestamp: Date.now(),
  };

  if (input.messages.length <= 1) {
    return [promptMessage];
  }

  const retained = input.messages.slice(
    Math.max(1, input.messages.length - (input.compressionLevel === 2 ? 2 : 4)),
  );
  const maxLength = input.compressionLevel === 2 ? 260 : 700;

  return [
    promptMessage,
    ...retained.map((message) => cloneMessageWithTrimmedContent(message, maxLength)),
  ];
}

function buildAnswerOnlyMessages(input: {
  request: HermesRespondRequest;
  successfulToolContexts: Array<{ toolName: string; text: string }>;
  warnings: string[];
  includesInternalMlbTools: boolean;
}) {
  const toolResultsText =
    input.successfulToolContexts
      .slice(-6)
      .map((entry, index) => `${index + 1}. ${entry.toolName}\n${truncate(entry.text, 1200)}`)
      .join("\n\n") || "None.";
  const warningText =
    input.warnings.length > 0 ? `Warnings:\n- ${input.warnings.slice(-4).join("\n- ")}` : null;

  return [
    {
      role: "user",
      content: [
        "<user_request>",
        input.request.message,
        "</user_request>",
        "<tool_results>",
        toolResultsText,
        "</tool_results>",
        warningText,
        "Answer the user's request directly in plain text using only the tool results above.",
        "Do not call any more tools.",
        input.includesInternalMlbTools
          ? "Only name players, teams, lineup spots, or matchups that appear in the tool results above."
          : null,
        "If the available data is incomplete, say what is uncertain and still give the best bounded recommendation you can.",
      ]
        .filter(Boolean)
        .join("\n"),
      timestamp: Date.now(),
    } as Message,
  ];
}

async function executeNonPlanningTool(input: {
  tool: AgentToolDefinition;
  userId: string;
  threadId: string | null;
  args: Record<string, unknown>;
}) {
  switch (input.tool.category) {
    case "read":
      return runHermesReadTool({
        toolName: input.tool.toolName,
        userId: input.userId,
        threadId: input.threadId,
        args: input.args,
      });
    case "scan":
      return runHermesScanTool({
        toolName: input.tool.toolName,
        userId: input.userId,
        args: input.args,
      });
    case "action":
      return runHermesActionTool({
        toolName: input.tool.toolName,
        userId: input.userId,
        threadId: input.threadId,
        args: input.args,
      });
    case "memory":
      return runHermesMemoryTool({
        toolName: input.tool.toolName,
        userId: input.userId,
        threadId: input.threadId,
        args: input.args,
      });
    default:
      return null;
  }
}

export function isStructuredReadResult(value: unknown): value is {
  replyText?: string;
  summary?: string | null;
  warnings?: string[];
  citations?: AgentCitation[];
} {
  return Boolean(
    value &&
    typeof value === "object" &&
    ("replyText" in (value as Record<string, unknown>) ||
      "summary" in (value as Record<string, unknown>)),
  );
}

export async function runHermesModelToolLoop(input: {
  profile: UserAgentProfile;
  secret?: UserAgentSecret;
  request: HermesRespondRequest;
  matchedSkill: AgentSkillDefinition | null;
}): Promise<ModelFirstRouteResult> {
  const toolTrace: AgentToolTrace[] = [];
  const warnings: string[] = [];
  const citations: AgentCitation[] = [];
  const tools = resolveHermesToolCatalog({
    toolAllowlist: input.request.toolAllowlist,
    toolCatalog: input.request.toolCatalog,
  }).filter((entry) => entry.exposure !== "hidden_fallback" && entry.exposure !== "internal_only");
  const includesInternalMlbTools = hasInternalMlbEnrichmentTools(tools);
  const internalMlbGroundingRules = includesInternalMlbTools
    ? buildInternalMlbGroundingRules()
    : [];
  const requestedPlanningIntent = isExplicitPlanningIntent(input.request.message);
  const planTools = tools.filter((tool) => tool.category === "plan");
  let compressionLevel = resolveInitialCompressionLevel({
    request: input.request,
    matchedSkill: input.matchedSkill,
    tools,
  });
  let compressionApplied = compressionLevel > 0;
  let repairAttempts = 0;
  let providerFailureClass: AgentProviderFailureClass | null = null;

  try {
    let messages = rebuildLoopMessages({
      request: input.request,
      matchedSkill: input.matchedSkill,
      tools,
      compressionLevel,
      messages: [],
    });
    let repairReason: string | null = null;
    let toolCallsUsed = 0;
    let finalUsage: AgentModelUsage | undefined;
    let usedTransientRetry = false;
    let lastSuccessfulToolName: string | null = null;
    let lastSuccessfulToolReply: string | null = null;
    let lastSuccessfulToolUiBlocks: AgentUiBlock[] = [];
    const successfulToolContexts: Array<{ toolName: string; text: string }> = [];

    const buildMetadata = (terminationReason: string | null): ModelFirstRouteMetadata => ({
      terminationReason,
      compressionApplied,
      repairAttempts,
      providerFailureClass,
    });

    const attemptAnswerOnlySynthesis = async (reason: string) => {
      if (toolCallsUsed === 0) {
        return null;
      }

      const startedAt = Date.now();
      try {
        const synthesisMessage = await callAgentModel({
          profile: input.profile,
          secret: input.secret,
          systemPrompt: [
            "You are Sportfolio Operator.",
            input.request.profile.systemPrompt || null,
            "The tool loop already gathered context for this turn.",
            "No more Hermes tool calls are available right now.",
            "Answer directly from the available tool results and keep the response useful and concrete.",
            ...internalMlbGroundingRules,
          ]
            .filter(Boolean)
            .join(" "),
          messages: buildAnswerOnlyMessages({
            request: input.request,
            successfulToolContexts,
            warnings,
            includesInternalMlbTools,
          }),
          tools: [],
          temperature: clampTemperature(input.profile),
          maxTokens: clampMaxTokens(input.profile),
        });

        const synthesisText = extractAssistantText(synthesisMessage);
        const synthesisUsage = summarizeUsage(synthesisMessage);

        if (!synthesisText) {
          toolTrace.push(
            buildToolTraceEntry({
              toolName: "model_answer_synthesis",
              phase: "plan",
              status: "skipped",
              startedAt,
              summary: `The final answer-only synthesis pass did not return visible text after ${reason}.`,
            }),
          );
          return null;
        }

        finalUsage = synthesisUsage || finalUsage;
        warnings.push(
          "Hermes used a final answer-only synthesis pass after the direct tool loop gathered context but did not close with a direct reply.",
        );
        toolTrace.push(
          buildToolTraceEntry({
            toolName: "model_answer_synthesis",
            phase: "plan",
            status: "ok",
            startedAt,
            summary: `Synthesized a direct answer after ${reason}.`,
          }),
        );

        return {
          outcome: "answer" as const,
          replyText: synthesisText,
          summary: `Model answered after ${reason}.`,
          warnings,
          citations,
          toolTrace,
          ...(lastSuccessfulToolUiBlocks.length > 0
            ? { uiBlocks: lastSuccessfulToolUiBlocks }
            : {}),
          ...(finalUsage ? { usage: finalUsage } : {}),
          ...buildMetadata("answer_only_synthesis"),
        };
      } catch (error: any) {
        toolTrace.push(
          buildToolTraceEntry({
            toolName: "model_answer_synthesis",
            phase: "plan",
            status: "failed",
            startedAt,
            summary:
              error?.message || `The final answer-only synthesis pass failed after ${reason}.`,
          }),
        );
        return null;
      }
    };

    const attemptPlanOnlyRecovery = async (reason: string) => {
      if (!requestedPlanningIntent || planTools.length === 0) {
        return null;
      }

      const startedAt = Date.now();
      const normalizedPlanningMessage = stripLeadingCommandPreamble(input.request.message);
      const looksLikeSingleLpAddRequest =
        /\b(?:add|deposit|provide|supply)(?:\s+liquidity)?\s+(?:to|into)\s+.+?\s+with\s+\d+(?:\.\d+)?\s+shares?\s+(?:and|plus)\s+\$?\d+(?:\.\d+)?/i.test(
          normalizedPlanningMessage,
        ) ||
        /\b(?:add|deposit|provide|supply)(?:\s+liquidity)?\s+\d+(?:\.\d+)?\s+shares?\s+(?:and|with)\s+\$?\d+(?:\.\d+)?\s*(?:sb|bucks|dollars?)?\s+(?:to|into)\s+.+?(?:'s)?(?:\s+pool)?$/i.test(
          normalizedPlanningMessage,
        );
      const looksCompoundActionRequest =
        (!looksLikeSingleLpAddRequest &&
          /(?:\b(?:and then|then)\b|,\s*)(?=(?:buy|stack|put|assign|boost|add|remove|sell|zap|create|set|move|place|lock)\b)/i.test(
            normalizedPlanningMessage,
          )) ||
        (!looksLikeSingleLpAddRequest &&
          /\b(?:buy|sell|boost|scout|zap|liquidity|stack)\b.*\band\b/i.test(
            normalizedPlanningMessage,
          ));
      const deterministicRecoveryTool = planTools.find(
        (tool) =>
          tool.toolName ===
          (looksCompoundActionRequest ? "preview_multi_action_bundle" : "preview_direct_operation"),
      );

      if (deterministicRecoveryTool) {
        const deterministicArgs = { message: input.request.message };
        if (
          canProceedWithPlanTool({
            request: input.request,
            args: deterministicArgs,
          })
        ) {
          toolTrace.push(
            buildToolTraceEntry({
              toolName: "model_plan_recovery",
              phase: "plan",
              status: "ok",
              startedAt,
              summary: `Recovered ${deterministicRecoveryTool.toolName} deterministically after ${reason}.`,
            }),
          );

          return {
            outcome: "tool" as const,
            toolName: deterministicRecoveryTool.toolName,
            toolCategory: "plan" as const,
            toolArgs: deterministicArgs,
            summary: `Recovered ${deterministicRecoveryTool.toolName} after ${reason}.`,
            warnings,
            citations,
            toolTrace,
            ...(finalUsage ? { usage: finalUsage } : {}),
            ...buildMetadata("plan_only_recovery"),
          };
        }
      }

      try {
        const recoveryMessage = await callAgentModel({
          profile: input.profile,
          secret: input.secret,
          systemPrompt: [
            "You are Sportfolio Operator.",
            input.request.profile.systemPrompt || null,
            "The read and scan loop already gathered context for this turn.",
            "Use the available plan tools only if the user explicitly asked to stage, preview, or queue a move.",
            "Prefer preview_multi_action_bundle for multi-step requests and preview_direct_operation for one concrete action.",
            "Do not call read, scan, action, or memory tools in this recovery pass.",
            ...internalMlbGroundingRules,
          ]
            .filter(Boolean)
            .join(" "),
          messages: [
            {
              role: "user",
              content: [
                "<user_request>",
                input.request.message,
                "</user_request>",
                "<tool_results>",
                successfulToolContexts
                  .slice(-6)
                  .map(
                    (entry, index) =>
                      `${index + 1}. ${entry.toolName}\n${truncate(entry.text, 1200)}`,
                  )
                  .join("\n\n") || "None.",
                "</tool_results>",
                warnings.length > 0 ? `Warnings:\n- ${warnings.slice(-4).join("\n- ")}` : null,
                "If there is enough context to stage a move safely, select one plan tool with valid JSON arguments.",
                "If a staged move is still premature, answer directly with one concise explanation or clarification.",
              ]
                .filter(Boolean)
                .join("\n"),
              timestamp: Date.now(),
            } as Message,
          ],
          tools: planTools.map((tool) => ({
            name: tool.toolName,
            description: buildToolDescription(tool),
            parameters: (tool.inputSchema || noArgsSchema) as Record<string, unknown>,
          })),
          temperature: clampTemperature(input.profile),
          maxTokens: clampMaxTokens(input.profile),
        });

        const recoveryUsage = summarizeUsage(recoveryMessage);
        finalUsage = recoveryUsage || finalUsage;

        const recoveryToolCall = extractToolCalls(recoveryMessage)[0] || null;
        if (recoveryToolCall) {
          const selectedToolLookup = findSelectedTool(planTools, recoveryToolCall.name);
          const selectedTool = selectedToolLookup.tool;
          if (selectedTool) {
            let normalizedArgs = normalizeArgs(
              selectedTool,
              input.request,
              recoveryToolCall.arguments,
            );
            const validation = validateToolArgs(selectedTool, normalizedArgs);
            normalizedArgs = validation.normalizedArgs;

            if (
              validation.valid &&
              canProceedWithPlanTool({
                request: input.request,
                args: normalizedArgs,
              })
            ) {
              toolTrace.push(
                buildToolTraceEntry({
                  toolName: "model_plan_recovery",
                  phase: "plan",
                  status: "ok",
                  startedAt,
                  summary: `Recovered a confirmation-gated plan after ${reason}.`,
                }),
              );

              return {
                outcome: "tool" as const,
                toolName: selectedTool.toolName,
                toolCategory: "plan" as const,
                toolArgs: normalizedArgs,
                summary: `Recovered ${selectedTool.toolName} after ${reason}.`,
                warnings,
                citations,
                toolTrace,
                ...(finalUsage ? { usage: finalUsage } : {}),
                ...buildMetadata("plan_only_recovery"),
              };
            }
          }
        }

        const recoveryText = extractAssistantText(recoveryMessage);
        if (recoveryText) {
          toolTrace.push(
            buildToolTraceEntry({
              toolName: "model_plan_recovery",
              phase: "plan",
              status: "ok",
              startedAt,
              summary: `Recovered a direct response after ${reason} when staging was still premature.`,
            }),
          );

          return {
            outcome: "answer" as const,
            replyText: recoveryText,
            summary: `Recovered a direct response after ${reason}.`,
            warnings,
            citations,
            toolTrace,
            ...(lastSuccessfulToolUiBlocks.length > 0
              ? { uiBlocks: lastSuccessfulToolUiBlocks }
              : {}),
            ...(finalUsage ? { usage: finalUsage } : {}),
            ...buildMetadata("plan_only_recovery"),
          };
        }

        toolTrace.push(
          buildToolTraceEntry({
            toolName: "model_plan_recovery",
            phase: "plan",
            status: "skipped",
            startedAt,
            summary: `The final plan-only recovery pass did not return a usable plan or reply after ${reason}.`,
          }),
        );
        return null;
      } catch (error: any) {
        toolTrace.push(
          buildToolTraceEntry({
            toolName: "model_plan_recovery",
            phase: "plan",
            status: "failed",
            startedAt,
            summary: error?.message || `The final plan-only recovery pass failed after ${reason}.`,
          }),
        );
        return null;
      }
    };

    const attemptDeterministicAdvisoryFallback = async (reason: string) => {
      if (requestedPlanningIntent) {
        return null;
      }

      const selectedTool = selectDeterministicAdvisoryTool(tools, input.request.message);
      if (!selectedTool || selectedTool.category === "plan") {
        return null;
      }

      const startedAt = Date.now();
      try {
        const toolResult = await executeNonPlanningTool({
          tool: selectedTool,
          userId: input.request.userId,
          threadId: input.request.threadId,
          args: { message: input.request.message },
        });

        citations.push(...collectCitations(toolResult));
        const toolUiBlocks = buildToolResultUiBlocks({
          tool: selectedTool,
          result: toolResult,
          conversationMode: input.request.conversationMode,
        });
        const toolResultText = buildToolResultText(selectedTool, toolResult);
        successfulToolContexts.push({
          toolName: selectedTool.toolName,
          text: toolResultText,
        });
        lastSuccessfulToolUiBlocks = toolUiBlocks;

        toolTrace.push(
          buildToolTraceEntry({
            toolName: selectedTool.toolName,
            phase:
              selectedTool.category === "read" && selectedTool.toolName === "get_hosted_research"
                ? "research"
                : selectedTool.category,
            status: "ok",
            startedAt,
            summary: `Executed ${selectedTool.toolName} through the deterministic advisory fallback.`,
          }),
        );
        toolTrace.push(
          buildToolTraceEntry({
            toolName: "tool_first_router",
            phase: "plan",
            status: "ok",
            startedAt,
            summary: `Recovered a direct advisory reply via ${selectedTool.toolName} after ${reason}.`,
          }),
        );

        const fallbackReply =
          selectedTool.toolName === "get_operator_overview" ||
          selectedTool.toolName === "get_portfolio_summary"
            ? formatOperatorOverviewFallback(toolResult) ||
              buildToolFallbackText(selectedTool, toolResult)
            : buildToolFallbackText(selectedTool, toolResult);

        warnings.push(
          `Hermes used ${selectedTool.toolName} directly after the active model returned empty turns.`,
        );

        return {
          outcome: "answer" as const,
          replyText: fallbackReply,
          summary: `Recovered an advisory reply via ${selectedTool.toolName} after ${reason}.`,
          warnings,
          citations,
          toolTrace,
          ...(toolUiBlocks.length > 0 ? { uiBlocks: toolUiBlocks } : {}),
          ...(finalUsage ? { usage: finalUsage } : {}),
          ...buildMetadata("deterministic_advisory_fallback"),
        };
      } catch (error: any) {
        toolTrace.push(
          buildToolTraceEntry({
            toolName: "tool_first_router",
            phase: "plan",
            status: "failed",
            startedAt,
            summary: error?.message || `Deterministic advisory fallback failed after ${reason}.`,
          }),
        );
        return null;
      }
    };

    for (let pass = 0; pass < MAX_MODEL_PASSES; pass += 1) {
      const startedAt = Date.now();
      let assistantMessage: AssistantMessage;

      try {
        assistantMessage = await callAgentModel({
          profile: input.profile,
          secret: input.secret,
          systemPrompt: [
            "You are Sportfolio Operator.",
            input.request.profile.systemPrompt || null,
            "Use the available Hermes tools directly when you need account, market, or news context.",
            "If you select a tool, return valid JSON arguments that satisfy the tool schema.",
            "Call at most one tool at a time. If you already have enough information, answer directly in plain text.",
            ...internalMlbGroundingRules,
            repairReason ? `Repair instruction: ${repairReason}` : null,
            compressionApplied
              ? "Context may be compressed. Avoid repeating old searches or rereading already returned tool data unless the user explicitly asks."
              : null,
          ]
            .filter(Boolean)
            .join(" "),
          messages,
          tools: tools.map((tool) => ({
            name: tool.toolName,
            description: buildToolDescription(tool),
            parameters: (tool.inputSchema || noArgsSchema) as Record<string, unknown>,
          })),
          temperature: clampTemperature(input.profile),
          maxTokens: clampMaxTokens(input.profile),
        });
      } catch (error: any) {
        providerFailureClass = classifyAgentProviderFailure(error);

        if (providerFailureClass === "context_overflow" && compressionLevel < 2) {
          const previousLevel = compressionLevel;
          compressionLevel = previousLevel === 0 ? 1 : 2;
          compressionApplied = true;
          repairAttempts += 1;
          repairReason =
            "Continue from the compressed context only. Use the latest context and do not repeat prior tool calls unless still necessary.";
          messages = rebuildLoopMessages({
            request: input.request,
            matchedSkill: input.matchedSkill,
            tools,
            compressionLevel,
            messages,
          });
          toolTrace.push(
            buildToolTraceEntry({
              toolName: "model_context_compression",
              phase: "plan",
              status: "ok",
              startedAt,
              summary:
                previousLevel === 0
                  ? "Compressed the context after the provider rejected the initial payload."
                  : "Escalated to the tightest context budget after another provider overflow.",
              details: {
                fromLevel: previousLevel,
                toLevel: compressionLevel,
                providerFailureClass,
              },
            }),
          );
          continue;
        }

        if (providerFailureClass === "transient" && !usedTransientRetry) {
          usedTransientRetry = true;
          warnings.push("The provider returned a transient error. Hermes retried the turn once.");
          toolTrace.push(
            buildToolTraceEntry({
              toolName: "model_provider_retry",
              phase: "plan",
              status: "skipped",
              startedAt,
              summary: "Retried once after a transient provider failure.",
              details: {
                providerFailureClass,
              },
            }),
          );
          continue;
        }

        const errorMessage = error?.message || "The model tool loop failed.";
        toolTrace.push(
          buildToolTraceEntry({
            toolName: "model_tool_loop",
            phase: "plan",
            status: "failed",
            startedAt,
            summary: errorMessage,
            details: {
              providerFailureClass,
            },
          }),
        );

        return {
          outcome: "error",
          errorMessage,
          warnings,
          citations,
          toolTrace,
          ...(finalUsage ? { usage: finalUsage } : {}),
          ...buildMetadata("provider_error"),
        };
      }

      finalUsage = summarizeUsage(assistantMessage);
      usedTransientRetry = false;

      const toolCalls = extractToolCalls(assistantMessage);
      const assistantText = extractAssistantText(assistantMessage);

      if (toolCalls.length === 0) {
        if (assistantText && requestedPlanningIntent) {
          const recoveredPlan = await attemptPlanOnlyRecovery(
            "the model answered in prose despite an explicit staged-action request",
          );
          if (recoveredPlan) {
            return recoveredPlan;
          }
        }

        if (assistantText) {
          toolTrace.push(
            buildToolTraceEntry({
              toolName: "model_tool_loop",
              phase: "plan",
              status: "ok",
              startedAt,
              summary:
                toolCallsUsed > 0
                  ? `The model answered after ${toolCallsUsed} direct Hermes tool call(s).`
                  : "The model answered directly without needing a tool.",
            }),
          );

          return {
            outcome: "answer",
            replyText: assistantText,
            summary:
              toolCallsUsed > 0
                ? `Model answered after ${toolCallsUsed} Hermes tool call(s).`
                : "Model answered directly.",
            warnings,
            citations,
            toolTrace,
            ...(lastSuccessfulToolUiBlocks.length > 0
              ? { uiBlocks: lastSuccessfulToolUiBlocks }
              : {}),
            ...(finalUsage ? { usage: finalUsage } : {}),
            ...buildMetadata(toolCallsUsed > 0 ? "answered_after_tool_use" : "answered_directly"),
          };
        }

        if (!repairReason) {
          repairReason =
            "You must either answer directly in plain text or call exactly one available Hermes tool.";
          repairAttempts += 1;
          toolTrace.push(
            buildToolTraceEntry({
              toolName: "model_tool_repair_retry",
              phase: "plan",
              status: "skipped",
              startedAt,
              summary:
                "The model returned no visible answer and no usable tool call. Retrying once.",
            }),
          );
          continue;
        }

        if (requestedPlanningIntent) {
          const recoveredPlan = await attemptPlanOnlyRecovery(
            "the provider returned no visible answer or usable tool call after the repair retry",
          );
          if (recoveredPlan) {
            return recoveredPlan;
          }
        }

        const advisoryFallback = await attemptDeterministicAdvisoryFallback(
          "the provider returned no visible answer or usable tool call after the repair retry",
        );
        if (advisoryFallback) {
          return advisoryFallback;
        }

        if (!providerFailureClass) {
          providerFailureClass = "malformed_response";
        }

        if (lastSuccessfulToolReply) {
          return {
            outcome: "unsupported",
            replyText: lastSuccessfulToolReply,
            summary:
              lastSuccessfulToolName != null
                ? `Returned the latest ${lastSuccessfulToolName} result after the provider stopped responding.`
                : "Returned the latest Hermes tool result after the provider stopped responding.",
            warnings: [
              ...warnings,
              "The provider returned neither a visible answer nor a valid tool call after one repair retry, so Hermes returned the latest successful tool result directly.",
            ],
            citations,
            toolTrace,
            ...(lastSuccessfulToolUiBlocks.length > 0
              ? { uiBlocks: lastSuccessfulToolUiBlocks }
              : {}),
            ...(finalUsage ? { usage: finalUsage } : {}),
            ...buildMetadata("empty_provider_response"),
          };
        }

        return {
          outcome: "unsupported",
          replyText: null,
          summary: "The model returned an empty response twice.",
          warnings: [
            ...warnings,
            "The provider returned neither a visible answer nor a valid tool call after one repair retry.",
          ],
          citations,
          toolTrace,
          ...(finalUsage ? { usage: finalUsage } : {}),
          ...buildMetadata("empty_provider_response"),
        };
      }

      const toolCall = toolCalls[0];
      if (toolCalls.length > 1) {
        warnings.push(
          `The model returned ${toolCalls.length} tool calls in one pass. Only the first tool call was executed.`,
        );
      }

      const selectedToolLookup = findSelectedTool(tools, toolCall.name);
      const selectedTool = selectedToolLookup.tool;
      messages.push(assistantMessage);

      if (!selectedTool) {
        const toolResultMessage: Message = {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [
            {
              type: "text",
              text: `The tool ${toolCall.name} is not available on this turn. Choose another available tool or answer directly.`,
            },
          ],
          isError: true,
          timestamp: Date.now(),
        } as Message;
        messages.push(toolResultMessage);
        warnings.push(`The model selected unavailable tool ${toolCall.name}.`);

        if (!repairReason) {
          repairReason =
            "Do not call unavailable tools. Choose one listed tool or answer directly.";
          repairAttempts += 1;
          continue;
        }

        return {
          outcome: "unsupported",
          replyText: null,
          summary: "The model selected an unavailable tool.",
          warnings,
          citations,
          toolTrace,
          ...(finalUsage ? { usage: finalUsage } : {}),
          ...buildMetadata("unavailable_tool"),
        };
      }

      if (selectedToolLookup.repaired) {
        repairAttempts += 1;
        toolTrace.push(
          buildToolTraceEntry({
            toolName: "model_tool_repair_retry",
            phase: "plan",
            status: "ok",
            startedAt: Date.now(),
            summary: `Normalized tool name ${toolCall.name} to ${selectedTool.toolName}.`,
            details: {
              requestedToolName: toolCall.name,
              normalizedToolName: selectedTool.toolName,
            },
          }),
        );
      }

      let normalizedArgs = normalizeArgs(selectedTool, input.request, toolCall.arguments);
      const validation = validateToolArgs(selectedTool, normalizedArgs);
      normalizedArgs = validation.normalizedArgs;

      if (validation.repaired) {
        repairAttempts += 1;
        toolTrace.push(
          buildToolTraceEntry({
            toolName: "model_tool_repair_retry",
            phase: "plan",
            status: "ok",
            startedAt: Date.now(),
            summary: `Normalized arguments for ${selectedTool.toolName}.`,
            details: {
              notes: validation.notes,
            },
          }),
        );
      }

      if (!validation.valid) {
        const note = validation.notes.join(" ");
        warnings.push(`The model provided invalid arguments for ${selectedTool.toolName}. ${note}`);
        messages.push({
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: selectedTool.toolName,
          content: [
            {
              type: "text",
              text: `${selectedTool.toolName} arguments were invalid: ${note}`,
            },
          ],
          isError: true,
          timestamp: Date.now(),
        } as Message);

        if (!repairReason) {
          repairReason = `Return the same tool only if you can provide valid arguments. ${note}`;
          repairAttempts += 1;
          toolTrace.push(
            buildToolTraceEntry({
              toolName: "model_tool_repair_retry",
              phase: "plan",
              status: "skipped",
              startedAt: Date.now(),
              summary: `Rejected invalid arguments for ${selectedTool.toolName} and requested a repaired tool call.`,
              details: {
                notes: validation.notes,
              },
            }),
          );
          continue;
        }

        return {
          outcome: "unsupported",
          replyText: null,
          summary: `The model provided invalid arguments for ${selectedTool.toolName}.`,
          warnings,
          citations,
          toolTrace,
          ...(finalUsage ? { usage: finalUsage } : {}),
          ...buildMetadata("invalid_tool_arguments"),
        };
      }

      if (selectedTool.category === "plan") {
        if (
          !canProceedWithPlanTool({
            request: input.request,
            args: normalizedArgs,
          })
        ) {
          const note = `The user message is advisory-level and not explicit enough to stage ${selectedTool.toolName}. Use read/scan tools first, then provide strategy guidance or ask one concise clarification if needed.`;
          warnings.push(note);
          messages.push({
            role: "toolResult",
            toolCallId: toolCall.id,
            toolName: selectedTool.toolName,
            content: [
              {
                type: "text",
                text: note,
              },
            ],
            isError: true,
            timestamp: Date.now(),
          } as Message);
          repairAttempts += 1;
          toolTrace.push(
            buildToolTraceEntry({
              toolName: "model_tool_repair_retry",
              phase: "plan",
              status: "skipped",
              startedAt: Date.now(),
              summary: `Rejected premature plan tool ${selectedTool.toolName} for an advisory request and requested a safer reroute.`,
            }),
          );
          continue;
        }

        toolTrace.push(
          buildToolTraceEntry({
            toolName: "model_tool_loop",
            phase: "plan",
            status: "ok",
            startedAt,
            summary: `The model selected ${selectedTool.toolName} for confirmation-gated planning.`,
          }),
        );

        return {
          outcome: "tool",
          toolName: selectedTool.toolName,
          toolCategory: "plan",
          toolArgs: normalizedArgs,
          summary: `The model selected ${selectedTool.toolName}.`,
          warnings,
          citations,
          toolTrace,
          ...(finalUsage ? { usage: finalUsage } : {}),
          ...buildMetadata("plan_tool_selected"),
        };
      }

      if (toolCallsUsed >= MAX_TOOL_CALLS) {
        const recoveredPlan = await attemptPlanOnlyRecovery("the Hermes tool budget was exhausted");
        if (recoveredPlan) {
          return recoveredPlan;
        }

        const synthesized = await attemptAnswerOnlySynthesis(
          "the Hermes tool budget was exhausted",
        );
        if (synthesized) {
          return synthesized;
        }

        return {
          outcome: "unsupported",
          replyText: null,
          summary: "The model exhausted the Hermes tool budget before answering.",
          warnings: [...warnings, "The model hit the maximum Hermes tool call budget."],
          citations,
          toolTrace,
          ...(finalUsage ? { usage: finalUsage } : {}),
          ...buildMetadata("tool_budget_exhausted"),
        };
      }

      toolCallsUsed += 1;
      const toolStartedAt = Date.now();

      try {
        const toolResult = await executeNonPlanningTool({
          tool: selectedTool,
          userId: input.request.userId,
          threadId: input.request.threadId,
          args: normalizedArgs,
        });

        citations.push(...collectCitations(toolResult));
        const toolUiBlocks = buildToolResultUiBlocks({
          tool: selectedTool,
          result: toolResult,
          conversationMode: input.request.conversationMode,
        });
        const toolResultText = buildToolResultText(selectedTool, toolResult);
        const toolFallbackText = buildToolFallbackText(selectedTool, toolResult);
        lastSuccessfulToolName = selectedTool.toolName;
        lastSuccessfulToolReply = toolFallbackText;
        lastSuccessfulToolUiBlocks = toolUiBlocks;
        successfulToolContexts.push({
          toolName: selectedTool.toolName,
          text: toolResultText,
        });
        toolTrace.push(
          buildToolTraceEntry({
            toolName: selectedTool.toolName,
            phase:
              selectedTool.category === "read" && selectedTool.toolName === "get_hosted_research"
                ? "research"
                : selectedTool.category,
            status: "ok",
            startedAt: toolStartedAt,
            summary: `Executed ${selectedTool.toolName} in the model tool loop.`,
          }),
        );

        const toolResultMessage: Message = {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: selectedTool.toolName,
          content: [
            {
              type: "text",
              text: toolResultText,
            },
          ],
          details:
            toolResult && typeof toolResult === "object"
              ? { result: JSON.parse(JSON.stringify(toolResult)) }
              : { result: toolResult },
          isError: false,
          timestamp: Date.now(),
        } as Message;
        messages.push(toolResultMessage);
        repairReason = null;
      } catch (error: any) {
        const errorMessage = error?.message || `${selectedTool.toolName} failed.`;
        warnings.push(errorMessage);
        toolTrace.push(
          buildToolTraceEntry({
            toolName: selectedTool.toolName,
            phase:
              selectedTool.category === "read" && selectedTool.toolName === "get_hosted_research"
                ? "research"
                : selectedTool.category,
            status: "failed",
            startedAt: toolStartedAt,
            summary: errorMessage,
          }),
        );

        const toolResultMessage: Message = {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: selectedTool.toolName,
          content: [
            {
              type: "text",
              text: `${selectedTool.toolName} failed: ${errorMessage}`,
            },
          ],
          isError: true,
          timestamp: Date.now(),
        } as Message;
        messages.push(toolResultMessage);

        if (!repairReason) {
          repairReason =
            "Recover by using another valid tool if needed, or answer directly from the available context.";
          repairAttempts += 1;
        }
      }
    }

    const recoveredPlan = await attemptPlanOnlyRecovery(
      "the model tool loop reached its pass limit",
    );
    if (recoveredPlan) {
      return recoveredPlan;
    }

    const advisoryFallback = await attemptDeterministicAdvisoryFallback(
      "the model tool loop reached its pass limit",
    );
    if (advisoryFallback) {
      return advisoryFallback;
    }

    const synthesized = await attemptAnswerOnlySynthesis(
      "the model tool loop reached its pass limit",
    );
    if (synthesized) {
      return synthesized;
    }

    return {
      outcome: "unsupported",
      replyText: null,
      summary: "The model tool loop reached its pass limit before finishing.",
      warnings: [...warnings, "The model exhausted the maximum number of model passes."],
      citations,
      toolTrace,
      ...(finalUsage ? { usage: finalUsage } : {}),
      ...buildMetadata("model_pass_limit"),
    };
  } catch (error: any) {
    return {
      outcome: "error",
      errorMessage: error?.message || "The model tool loop failed.",
      warnings,
      citations,
      toolTrace,
      terminationReason: "loop_exception",
      compressionApplied,
      repairAttempts,
      providerFailureClass,
    };
  }
}

export const runModelFirstToolRouter = runHermesModelToolLoop;
