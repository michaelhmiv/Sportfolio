export const AGENT_UI_BLOCK_TYPES = [
  "goal_strip",
  "pending_decision",
  "clarification_card",
  "strategy_draft",
  "strategy_status",
  "stat_highlight_strip",
  "leaderboard_table",
  "entity_table",
  "schedule_board",
  "execution_checklist",
  "tool_catalog_summary",
  "schedule_summary",
  "rules_summary",
  "performance_summary",
  "source_list",
  "run_summary",
] as const;

export const AGENT_UI_BLOCK_SLOTS = [
  "chat_header",
  "chat_inline",
  "strategy_overview",
  "strategy_chat",
  "strategy_rules",
] as const;

export type AgentUiBlockType = (typeof AGENT_UI_BLOCK_TYPES)[number];
export type AgentUiBlockSlot = (typeof AGENT_UI_BLOCK_SLOTS)[number];
export type AgentUiEntityType = "player" | "team" | "game" | "tool";
export type AgentUiTone = "default" | "accent" | "positive" | "warning" | "negative";
export type AgentUiAlign = "left" | "center" | "right";
export type AgentUiChecklistStatus = "pending" | "ready" | "in_progress" | "done" | "blocked";

export type AgentUiEntityCell = {
  text: string;
  secondaryText?: string | null;
  badge?: string | null;
  href?: string | null;
  entityType?: AgentUiEntityType | null;
  entityId?: string | null;
  align?: AgentUiAlign | null;
  tone?: AgentUiTone | null;
};

type AgentUiBlockBase<TType extends AgentUiBlockType, TProps> = {
  type: TType;
  slot?: AgentUiBlockSlot | null;
  priority?: number | null;
  props: TProps;
};

export type AgentGoalStripBlock = AgentUiBlockBase<
  "goal_strip",
  {
    eyebrow?: string | null;
    title: string;
    status?: string | null;
    summary?: string | null;
    nextStep?: string | null;
    badge?: string | null;
  }
>;

export type AgentPendingDecisionBlock = AgentUiBlockBase<
  "pending_decision",
  {
    title: string;
    summary: string;
    risk?: "low" | "medium" | "high" | null;
    helper?: string | null;
    actionLabel?: string | null;
  }
>;

export type AgentClarificationCardBlock = AgentUiBlockBase<
  "clarification_card",
  {
    title?: string | null;
    prompt: string;
    helper?: string | null;
    choices?: string[] | null;
  }
>;

export type AgentStrategyDraftBlock = AgentUiBlockBase<
  "strategy_draft",
  {
    title: string;
    summary?: string | null;
    schedule?: string | null;
    actionScope?: string[] | null;
    missingDetails?: string[] | null;
  }
>;

export type AgentStrategyStatusBlock = AgentUiBlockBase<
  "strategy_status",
  {
    title: string;
    status: string;
    summary?: string | null;
    nextRunAt?: string | null;
    lastResult?: string | null;
  }
>;

export type AgentStatHighlightStripBlock = AgentUiBlockBase<
  "stat_highlight_strip",
  {
    title?: string | null;
    helper?: string | null;
    items: Array<{
      label: string;
      value: string;
      helper?: string | null;
      tone?: AgentUiTone | null;
    }>;
  }
>;

export type AgentLeaderboardTableBlock = AgentUiBlockBase<
  "leaderboard_table",
  {
    title?: string | null;
    helper?: string | null;
    statLabel: string;
    secondaryStatLabel?: string | null;
    leaders: Array<{
      id: string;
      rank: number;
      playerName: string;
      playerId?: string | null;
      href?: string | null;
      team?: string | null;
      secondaryText?: string | null;
      badge?: string | null;
      primaryValue: string;
      secondaryValue?: string | null;
      note?: string | null;
      tone?: AgentUiTone | null;
    }>;
    emptyState?: string | null;
  }
>;

