import type { ReactNode } from "react";
import type { AgentUiBlock } from "@shared/agent-ui";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getStatusTone(status: string | null | undefined) {
  const normalized = (status || "").toLowerCase();
  if (
    normalized.includes("active") ||
    normalized.includes("live") ||
    normalized.includes("completed") ||
    normalized.includes("tracking")
  ) {
    return "terminal-status-positive";
  }
  if (
    normalized.includes("wait") ||
    normalized.includes("pending") ||
    normalized.includes("paused") ||
    normalized.includes("warning")
  ) {
    return "terminal-status-warning";
  }
  if (
    normalized.includes("failed") ||
    normalized.includes("blocked") ||
    normalized.includes("error")
  ) {
    return "terminal-status-negative";
  }
  return "border-border bg-card text-foreground";
}

function BlockShell({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("terminal-shell p-3 sm:p-4", className)}>{children}</section>;
}

function GoalStripBlock({ block }: { block: Extract<AgentUiBlock, { type: "goal_strip" }> }) {
  return (
    <BlockShell className="bg-card/95">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="terminal-kicker">{block.props.eyebrow || "Goal"}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
              {block.props.title}
            </h2>
            {block.props.badge ? (
              <span className="terminal-strip py-1">{block.props.badge}</span>
            ) : null}
          </div>
          {block.props.summary ? (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{block.props.summary}</p>
          ) : null}
        </div>
        {block.props.status ? (
          <Badge
            className={cn(
              "rounded-sm font-mono text-[10px] uppercase tracking-[0.12em]",
              getStatusTone(block.props.status),
            )}
          >
            {block.props.status.replace(/_/g, " ")}
          </Badge>
        ) : null}
      </div>
      {block.props.nextStep ? (
        <div className="mt-3 border-t border-border pt-3">
          <div className="terminal-label">Next</div>
          <div className="mt-1 text-sm text-foreground">{block.props.nextStep}</div>
        </div>
      ) : null}
    </BlockShell>
  );
}

function PendingDecisionBlock({
  block,
}: {
  block: Extract<AgentUiBlock, { type: "pending_decision" }>;
}) {
  return (
    <BlockShell className="border-amber-500/30 bg-amber-500/10">
      <div className="flex flex-wrap items-center gap-2">
        <div className="terminal-kicker text-amber-200">{block.props.title}</div>
        {block.props.risk ? (
          <Badge
            className={cn(
              "rounded-sm font-mono text-[10px] uppercase tracking-[0.12em]",
              getStatusTone(block.props.risk),
            )}
          >
            {block.props.risk} risk
          </Badge>
        ) : null}
      </div>
      <div className="mt-2 text-sm font-medium text-foreground">{block.props.summary}</div>
      {block.props.helper ? (
        <div className="mt-2 text-sm leading-6 text-muted-foreground">{block.props.helper}</div>
      ) : null}
      {block.props.actionLabel ? (
        <div className="mt-3 terminal-strip py-1.5">{block.props.actionLabel}</div>
      ) : null}
    </BlockShell>
  );
}

function ClarificationBlock({
  block,
}: {
  block: Extract<AgentUiBlock, { type: "clarification_card" }>;
}) {
  return (
    <BlockShell className="border-sky-500/30 bg-sky-500/10">
      <div className="terminal-kicker text-sky-200">
        {block.props.title || "One detail is missing"}
      </div>
      <div className="mt-2 text-sm leading-6 text-foreground">{block.props.prompt}</div>
      {block.props.helper ? (
        <div className="mt-2 text-sm text-muted-foreground">{block.props.helper}</div>
      ) : null}
      {block.props.choices && block.props.choices.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {block.props.choices.slice(0, 3).map((choice) => (
            <span key={choice} className="terminal-strip py-1">
              {choice}
            </span>
          ))}
        </div>
      ) : null}
    </BlockShell>
  );
}

