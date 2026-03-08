import { Type } from "@sinclair/typebox";
import type { AgentToolDefinition } from "./types";

const noArgsSchema = Type.Object({}, { additionalProperties: false });
const flexibleObjectSchema = Type.Object({}, { additionalProperties: true });
const optionalMessageSchema = Type.Object(
  {
    message: Type.Optional(Type.String({ minLength: 1, maxLength: 1200 })),
  },
  { additionalProperties: true },
);
const optionalSportDateSchema = Type.Object(
  {
    message: Type.Optional(Type.String({ minLength: 1, maxLength: 1200 })),
    sport: Type.Optional(Type.String({ minLength: 2, maxLength: 16 })),
    date: Type.Optional(Type.String({ minLength: 4, maxLength: 32 })),
  },
  { additionalProperties: true },
);
const playerIdSchema = Type.Object(
  {
    playerId: Type.String({ minLength: 1, maxLength: 160 }),
  },
  { additionalProperties: true },
);
const playerIdLimitSchema = Type.Object(
  {
    playerId: Type.String({ minLength: 1, maxLength: 160 }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: true },
);
const limitSportSchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    sport: Type.Optional(Type.String({ minLength: 2, maxLength: 16 })),
  },
  { additionalProperties: true },
);
const quoteSchema = Type.Object(
  {
    playerId: Type.String({ minLength: 1, maxLength: 160 }),
    type: Type.String({ minLength: 3, maxLength: 8 }),
    amount: Type.Number({ exclusiveMinimum: 0 }),
  },
  { additionalProperties: true },
);
const pendingBundleSchema = Type.Object(
  {
    threadId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    message: Type.Optional(Type.String({ minLength: 1, maxLength: 1200 })),
  },
  { additionalProperties: true },
);
const timeRangeSchema = Type.Object(
  {
    timeRange: Type.Optional(
      Type.Union([
        Type.Literal("1D"),
        Type.Literal("7D"),
        Type.Literal("1M"),
        Type.Literal("1Y"),
        Type.Literal("ALL"),
      ]),
    ),
  },
  { additionalProperties: true },
);

function cloneTool(entry: AgentToolDefinition): AgentToolDefinition {
  return {
    ...entry,
    whenToUse: [...entry.whenToUse],
    whenNotToUse: [...entry.whenNotToUse],
    examplePrompts: [...entry.examplePrompts],
    inputSchema: entry.inputSchema
      ? (JSON.parse(JSON.stringify(entry.inputSchema)) as Record<string, unknown>)
      : null,
    autoContextArgs: [...(entry.autoContextArgs || [])],
  };
}

function defineTool(input: AgentToolDefinition): AgentToolDefinition {
  return {
    ...input,
    whenToUse: [...input.whenToUse],
    whenNotToUse: [...input.whenNotToUse],
    examplePrompts: [...input.examplePrompts],
    inputSchema: input.inputSchema || noArgsSchema,
    resultShapeHint: input.resultShapeHint || null,
    autoContextArgs: [...(input.autoContextArgs || [])],
    exposure: input.exposure || "default",
    supportsSequentialUse: input.supportsSequentialUse ?? true,
    auditPriority: input.auditPriority || "normal",
  };
}

