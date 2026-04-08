import type { AgentUiBlock } from "@shared/agent-ui";
import type { AgentStrategyTimeline } from "@shared/agent-strategy";

export type ProviderMode = "managed" | "byok";

export type AgentDomain =
  | "scouting"
  | "player_pools"
  | "daily_boosts"
  | "community_boosts"
  | "watchlists"
  | "sportfolio";
export type AgentThreadWorkspace = "chat" | "strategy";

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
    dataSources?: {
      builtIn: Array<{
        id: string;
        kind: "built_in" | "external";
        name: string;
        description: string | null;
        enabled: boolean;
        available: boolean;
        capabilitySummary: string | null;
      }>;
      external: Array<{
        id: string;
        kind: "built_in" | "external";
        name: string;
        description: string | null;
        enabled: boolean;
        available: boolean;
        capabilitySummary: string | null;
      }>;
    };
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
    | "holdings_stack_shares"
    | "daily_boost_assign"
    | "daily_boost_remove"
    | "watchlist_add_player"
    | "watchlist_remove_player"
    | "community_boost_create";
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
  sharesToStack?: number;
  expectedMultiplierGained?: number;
  expectedStackedShareCount?: number;
  sport?: string;
  slotTier?: 2 | 3 | 4 | 5;
  sharesEntered?: 1;
  boostDate?: string;
  gameId?: string | null;
  gameStartTime?: string | null;
  opponent?: string | null;
  availableShares?: number;
  shareMultiplier?: number | null;
  boostId?: string;
  watchlistId?: string | null;
  watchlistName?: string | null;
  removeFromAll?: boolean;
  communitySharesAvailable?: number;
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
  workspace: AgentThreadWorkspace;
  strategyId: string | null;
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
  toolTrace?: AgentToolTrace[] | null;
  skillsUsed?: string[] | null;
  memoryInfluences?: string[] | null;
  confirmationPreview?: AgentConfirmationPreview | null;
  uiBlocks?: AgentUiBlock[] | null;
  generatedBy?: "user" | "assistant" | "hermes_schedule" | "hermes_strategy" | null;
  scheduleJobType?:
    | "daily_setup_review"
    | "pre_lock_nudge"
    | "injury_watch"
    | "idle_balance_nudge"
    | "boost_window"
    | null;
}

export type AgentDrawerState = "threads" | "settings" | null;

export interface AgentToolTrace {
  toolName: string;
  phase: "read" | "scan" | "plan" | "action" | "memory" | "research";
  status: "ok" | "failed" | "skipped";
  latencyMs: number;
  summary: string;
  details?: Record<string, unknown> | null;
}

export type AgentTurnProgressEventType =
  | "stream_connected"
  | "turn_started"
  | "model_pass_started"
  | "model_pass_completed"
  | "tool_call_started"
  | "tool_call_completed"
  | "tool_call_failed"
  | "repair_retry"
  | "turn_completed"
  | "turn_failed";

export interface AgentTurnProgressEvent {
  turnId: string;
  threadId: string;
  timestamp: string;
  eventType: AgentTurnProgressEventType;
  status: "queued" | "running" | "done" | "failed" | "info";
  summary: string;
  phase?: AgentToolTrace["phase"];
  toolName?: string | null;
  passIndex?: number;
  elapsedMs?: number | null;
  details?: Record<string, unknown> | null;
}

export interface AgentConfirmationPreview {
  actionSummary: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  estimatedImpact: string | null;
  warnings: string[];
  riskClass: "low" | "medium" | "high";
}

export interface AgentContinuityAction {
  id: string;
  title: string;
  summary: string;
  createdAt: string | null;
  source: "strategy_run" | "pending_bundle";
}

export interface AgentContinuityOpenLoop {
  id: string;
  title: string;
  summary: string;
  status: "tracking" | "waiting_on_you" | "scheduled" | "blocked";
  dueAt: string | null;
  source: "pending_bundle" | "strategy" | "schedule" | "research";
}

export interface AgentContinuityStrategy {
  strategyId: string;
  name: string;
  status: AgentStrategyStatus;
  nextRunAt: string | null;
  lastOutcomeSummary: string | null;
}

export interface AgentContinuityEvidence {
  id: string;
  title: string;
  summary: string;
  createdAt: string | null;
  sourceName: string | null;
}

export interface AgentContinuityState {
  headline: string;
  summary: string;
  recentActions: AgentContinuityAction[];
  openLoops: AgentContinuityOpenLoop[];
  activeStrategies: AgentContinuityStrategy[];
  evidenceUpdates: AgentContinuityEvidence[];
}

export interface AgentThreadObjective {
  title: string;
  status: "tracking" | "planning" | "waiting_on_you" | "completed" | "blocked";
  summary: string;
  nextStep: string | null;
  source:
    | "pending_bundle"
    | "clarification"
    | "scheduled_advisory"
    | "assistant_run"
    | "applied_result";
  updatedAt: string;
  runId: string | null;
}

