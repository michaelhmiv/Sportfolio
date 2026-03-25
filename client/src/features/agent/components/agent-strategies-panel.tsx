import { useEffect, useState, type RefObject } from "react";
import { summarizeAgentStrategyTrigger } from "@shared/agent-strategy";
import {
  ArrowLeft,
  Clock3,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Settings2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatCurrency, formatNumericValue } from "../lib/agent-view";
import type { AgentStrategyDetail, AgentStrategySummary, AgentThreadMessage } from "../types";
import type { AgentUiBlock } from "@shared/agent-ui";
import {
  AgentEmptyConversationState,
  AgentMessageList,
  type PendingUserMessage,
} from "./agent-conversation";
import { AgentComposer } from "./agent-composer";
import { AgentUiBlockList } from "./agent-ui-blocks";

type StrategyDetailTab = "overview" | "chat" | "rules";

type StrategyRuleDraft = {
  name: string;
  summary: string;
  mandateText: string;
  scheduleCron: string;
  maxActionsPerRun: string;
  maxActionsPerDay: string;
};

function getActiveTimelineStage(strategyDetail: AgentStrategyDetail) {
  return (
    strategyDetail.timeline.stages.find(
      (stage) => stage.id === strategyDetail.timeline.currentStageId,
    ) ||
    strategyDetail.timeline.stages[0] ||
    null
  );
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not scheduled";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Recent";
  }

  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getContinuityLoopTone(status: "tracking" | "waiting_on_you" | "scheduled" | "blocked") {
  switch (status) {
    case "waiting_on_you":
      return "border-amber-500/35 bg-amber-500/10 text-amber-100";
    case "blocked":
      return "border-red-500/35 bg-red-500/10 text-red-100";
    case "scheduled":
      return "border-sky-500/35 bg-sky-500/10 text-sky-100";
    case "tracking":
    default:
      return "border-emerald-500/35 bg-emerald-500/10 text-emerald-100";
  }
}

function getStrategyTone(status: AgentStrategySummary["status"]) {
  switch (status) {
    case "live":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
    case "blocked":
      return "border-red-500/30 bg-red-500/10 text-red-100";
    case "paused":
      return "border-amber-500/30 bg-amber-500/10 text-amber-100";
    case "archived":
      return "border-slate-600 bg-slate-800/80 text-slate-300";
    case "draft":
    default:
      return "border-sky-500/30 bg-sky-500/10 text-sky-100";
  }
}

function getReviewTone(status: AgentStrategySummary["reviewState"]["status"]) {
  return status === "approved"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
    : "border-amber-500/30 bg-amber-500/10 text-amber-100";
}

function getResolvedReviewState(
  strategy: Pick<AgentStrategySummary, "updatedAt"> & {
    requiresReview?: boolean | null;
    reviewState?: Partial<AgentStrategySummary["reviewState"]> | null;
  },
) {
  const status: AgentStrategySummary["reviewState"]["status"] =
    strategy.reviewState?.status === "approved" ? "approved" : "pending";
  const requiresReview =
    typeof strategy.requiresReview === "boolean" ? strategy.requiresReview : status !== "approved";

  return {
    status,
    requiresReview,
    summary: strategy.reviewState?.summary || null,
    reviewedAt: strategy.reviewState?.reviewedAt || null,
    lastMaterialUpdateAt: strategy.reviewState?.lastMaterialUpdateAt || strategy.updatedAt,
  };
}

function buildRuleDraft(strategyDetail: AgentStrategyDetail | null): StrategyRuleDraft {
  const guardrails = strategyDetail?.guardrails || {};
  const maxActionsPerRun =
    typeof guardrails.maxActionsPerRun === "number" ? String(guardrails.maxActionsPerRun) : "3";
  const maxActionsPerDay =
    typeof guardrails.maxActionsPerDay === "number" ? String(guardrails.maxActionsPerDay) : "8";

  return {
    name: strategyDetail?.name || "",
    summary: strategyDetail?.summary || "",
    mandateText: strategyDetail?.mandateText || "",
    scheduleCron: strategyDetail?.scheduleCron || "",
    maxActionsPerRun,
    maxActionsPerDay,
  };
}

