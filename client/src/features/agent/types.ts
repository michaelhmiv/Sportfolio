export type ProviderMode = "managed" | "byok";

export type AgentDomain =
  | "scouting"
  | "player_pools"
  | "daily_boosts"
  | "community_boosts"
  | "watchlists"
  | "vesting"
  | "sportfolio";

export interface AgentProfileResponse {
  profile: {
    enabled: boolean;
    providerMode: ProviderMode;
    model: string;
    baseUrl: string | null;
    userPromptTemplate: string;
    defaultSport: string | null;
  };
  secret: {
    configured: boolean;
    keyLast4: string | null;
  };
  capabilities: {
    canAnalyze: boolean;
    canAutoExecute: boolean;
    canUseWebResearch: boolean;
    webResearchProvider: "brave" | null;
  };
}

export interface AgentCitation {
  id: string;
  title: string;
  sourceName: string;
  url: string;
  publishedAt: string | null;
  retrievedAt: string;
  factSummary: string;
  relevanceScore: number;
}

export interface AgentAction {
  actionType:
    | "scout_set_count"
    | "pool_buy"
    | "pool_sell"
    | "pool_add_liquidity"
    | "pool_add_liquidity_optimal"
    | "pool_zap_add_shares"
    | "pool_zap_add_sb"
    | "pool_remove_liquidity"
    | "holdings_condense"
    | "daily_boost_assign"
    | "daily_boost_remove"
    | "watchlist_add_player"
    | "watchlist_remove_player"
    | "community_boost_create"
    | "vesting_claim";
  playerId: string;
  playerName?: string;
  status?: string;
  reasoning: string;
  confidence: number;
  targetCount?: number;
  currentCount?: number;
  evidence?: Record<string, string | null>;
  riskFlags?: string[];
  sbAmount?: number;
  availableBalanceBefore?: number | null;
  availableBalanceAfter?: number | null;
  sharesAmount?: number;
  availableSharesBefore?: number | null;
  availableSharesAfter?: number | null;
  maxSlippage?: number;
  estimatedSharesOut?: number | null;
  estimatedSbOut?: number | null;
  estimatedPricePerShare?: number | null;
  estimatedSlippagePercent?: number | null;
  shares?: number;
  playMoney?: number;
  estimatedOwnershipPercent?: number | null;
  maxShares?: number;
  maxPlayMoney?: number;
  sb?: number;
  estimatedLpSharesMinted?: number | null;
  lpShares?: number;
  currentLpShares?: number | null;
  remainingLpShares?: number | null;
  estimatedPlayMoneyOut?: number | null;
  sharesToCondense?: number;
  expectedPowerGained?: number;
  expectedPoweredShareCount?: number;
  sport?: string;
  slotTier?: 2 | 3 | 4 | 5;
  sharesEntered?: 1;
  boostDate?: string;
  gameId?: string | null;
  gameStartTime?: string | null;
  opponent?: string | null;
  availableShares?: number;
  powerLevel?: number | null;
  boostId?: string;
  watchlistId?: string | null;
  watchlistName?: string | null;
  removeFromAll?: boolean;
  communitySharesAvailable?: number;
  claimableShares?: number;
  distributionCount?: number;
  targetDescription?: string | null;
}

export interface AgentPendingClarification {
  kind: "player_name";
  prompt: string;
  missingFields: string[];
  workflowTitle?: string | null;
  workflowPreviewSteps?: string[];
}

export interface AgentActionBundle {
  id: string;
  status:
    | "pending_clarification"
    | "pending_confirmation"
    | "applied"
    | "rejected"
    | "failed"
    | "expired";
  domain: AgentDomain;
  summary: string;
  warnings: string[];
  actions: AgentAction[];
  workflowType: "single_action" | "multi_action" | "clarification";
  steps: Array<{
    id: string;
    title: string;
    status: "ready" | "needs_clarification" | "blocked" | "completed" | "failed" | "cancelled";
    action: AgentAction | null;
    clarificationPrompt?: string | null;
  }>;
  pendingClarification?: AgentPendingClarification | null;
  runId: string | null;
  createdAt: string;
  confirmedAt: string | null;
  appliedAt: string | null;
}

export interface AgentThreadSummary {
  id: string;
  title: string | null;
  channel: "in_app" | "sms";
  domain: AgentDomain;
  status: string;
  lastMessageAt: string | null;
  updatedAt: string;
  createdAt: string;
  lastMessagePreview: string | null;
  pendingActionBundle: AgentActionBundle | null;
}

export interface AgentThreadMessage {
  id: string;
  role: "user" | "assistant" | "system";
  messageType: "chat" | "plan" | "confirmation" | "result" | "error";
  contentText: string;
  createdAt: string;
  runId: string | null;
  actionBundle: AgentActionBundle | null;
  citations?: AgentCitation[] | null;
  pendingClarification?: AgentPendingClarification | null;
}

export type AgentDrawerState = "threads" | "settings" | null;
