import type {
  AgentSystemSettings,
  UpdateUserAgentProfileInput,
  UserAgentByokInput,
  UserAgentProfile,
} from "@shared/schema";

export type AgentProviderMode = "managed" | "byok";
export type AgentRuntime = "pi" | "hermes";
export type AgentDomain =
  | "scouting"
  | "player_pools"
  | "daily_boosts"
  | "community_boosts"
  | "watchlists"
  | "vesting"
  | "sportfolio";
export type AgentChannel = "in_app" | "sms" | "cli";
export type ManagedProviderKey = "chutes" | "minimax" | "openrouter";
export type AgentMessageRole = "user" | "assistant" | "system";
export type AgentMessageType = "chat" | "plan" | "confirmation" | "result" | "error";
export type AgentClarificationField = "player_name";
export type AgentSemanticRoute =
  | "top_targets_today"
  | "single_adjustment"
  | "review_setup"
  | "general_scouting";
export type AgentActionBundleStatus =
  | "pending_clarification"
  | "pending_confirmation"
  | "applied"
  | "rejected"
  | "failed"
  | "expired";
export const MANAGED_MODEL_PLACEHOLDER = "managed-default";
export const DEFAULT_MANAGED_MODEL = "moonshotai/Kimi-K2.5-TEE";

export interface AgentPendingClarification {
  kind: "player_name";
  prompt: string;
  missingFields: AgentClarificationField[];
  originalRequest: string;
  resumeMessageTemplate: string;
  workflowTitle?: string | null;
  workflowPreviewSteps?: string[];
}

export type AgentWorkflowStepStatus =
  | "ready"
  | "needs_clarification"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentWorkflowStepView {
  id: string;
  title: string;
  status: AgentWorkflowStepStatus;
  action: AgentAction | null;
  clarificationPrompt?: string | null;
}

export interface AgentSecretMetadata {
  configured: boolean;
  keyLast4: string | null;
  updatedAt: Date | null;
}

export interface AgentProfileView {
  profile: UserAgentProfile;
  secret: AgentSecretMetadata;
  capabilities: {
    canAnalyze: boolean;
    canAutoExecute: boolean;
    canUseWebResearch: boolean;
    webResearchProvider: "brave" | null;
    runtime: AgentRuntime;
    hasDurableMemory: boolean;
    canScheduleAdvisories: boolean;
  };
}

export interface AgentCapabilitiesView {
  domains: AgentDomain[];
  actionTypes: AgentAction["actionType"][];
  canAnalyze: boolean;
  canAutoExecute: boolean;
  canUseWebResearch: boolean;
  webResearchProvider: "brave" | null;
  providerMode: AgentProviderMode;
  runtime: AgentRuntime;
  hasDurableMemory: boolean;
  canScheduleAdvisories: boolean;
}

export interface ManagedProviderStatus {
  key: ManagedProviderKey;
  label: string;
  configured: boolean;
  baseUrl: string;
  defaultModel: string | null;
  models: string[];
}

export interface AgentSystemSettingsView {
  settings: Pick<AgentSystemSettings, "id" | "managedProvider" | "managedModel" | "updatedAt">;
  managedProvider: ManagedProviderStatus;
  managedProviders: ManagedProviderStatus[];
}

export interface ScoutAgentCandidate {
  playerId: string;
  name: string;
  sport: string;
  team: string;
  position: string;
  currentPrice: string | null;
  lastTradePrice: string | null;
  volume24h: number;
  priceChange24h: string;
  marketCap: string;
  injuryStatus: string | null;
  avgFantasyPointsPerGame: string;
  globalScoutCount: number;
  currentScoutCount: number;
  upcomingGame: string | null;
  hasGameInFocusWindow: boolean;
  scoutOpportunityScore: number;
}

export interface ScoutAgentSelectionWindow {
  label: string;
  date: string;
  gameCount: number;
  sportScope: string[];
}

export interface ScoutAgentRecommendedTarget {
  playerId: string;
  name: string;
  sport: string;
  score: number;
  reason: string;
}

export interface ScoutAgentOperatorHolding {
  playerId: string;
  name: string;
  sport: string;
  shares: number;
  multiplier: number;
  availableShares: number;
  nextGameAt: string | null;
}

export interface ScoutAgentOperatorOverview {
  availableBalance: number;
  portfolioPlayerCount: number;
  totalPlayerShares: number;
  stackedHoldingRows: number;
  stackReadyHoldingRows: number;
  watchlistCount: number;
  watchlistEntryCount: number;
  communitySharesAvailable: number;
  activeDailyBoostSlots: number;
  openDailyBoostSlots: number;
  claimableVestingShares: number;
  topHoldings: ScoutAgentOperatorHolding[];
  nextBestLevers: string[];
}