function buildStrategyOverviewBlocks(strategyDetail: AgentStrategyDetail): AgentUiBlock[] {
  const performance = strategyDetail.performance;
  const latestRun = strategyDetail.recentRuns[0] || null;
  const isDraft = strategyDetail.status === "draft";
  const activeStage = getActiveTimelineStage(strategyDetail);
  const reviewState = getResolvedReviewState(strategyDetail);
  const needsReview = reviewState.requiresReview;

  const rulesItems = [
    activeStage
      ? {
          label: "Current stage",
          value: `${activeStage.title} - ${summarizeAgentStrategyTrigger(activeStage.triggerPolicy)}`,
        }
      : null,
    strategyDetail.allowedActionTypes.length > 0
      ? {
          label: "Actions",
          value: strategyDetail.allowedActionTypes.join(", ").replace(/_/g, " "),
        }
      : null,
    strategyDetail.guardrails.maxActionsPerRun
      ? {
          label: "Run cap",
          value: String(strategyDetail.guardrails.maxActionsPerRun),
        }
      : null,
    strategyDetail.guardrails.maxActionsPerDay
      ? {
          label: "Daily cap",
          value: String(strategyDetail.guardrails.maxActionsPerDay),
        }
      : null,
    {
      label: "Autonomy",
      value: "Managed inside saved caps",
    },
    {
      label: "Review",
      value: needsReview ? "Approve before activation" : "Approved",
    },
  ].filter((item): item is { label: string; value: string } => Boolean(item));

  return [
    ...(needsReview
      ? ([
          {
            type: "pending_decision",
            slot: "strategy_overview",
            priority: 5,
            props: {
              title: "Review needed",
              summary:
                reviewState.summary ||
                "Review the saved stages, triggers, and action scope before Hermes can run this live.",
              helper:
                strategyDetail.status === "paused"
                  ? "This strategy was paused until you approve the latest saved changes."
                  : "Approve the saved playbook before activating the strategy.",
              actionLabel: "Approve changes",
            },
          } satisfies AgentUiBlock,
        ] as AgentUiBlock[])
      : []),
    isDraft
      ? ({
          type: "strategy_draft",
          slot: "strategy_overview",
          priority: 10,
          props: {
            title: strategyDetail.name,
            summary: strategyDetail.summary,
            schedule: activeStage ? summarizeAgentStrategyTrigger(activeStage.triggerPolicy) : null,
            actionScope:
              strategyDetail.allowedActionTypes.length > 0
                ? strategyDetail.allowedActionTypes.map((entry) => entry.replace(/_/g, " "))
                : null,
            missingDetails:
              strategyDetail.scheduleCron && strategyDetail.allowedActionTypes.length > 0
                ? []
                : [
                    !strategyDetail.scheduleCron ? "schedule" : null,
                    strategyDetail.allowedActionTypes.length === 0 ? "actions" : null,
                  ].filter((entry): entry is string => Boolean(entry)),
          },
        } satisfies AgentUiBlock)
      : ({
          type: "strategy_status",
          slot: "strategy_overview",
          priority: 10,
          props: {
            title: strategyDetail.name,
            status: strategyDetail.status === "live" ? "active" : strategyDetail.status,
            summary: strategyDetail.summary,
            nextRunAt: strategyDetail.nextRunAt,
            lastResult: strategyDetail.lastOutcomeSummary,
          },
        } satisfies AgentUiBlock),
    ...(activeStage
      ? ([
          {
            type: "schedule_summary",
            slot: "strategy_overview",
            priority: 15,
            props: {
              title: "Schedule",
              scheduleLabel: summarizeAgentStrategyTrigger(activeStage.triggerPolicy),
              helper:
                strategyDetail.status === "live"
                  ? "Hermes will wake this active stage when its saved trigger is eligible."
                  : "This trigger will be used when the strategy is active.",
            },
          } satisfies AgentUiBlock,
        ] as AgentUiBlock[])
      : []),
    {
      type: "performance_summary",
      slot: "strategy_overview",
      priority: 20,
      props: {
        title: "Performance",
        metrics: [
          {
            label: "Net P/L",
            value: formatCurrency(performance.estimatedNetPnlSb) || "$0.00",
            tone:
              performance.estimatedNetPnlSb > 0
                ? "positive"
                : performance.estimatedNetPnlSb < 0
                  ? "negative"
                  : "default",
          },
          {
            label: "Open positions",
            value: formatNumericValue(performance.openPositionCount) || "0",
          },
          {
            label: "Completed runs",
            value: formatNumericValue(performance.completedRunCount) || "0",
          },
        ],
      },
    },
    ...(latestRun
      ? ([
          {
            type: "run_summary",
            slot: "strategy_overview",
            priority: 30,
            props: {
              title: "Latest run",
              summary: latestRun.outcomeSummary || "Hermes completed the latest review.",
              status: latestRun.status,
              trigger: latestRun.triggerSource,
              transport: latestRun.runtimeTransport,
              createdAt: latestRun.createdAt,
            },
          } satisfies AgentUiBlock,
        ] as AgentUiBlock[])
      : []),
    ...(rulesItems.length > 0
      ? ([
          {
            type: "rules_summary",
            slot: "strategy_overview",
            priority: 40,
            props: {
              title: "Saved rules",
              items: rulesItems,
            },
          } satisfies AgentUiBlock,
        ] as AgentUiBlock[])
      : []),
  ];
}