export type AgentEntityTableBlock = AgentUiBlockBase<
  "entity_table",
  {
    title?: string | null;
    helper?: string | null;
    columns: Array<{
      key: string;
      label: string;
      align?: AgentUiAlign | null;
    }>;
    rows: Array<{
      id: string;
      rank?: number | null;
      note?: string | null;
      cells: Record<string, AgentUiEntityCell>;
    }>;
    emptyState?: string | null;
  }
>;

export type AgentScheduleBoardBlock = AgentUiBlockBase<
  "schedule_board",
  {
    title?: string | null;
    helper?: string | null;
    rows: Array<{
      id: string;
      matchup: string;
      status?: string | null;
      startTime?: string | null;
      venue?: string | null;
      href?: string | null;
      chips?: string[] | null;
      probableAwayPitcher?: string | null;
      probableHomePitcher?: string | null;
      note?: string | null;
    }>;
    emptyState?: string | null;
  }
>;

export type AgentExecutionChecklistBlock = AgentUiBlockBase<
  "execution_checklist",
  {
    title?: string | null;
    summary?: string | null;
    items: Array<{
      id: string;
      label: string;
      detail?: string | null;
      status: AgentUiChecklistStatus;
    }>;
  }
>;

export type AgentToolCatalogSummaryBlock = AgentUiBlockBase<
  "tool_catalog_summary",
  {
    title?: string | null;
    helper?: string | null;
    groups: Array<{
      id: string;
      label: string;
      tools: Array<{
        name: string;
        description: string;
        riskLevel?: "low" | "medium" | "high" | null;
        examplePrompt?: string | null;
        presentationProfile?: string | null;
        primaryEntityType?: AgentUiEntityType | null;
      }>;
    }>;
  }
>;

export type AgentScheduleSummaryBlock = AgentUiBlockBase<
  "schedule_summary",
  {
    title?: string | null;
    scheduleLabel: string;
    helper?: string | null;
  }
>;

export type AgentRulesSummaryBlock = AgentUiBlockBase<
  "rules_summary",
  {
    title?: string | null;
    items: Array<{
      label: string;
      value: string;
    }>;
  }
>;

export type AgentPerformanceSummaryBlock = AgentUiBlockBase<
  "performance_summary",
  {
    title?: string | null;
    metrics: Array<{
      label: string;
      value: string;
      tone?: "default" | "positive" | "warning" | "negative" | null;
    }>;
  }
>;

export type AgentSourceListBlock = AgentUiBlockBase<
  "source_list",
  {
    title?: string | null;
    sources: Array<{
      id: string;
      title: string;
      sourceName?: string | null;
      retrievedAt?: string | null;
      url?: string | null;
      factSummary?: string | null;
    }>;
  }
>;

export type AgentRunSummaryBlock = AgentUiBlockBase<
  "run_summary",
  {
    title?: string | null;
    summary: string;
    status?: string | null;
    trigger?: string | null;
    transport?: string | null;
    createdAt?: string | null;
  }
>;

export type AgentUiBlock =
  | AgentGoalStripBlock
  | AgentPendingDecisionBlock
  | AgentClarificationCardBlock
  | AgentStrategyDraftBlock
  | AgentStrategyStatusBlock
  | AgentStatHighlightStripBlock
  | AgentLeaderboardTableBlock
  | AgentEntityTableBlock
  | AgentScheduleBoardBlock
  | AgentExecutionChecklistBlock
  | AgentToolCatalogSummaryBlock
  | AgentScheduleSummaryBlock
  | AgentRulesSummaryBlock
  | AgentPerformanceSummaryBlock
  | AgentSourceListBlock
  | AgentRunSummaryBlock;

export function isAgentUiBlockType(value: unknown): value is AgentUiBlockType {
  return typeof value === "string" && AGENT_UI_BLOCK_TYPES.includes(value as AgentUiBlockType);
}

export function isAgentUiBlockSlot(value: unknown): value is AgentUiBlockSlot {
  return typeof value === "string" && AGENT_UI_BLOCK_SLOTS.includes(value as AgentUiBlockSlot);
}
