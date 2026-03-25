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
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
  }
  if (
    normalized.includes("wait") ||
    normalized.includes("pending") ||
    normalized.includes("paused") ||
    normalized.includes("warning")
  ) {
    return "border-amber-500/25 bg-amber-500/10 text-amber-200";
  }
  if (
    normalized.includes("failed") ||
    normalized.includes("blocked") ||
    normalized.includes("error")
  ) {
    return "border-red-500/25 bg-red-500/10 text-red-200";
  }
  return "border-white/[0.06] bg-white/[0.02] text-white/80";
}

function BlockShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 sm:p-4", className)}>
      {children}
    </section>
  );
}

function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("text-[10px] font-medium uppercase tracking-wider text-white/40", className)}>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] font-medium uppercase tracking-wider text-white/35">
      {children}
    </div>
  );
}

function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-white/60",
        className,
      )}
    >
      {children}
    </span>
  );
}

function GoalStripBlock({ block }: { block: Extract<AgentUiBlock, { type: "goal_strip" }> }) {
  return (
    <BlockShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Kicker>{block.props.eyebrow || "Goal"}</Kicker>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight text-white/90 sm:text-lg">
              {block.props.title}
            </h2>
            {block.props.badge ? <Pill>{block.props.badge}</Pill> : null}
          </div>
          {block.props.summary ? (
            <p className="mt-2 text-sm leading-6 text-white/50">{block.props.summary}</p>
          ) : null}
        </div>
        {block.props.status ? (
          <Badge
            className={cn(
              "rounded-full text-[10px] font-medium",
              getStatusTone(block.props.status),
            )}
          >
            {block.props.status.replace(/_/g, " ")}
          </Badge>
        ) : null}
      </div>
      {block.props.nextStep ? (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <FieldLabel>Next</FieldLabel>
          <div className="mt-1 text-sm text-white/80">{block.props.nextStep}</div>
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
    <BlockShell className="border-amber-500/20 bg-amber-500/5">
      <div className="flex flex-wrap items-center gap-2">
        <Kicker className="text-amber-200/70">{block.props.title}</Kicker>
        {block.props.risk ? (
          <Badge
            className={cn(
              "rounded-full text-[10px] font-medium",
              getStatusTone(block.props.risk),
            )}
          >
            {block.props.risk} risk
          </Badge>
        ) : null}
      </div>
      <div className="mt-2 text-sm font-medium text-white/90">{block.props.summary}</div>
      {block.props.helper ? (
        <div className="mt-2 text-sm leading-6 text-white/50">{block.props.helper}</div>
      ) : null}
      {block.props.actionLabel ? (
        <div className="mt-3">
          <Pill className="border-amber-500/20 bg-amber-500/10 text-amber-200">
            {block.props.actionLabel}
          </Pill>
        </div>
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
    <BlockShell className="border-sky-500/20 bg-sky-500/5">
      <Kicker className="text-sky-200/70">
        {block.props.title || "One detail is missing"}
      </Kicker>
      <div className="mt-2 text-sm leading-6 text-white/90">{block.props.prompt}</div>
      {block.props.helper ? (
        <div className="mt-2 text-sm text-white/50">{block.props.helper}</div>
      ) : null}
      {block.props.choices && block.props.choices.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {block.props.choices.slice(0, 3).map((choice) => (
            <Pill key={choice}>{choice}</Pill>
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
          <Kicker>Strategy</Kicker>
          <div className="mt-2 text-base font-semibold text-white/90">{block.props.title}</div>
        </div>
        <Badge
          className={cn(
            "rounded-full text-[10px] font-medium",
            getStatusTone(block.props.status),
          )}
        >
          {block.props.status.replace(/_/g, " ")}
        </Badge>
      </div>
      {block.props.summary ? (
        <div className="mt-3 text-sm leading-6 text-white/50">{block.props.summary}</div>
      ) : null}
      <div className="mt-3 grid gap-3 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
        <div>
          <FieldLabel>Next run</FieldLabel>
          <div className="mt-1 text-sm text-white/80">
            {formatDateTime(block.props.nextRunAt) || "Not scheduled"}
          </div>
        </div>
        <div>
          <FieldLabel>Latest result</FieldLabel>
          <div className="mt-1 text-sm text-white/80">
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
      <Kicker>Draft strategy</Kicker>
      <div className="mt-2 text-base font-semibold text-white/90">{block.props.title}</div>
      {block.props.summary ? (
        <div className="mt-2 text-sm leading-6 text-white/50">{block.props.summary}</div>
      ) : null}
      {block.props.schedule ? (
        <div className="mt-3">
          <Pill>Schedule: {block.props.schedule}</Pill>
        </div>
      ) : null}
      {block.props.actionScope && block.props.actionScope.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {block.props.actionScope.map((item) => (
            <Pill key={item}>{item}</Pill>
          ))}
        </div>
      ) : null}
      {block.props.missingDetails && block.props.missingDetails.length > 0 ? (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <FieldLabel>Still needs</FieldLabel>
          <div className="mt-2 flex flex-wrap gap-2">
            {block.props.missingDetails.map((item) => (
              <Pill key={item} className="border-amber-500/15 text-amber-200/70">
                {item}
              </Pill>
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
      <Kicker>{block.props.title || "Schedule"}</Kicker>
      <div className="mt-3">
        <Pill>{block.props.scheduleLabel}</Pill>
      </div>
      {block.props.helper ? (
        <div className="mt-2 text-sm leading-6 text-white/50">{block.props.helper}</div>
      ) : null}
    </BlockShell>
  );
}

function RulesSummaryBlock({ block }: { block: Extract<AgentUiBlock, { type: "rules_summary" }> }) {
  return (
    <BlockShell>
      <Kicker>{block.props.title || "Rules"}</Kicker>
      <div className="mt-3 space-y-3">
        {block.props.items.map((item) => (
          <div
            key={`${item.label}-${item.value}`}
            className="flex items-center justify-between gap-3"
          >
            <FieldLabel>{item.label}</FieldLabel>
            <div className="text-sm font-semibold text-white/90">{item.value}</div>
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
      <Kicker>{block.props.title || "Performance"}</Kicker>
      <div className="mt-3 flex flex-wrap gap-2.5">
        {block.props.metrics.map((metric) => (
          <div
            key={`${metric.label}-${metric.value}`}
            className="min-w-[9rem] flex-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
          >
            <FieldLabel>{metric.label}</FieldLabel>
            <div
              className={cn(
                "mt-1 text-sm font-semibold sm:text-base",
                metric.tone === "positive"
                  ? "text-emerald-300"
                  : metric.tone === "negative"
                    ? "text-red-300"
                    : metric.tone === "warning"
                      ? "text-amber-200"
                      : "text-white/90",
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
      <Kicker>{block.props.title || "Sources"}</Kicker>
      <div className="mt-3 space-y-3">
        {block.props.sources.map((source) => {
          const body = (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-white/90">{source.title}</div>
                <div className="text-[10px] text-white/30">
                  {formatDateTime(source.retrievedAt) || "Recent"}
                </div>
              </div>
              {source.sourceName ? (
                <div className="mt-1 text-[10px] font-medium uppercase tracking-wider text-white/35">
                  {source.sourceName}
                </div>
              ) : null}
              {source.factSummary ? (
                <div className="mt-2 text-sm leading-6 text-white/50">
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
              className="block rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.04]"
            >
              {body}
            </a>
          ) : (
            <div key={source.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
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
        <Kicker>{block.props.title || "Run summary"}</Kicker>
        {block.props.status ? (
          <Badge
            className={cn(
              "rounded-full text-[10px] font-medium",
              getStatusTone(block.props.status),
            )}
          >
            {block.props.status.replace(/_/g, " ")}
          </Badge>
        ) : null}
      </div>
      <div className="mt-2 text-sm leading-6 text-white/90">{block.props.summary}</div>
      {(block.props.trigger || block.props.transport || block.props.createdAt) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {block.props.trigger ? (
            <Pill>{block.props.trigger.replace(/_/g, " ")}</Pill>
          ) : null}
          {block.props.transport ? (
            <Pill>via {block.props.transport}</Pill>
          ) : null}
          {block.props.createdAt ? (
            <Pill>{formatDateTime(block.props.createdAt) || "Recent"}</Pill>
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