function StrategyDeskBrief({
  strategies,
  selectedDetail,
}: {
  strategies: AgentStrategySummary[];
  selectedDetail: AgentStrategyDetail | null;
}) {
  const liveCount = strategies.filter((strategy) => strategy.status === "live").length;
  const reviewCount = strategies.filter((strategy) => strategy.requiresReview).length;
  const blockedCount = strategies.filter((strategy) => strategy.status === "blocked").length;
  const nextRunLabel = selectedDetail?.nextRunAt ? formatDateTime(selectedDetail.nextRunAt) : null;
  const leadLoop = selectedDetail?.continuity.openLoops[0] || null;
  const leadAction = selectedDetail?.continuity.recentActions[0] || null;

  const briefItems = [
    {
      label: "Live",
      value: String(liveCount),
    },
    {
      label: "Needs review",
      value: String(reviewCount),
    },
    {
      label: "Blocked",
      value: String(blockedCount),
    },
  ];

  return (
    <section className="min-w-0 w-full overflow-hidden border-b border-[#1f2634] bg-[#0b1120] md:rounded-xl md:border md:border-white/[0.06] md:bg-white/[0.02]">
      <div className="border-b border-[#222938] px-0 py-2 sm:px-4 md:px-3 md:py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">Strategy desk</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <div className="truncate text-sm font-semibold text-slate-50 sm:text-base">
                {selectedDetail?.name || "Strategy desk"}
              </div>
              {nextRunLabel ? (
                <span className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-white/60">{`Next ${nextRunLabel}`}</span>
              ) : null}
              {leadLoop ? (
                <Badge
                  className={cn("hover:bg-transparent", getContinuityLoopTone(leadLoop.status))}
                >
                  {leadLoop.status.replace(/_/g, " ")}
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="hidden min-w-[10rem] grid-cols-3 gap-px overflow-hidden border border-[#222938] bg-[#222938] md:grid">
            {briefItems.map((item) => (
              <div key={item.label} className="bg-[#0f1524] px-2 py-1.5 text-right">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
                  {item.label}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-50">{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="divide-y divide-[#222938] md:hidden">
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-0 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500">
          {briefItems.map((item) => (
            <span key={item.label}>
              <span className="text-slate-100">{item.value}</span> {item.label}
            </span>
          ))}
          {selectedDetail?.requiresReview ? (
            <span className="text-amber-200">Review needed</span>
          ) : null}
        </div>
        <div className="px-0 py-1.5 text-[11px] leading-4.5 text-slate-300">
          <span className="font-mono uppercase tracking-[0.08em] text-slate-500">Focus</span>{" "}
          {leadLoop?.summary ||
            selectedDetail?.summary ||
            "Open a slot to inspect the saved thesis, current wake, and recent runs."}
        </div>
        <div className="px-0 py-1.5 text-[11px] leading-4.5 text-slate-300">
          <span className="font-mono uppercase tracking-[0.08em] text-slate-500">Next</span>{" "}
          {leadAction?.summary ||
            leadLoop?.title ||
            (nextRunLabel
              ? `Hermes wakes again ${nextRunLabel}.`
              : "Hermes is waiting for the next saved trigger or fresh evidence.")}
        </div>
      </div>

      <div className="hidden gap-px bg-[#222938] md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="bg-[#0f1524] px-0 py-2.5 sm:px-4 md:px-3 md:py-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-white/35">Active focus</div>
          <div className="mt-1 text-sm font-semibold text-slate-50">
            {selectedDetail?.name || "No strategy selected"}
          </div>
          <div className="mt-2 text-xs leading-5 text-slate-300">
            {selectedDetail?.lastOutcomeSummary ||
              "Use the slot rail to open a saved template or start a new strategy conversation."}
          </div>
        </div>

        <div className="bg-[#0f1524] px-0 py-2.5 sm:px-4 md:px-3 md:py-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-white/35">Next action</div>
          <div className="mt-1 text-sm font-semibold text-slate-50">
            {leadLoop?.title || "Awaiting next trigger"}
          </div>
          <div className="mt-2 text-xs leading-5 text-slate-300">
            {leadAction?.summary ||
              (nextRunLabel
                ? `Hermes wakes again ${nextRunLabel}.`
                : "Hermes will hold here until a saved trigger or fresh evidence changes the plan.")}
          </div>
        </div>
      </div>
    </section>
  );
}

function StrategySlots({
  strategies,
  selectedStrategyId,
  isCreating,
  onSelect,
  onCreateBlank,
  scrollable = true,
  showHeader = true,
}: {
  strategies: AgentStrategySummary[];
  selectedStrategyId: string | null;
  isCreating: boolean;
  onSelect: (strategyId: string) => void;
  onCreateBlank: () => void;
  scrollable?: boolean;
  showHeader?: boolean;
}) {
  const slots = Array.from({ length: 5 }, (_, index) => strategies[index] || null);

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-col border-t border-[#1f2634] bg-[#0b1120] md:rounded-xl md:border md:border-white/[0.06] md:bg-white/[0.02]">
      {showHeader ? (
        <div className="border-b border-[#222938] px-0 py-2 sm:px-4 md:px-3 md:py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">Strategy rail</div>
              <div className="mt-1 text-sm font-semibold text-slate-50">Saved slots</div>
            </div>
            <Badge variant="outline" className="border-[#2a2e39] text-slate-300">
              {strategies.length}/5 used
            </Badge>
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "px-0 py-1 md:px-3 md:py-3",
          scrollable
            ? "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-3"
            : "pb-0",
        )}
        data-testid="strategy-slots"
      >
        <div className="divide-y divide-[#222938] md:space-y-2 md:divide-y-0">
          {slots.map((strategy, index) =>
            strategy ? (
              <button
                key={strategy.id}
                type="button"
                onClick={() => onSelect(strategy.id)}
                className={cn(
                  "w-full border-l-2 px-0 py-2.5 text-left transition-colors md:border md:px-3",
                  selectedStrategyId === strategy.id
                    ? "border-l-amber-500 bg-amber-500/5 md:border-amber-500/45 md:bg-[linear-gradient(180deg,rgba(122,81,0,0.14),rgba(27,20,8,0.96))]"
                    : "border-l-transparent hover:bg-[#101726] md:border-[#222938] md:bg-[#0f1524] md:hover:border-slate-500 md:hover:bg-[#141d2d]",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
                        {`S${index + 1}`}
                      </span>
                      <div className="truncate text-[13px] font-semibold text-slate-50 md:text-sm">
                        {strategy.name}
                      </div>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-4.5 text-slate-400">
                      {strategy.summary}
                    </div>
                    {strategy.lastOutcomeSummary && (
                      <div className="mt-1.5 line-clamp-2 text-[11px] leading-4.5 text-slate-300 md:mt-2 md:border-l md:border-[#2a2e39] md:pl-3">
                        {strategy.lastOutcomeSummary}
                      </div>
                    )}
                  </div>
                  <Badge
                    className={cn(
                      "hidden hover:bg-transparent md:inline-flex",
                      getStrategyTone(strategy.status),
                    )}
                  >
                    {strategy.status}
                  </Badge>
                  <div className="shrink-0 text-right md:hidden">
                    <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-slate-300">
                      {strategy.status}
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500">
                      {strategy.requiresReview ? "review" : "ready"}
                    </div>
                  </div>
                </div>

                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500 md:mt-2 md:gap-y-1.5">
                  <span>{strategy.requiresReview ? "Review needed" : "Reviewed"}</span>
                  <span>
                    Last update {formatDateTime(strategy.lastRunAt || strategy.updatedAt)}
                  </span>
                </div>
              </button>
            ) : (
              <button
                key={`empty-slot-${index + 1}`}
                type="button"
                onClick={onCreateBlank}
                disabled={isCreating}
                className="w-full border-l-2 border-l-transparent px-0 py-2.5 text-left transition-colors hover:bg-[#101726] disabled:cursor-not-allowed disabled:opacity-70 md:border md:border-dashed md:border-border md:bg-sidebar/10 md:px-3 md:py-3.5 md:hover:border-amber-500/40 md:hover:bg-sidebar/20"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
                        {`S${index + 1}`}
                      </span>
                      <div className="text-[13px] font-semibold text-slate-50 md:text-sm">
                        Create new
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] leading-4.5 text-slate-400">
                      Slot {index + 1} is open for a new strategy conversation.
                    </div>
                  </div>
                  <div className="shrink-0 text-amber-300">
                    {isCreating && index === strategies.length ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </div>
                </div>
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function StrategyOverview({ strategyDetail }: { strategyDetail: AgentStrategyDetail }) {
  const recentEvents = strategyDetail.recentEvents.slice(0, 5);
  const overviewBlocks = buildStrategyOverviewBlocks(strategyDetail);
  const activeStage = getActiveTimelineStage(strategyDetail);
  const continuity = strategyDetail.continuity;

  return (
    <div className="space-y-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:space-y-4 sm:pb-4">
      <div className="md:hidden">
        <AgentUiBlockList blocks={overviewBlocks.slice(0, 2)} />
      </div>
      <div className="hidden md:block">
        <AgentUiBlockList blocks={overviewBlocks} />
      </div>

      <section className="border-t border-[#1f2634] px-0 py-3 md:rounded-xl md:border md:border-white/[0.06] md:bg-white/[0.02] md:p-4">
        <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">Continuous state</div>
        <div className="mt-1 text-sm font-semibold text-slate-50">{continuity.headline}</div>
        <div className="mt-2 grid gap-3 xl:grid-cols-3">
          <div className="space-y-2">
            <div className="text-[10px] font-medium uppercase tracking-wider text-white/35">Open loops</div>
            {continuity.openLoops.length > 0 ? (
              continuity.openLoops.slice(0, 3).map((loop) => (
                <div key={loop.id} className="border border-border bg-sidebar/25 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-sm font-medium text-slate-50">{loop.title}</div>
                    <Badge
                      className={cn("hover:bg-transparent", getContinuityLoopTone(loop.status))}
                    >
                      {loop.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-300">{loop.summary}</div>
                </div>
              ))
            ) : (
              <div className="border border-dashed border-border bg-sidebar/15 px-3 py-3 text-xs leading-5 text-slate-400">
                No unresolved loops.
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-medium uppercase tracking-wider text-white/35">Recent actions</div>
            {continuity.recentActions.length > 0 ? (
              continuity.recentActions.slice(0, 3).map((action) => (
                <div key={action.id} className="border border-border bg-sidebar/25 px-3 py-2.5">
                  <div className="text-sm font-medium text-slate-50">{action.title}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-300">{action.summary}</div>
                  <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
                    {action.createdAt ? formatDateTime(action.createdAt) : "Recent"} |{" "}
                    {action.source === "pending_bundle" ? "staged" : "applied"}
                  </div>
                </div>
              ))
            ) : (
              <div className="border border-dashed border-border bg-sidebar/15 px-3 py-3 text-xs leading-5 text-slate-400">
                No recorded actions yet.
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-medium uppercase tracking-wider text-white/35">Evidence</div>
            {continuity.evidenceUpdates.length > 0 || continuity.activeStrategies.length > 0 ? (
              <>
                {continuity.evidenceUpdates.slice(0, 2).map((evidence) => (
                  <div key={evidence.id} className="border border-border bg-sidebar/25 px-3 py-2.5">
                    <div className="text-sm font-medium text-slate-50">{evidence.title}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-300">{evidence.summary}</div>
                    <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      {evidence.sourceName || "Research"}
                    </div>
                  </div>
                ))}
                {continuity.activeStrategies.slice(0, 1).map((strategy) => (
                  <div
                    key={strategy.strategyId}
                    className="border border-border bg-sidebar/25 px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium text-slate-50">{strategy.name}</div>
                      <Badge
                        className={cn("hover:bg-transparent", getStrategyTone(strategy.status))}
                      >
                        {strategy.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-300">
                      {strategy.lastOutcomeSummary ||
                        "Hermes is carrying this strategy forward in the operator state."}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="border border-dashed border-border bg-sidebar/15 px-3 py-3 text-xs leading-5 text-slate-400">
                No fresh evidence attached.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="border-t border-[#1f2634] px-0 py-3 md:rounded-xl md:border md:border-white/[0.06] md:bg-white/[0.02] md:p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-50">
          <Clock3 className="h-4 w-4 text-sky-300" />
          Strategy timeline
        </div>
        <div className="mt-3 space-y-3">
          {strategyDetail.timeline.stages.map((stage, index) => {
            const isActive = activeStage?.id === stage.id;

            return (
              <div
                key={stage.id}
                className={cn(
                  "border px-3 py-3",
                  isActive ? "border-amber-500/40 bg-amber-500/10" : "border-border bg-sidebar/25",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                      Stage {index + 1}
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-100">{stage.title}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-400">
                      {summarizeAgentStrategyTrigger(stage.triggerPolicy)}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "border-[#2a2e39] text-slate-300",
                      isActive && "border-amber-500/40 text-amber-200",
                    )}
                  >
                    {isActive ? "active" : stage.status}
                  </Badge>
                </div>
                {stage.summary && (
                  <div className="mt-3 text-sm leading-6 text-slate-300">{stage.summary}</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="border-t border-[#1f2634] px-0 py-3 md:rounded-xl md:border md:border-white/[0.06] md:bg-white/[0.02] md:p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-50">
          <Rocket className="h-4 w-4 text-sky-300" />
          Strategy instructions
        </div>
        <div className="mt-2 text-sm leading-6 text-slate-300">{strategyDetail.mandateText}</div>
      </section>

      <section className="border-t border-[#1f2634] px-0 py-3 md:rounded-xl md:border md:border-white/[0.06] md:bg-white/[0.02] md:p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-50">
          <Clock3 className="h-4 w-4 text-sky-300" />
          Operations timeline
        </div>
        <div className="mt-2 space-y-2">
          {recentEvents.length > 0 ? (
            recentEvents.map((event) => (
              <div key={event.id} className="border border-border bg-sidebar/25 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-slate-100">{event.title}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
                    {formatDateTime(event.createdAt)}
                  </div>
                </div>
                {event.summary && (
                  <div className="mt-1 text-xs leading-5 text-slate-300">{event.summary}</div>
                )}
              </div>
            ))
          ) : (
            <div className="border border-dashed border-border bg-sidebar/20 px-3 py-4 text-xs leading-5 text-slate-400">
              Hermes has not logged strategy activity yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function StrategyRulesForm({
  strategyDetail,
  isSaving,
  isReviewing,
  onSave,
  onReview,
}: {
  strategyDetail: AgentStrategyDetail;
  isSaving: boolean;
  isReviewing: boolean;
  onSave: (payload: Record<string, unknown>) => void;
  onReview: () => void;
}) {
  const [draft, setDraft] = useState<StrategyRuleDraft>(() => buildRuleDraft(strategyDetail));
  const reviewState = getResolvedReviewState(strategyDetail);

  useEffect(() => {
    setDraft(buildRuleDraft(strategyDetail));
  }, [strategyDetail.id, strategyDetail.updatedAt]);

  const handleSave = () => {
    const nextMaxActionsPerRun = Number.parseInt(draft.maxActionsPerRun, 10);
    const nextMaxActionsPerDay = Number.parseInt(draft.maxActionsPerDay, 10);

    onSave({
      name: draft.name.trim(),
      summary: draft.summary.trim(),
      mandateText: draft.mandateText.trim(),
      scheduleCron: draft.scheduleCron.trim() || null,
      guardrails: {
        ...strategyDetail.guardrails,
        maxActionsPerRun: Number.isFinite(nextMaxActionsPerRun) ? nextMaxActionsPerRun : 1,
        maxActionsPerDay: Number.isFinite(nextMaxActionsPerDay) ? nextMaxActionsPerDay : 3,
      },
    });
  };

  return (
    <div className="space-y-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:pb-4">
      <section className="border-t border-[#1f2634] px-0 py-3 md:rounded-xl md:border md:border-white/[0.06] md:bg-white/[0.02] md:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-50">
              <Rocket className="h-4 w-4 text-amber-300" />
              Activation review
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-400">
              {reviewState.summary || "Review the saved playbook before Hermes uses it live."}
            </div>
            <div className="mt-3 rounded-sm border border-[#2a2e39] bg-[#0d1320] px-3 py-3 text-xs leading-5 text-slate-300">
              Broad goals are interpreted as ongoing portfolio mandates. By default Hermes should
              pace actions, avoid repetitive concentration in one player, and never use premium,
              checkout, or community boost flows.
            </div>
          </div>
          <Badge className={cn("hover:bg-transparent", getReviewTone(reviewState.status))}>
            {reviewState.status === "approved" ? "approved" : "review needed"}
          </Badge>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="border border-border bg-sidebar/25 p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
              Latest saved change
            </div>
            <div className="mt-2 text-sm text-slate-200">
              {formatDateTime(reviewState.lastMaterialUpdateAt)}
            </div>
          </div>
          <div className="border border-border bg-sidebar/25 p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
              Last approval
            </div>
            <div className="mt-2 text-sm text-slate-200">
              {reviewState.reviewedAt ? formatDateTime(reviewState.reviewedAt) : "Not approved yet"}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {strategyDetail.timeline.stages.map((stage, index) => (
            <div key={stage.id} className="border border-border bg-sidebar/25 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    Stage {index + 1}
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-100">{stage.title}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-400">
                    {summarizeAgentStrategyTrigger(stage.triggerPolicy)}
                  </div>
                </div>
                <Badge variant="outline" className="border-[#2a2e39] text-slate-300">
                  {stage.status}
                </Badge>
              </div>
              {stage.summary ? (
                <div className="mt-2 text-sm leading-6 text-slate-300">{stage.summary}</div>
              ) : null}
            </div>
          ))}
        </div>

        <Button
          variant={reviewState.requiresReview ? "terminal" : "terminalOutline"}
          className="mt-4 h-10"
          onClick={onReview}
          disabled={isReviewing || !reviewState.requiresReview}
        >
          {isReviewing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="mr-2 h-4 w-4" />
          )}
          {reviewState.requiresReview ? "Approve saved playbook" : "Already approved"}
        </Button>
      </section>

      <section className="border-t border-[#1f2634] px-0 py-3 md:rounded-xl md:border md:border-white/[0.06] md:bg-white/[0.02] md:p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-50">
          <Settings2 className="h-4 w-4 text-amber-300" />
          Saved strategy rules
        </div>
        <div className="mt-2 text-sm leading-6 text-slate-400">
          Use chat to refine the idea with Hermes. Save the current name, instructions, schedule,
          and limits here.
        </div>

        <div className="mt-4 grid gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300" htmlFor="strategy-name">
              Name
            </Label>
            <Input
              id="strategy-name"
              className="h-9 rounded-sm border-[#2a2e39] bg-[#0d1320] text-slate-100"
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300" htmlFor="strategy-summary">
              Summary
            </Label>
            <Textarea
              id="strategy-summary"
              className="rounded-sm border-[#2a2e39] bg-[#0d1320] text-slate-100"
              rows={4}
              value={draft.summary}
              onChange={(event) =>
                setDraft((current) => ({ ...current, summary: event.target.value }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300" htmlFor="strategy-mandate">
              Strategy instructions
            </Label>
            <Textarea
              id="strategy-mandate"
              className="rounded-sm border-[#2a2e39] bg-[#0d1320] text-slate-100"
              rows={6}
              value={draft.mandateText}
              onChange={(event) =>
                setDraft((current) => ({ ...current, mandateText: event.target.value }))
              }
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-1">
              <Label className="text-slate-300" htmlFor="strategy-schedule">
                Schedule
              </Label>
              <Input
                id="strategy-schedule"
                className="h-9 rounded-sm border-[#2a2e39] bg-[#0d1320] text-slate-100"
                value={draft.scheduleCron}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, scheduleCron: event.target.value }))
                }
                placeholder="0 8 * * *"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300" htmlFor="strategy-max-run">
                Max actions per run
              </Label>
              <Input
                id="strategy-max-run"
                className="h-9 rounded-sm border-[#2a2e39] bg-[#0d1320] text-slate-100"
                inputMode="numeric"
                value={draft.maxActionsPerRun}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, maxActionsPerRun: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300" htmlFor="strategy-max-day">
                Max actions per day
              </Label>
              <Input
                id="strategy-max-day"
                className="h-9 rounded-sm border-[#2a2e39] bg-[#0d1320] text-slate-100"
                inputMode="numeric"
                value={draft.maxActionsPerDay}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, maxActionsPerDay: event.target.value }))
                }
              />
            </div>
          </div>

          <div className="rounded-sm border border-[#2a2e39] bg-[#0d1320] p-3">
            <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
              Allowed actions
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {strategyDetail.allowedActionTypes.length > 0 ? (
                strategyDetail.allowedActionTypes.map((actionType) => (
                  <Badge
                    key={actionType}
                    variant="outline"
                    className="border-[#2a2e39] text-slate-300"
                  >
                    {actionType.replace(/_/g, " ")}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-slate-400">
                  Hermes can still guide the setup even before action types are narrowed down.
                </span>
              )}
            </div>
          </div>
        </div>

        <Button
          className="mt-4 h-9 rounded-sm bg-slate-100 px-4 text-sm text-slate-950 hover:bg-slate-200"
          onClick={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save strategy
        </Button>
      </section>
    </div>
  );
}

function StrategyChatTab({
  strategyDetail,
  messages,
  pendingUserMessage,
  composerValue,
  onComposerChange,
  onSend,
  onConfirmPlan,
  onCancelPlan,
  isConfirming,
  isCanceling,
  isSending,
  agentEnabled,
  scrollViewportRef,
  endRef,
}: {
  strategyDetail: AgentStrategyDetail;
  messages: AgentThreadMessage[];
  pendingUserMessage: PendingUserMessage | null;
  composerValue: string;
  onComposerChange: (value: string) => void;
  onSend: () => void;
  onConfirmPlan: () => void;
  onCancelPlan: () => void;
  isConfirming: boolean;
  isCanceling: boolean;
  isSending: boolean;
  agentEnabled: boolean;
  scrollViewportRef: RefObject<HTMLDivElement>;
  endRef: RefObject<HTMLDivElement>;
}) {
  const shouldShowEmptyState = messages.length === 0 && !pendingUserMessage;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="border-b border-[#222938] px-0 py-1.5 sm:px-4 md:px-3 md:py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">Strategy chat</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
            {strategyDetail.nextRunAt
              ? `Wake ${formatDateTime(strategyDetail.nextRunAt)}`
              : strategyDetail.status === "live"
                ? "live"
                : strategyDetail.status}
          </div>
        </div>
      </div>
      <div
        ref={scrollViewportRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#0b1120] px-0 py-1.5 pb-2 sm:px-4 md:bg-[linear-gradient(180deg,rgba(15,20,32,0.96),rgba(8,13,24,0.98))] md:px-3 md:py-3"
        data-testid="strategy-chat-scroll"
      >
        {shouldShowEmptyState ? (
          <AgentEmptyConversationState
            isDraftConversation={strategyDetail.status === "draft"}
            enabled={agentEnabled}
            canAnalyze
            starterPrompts={[
              "I want you to buy the best MLB players throughout this week.",
              "Tighten the pace and diversification rules before activation.",
              "Explain why the last run acted or held.",
            ]}
            onUseStarterPrompt={onComposerChange}
          />
        ) : (
          <AgentMessageList
            messages={messages}
            pendingUserMessage={pendingUserMessage}
            onConfirmPlan={onConfirmPlan}
            onCancelPlan={onCancelPlan}
            isConfirming={isConfirming}
            isCanceling={isCanceling}
            endRef={endRef}
          />
        )}
      </div>

      <div className="border-t border-[#222938] px-0 py-1.5 pb-[calc(env(safe-area-inset-bottom)+0.85rem)] sm:px-4 sm:py-2 sm:pb-3 md:px-3">
        <AgentComposer
          value={composerValue}
          onChange={onComposerChange}
          onSend={onSend}
          disabled={!agentEnabled || !composerValue.trim() || isSending}
          isSending={isSending}
          enabled={agentEnabled}
        />
      </div>
    </div>
  );
}

function StrategyDetailWorkspace({
  strategyDetail,
  strategyMessages,
  detailTab,
  onDetailTabChange,
  onBack,
  onSave,
  onActivate,
  onReview,
  onPause,
  onArchive,
  onRunNow,
  isSaving,
  isActivating,
  isReviewing,
  isPausing,
  isArchiving,
  isRunning,
  pendingUserMessage,
  composerValue,
  onComposerChange,
  onSendMessage,
  onConfirmPlan,
  onCancelPlan,
  isConfirming,
  isCanceling,
  isSending,
  agentEnabled,
  scrollViewportRef,
  endRef,
}: {
  strategyDetail: AgentStrategyDetail;
  strategyMessages: AgentThreadMessage[];
  detailTab: StrategyDetailTab;
  onDetailTabChange: (value: StrategyDetailTab) => void;
  onBack: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  onActivate: () => void;
  onReview: () => void;
  onPause: () => void;
  onArchive: () => void;
  onRunNow: () => void;
  isSaving: boolean;
  isActivating: boolean;
  isReviewing: boolean;
  isPausing: boolean;
  isArchiving: boolean;
  isRunning: boolean;
  pendingUserMessage: PendingUserMessage | null;
  composerValue: string;
  onComposerChange: (value: string) => void;
  onSendMessage: () => void;
  onConfirmPlan: () => void;
  onCancelPlan: () => void;
  isConfirming: boolean;
  isCanceling: boolean;
  isSending: boolean;
  agentEnabled: boolean;
  scrollViewportRef: RefObject<HTMLDivElement>;
  endRef: RefObject<HTMLDivElement>;
}) {
  const reviewState = getResolvedReviewState(strategyDetail);
  const needsReview = reviewState.requiresReview;

  const detailBody =
    detailTab === "overview" ? (
      <div
        className="h-full overflow-y-auto overscroll-contain px-0 py-2.5 sm:px-4 sm:py-4"
        data-testid="strategy-overview-scroll"
      >
        <StrategyOverview strategyDetail={strategyDetail} />
      </div>
    ) : detailTab === "chat" ? (
      <StrategyChatTab
        strategyDetail={strategyDetail}
        messages={strategyMessages}
        pendingUserMessage={pendingUserMessage}
        composerValue={composerValue}
        onComposerChange={onComposerChange}
        onSend={onSendMessage}
        onConfirmPlan={onConfirmPlan}
        onCancelPlan={onCancelPlan}
        isConfirming={isConfirming}
        isCanceling={isCanceling}
        isSending={isSending}
        agentEnabled={agentEnabled}
        scrollViewportRef={scrollViewportRef}
        endRef={endRef}
      />
    ) : (
      <div
        className="h-full overflow-y-auto overscroll-contain px-0 py-2.5 sm:px-4 sm:py-4"
        data-testid="strategy-rules-scroll"
      >
        <StrategyRulesForm
          strategyDetail={strategyDetail}
          isSaving={isSaving}
          isReviewing={isReviewing}
          onSave={onSave}
          onReview={onReview}
        />
      </div>
    );

  return (
    <div
      className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden border-t border-[#1f2634] bg-[#0b1120] md:rounded-xl md:border md:border-white/[0.06] md:bg-white/[0.02]"
      data-testid="strategy-detail"
    >
      <div className="border-b border-[#222938] bg-[#0b1120] px-0 py-2 sm:px-4 md:bg-[linear-gradient(180deg,rgba(17,23,39,0.96),rgba(12,17,29,0.98))] md:px-3 md:py-4">
        <div className="space-y-2 md:hidden">
          <div className="flex items-start gap-2">
            <Button
              variant="terminalOutline"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onBack}
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to strategy slots</span>
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    Strategy detail
                  </div>
                  <h2 className="truncate text-sm font-semibold text-slate-50">
                    {strategyDetail.name}
                  </h2>
                </div>
                <Badge
                  className={cn("hover:bg-transparent", getStrategyTone(strategyDetail.status))}
                >
                  {strategyDetail.status === "live" ? "active" : strategyDetail.status}
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500">
                <span>{reviewState.status === "approved" ? "Reviewed" : "Pending review"}</span>
                <span>
                  {strategyDetail.allowedActionTypes.length > 0
                    ? `${strategyDetail.allowedActionTypes.length} actions`
                    : "Scope pending"}
                </span>
                {strategyDetail.nextRunAt ? (
                  <span>{`Wake ${formatDateTime(strategyDetail.nextRunAt)}`}</span>
                ) : null}
                {needsReview ? <span className="text-amber-200">Review needed</span> : null}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {strategyDetail.status === "live" ? (
              <Button
                variant="terminalOutline"
                className="h-8 text-xs"
                onClick={onPause}
                disabled={isPausing}
              >
                {isPausing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PauseCircle className="mr-2 h-4 w-4" />
                )}
                Pause
              </Button>
            ) : (
              <Button
                variant={needsReview ? "terminal" : "terminalOutline"}
                className="h-8 text-xs"
                onClick={onReview}
                disabled={isReviewing || !needsReview || strategyDetail.status === "archived"}
              >
                {isReviewing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {needsReview ? "Approve" : "Approved"}
              </Button>
            )}

            <Button
              variant="terminal"
              className="h-8 border-emerald-500/30 bg-emerald-500/15 px-3 text-xs text-emerald-100 hover:bg-emerald-500/20"
              onClick={onActivate}
              disabled={isActivating || strategyDetail.status === "archived" || needsReview}
            >
              {isActivating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="mr-2 h-4 w-4" />
              )}
              Active
            </Button>

            <Button
              variant="terminalOutline"
              className="h-8 text-xs"
              onClick={onRunNow}
              disabled={isRunning || strategyDetail.status === "archived"}
            >
              {isRunning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Run now
            </Button>

            <Button
              variant="terminalOutline"
              className="h-8 text-xs"
              onClick={onArchive}
              disabled={isArchiving || strategyDetail.status === "archived"}
            >
              {isArchiving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PauseCircle className="mr-2 h-4 w-4" />
              )}
              Archive
            </Button>
          </div>
        </div>

        <div className="hidden flex-wrap items-start justify-between gap-3 md:flex">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-slate-50">
                {strategyDetail.name}
              </h2>
              <Badge className={cn("hover:bg-transparent", getStrategyTone(strategyDetail.status))}>
                {strategyDetail.status === "live" ? "active" : strategyDetail.status}
              </Badge>
              {needsReview ? (
                <span className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-white/60 text-amber-200">review needed</span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-white/60">
                {strategyDetail.nextRunAt
                  ? `Next wake ${formatDateTime(strategyDetail.nextRunAt)}`
                  : "No wake scheduled"}
              </span>
              <span className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-white/60">
                {strategyDetail.allowedActionTypes.length > 0
                  ? `${strategyDetail.allowedActionTypes.length} action types`
                  : "Action scope not finalized"}
              </span>
              <span className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-white/60">
                {reviewState.status === "approved" ? "Reviewed" : "Pending review"}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {strategyDetail.status === "live" ? (
              <Button
                variant="terminalOutline"
                className="h-9"
                onClick={onPause}
                disabled={isPausing}
              >
                {isPausing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PauseCircle className="mr-2 h-4 w-4" />
                )}
                Pause
              </Button>
            ) : (
              <>
                <Button
                  variant={needsReview ? "terminal" : "terminalOutline"}
                  className="h-9"
                  onClick={onReview}
                  disabled={isReviewing || !needsReview || strategyDetail.status === "archived"}
                >
                  {isReviewing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  {needsReview ? "Approve changes" : "Approved"}
                </Button>
                <Button
                  variant="terminal"
                  className="h-9 border-emerald-500/30 bg-emerald-500/15 px-4 text-emerald-100 hover:bg-emerald-500/20"
                  onClick={onActivate}
                  disabled={isActivating || strategyDetail.status === "archived" || needsReview}
                >
                  {isActivating ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <PlayCircle className="mr-2 h-4 w-4" />
                  )}
                  Make active
                </Button>
              </>
            )}
            <Button
              variant="terminalOutline"
              className="h-9"
              onClick={onRunNow}
              disabled={isRunning || strategyDetail.status === "archived"}
            >
              {isRunning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Run now
            </Button>
            <Button
              variant="terminalOutline"
              className="h-9"
              onClick={onArchive}
              disabled={isArchiving || strategyDetail.status === "archived"}
            >
              {isArchiving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PauseCircle className="mr-2 h-4 w-4" />
              )}
              Archive
            </Button>
          </div>
        </div>
      </div>

      <Tabs
        value={detailTab}
        onValueChange={(value) => onDetailTabChange(value as StrategyDetailTab)}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="border-b border-[#222938] px-0 py-1.5 sm:px-4 md:px-3 md:py-3">
          <TabsList variant="terminal" className="grid h-auto w-full grid-cols-3 bg-transparent">
            <TabsTrigger variant="terminal" value="overview">
              Overview
            </TabsTrigger>
            <TabsTrigger variant="terminal" value="chat">
              Chat
            </TabsTrigger>
            <TabsTrigger variant="terminal" value="rules">
              Rules
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{detailBody}</div>
      </Tabs>
    </div>
  );
}

export function AgentStrategiesPanel({
  strategies,
  strategyDetail,
  strategyMessages,
  selectedStrategyId,
  mobileDetailOpen,
  detailTab,
  isLoading,
  isDetailLoading,
  isCreating,
  isSavingId,
  isActivatingId,
  isReviewingId,
  isPausingId,
  isArchivingId,
  isRunningId,
  strategyComposerValue,
  onStrategyComposerChange,
  onStrategySend,
  pendingStrategyMessage,
  strategyScrollViewportRef,
  strategyThreadEndRef,
  onSelect,
  onCloseMobileDetail,
  onCreateBlank,
  onSave,
  onActivate,
  onReview,
  onPause,
  onArchive,
  onRunNow,
  onDetailTabChange,
  onConfirmStrategyPlan,
  onCancelStrategyPlan,
  isConfirmingStrategyPlan,
  isCancelingStrategyPlan,
  isSendingStrategyMessage,
  agentEnabled,
}: {
  strategies: AgentStrategySummary[] | undefined;
  strategyDetail: AgentStrategyDetail | undefined;
  strategyMessages: AgentThreadMessage[] | undefined;
  selectedStrategyId: string | null;
  mobileDetailOpen: boolean;
  detailTab: StrategyDetailTab;
  isLoading: boolean;
  isDetailLoading: boolean;
  isCreating: boolean;
  isSavingId: string | null;
  isActivatingId: string | null;
  isReviewingId: string | null;
  isPausingId: string | null;
  isArchivingId: string | null;
  isRunningId: string | null;
  strategyComposerValue: string;
  onStrategyComposerChange: (value: string) => void;
  onStrategySend: () => void;
  pendingStrategyMessage: PendingUserMessage | null;
  strategyScrollViewportRef: RefObject<HTMLDivElement>;
  strategyThreadEndRef: RefObject<HTMLDivElement>;
  onSelect: (strategyId: string | null) => void;
  onCloseMobileDetail: () => void;
  onCreateBlank: () => void;
  onSave: (strategyId: string, payload: Record<string, unknown>) => void;
  onActivate: (strategyId: string) => void;
  onReview: (strategyId: string) => void;
  onPause: (strategyId: string) => void;
  onArchive: (strategyId: string) => void;
  onRunNow: (strategyId: string) => void;
  onDetailTabChange: (value: StrategyDetailTab) => void;
  onConfirmStrategyPlan: () => void;
  onCancelStrategyPlan: () => void;
  isConfirmingStrategyPlan: boolean;
  isCancelingStrategyPlan: boolean;
  isSendingStrategyMessage: boolean;
  agentEnabled: boolean;
}) {
  const strategyList = strategies || [];
  const selectedDetail = strategyDetail || null;

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[#1f2634] pb-2 md:mb-3 md:gap-3 md:pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-white/60">{`${strategyList.length}/5 templates`}</span>
          <span className="inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-white/60">
            {strategyList.some((strategy) => strategy.status === "live")
              ? "1 active strategy"
              : "No active strategy"}
          </span>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-slate-500">
          {selectedDetail?.nextRunAt
            ? `Next wake ${formatDateTime(selectedDetail.nextRunAt)}`
            : "Awaiting next trigger"}
        </div>
      </div>

      {isLoading && strategyList.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] flex min-h-[14rem] items-center justify-center text-sm text-slate-300">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading strategies...
        </div>
      ) : (
        <>
          <div className="min-h-0 min-w-0 flex-1 md:hidden">
            {!mobileDetailOpen ? (
              <div
                className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
                data-testid="strategy-command-center"
              >
                <div
                  className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
                  data-testid="strategy-command-center-scroll"
                >
                  <StrategyDeskBrief strategies={strategyList} selectedDetail={selectedDetail} />
                  <StrategySlots
                    strategies={strategyList}
                    selectedStrategyId={selectedStrategyId}
                    isCreating={isCreating}
                    onSelect={(strategyId) => {
                      onSelect(strategyId);
                      onDetailTabChange("overview");
                    }}
                    onCreateBlank={onCreateBlank}
                    scrollable={false}
                    showHeader={false}
                  />
                </div>
              </div>
            ) : isDetailLoading && selectedStrategyId ? (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] flex h-full min-h-[18rem] items-center justify-center text-sm text-slate-300">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading strategy details...
              </div>
            ) : selectedDetail ? (
              <StrategyDetailWorkspace
                strategyDetail={selectedDetail}
                strategyMessages={strategyMessages || []}
                detailTab={detailTab}
                onDetailTabChange={onDetailTabChange}
                onBack={onCloseMobileDetail}
                onSave={(payload) => onSave(selectedDetail.id, payload)}
                onActivate={() => onActivate(selectedDetail.id)}
                onReview={() => onReview(selectedDetail.id)}
                onPause={() => onPause(selectedDetail.id)}
                onArchive={() => onArchive(selectedDetail.id)}
                onRunNow={() => onRunNow(selectedDetail.id)}
                isSaving={isSavingId === selectedDetail.id}
                isActivating={isActivatingId === selectedDetail.id}
                isReviewing={isReviewingId === selectedDetail.id}
                isPausing={isPausingId === selectedDetail.id}
                isArchiving={isArchivingId === selectedDetail.id}
                isRunning={isRunningId === selectedDetail.id}
                pendingUserMessage={pendingStrategyMessage}
                composerValue={strategyComposerValue}
                onComposerChange={onStrategyComposerChange}
                onSendMessage={onStrategySend}
                onConfirmPlan={onConfirmStrategyPlan}
                onCancelPlan={onCancelStrategyPlan}
                isConfirming={isConfirmingStrategyPlan}
                isCanceling={isCancelingStrategyPlan}
                isSending={isSendingStrategyMessage}
                agentEnabled={agentEnabled}
                scrollViewportRef={strategyScrollViewportRef}
                endRef={strategyThreadEndRef}
              />
            ) : (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] flex h-full min-h-[18rem] items-center justify-center border-dashed bg-sidebar/15 px-6 text-center text-sm leading-6 text-slate-400">
                Pick a strategy slot to review it, or create a new one to open a dedicated strategy
                chat with Hermes.
              </div>
            )}
          </div>

          <div className="hidden min-h-0 min-w-0 flex-1 flex-col md:flex">
            <StrategyDeskBrief strategies={strategyList} selectedDetail={selectedDetail} />
            <div className="mt-4 min-h-0 min-w-0 flex-1 md:grid md:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)] md:gap-4">
              <div className={cn("min-h-0", selectedStrategyId ? "hidden md:block" : "block")}>
                <StrategySlots
                  strategies={strategyList}
                  selectedStrategyId={selectedStrategyId}
                  isCreating={isCreating}
                  onSelect={(strategyId) => {
                    onSelect(strategyId);
                    onDetailTabChange("overview");
                  }}
                  onCreateBlank={onCreateBlank}
                />
              </div>

              <div className={cn("min-h-0", selectedStrategyId ? "block" : "hidden md:block")}>
                {isDetailLoading && selectedStrategyId ? (
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] flex h-full min-h-[18rem] items-center justify-center text-sm text-slate-300">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading strategy details...
                  </div>
                ) : selectedDetail ? (
                  <StrategyDetailWorkspace
                    strategyDetail={selectedDetail}
                    strategyMessages={strategyMessages || []}
                    detailTab={detailTab}
                    onDetailTabChange={onDetailTabChange}
                    onBack={() => onSelect(null)}
                    onSave={(payload) => onSave(selectedDetail.id, payload)}
                    onActivate={() => onActivate(selectedDetail.id)}
                    onReview={() => onReview(selectedDetail.id)}
                    onPause={() => onPause(selectedDetail.id)}
                    onArchive={() => onArchive(selectedDetail.id)}
                    onRunNow={() => onRunNow(selectedDetail.id)}
                    isSaving={isSavingId === selectedDetail.id}
                    isActivating={isActivatingId === selectedDetail.id}
                    isReviewing={isReviewingId === selectedDetail.id}
                    isPausing={isPausingId === selectedDetail.id}
                    isArchiving={isArchivingId === selectedDetail.id}
                    isRunning={isRunningId === selectedDetail.id}
                    pendingUserMessage={pendingStrategyMessage}
                    composerValue={strategyComposerValue}
                    onComposerChange={onStrategyComposerChange}
                    onSendMessage={onStrategySend}
                    onConfirmPlan={onConfirmStrategyPlan}
                    onCancelPlan={onCancelStrategyPlan}
                    isConfirming={isConfirmingStrategyPlan}
                    isCanceling={isCancelingStrategyPlan}
                    isSending={isSendingStrategyMessage}
                    agentEnabled={agentEnabled}
                    scrollViewportRef={strategyScrollViewportRef}
                    endRef={strategyThreadEndRef}
                  />
                ) : (
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] flex h-full min-h-[18rem] items-center justify-center border-dashed bg-sidebar/15 px-6 text-center text-sm leading-6 text-slate-400">
                    Pick a strategy slot to review it, or create a new one to open a dedicated
                    strategy chat with Hermes.
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