export interface ScoutAgentKnowledgeBriefItem {
  id: string;
  title: string;
  summary: string;
  urlPath: string;
  lastReviewedAt: string;
  notes: string[];
}

export interface ScoutAgentContext {
  generatedAt: string;
  analysisWindowMinutes: number;
  userPromptTemplate: string;
  maxScouts: number;
  totalScouts: number;
  remainingScouts: number;
  defaultSport: string | null;
  assignments: Array<{
    playerId: string;
    name: string;
    scoutCount: number;
    globalScoutCount: number;
    sport: string;
  }>;
  candidates: ScoutAgentCandidate[];
  selectionWindow: ScoutAgentSelectionWindow | null;
  recommendedTargets: ScoutAgentRecommendedTarget[];
  operatorOverview: ScoutAgentOperatorOverview;
  knowledgeBrief: ScoutAgentKnowledgeBriefItem[];
}

export interface AgentModelUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
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

export type AgentMemoryScope = "profile" | "episodic" | "semantic";
export type AgentMemoryKind =
  | "preference"
  | "goal"
  | "risk_tolerance"
  | "favorite_entities"
  | "habit"
  | "interaction_style";
export type AgentScheduleJobType =
  | "daily_setup_review"
  | "pre_lock_nudge"
  | "injury_watch"
  | "idle_balance_nudge"
  | "boost_window";
export type AgentToolCategory = "read" | "scan" | "plan" | "action" | "memory" | "research";
export type AgentToolExposure = "default" | "advanced" | "hidden_fallback" | "internal_only";
export type AgentFailureClass =
  | "malformed_tool_call"
  | "tool_not_selected_when_needed"
  | "wrong_tool_selected"
  | "insufficient_tool_chain"
  | "tool_execution_error"
  | "overeager_direct_answer"
  | "fallback_triggered"
  | "legacy_compatibility_used";
export type AgentImprovementCandidateStatus = "new" | "reviewed" | "implemented" | "rejected";
export type AgentImprovementChangeType =
  | "tool_schema"
  | "tool_coverage"
  | "loop_budget"
  | "executor_reliability"
  | "prompt_policy"
  | "fallback_policy"
  | "compatibility_isolation";

export interface AgentToolDefinition {
  toolName: string;
  category: AgentToolCategory;
  description: string;
  whenToUse: string[];
  whenNotToUse: string[];
  examplePrompts: string[];
  requiresConfirmation: boolean;
  riskLevel: "low" | "medium" | "high";
  inputSchema?: Record<string, unknown> | null;
  resultShapeHint?: string | null;
  autoContextArgs?: string[];
  exposure?: AgentToolExposure;
  supportsSequentialUse?: boolean;
  auditPriority?: "critical" | "high" | "normal";
}

