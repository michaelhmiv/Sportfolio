import type { AgentAction, AgentStrategyRecord } from "./types";

export const DEFAULT_AUTONOMOUS_STRATEGY_ACTION_TYPES = [
  "scout_set_count",
  "pool_buy",
  "pool_sell",
  "pool_add_liquidity",
  "pool_add_liquidity_optimal",
  "pool_zap_add_shares",
  "pool_zap_add_sb",
  "pool_remove_liquidity",
  "holdings_stack_shares",
  "daily_boost_assign",
  "daily_boost_remove",
  "watchlist_add_player",
  "watchlist_remove_player",
] as const satisfies readonly AgentAction["actionType"][];

const BROAD_MANDATE_PATTERNS = [
  /\bbest\b/i,
  /\btop\b/i,
  /\bhighest\b/i,
  /\bstrongest\b/i,
  /\bthroughout\s+this\s+week\b/i,
  /\bthis\s+week\b/i,
  /\bevery\s+(day|morning|night|week)\b/i,
  /\bduring\s+the\s+week\b/i,
  /\bthroughout\s+the\s+week\b/i,
  /\bkeep\s+buying\b/i,
];

const DEFAULT_STRATEGY_GUARDRAILS = {
  maxActionsPerRun: 3,
  maxActionsPerDay: 8,
  maxBuyActionsPerPlayerPerRun: 1,
  minDistinctPlayersForMultiBuyRun: 2,
} as const satisfies Record<string, number>;

function toFinitePositiveInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function buildDefaultStrategyGuardrails(
  overrides: Record<string, unknown> | null | undefined = {},
) {
  return {
    ...DEFAULT_STRATEGY_GUARDRAILS,
    ...toRecord(overrides),
  } satisfies Record<string, unknown>;
}

export function isBroadStrategyMandate(mandateText: string | null | undefined) {
  const normalized = (mandateText || "").trim();
  if (!normalized) {
    return false;
  }

  return BROAD_MANDATE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function buildStrategyAutonomyPolicyLines(input: {
  mandateText: string | null | undefined;
  guardrails?: Record<string, unknown> | null | undefined;
  allowedActionTypes?: AgentAction["actionType"][] | null | undefined;
}) {
  const broadMandate = isBroadStrategyMandate(input.mandateText);
  const guardrails = buildDefaultStrategyGuardrails(input.guardrails);
  const actionScope = input.allowedActionTypes || DEFAULT_AUTONOMOUS_STRATEGY_ACTION_TYPES;

  const lines = [
    `Autonomous scope: ${actionScope.join(", ")}.`,
    "Never use community boosts, premium-share flows, checkout, add-cash, Whop, or any other purchase-like flow.",
    "Use only product-owned gameplay tools and the saved hard caps; do not invent unsupported actions.",
  ];

  if (broadMandate) {
    lines.push(
      "Treat broad mandates as portfolio-management tasks, not literal one-trade instructions.",
      "Prefer a diversified set of qualified players over repeatedly buying one name when multiple names satisfy the mandate.",
      "Do not spend the full budget in one run unless the saved rules explicitly require concentration.",
      "If the mandate spans multiple days, pace entries across future runs instead of exhausting capital immediately.",
      "If only one player clearly qualifies, explain why concentration was necessary instead of silently over-concentrating.",
      "Do not place tiny token buys just to satisfy the mandate; each applied action should be materially useful inside the saved caps.",
    );
  }

  if (toFinitePositiveInteger(guardrails.maxBuyActionsPerPlayerPerRun) === 1) {
    lines.push("Do not buy the same player more than once in one autonomous run.");
  }

  const minDistinctPlayers = toFinitePositiveInteger(guardrails.minDistinctPlayersForMultiBuyRun);
  if (broadMandate && minDistinctPlayers && minDistinctPlayers > 1) {
    lines.push(
      `If you choose multiple buy actions in one run, spread them across at least ${minDistinctPlayers} distinct players when the market evidence supports it.`,
    );
  }

  return {
    broadMandate,
    lines,
  };
}

export function validateBroadStrategyActionMix(input: {
  strategy: Pick<AgentStrategyRecord, "mandateText" | "guardrails">;
  actions: AgentAction[];
}) {
  if (!isBroadStrategyMandate(input.strategy.mandateText)) {
    return;
  }

  const guardrails = buildDefaultStrategyGuardrails(input.strategy.guardrails);
  const maxBuysPerPlayer = toFinitePositiveInteger(guardrails.maxBuyActionsPerPlayerPerRun);
  const minDistinctPlayers = toFinitePositiveInteger(guardrails.minDistinctPlayersForMultiBuyRun);
  const buyActions = input.actions.filter((action) => action.actionType === "pool_buy");

  if (buyActions.length === 0) {
    return;
  }

  const buyCountByPlayer = new Map<string, number>();
  for (const action of buyActions) {
    buyCountByPlayer.set(action.playerId, (buyCountByPlayer.get(action.playerId) || 0) + 1);
  }

  if (maxBuysPerPlayer) {
    for (const [playerId, count] of buyCountByPlayer.entries()) {
      if (count > maxBuysPerPlayer) {
        throw new Error(
          `Broad strategy mandates cannot buy the same player more than ${maxBuysPerPlayer} time${maxBuysPerPlayer === 1 ? "" : "s"} in one run (${playerId}).`,
        );
      }
    }
  }

  if (buyActions.length > 1 && minDistinctPlayers && buyCountByPlayer.size < minDistinctPlayers) {
    throw new Error(
      `Broad strategy mandates should spread multi-buy runs across at least ${minDistinctPlayers} distinct players when several candidates qualify.`,
    );
  }
}