function StrategyStatusBlock({
  block,
}: {
  block: Extract<AgentUiBlock, { type: "strategy_status" }>;
}) {
  return (
    <BlockShell>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="terminal-kicker">Strategy</div>
          <div className="mt-2 text-base font-semibold text-foreground">{block.props.title}</div>
        </div>
        <Badge
          className={cn(
            "rounded-sm font-mono text-[10px] uppercase tracking-[0.12em]",
            getStatusTone(block.props.status),
          )}
        >
          {block.props.status.replace(/_/g, " ")}
        </Badge>
      </div>
      {block.props.summary ? (
        <div className="mt-3 text-sm leading-6 text-muted-foreground">{block.props.summary}</div>
      ) : null}
      <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
        <div>
          <div className="terminal-label">Next run</div>
          <div className="mt-1 text-sm text-foreground">
            {formatDateTime(block.props.nextRunAt) || "Not scheduled"}
          </div>
        </div>
        <div>
          <div className="terminal-label">Latest result</div>
          <div className="mt-1 text-sm text-foreground">
            {block.props.lastResult || "No run recorded yet"}
          </div>
        </div>
      </div>
    </BlockShell>
  );
}

function StrategyDraftBlock({
  block,
}: {
  block: Extract<AgentUiBlock, { type: "strategy_draft" }>;
}) {
  return (
    <BlockShell>
      <div className="terminal-kicker">Draft strategy</div>
      <div className="mt-2 text-base font-semibold text-foreground">{block.props.title}</div>
      {block.props.summary ? (
        <div className="mt-2 text-sm leading-6 text-muted-foreground">{block.props.summary}</div>
      ) : null}
      {block.props.schedule ? (
        <div className="mt-3 terminal-strip py-1.5">Schedule: {block.props.schedule}</div>
      ) : null}
      {block.props.actionScope && block.props.actionScope.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {block.props.actionScope.map((item) => (
            <span key={item} className="terminal-strip py-1">
              {item}
            </span>
          ))}
        </div>
      ) : null}
      {block.props.missingDetails && block.props.missingDetails.length > 0 ? (
        <div className="mt-3 border-t border-border pt-3">
          <div className="terminal-label">Still needs</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {block.props.missingDetails.map((item) => (
              <span key={item} className="terminal-strip py-1">
                {item}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </BlockShell>
  );
}

function ScheduleSummaryBlock({
  block,
}: {
  block: Extract<AgentUiBlock, { type: "schedule_summary" }>;
}) {
  return (
    <BlockShell>
      <div className="terminal-kicker">{block.props.title || "Schedule"}</div>
      <div className="mt-3 terminal-strip py-1.5">{block.props.scheduleLabel}</div>
      {block.props.helper ? (
        <div className="mt-2 text-sm leading-6 text-muted-foreground">{block.props.helper}</div>
      ) : null}
    </BlockShell>
  );
}

function RulesSummaryBlock({ block }: { block: Extract<AgentUiBlock, { type: "rules_summary" }> }) {
  return (
    <BlockShell>
      <div className="terminal-kicker">{block.props.title || "Rules"}</div>
      <div className="mt-3 space-y-3">
        {block.props.items.map((item) => (
          <div
            key={`${item.label}-${item.value}`}
            className="flex items-center justify-between gap-3"
          >
            <div className="terminal-label">{item.label}</div>
            <div className="terminal-value text-sm">{item.value}</div>
          </div>
        ))}
      </div>
    </BlockShell>
  );
}

function PerformanceSummaryBlock({
  block,
}: {
  block: Extract<AgentUiBlock, { type: "performance_summary" }>;
}) {
  return (
    <BlockShell>
      <div className="terminal-kicker">{block.props.title || "Performance"}</div>
      <div className="mt-3 flex flex-wrap gap-2.5">
        {block.props.metrics.map((metric) => (
          <div
            key={`${metric.label}-${metric.value}`}
            className="min-w-[9rem] flex-1 border border-border bg-sidebar/20 px-3 py-2.5"
          >
            <div className="terminal-label">{metric.label}</div>
            <div
              className={cn(
                "mt-1 text-sm font-semibold sm:text-base",
                metric.tone === "positive"
                  ? "text-emerald-300"
                  : metric.tone === "negative"
                    ? "text-red-300"
                    : metric.tone === "warning"
                      ? "text-amber-200"
                      : "text-foreground",
              )}
            >
              {metric.value}
            </div>
          </div>
        ))}
      </div>
    </BlockShell>
  );
}

function SourceListBlock({ block }: { block: Extract<AgentUiBlock, { type: "source_list" }> }) {
  return (
    <BlockShell>
      <div className="terminal-kicker">{block.props.title || "Sources"}</div>
      <div className="mt-3 space-y-3">
        {block.props.sources.map((source) => {
          const body = (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-foreground">{source.title}</div>
                <div className="terminal-subtle">
                  {formatDateTime(source.retrievedAt) || "Recent"}
                </div>
              </div>
              {source.sourceName ? (
                <div className="mt-1 terminal-label">{source.sourceName}</div>
              ) : null}
              {source.factSummary ? (
                <div className="mt-2 text-sm leading-6 text-muted-foreground">
                  {source.factSummary}
                </div>
              ) : null}
            </>
          );

          return source.url ? (
            <a
              key={source.id}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="block border border-border bg-sidebar/20 p-3 transition-colors hover:bg-sidebar/35"
            >
              {body}
            </a>
          ) : (
            <div key={source.id} className="border border-border bg-sidebar/20 p-3">
              {body}
            </div>
          );
        })}
      </div>
    </BlockShell>
  );
}

function RunSummaryBlock({ block }: { block: Extract<AgentUiBlock, { type: "run_summary" }> }) {
  return (
    <BlockShell>
      <div className="flex flex-wrap items-center gap-2">
        <div className="terminal-kicker">{block.props.title || "Run summary"}</div>
        {block.props.status ? (
          <Badge
            className={cn(
              "rounded-sm font-mono text-[10px] uppercase tracking-[0.12em]",
              getStatusTone(block.props.status),
            )}
          >
            {block.props.status.replace(/_/g, " ")}
          </Badge>
        ) : null}
      </div>
      <div className="mt-2 text-sm leading-6 text-foreground">{block.props.summary}</div>
      {(block.props.trigger || block.props.transport || block.props.createdAt) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {block.props.trigger ? (
            <span className="terminal-strip py-1">{block.props.trigger.replace(/_/g, " ")}</span>
          ) : null}
          {block.props.transport ? (
            <span className="terminal-strip py-1">via {block.props.transport}</span>
          ) : null}
          {block.props.createdAt ? (
            <span className="terminal-strip py-1">
              {formatDateTime(block.props.createdAt) || "Recent"}
            </span>
          ) : null}
        </div>
      )}
    </BlockShell>
  );
}

function renderBlock(block: AgentUiBlock) {
  switch (block.type) {
    case "goal_strip":
      return <GoalStripBlock block={block} />;
    case "pending_decision":
      return <PendingDecisionBlock block={block} />;
    case "clarification_card":
      return <ClarificationBlock block={block} />;
    case "strategy_draft":
      return <StrategyDraftBlock block={block} />;
    case "strategy_status":
      return <StrategyStatusBlock block={block} />;
    case "schedule_summary":
      return <ScheduleSummaryBlock block={block} />;
    case "rules_summary":
      return <RulesSummaryBlock block={block} />;
    case "performance_summary":
      return <PerformanceSummaryBlock block={block} />;
    case "source_list":
      return <SourceListBlock block={block} />;
    case "run_summary":
      return <RunSummaryBlock block={block} />;
    default:
      return null;
  }
}

export function AgentUiBlockList({
  blocks,
  className,
}: {
  blocks: AgentUiBlock[] | null | undefined;
  className?: string;
}) {
  const sortedBlocks = [...(blocks || [])].sort((left, right) => {
    return (left.priority || 0) - (right.priority || 0);
  });

  if (sortedBlocks.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-3", className)}>
      {sortedBlocks.map((block, index) => (
        <div key={`${block.type}-${block.slot || "slot"}-${index}`}>{renderBlock(block)}</div>
      ))}
    </div>
  );
}