export interface AgentImprovementCandidate {
  id: string;
  signature: string;
  userId: string | null;
  sourceRunId: string | null;
  status: AgentImprovementCandidateStatus;
  failureClass: AgentFailureClass;
  recommendedChangeType: AgentImprovementChangeType;
  recommendedChange: string;
  affectedTools: string[];
  evidence: Record<string, unknown>;
  confidence: number;
  occurrenceCount: number;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type AgentSkillScope = "user" | "global_candidate" | "global_approved";
export type AgentSkillStatus = "active" | "candidate" | "approved" | "archived" | "rejected";

export interface AgentSkillStep {
  stepType: "tool_call" | "clarify" | "decision";
  toolCategory: AgentToolCategory;
  toolName: string;
  argumentTemplate: Record<string, unknown>;
  stopIf?: string | null;
  requiresUserInput?: boolean;
}

export interface AgentSkillDefinition {
  id: string;
  scope: AgentSkillScope;
  status: AgentSkillStatus;
  userId: string | null;
  name: string;
  description: string;
  triggerExamples: string[];
  toolSequence: AgentSkillStep[];
  clarificationStrategy: Record<string, unknown>;
  constraints: Record<string, unknown>;
  confidence: number;
  sourceThreadId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface AgentSkillMatchResult {
  matched: boolean;
  skillId: string | null;
  confidence: number;
  reason: string | null;
}

export interface AgentMemoryRecord {
  id: string;
  userId: string;
  threadId: string | null;
  scope: AgentMemoryScope;
  kind: AgentMemoryKind;
  summary: string;
  content: Record<string, unknown>;
  confidence: number;
  source: "user_explicit" | "agent_inferred" | "system_derived";
  embedding: number[] | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface ProposedMemoryWrite {
  scope: AgentMemoryScope;
  kind: AgentMemoryKind;
  summary: string;
  content: Record<string, unknown>;
  confidence: number;
  reason: string;
}

export interface AgentToolTrace {
  toolName: string;
  phase: "read" | "scan" | "plan" | "action" | "memory" | "research";
  status: "ok" | "failed" | "skipped";
  latencyMs: number;
  summary: string;
}

export interface AgentConfirmationPreview {
  actionSummary: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  estimatedImpact: string | null;
  warnings: string[];
  riskClass: "low" | "medium" | "high";
}

export interface AgentUserSchedule {
  id: string;
  userId: string;
  jobType: AgentScheduleJobType;
  enabled: boolean;
  scheduleCron: string;
  channelTargets: AgentChannel[];
  policy: Record<string, unknown>;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentModelRuntimeConfig {
  providerMode: AgentProviderMode;
  providerKey?: ManagedProviderKey;
  model: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  authMode?: "standard" | "raw";
  headers?: Record<string, string> | null;
  payloadDefaults?: Record<string, unknown> | null;
}

export interface HermesRespondRequest {
  userId: string;
  threadId: string | null;
  channel: AgentChannel;
  message: string;
  requestMode: "auto" | "discussion" | "plan" | "clarification_resume";
  orchestrationMode?: "hermes_first";
  toolAllowlist: string[];
  toolCatalog: AgentToolDefinition[];
  availableSkills: AgentSkillDefinition[];
  skillPolicy?: {
    allowRuntimeSkillCreation: boolean;
    requireAdminApprovalForGlobalSkills: boolean;
  };
  memoryMode: "off" | "read_only" | "read_write";
  autoExecutionPolicy: {
    allowAdvisoryJobs: boolean;
    allowRiskyActions: boolean;
  };
  confirmationPolicy: {
    requireExplicitConfirmation: boolean;
    preferredChannel: AgentChannel;
  };
  profile: {
    displayName: string;
    providerMode: AgentProviderMode;
    model: string;
    baseUrl: string | null;
    systemPrompt: string;
    userPromptTemplate: string;
    temperature: number;
    maxTokens: number;
  };
  modelRuntime: AgentModelRuntimeConfig;
  canonicalState: {
    threadId: string | null;
    pendingBundleId: string | null;
    operatorOverview: ScoutAgentOperatorOverview;
    capabilities: Pick<
      AgentCapabilitiesView,
      | "domains"
      | "actionTypes"
      | "canAnalyze"
      | "canAutoExecute"
      | "canUseWebResearch"
      | "runtime"
      | "hasDurableMemory"
      | "canScheduleAdvisories"
    >;
  };
  memoryContext: {
    profile: AgentMemoryRecord[];
    episodic: AgentMemoryRecord[];
    semantic: AgentMemoryRecord[];
  };
  externalContext: {
    canonicalKnowledge: ScoutAgentKnowledgeBriefItem[];
    research: AgentCitation[];
  };
  conversationHistory: Array<{
    role: "user" | "assistant";
    contentText: string;
  }>;
  semanticRouteHint?: AgentSemanticRoute | null;
}

export interface HermesRespondResult {
  outcome: "advisory" | "staged_plan" | "clarification" | "unsupported" | "error";
  assistantText: string;
  summary: string | null;
  warnings: string[];
  proposedActions: AgentAction[];
  pendingClarification: AgentPendingClarification | null;
  citations: AgentCitation[];
  proposedMemoryWrites: ProposedMemoryWrite[];
  toolTrace: AgentToolTrace[];
  toolCallsUsed: string[];
  skillsUsed: string[];
  createdSkillCandidates: string[];
  skillMatchRationale?: string | null;
  fallbackUsed?: boolean;
  requiresConfirmation: boolean;
  confirmationPreview: AgentConfirmationPreview | null;
}

export interface ScoutProposalAction {
  actionType: "scout_set_count";
  playerId: string;
  playerName?: string;
  status?: string;
  targetCount: number;
  currentCount: number;
  reasoning: string;
  confidence: number;
  evidence: Record<string, string | null>;
  riskFlags: string[];
}

export interface PoolBuyAction {
  actionType: "pool_buy";
  playerId: string;
  playerName?: string;
  status?: string;
  sbAmount: number;
  availableBalanceBefore?: number | null;
  availableBalanceAfter?: number | null;
  maxSlippage: number;
  estimatedSharesOut?: number | null;
  estimatedPricePerShare?: number | null;
  estimatedSlippagePercent?: number | null;
  reasoning: string;
  confidence: number;
}

export interface PoolSellAction {
  actionType: "pool_sell";
  playerId: string;
  playerName?: string;
  status?: string;
  sharesAmount: number;
  availableBalanceBefore?: number | null;
  availableBalanceAfter?: number | null;
  availableSharesBefore?: number | null;
  availableSharesAfter?: number | null;
  maxSlippage: number;
  estimatedSbOut?: number | null;
  estimatedPricePerShare?: number | null;
  estimatedSlippagePercent?: number | null;
  reasoning: string;
  confidence: number;
}

export interface PoolAddLiquidityAction {
  actionType: "pool_add_liquidity";
  playerId: string;
  playerName?: string;
  status?: string;
  shares: number;
  playMoney: number;
  availableBalanceBefore?: number | null;
  availableBalanceAfter?: number | null;
  availableSharesBefore?: number | null;
  availableSharesAfter?: number | null;
  estimatedOwnershipPercent?: number | null;
  reasoning: string;
  confidence: number;
}

export interface PoolAddLiquidityOptimalAction {
  actionType: "pool_add_liquidity_optimal";
  playerId: string;
  playerName?: string;
  status?: string;
  maxShares: number;
  maxPlayMoney: number;
  availableBalanceBefore?: number | null;
  availableBalanceAfter?: number | null;
  availableSharesBefore?: number | null;
  availableSharesAfter?: number | null;
  estimatedOwnershipPercent?: number | null;
  reasoning: string;
  confidence: number;
}

export interface PoolZapSharesAction {
  actionType: "pool_zap_add_shares";
  playerId: string;
  playerName?: string;
  status?: string;
  shares: number;
  availableSharesBefore?: number | null;
  availableSharesAfter?: number | null;
  estimatedLpSharesMinted?: number | null;
  reasoning: string;
  confidence: number;
}

export interface PoolZapSbAction {
  actionType: "pool_zap_add_sb";
  playerId: string;
  playerName?: string;
  status?: string;
  sb: number;
  availableBalanceBefore?: number | null;
  availableBalanceAfter?: number | null;
  estimatedLpSharesMinted?: number | null;
  reasoning: string;
  confidence: number;
}

export interface PoolRemoveLiquidityAction {
  actionType: "pool_remove_liquidity";
  playerId: string;
  playerName?: string;
  status?: string;
  lpShares: number;
  currentLpShares?: number | null;
  remainingLpShares?: number | null;
  estimatedSharesOut?: number | null;
  estimatedPlayMoneyOut?: number | null;
  reasoning: string;
  confidence: number;
}

export interface HoldingsStackSharesAction {
  actionType: "holdings_stack_shares";
  playerId: string;
  playerName?: string;
  status?: string;
  sharesToStack: number;
  availableSharesBefore?: number | null;
  availableSharesAfter?: number | null;
  expectedMultiplierGained: number;
  expectedStackedShareCount: number;
  reasoning: string;
  confidence: number;
}

export interface DailyBoostAssignAction {
  actionType: "daily_boost_assign";
  playerId: string;
  playerName?: string;
  status?: string;
  sport: string;
  slotTier: 2 | 3 | 4 | 5;
  sharesEntered: 1;
  boostDate: string;
  gameId: string;
  gameStartTime?: string | null;
  opponent?: string | null;
  availableShares?: number;
  shareMultiplier?: number | null;
  reasoning: string;
  confidence: number;
}

export interface DailyBoostRemoveAction {
  actionType: "daily_boost_remove";
  boostId: string;
  playerId: string;
  playerName?: string;
  status?: string;
  sport: string;
  slotTier: 2 | 3 | 4 | 5;
  boostDate: string;
  gameId?: string | null;
  gameStartTime?: string | null;
  reasoning: string;
  confidence: number;
}

export interface WatchlistAddPlayerAction {
  actionType: "watchlist_add_player";
  playerId: string;
  playerName?: string;
  status?: string;
  watchlistId?: string | null;
  watchlistName?: string | null;
  reasoning: string;
  confidence: number;
}

export interface WatchlistRemovePlayerAction {
  actionType: "watchlist_remove_player";
  playerId: string;
  playerName?: string;
  status?: string;
  watchlistId?: string | null;
  watchlistName?: string | null;
  removeFromAll: boolean;
  reasoning: string;
  confidence: number;
}

export interface CommunityBoostCreateAction {
  actionType: "community_boost_create";
  playerId: string;
  playerName?: string;
  status?: string;
  sport: string;
  boostDate: string;
  gameId: string;
  gameStartTime?: string | null;
  opponent?: string | null;
  communitySharesAvailable?: number;
  reasoning: string;
  confidence: number;
}

export interface VestingClaimAction {
  actionType: "vesting_claim";
  playerId: string;
  playerName?: string;
  status?: string;
  claimableShares: number;
  distributionCount: number;
  targetDescription?: string | null;
  reasoning: string;
  confidence: number;
}

export type AgentAction =
  | ScoutProposalAction
  | PoolBuyAction
  | PoolSellAction
  | PoolAddLiquidityAction
  | PoolAddLiquidityOptimalAction
  | PoolZapSharesAction
  | PoolZapSbAction
  | PoolRemoveLiquidityAction
  | HoldingsStackSharesAction
  | DailyBoostAssignAction
  | DailyBoostRemoveAction
  | WatchlistAddPlayerAction
  | WatchlistRemovePlayerAction
  | CommunityBoostCreateAction
  | VestingClaimAction;

export interface AgentAnalysisResult {
  runId: string;
  status: string;
  domain: AgentDomain;
  requestMessage: string | null;
  replyText?: string | null;
  summary: string | null;
  observations: string[];
  warnings: string[];
  actions: AgentAction[];
  citations?: AgentCitation[];
  pendingClarification?: AgentPendingClarification | null;
  proposedMemoryWrites?: ProposedMemoryWrite[];
  toolTrace?: AgentToolTrace[];
  skillsUsed?: string[];
  createdSkillCandidates?: string[];
  errorMessage?: string | null;
}

export type ScoutAnalysisResult = AgentAnalysisResult;

export interface AgentActionBundleView {
  id: string;
  status: AgentActionBundleStatus;
  domain: AgentDomain;
  summary: string;
  warnings: string[];
  actions: AgentAction[];
  workflowType: "single_action" | "multi_action" | "clarification";
  steps: AgentWorkflowStepView[];
  pendingClarification?: AgentPendingClarification | null;
  runId: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  appliedAt: Date | null;
}

export interface AgentThreadSummary {
  id: string;
  title: string | null;
  channel: AgentChannel;
  domain: AgentDomain;
  status: string;
  lastMessageAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
  lastMessagePreview: string | null;
  pendingActionBundle: AgentActionBundleView | null;
}

export interface AgentThreadMessage {
  id: string;
  role: AgentMessageRole;
  messageType: AgentMessageType;
  contentText: string;
  createdAt: Date;
  runId: string | null;
  actionBundle: AgentActionBundleView | null;
  citations?: AgentCitation[] | null;
  pendingClarification?: AgentPendingClarification | null;
}

export interface AgentThreadTurnResult {
  thread: AgentThreadSummary;
  createdMessages: AgentThreadMessage[];
  pendingActionBundle: AgentActionBundleView | null;
  pendingClarification?: AgentPendingClarification | null;
}

export interface AgentSemanticRouteMatch {
  route: AgentSemanticRoute | null;
  confidence: number;
  matchedPrototype: string | null;
  provider: string;
  model: string;
}

export interface AgentQuestionLogEntry {
  userId: string;
  threadId: string;
  message: string;
  createdAt: Date;
  semanticRouteHint?: AgentSemanticRoute | null;
}

export interface AgentQuestionLogAggregate {
  normalizedPrompt: string;
  samplePrompt: string;
  count: number;
  lastAskedAt: Date;
}

export interface AgentQuestionRouteAggregate {
  route: AgentSemanticRoute;
  count: number;
  lastAskedAt: Date;
  samplePrompt: string;
}

export interface AgentQuestionSemanticCluster {
  label: string;
  route: AgentSemanticRoute | null;
  count: number;
  samplePrompts: string[];
  lastAskedAt: Date;
}

export interface AgentQuestionLogReport {
  recentQuestions: AgentQuestionLogEntry[];
  commonQuestions: AgentQuestionLogAggregate[];
  routeCounts: AgentQuestionRouteAggregate[];
  semanticClusters: AgentQuestionSemanticCluster[];
}

export interface UpdateAgentProfileRequest extends UpdateUserAgentProfileInput {}

export interface SaveByokRequest extends UserAgentByokInput {}