export interface AgentTimelineEvent {
  id: string;
  type:
    | "user_turn"
    | "assistant_run"
    | "scheduled_advisory"
    | "research_update"
    | "plan_staged"
    | "clarification_needed"
    | "plan_applied"
    | "plan_cancelled"
    | "plan_failed";
  title: string;
  summary: string;
  status: "tracking" | "waiting_on_you" | "completed" | "blocked" | "failed" | "info";
  createdAt: string;
  runId: string | null;
  citations: AgentCitation[];
  toolTrace: AgentToolTrace[];
  skillsUsed: string[];
  memoryInfluences: string[];
  confirmationPreview: AgentConfirmationPreview | null;
}

export interface AgentDeltaSummary {
  anchorAt: string | null;
  eventCount: number;
  headline: string;
  items: Array<{
    id: string;
    title: string;
    createdAt: string;
    type: AgentTimelineEvent["type"];
  }>;
}

export interface AgentScheduleSummary {
  id: string;
  userId: string;
  jobType:
    | "daily_setup_review"
    | "pre_lock_nudge"
    | "injury_watch"
    | "idle_balance_nudge"
    | "boost_window";
  enabled: boolean;
  scheduleCron: string;
  channelTargets: Array<"in_app" | "sms" | "cli">;
  policy: Record<string, unknown>;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AgentStrategyStatus = "draft" | "live" | "paused" | "blocked" | "archived";
export type AgentStrategyReviewStatus = "pending" | "approved";

export interface AgentStrategyRunSummary {
  id: string;
  strategyId: string;
  userId: string;
  threadId: string | null;
  hermesRunId: string | null;
  runtimeSessionId: string | null;
  runtimeTransport: "local" | "sidecar" | null;
  runtimeEndpoint: string | null;
  runtimeCorrelationId: string | null;
  triggerSource: string;
  status: string;
  outcomeSummary: string | null;
  toolTrace: AgentToolTrace[];
  appliedActions: AgentAction[];
  adaptationNotes: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AgentStrategyEventSummary {
  id: string;
  strategyId: string;
  userId: string;
  strategyRunId: string | null;
  eventType: string;
  status: "info" | "success" | "warning" | "error";
  title: string;
  summary: string | null;
  eventKey: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AgentStrategyPerformancePosition {
  playerId: string;
  playerName: string | null;
  team: string | null;
  netShares: number;
  estimatedCostBasis: number;
  estimatedCurrentPrice: number | null;
  estimatedCurrentValue: number | null;
  estimatedUnrealizedPnl: number | null;
}

export interface AgentStrategyPerformanceSummary {
  appliedRunCount: number;
  completedRunCount: number;
  blockedRunCount: number;
  failedRunCount: number;
  buyActionCount: number;
  sellActionCount: number;
  scoutActionCount: number;
  watchlistActionCount: number;
  boostActionCount: number;
  estimatedSpentSb: number;
  estimatedRealizedSb: number;
  estimatedCurrentValueSb: number;
  estimatedNetPnlSb: number;
  openPositionCount: number;
  openScoutTargetCount: number;
  lastAppliedAt: string | null;
  positions: AgentStrategyPerformancePosition[];
}

export interface AgentStrategySummary {
  id: string;
  userId: string;
  sourceThreadId: string | null;
  conversationThreadId: string | null;
  name: string;
  summary: string;
  mandateText: string;
  normalizedRuleSheet: Record<string, unknown>;
  timeline: AgentStrategyTimeline;
  status: AgentStrategyStatus;
  scheduleCron: string | null;
  eventSubscriptions: string[];
  allowedActionTypes: AgentAction["actionType"][];
  guardrails: Record<string, unknown>;
  reviewState: {
    status: AgentStrategyReviewStatus;
    reviewedAt: string | null;
    lastMaterialUpdateAt: string | null;
    summary: string | null;
  };
  requiresReview: boolean;
  linkedSkillId: string | null;
  lastOutcomeSummary: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  activatedAt: string | null;
  pausedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  recentRuns?: AgentStrategyRunSummary[];
}

export interface AgentStrategyDetail extends AgentStrategySummary {
  recentRuns: AgentStrategyRunSummary[];
  recentEvents: AgentStrategyEventSummary[];
  performance: AgentStrategyPerformanceSummary;
  continuity: AgentContinuityState;
}

export interface AgentCapabilityTool {
  toolName: string;
  description: string;
  requiresConfirmation: boolean;
  riskLevel: "low" | "medium" | "high";
  examplePrompts: string[];
}

export interface AgentCapabilityGroup {
  key: "read" | "scan" | "research" | "plan" | "action" | "memory" | "schedules";
  label: string;
  tools: AgentCapabilityTool[];
}

export interface AgentIsolationBoundary {
  gameplayOnly: true;
  codebaseAccess: false;
  arbitraryDatabaseAccess: false;
  genericFileAccess: false;
  adminAccess: false;
  riskyMutationsRequireConfirmation: true;
}

export interface AgentThreadRuntimeDetails {
  activeObjective: AgentThreadObjective | null;
  sinceLastUserMessage: AgentDeltaSummary | null;
  continuity: AgentContinuityState;
  timeline: AgentTimelineEvent[];
  researchSources: AgentCitation[];
  schedules: AgentScheduleSummary[];
  capabilityGroups: AgentCapabilityGroup[];
  isolation: AgentIsolationBoundary;
}