const CORE_TOOL_CATALOG: AgentToolDefinition[] = [
  defineTool({
    toolName: "get_tool_catalog",
    category: "read",
    description: "List the current Hermes tool surface for this turn.",
    whenToUse: ["The user asks what Hermes can do right now."],
    whenNotToUse: [],
    examplePrompts: ["what can you do right now?"],
    requiresConfirmation: false,
    riskLevel: "low",
    auditPriority: "high",
  }),
  defineTool({
    toolName: "get_portfolio_summary",
    category: "read",
    description: "Read a broad portfolio summary with ranked targets and operator state.",
    whenToUse: ["The user wants a full portfolio review before acting."],
    whenNotToUse: [],
    examplePrompts: ["how does my portfolio look right now?"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: optionalSportDateSchema,
    autoContextArgs: ["message", "sport"],
    auditPriority: "critical",
  }),
  defineTool({
    toolName: "get_operator_overview",
    category: "read",
    description: "Read the main account-level operator overview.",
    whenToUse: ["The user wants a high-level state read."],
    whenNotToUse: [],
    examplePrompts: ["talk me through my setup"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: optionalSportDateSchema,
    autoContextArgs: ["message", "sport"],
    auditPriority: "critical",
  }),
  defineTool({
    toolName: "get_balance_state",
    category: "read",
    description: "Read available cash balance and nearby leverage context.",
    whenToUse: ["The user asks what to do with cash or how much is available."],
    whenNotToUse: [],
    examplePrompts: ["what should i spend my cash on?"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: optionalSportDateSchema,
    autoContextArgs: ["message", "sport"],
    auditPriority: "critical",
  }),
  defineTool({
    toolName: "get_holdings",
    category: "read",
    description: "Read current holdings, multiplier state, and available shares.",
    whenToUse: ["The user asks what they own or wants holdings-specific advice."],
    whenNotToUse: [],
    examplePrompts: ["what nascar holdings do i have right now?"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: limitSportSchema,
    auditPriority: "critical",
  }),
  defineTool({
    toolName: "get_watchlists",
    category: "read",
    description: "Read the user's watchlists.",
    whenToUse: ["The user asks about tracked players."],
    whenNotToUse: [],
    examplePrompts: ["what names am i tracking?"],
    requiresConfirmation: false,
    riskLevel: "low",
  }),
  defineTool({
    toolName: "get_player_detail",
    category: "read",
    description: "Read full player detail, market context, and user holding state.",
    whenToUse: ["The user wants a deep dive on one player."],
    whenNotToUse: [],
    examplePrompts: ["tell me about this player before i buy"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: playerIdLimitSchema,
    auditPriority: "critical",
  }),
  defineTool({
    toolName: "get_player_market_context",
    category: "read",
    description: "Read market-specific context for one player.",
    whenToUse: ["The user wants price and trend context for one player."],
    whenNotToUse: [],
    examplePrompts: ["what does the market look like for this player?"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: playerIdLimitSchema,
    auditPriority: "critical",
  }),
  defineTool({
    toolName: "get_player_recent_games",
    category: "read",
    description: "Read recent game logs for one player.",
    whenToUse: ["The user asks how a player has performed lately."],
    whenNotToUse: [],
    examplePrompts: ["how has this player done lately?"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: playerIdLimitSchema,
  }),
  defineTool({
    toolName: "get_player_financial_metrics",
    category: "read",
    description: "Read price and financial metrics for one player.",
    whenToUse: ["The user asks about player price movement or market metrics."],
    whenNotToUse: [],
    examplePrompts: ["show me this player's market metrics"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: playerIdSchema,
  }),
  defineTool({
    toolName: "get_player_shares_info",
    category: "read",
    description: "Read share pricing and share structure for one player.",
    whenToUse: ["The user asks about shares or market-cap style context."],
    whenNotToUse: [],
    examplePrompts: ["what does this player's share structure look like?"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: playerIdSchema,
  }),
  defineTool({
    toolName: "get_daily_boost_state",
    category: "read",
    description: "Read current daily boost assignments and open slots.",
    whenToUse: ["The user asks about their boost board."],
    whenNotToUse: [],
    examplePrompts: ["what do my boost slots look like today?"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: optionalSportDateSchema,
    autoContextArgs: ["sport", "date"],
  }),
  defineTool({
    toolName: "get_daily_boost_eligibility",
    category: "read",
    description: "Read which holdings are eligible for a daily boost window.",
    whenToUse: ["The user asks who can go in a boost slot."],
    whenNotToUse: [],
    examplePrompts: ["who can i put in my boost slots tonight?"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: optionalSportDateSchema,
    autoContextArgs: ["sport", "date"],
    auditPriority: "critical",
  }),
  defineTool({
    toolName: "get_community_boost_state",
    category: "read",
    description: "Read current community boost availability and live state.",
    whenToUse: ["The user asks about community boosts."],
    whenNotToUse: [],
    examplePrompts: ["what can i do with my community boosts?"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: optionalSportDateSchema,
    autoContextArgs: ["date"],
  }),
  defineTool({
    toolName: "get_pending_bundle",
    category: "read",
    description: "Read the staged pending bundle on the active thread.",
    whenToUse: ["The user asks what is pending right now."],
    whenNotToUse: [],
    examplePrompts: ["what do i currently have queued?"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: pendingBundleSchema,
    autoContextArgs: ["threadId"],
  }),
  defineTool({
    toolName: "get_trade_history",
    category: "read",
    description: "Read recent trade history, optionally filtered by sport.",
    whenToUse: ["The user asks what they have traded lately."],
    whenNotToUse: [],
    examplePrompts: ["what have i traded lately?"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: limitSportSchema,
  }),
  defineTool({
    toolName: "get_portfolio_history",
    category: "read",
    description: "Read portfolio snapshots over time.",
    whenToUse: ["The user asks how the portfolio has changed over time."],
    whenNotToUse: [],
    examplePrompts: ["how has my portfolio moved this month?"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: timeRangeSchema,
  }),
  defineTool({
    toolName: "get_amm_pool_state",
    category: "read",
    description: "Read AMM pool state for one player market.",
    whenToUse: ["The user wants liquidity context before trading."],
    whenNotToUse: [],
    examplePrompts: ["show me the pool for this player"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: playerIdSchema,
    auditPriority: "high",
  }),
  defineTool({
    toolName: "get_amm_trade_quote",
    category: "read",
    description: "Read a buy or sell quote for one player market.",
    whenToUse: ["The user wants a quote before placing a trade."],
    whenNotToUse: [],
    examplePrompts: ["quote a buy for this player"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: quoteSchema,
    auditPriority: "critical",
  }),
  defineTool({
    toolName: "get_lp_positions",
    category: "read",
    description: "Read all LP positions for the user.",
    whenToUse: ["The user asks about liquidity positions."],
    whenNotToUse: [],
    examplePrompts: ["what liquidity positions do i have?"],
    requiresConfirmation: false,
    riskLevel: "low",
  }),
  defineTool({
    toolName: "get_lp_position",
    category: "read",
    description: "Read one LP position by player market.",
    whenToUse: ["The user asks about one liquidity position."],
    whenNotToUse: [],
    examplePrompts: ["show me my LP position for this player"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: playerIdSchema,
  }),
  defineTool({
    toolName: "get_lp_history",
    category: "read",
    description: "Read LP transaction history.",
    whenToUse: ["The user asks about prior liquidity activity."],
    whenNotToUse: [],
    examplePrompts: ["show me my LP history"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: Type.Object(
      {
        playerId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      },
      { additionalProperties: true },
    ),
  }),
  defineTool({
    toolName: "get_user_schedules",
    category: "read",
    description: "Read the user's advisory schedules.",
    whenToUse: ["The user asks about scheduled agent nudges."],
    whenNotToUse: [],
    examplePrompts: ["what agent schedules do i have?"],
    requiresConfirmation: false,
    riskLevel: "low",
  }),
  defineTool({
    toolName: "get_schedule_templates",
    category: "read",
    description: "Read the supported schedule templates.",
    whenToUse: ["The user asks what recurring jobs Hermes can schedule."],
    whenNotToUse: [],
    examplePrompts: ["what can i schedule?"],
    requiresConfirmation: false,
    riskLevel: "low",
  }),
  defineTool({
    toolName: "get_hosted_research",
    category: "read",
    description: "Run hosted research for external time-sensitive context.",
    whenToUse: ["The user asks about current news or outside developments."],
    whenNotToUse: [],
    examplePrompts: ["what changed today that affects my setup?"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: optionalMessageSchema,
    autoContextArgs: ["message"],
  }),
  defineTool({
    toolName: "list_user_memories",
    category: "read",
    description: "Read durable user memory that matters for this turn.",
    whenToUse: ["The user asks what Hermes remembers."],
    whenNotToUse: [],
    examplePrompts: ["what do you remember about how i like to play?"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: Type.Object(
      {
        query: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
      },
      { additionalProperties: true },
    ),
    autoContextArgs: ["query"],
  }),
  defineTool({
    toolName: "search_user_memories",
    category: "read",
    description: "Search durable user memory with the current request.",
    whenToUse: ["The user asks about a remembered preference or prior goal."],
    whenNotToUse: [],
    examplePrompts: ["do you remember my risk preference?"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: Type.Object(
      {
        query: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
      },
      { additionalProperties: true },
    ),
    autoContextArgs: ["query"],
  }),
  defineTool({
    toolName: "get_user_memory_context",
    category: "read",
    description: "Read the structured memory context for the current request.",
    whenToUse: ["Hermes needs memory context before answering."],
    whenNotToUse: [],
    examplePrompts: ["what memory context matters for this request?"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: Type.Object(
      {
        query: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
      },
      { additionalProperties: true },
    ),
    autoContextArgs: ["query"],
  }),
  defineTool({
    toolName: "preview_direct_operation",
    category: "plan",
    description: "Preview one concrete user command as a confirmation-ready action.",
    whenToUse: ["The user gives one direct action request."],
    whenNotToUse: [],
    examplePrompts: ["buy $25 of Austin Hill"],
    requiresConfirmation: true,
    riskLevel: "medium",
    inputSchema: optionalMessageSchema,
    autoContextArgs: ["message"],
    supportsSequentialUse: false,
    auditPriority: "critical",
  }),
  defineTool({
    toolName: "preview_multi_action_bundle",
    category: "plan",
    description: "Preview a compound multi-step workflow as one pending bundle.",
    whenToUse: ["The user asks for multiple linked actions in one request."],
    whenNotToUse: [],
    examplePrompts: ["buy, stack shares, then boost this player"],
    requiresConfirmation: true,
    riskLevel: "high",
    inputSchema: optionalMessageSchema,
    autoContextArgs: ["message"],
    supportsSequentialUse: false,
    auditPriority: "critical",
  }),
  defineTool({
    toolName: "stage_action_bundle",
    category: "action",
    description: "Send a concrete action request through the staged confirmation flow.",
    whenToUse: ["The user wants the backend to stage a real bundle now."],
    whenNotToUse: [],
    examplePrompts: ["queue a buy for this player"],
    requiresConfirmation: true,
    riskLevel: "medium",
    inputSchema: pendingBundleSchema,
    autoContextArgs: ["message", "threadId"],
    supportsSequentialUse: false,
    auditPriority: "high",
  }),
  defineTool({
    toolName: "confirm_pending_bundle",
    category: "action",
    description: "Confirm the currently pending bundle on the active thread.",
    whenToUse: ["The user explicitly approves a staged plan."],
    whenNotToUse: [],
    examplePrompts: ["confirm that"],
    requiresConfirmation: false,
    riskLevel: "high",
    inputSchema: pendingBundleSchema,
    autoContextArgs: ["threadId"],
    supportsSequentialUse: false,
  }),
  defineTool({
    toolName: "cancel_pending_bundle",
    category: "action",
    description: "Cancel the currently pending bundle on the active thread.",
    whenToUse: ["The user explicitly rejects a staged plan."],
    whenNotToUse: [],
    examplePrompts: ["cancel that"],
    requiresConfirmation: false,
    riskLevel: "low",
    inputSchema: pendingBundleSchema,
    autoContextArgs: ["threadId"],
    supportsSequentialUse: false,
  }),
];

const CATEGORY_FALLBACKS: Record<string, AgentToolDefinition["category"]> = {
  read: "read",
  scan: "scan",
  preview: "plan",
  create: "action",
  update: "action",
  delete: "action",
  add: "action",
  remove: "action",
  confirm: "action",
  cancel: "action",
  stage: "action",
  list: "read",
  search: "read",
  write: "memory",
  supersede: "memory",
  archive: "memory",
  propose: "memory",
};

function inferCategory(toolName: string): AgentToolDefinition["category"] {
  const prefix = toolName.split("_")[0] || toolName;
  return CATEGORY_FALLBACKS[prefix] || "read";
}

function buildFallbackTool(toolName: string): AgentToolDefinition {
  const category = inferCategory(toolName);
  const requiresConfirmation = category === "plan" || toolName.includes("confirm_pending_bundle");

  return defineTool({
    toolName,
    category,
    description: `Use the ${toolName} capability inside Hermes.`,
    whenToUse: [`Use ${toolName} when it cleanly matches the user's request.`],
    whenNotToUse: [],
    examplePrompts: [],
    requiresConfirmation,
    riskLevel: requiresConfirmation ? "medium" : "low",
    inputSchema:
      category === "plan" || category === "action" ? flexibleObjectSchema : optionalMessageSchema,
    autoContextArgs:
      category === "plan" || category === "action"
        ? ["message", "threadId"]
        : category === "read" || category === "scan"
          ? ["message"]
          : [],
    exposure: toolName === "respond_to_user_turn" ? "hidden_fallback" : "default",
  });
}

export function getCoreHermesToolCatalog(): AgentToolDefinition[] {
  return CORE_TOOL_CATALOG.map(cloneTool);
}

export function resolveHermesToolCatalog(input: {
  toolAllowlist?: string[];
  toolCatalog?: AgentToolDefinition[];
  includeHiddenFallback?: boolean;
}): AgentToolDefinition[] {
  const merged = new Map<string, AgentToolDefinition>();

  for (const entry of input.toolCatalog || []) {
    merged.set(entry.toolName, defineTool(entry));
  }

  for (const entry of CORE_TOOL_CATALOG) {
    merged.set(entry.toolName, entry);
  }

  const names =
    input.toolAllowlist && input.toolAllowlist.length > 0
      ? [...new Set(input.toolAllowlist)]
      : [...merged.keys()];

  return names
    .map((toolName) => merged.get(toolName) || buildFallbackTool(toolName))
    .filter((entry) =>
      input.includeHiddenFallback
        ? entry.exposure !== "internal_only"
        : entry.exposure !== "hidden_fallback" && entry.exposure !== "internal_only",
    )
    .map(cloneTool);
}

export function getDefaultHermesToolAllowlist(includeAdvanced = true): string[] {
  return resolveHermesToolCatalog({})
    .filter((entry) => includeAdvanced || entry.exposure !== "advanced")
    .map((entry) => entry.toolName);
}
