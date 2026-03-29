import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import type {
  AgentUiBlock,
  AgentUiChecklistStatus,
  AgentUiEntityCell,
  AgentUiTone,
} from "@shared/agent-ui";
import { PlayerModal } from "@/components/player-modal";
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

function getToneTextClass(tone: AgentUiTone | null | undefined) {
  switch (tone) {
    case "accent":
      return "text-sky-200";
    case "positive":
      return "text-emerald-300";
    case "warning":
      return "text-amber-200";
    case "negative":
      return "text-red-300";
    default:
      return "text-white/90";
  }
}

function getTonePillClass(tone: AgentUiTone | null | undefined) {
  switch (tone) {
    case "accent":
      return "border-sky-500/20 bg-sky-500/10 text-sky-200";
    case "positive":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
    case "warning":
      return "border-amber-500/20 bg-amber-500/10 text-amber-200";
    case "negative":
      return "border-red-500/20 bg-red-500/10 text-red-200";
    default:
      return "border-white/[0.08] bg-white/[0.04] text-white/60";
  }
}

function getAlignClass(align: AgentUiEntityCell["align"]) {
  switch (align) {
    case "center":
      return "text-center";
    case "right":
      return "text-right";
    default:
      return "text-left";
  }
}

function getChecklistStatusLabel(status: AgentUiChecklistStatus) {
  return status.replace(/_/g, " ");
}

function BlockShell({
  children,
  className,
  ...props
}: {
  children: ReactNode;
  className?: string;
} & ComponentPropsWithoutRef<"section">) {
  return (
    <section
      {...props}
      className={cn("rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 sm:p-4", className)}
    >
      {children}
    </section>
  );
}

function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("text-[10px] font-medium uppercase tracking-wider text-white/40", className)}
    >
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] font-medium uppercase tracking-wider text-white/35">{children}</div>
  );
}

function Pill({
  children,
  className,
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: AgentUiTone | null;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-medium",
        getTonePillClass(tone),
        className,
      )}
    >
      {children}
    </span>
  );
}

function extractPlayerId(href?: string | null, entityId?: string | null) {
  if (entityId?.trim()) {
    return entityId.trim();
  }

  if (!href) {
    return null;
  }

  const match = href.match(/^\/player\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function EntityCellButton({
  cell,
  onOpenPlayer,
}: {
  cell: AgentUiEntityCell;
  onOpenPlayer: (playerId: string) => void;
}) {
  const playerId =
    cell.entityType === "player" || (cell.href || "").startsWith("/player/")
      ? extractPlayerId(cell.href, cell.entityId)
      : null;

  const content = (
    <>
      <span className={cn("font-medium", getToneTextClass(cell.tone))}>{cell.text}</span>
      {cell.badge ? (
        <span className="ml-2 inline-flex rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-white/55">
          {cell.badge}
        </span>
      ) : null}
      {cell.secondaryText ? (
        <div className="mt-0.5 text-[11px] leading-4 text-white/45">{cell.secondaryText}</div>
      ) : null}
    </>
  );

  if (playerId) {
    return (
      <button
        type="button"
        onClick={() => onOpenPlayer(playerId)}
        className="w-full text-left transition-colors hover:text-white"
      >
        {content}
      </button>
    );
  }

  if (cell.href) {
    return (
      <a href={cell.href} className="block transition-colors hover:text-white">
        {content}
      </a>
    );
  }

  return <div>{content}</div>;
}

function TableCellContent({
  cell,
  onOpenPlayer,
}: {
  cell: AgentUiEntityCell;
  onOpenPlayer: (playerId: string) => void;
}) {
  if (cell.href || cell.entityType === "player" || cell.entityId) {
    return <EntityCellButton cell={cell} onOpenPlayer={onOpenPlayer} />;
  }

  return (
    <div>
      <span className={cn("font-medium", getToneTextClass(cell.tone))}>{cell.text}</span>
      {cell.badge ? (
        <span className="ml-2 inline-flex rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-white/55">
          {cell.badge}
        </span>
      ) : null}
      {cell.secondaryText ? (
        <div className="mt-0.5 text-[11px] leading-4 text-white/45">{cell.secondaryText}</div>
      ) : null}
    </div>
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
            className={cn("rounded-full text-[10px] font-medium", getStatusTone(block.props.risk))}
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
      <Kicker className="text-sky-200/70">{block.props.title || "One detail is missing"}</Kicker>
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
          className={cn("rounded-full text-[10px] font-medium", getStatusTone(block.props.status))}
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

function StatHighlightStripBlock({
  block,
}: {
  block: Extract<AgentUiBlock, { type: "stat_highlight_strip" }>;
}) {
  return (
    <BlockShell className="space-y-3">
      {block.props.title ? <Kicker>{block.props.title}</Kicker> : null}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {block.props.items.map((item) => (
          <div
            key={`${item.label}-${item.value}`}
            className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2.5"
          >
            <FieldLabel>{item.label}</FieldLabel>
            <div className={cn("mt-1 text-sm font-semibold", getToneTextClass(item.tone))}>
              {item.value}
            </div>
            {item.helper ? (
              <div className="mt-1 text-[11px] leading-4 text-white/45">{item.helper}</div>
            ) : null}
          </div>
        ))}
      </div>
      {block.props.helper ? (
        <div className="text-xs leading-5 text-white/45">{block.props.helper}</div>
      ) : null}
    </BlockShell>
  );
}

function LeaderboardTableBlock({
  block,
  onOpenPlayer,
}: {
  block: Extract<AgentUiBlock, { type: "leaderboard_table" }>;
  onOpenPlayer: (playerId: string) => void;
}) {
  if (block.props.leaders.length === 0) {
    return (
      <BlockShell>
        <Kicker>{block.props.title || "Leaderboard"}</Kicker>
        <div className="mt-3 text-sm text-white/50">
          {block.props.emptyState || "No leaders available."}
        </div>
      </BlockShell>
    );
  }

  return (
    <BlockShell data-testid="agent-ui-leaderboard-table">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Kicker>{block.props.title || "Leaderboard"}</Kicker>
          <div className="mt-1 text-sm font-semibold text-white/90">{block.props.statLabel}</div>
        </div>
        {block.props.helper ? (
          <div className="max-w-sm text-right text-[11px] leading-5 text-white/45">
            {block.props.helper}
          </div>
        ) : null}
      </div>

      <div className="-mx-3 mt-3 overflow-x-auto px-3">
        <table className="w-full min-w-[34rem] border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-y border-white/[0.06] bg-white/[0.03] text-white/55">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Player</th>
              <th className="px-3 py-2 font-medium">Team</th>
              <th className="px-3 py-2 text-right font-medium">{block.props.statLabel}</th>
              {block.props.secondaryStatLabel ? (
                <th className="px-3 py-2 text-right font-medium">
                  {block.props.secondaryStatLabel}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {block.props.leaders.map((leader) => {
              const playerId = extractPlayerId(leader.href, leader.playerId);
              return (
                <tr key={leader.id} className="border-b border-white/[0.05] align-top">
                  <td className="px-3 py-2.5 font-mono text-white/45">{leader.rank}</td>
                  <td className="px-3 py-2.5">
                    {playerId ? (
                      <button
                        type="button"
                        onClick={() => onOpenPlayer(playerId)}
                        className="text-left transition-colors hover:text-white"
                      >
                        <div className={cn("font-medium", getToneTextClass(leader.tone))}>
                          {leader.playerName}
                        </div>
                        {(leader.secondaryText || leader.note || leader.badge) && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-white/45">
                            {leader.badge ? <Pill className="py-0.5">{leader.badge}</Pill> : null}
                            {leader.secondaryText ? <span>{leader.secondaryText}</span> : null}
                            {leader.note ? <span>{leader.note}</span> : null}
                          </div>
                        )}
                      </button>
                    ) : (
                      <div>
                        <div className={cn("font-medium", getToneTextClass(leader.tone))}>
                          {leader.playerName}
                        </div>
                        {(leader.secondaryText || leader.note || leader.badge) && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-white/45">
                            {leader.badge ? <Pill className="py-0.5">{leader.badge}</Pill> : null}
                            {leader.secondaryText ? <span>{leader.secondaryText}</span> : null}
                            {leader.note ? <span>{leader.note}</span> : null}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-white/65">{leader.team || "-"}</td>
                  <td
                    className={cn(
                      "px-3 py-2.5 text-right font-semibold",
                      getToneTextClass(leader.tone),
                    )}
                  >
                    {leader.primaryValue}
                  </td>
                  {block.props.secondaryStatLabel ? (
                    <td className="px-3 py-2.5 text-right text-white/65">
                      {leader.secondaryValue || "-"}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </BlockShell>
  );
}

function EntityTableBlock({
  block,
  onOpenPlayer,
}: {
  block: Extract<AgentUiBlock, { type: "entity_table" }>;
  onOpenPlayer: (playerId: string) => void;
}) {
  if (block.props.rows.length === 0) {
    return (
      <BlockShell>
        <Kicker>{block.props.title || "Table"}</Kicker>
        <div className="mt-3 text-sm text-white/50">
          {block.props.emptyState || "No rows available."}
        </div>
      </BlockShell>
    );
  }

  const hasRank = block.props.rows.some((row) => typeof row.rank === "number");

  return (
    <BlockShell data-testid="agent-ui-entity-table">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Kicker>{block.props.title || "Results"}</Kicker>
          {block.props.helper ? (
            <div className="mt-1 text-[11px] leading-5 text-white/45">{block.props.helper}</div>
          ) : null}
        </div>
      </div>
      <div className="-mx-3 mt-3 overflow-x-auto px-3">
        <table className="w-full min-w-[34rem] border-collapse text-left text-[12px]">
          <thead>
            <tr className="border-y border-white/[0.06] bg-white/[0.03] text-white/55">
              {hasRank ? <th className="px-3 py-2 font-medium">#</th> : null}
              {block.props.columns.map((column) => (
                <th
                  key={column.key}
                  className={cn("px-3 py-2 font-medium", getAlignClass(column.align))}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.props.rows.map((row) => (
              <tr key={row.id} className="border-b border-white/[0.05] align-top">
                {hasRank ? (
                  <td className="px-3 py-2.5 font-mono text-white/45">{row.rank ?? "-"}</td>
                ) : null}
                {block.props.columns.map((column) => {
                  const cell = row.cells[column.key] || { text: "-" };
                  return (
                    <td
                      key={`${row.id}-${column.key}`}
                      className={cn("px-3 py-2.5", getAlignClass(cell.align || column.align))}
                    >
                      <TableCellContent cell={cell} onOpenPlayer={onOpenPlayer} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BlockShell>
  );
}

function ScheduleBoardBlock({
  block,
}: {
  block: Extract<AgentUiBlock, { type: "schedule_board" }>;
}) {
  if (block.props.rows.length === 0) {
    return (
      <BlockShell>
        <Kicker>{block.props.title || "Schedule"}</Kicker>
        <div className="mt-3 text-sm text-white/50">
          {block.props.emptyState || "No games available."}
        </div>
      </BlockShell>
    );
  }

  return (
    <BlockShell data-testid="agent-ui-schedule-board">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Kicker>{block.props.title || "Schedule"}</Kicker>
          {block.props.helper ? (
            <div className="mt-1 text-[11px] leading-5 text-white/45">{block.props.helper}</div>
          ) : null}
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {block.props.rows.map((row) => {
          const content = (
            <div className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white/90">{row.matchup}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-white/45">
                    {row.startTime ? <span>{row.startTime}</span> : null}
                    {row.status ? <span>{row.status}</span> : null}
                    {row.venue ? <span>{row.venue}</span> : null}
                  </div>
                </div>
                {row.chips && row.chips.length > 0 ? (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {row.chips.slice(0, 3).map((chip) => (
                      <Pill key={`${row.id}-${chip}`}>{chip}</Pill>
                    ))}
                  </div>
                ) : null}
              </div>
              {(row.probableAwayPitcher || row.probableHomePitcher) && (
                <div className="mt-2 grid gap-2 text-[11px] text-white/55 sm:grid-cols-2">
                  <div>
                    <FieldLabel>Away probable</FieldLabel>
                    <div className="mt-1 text-sm text-white/85">
                      {row.probableAwayPitcher || "-"}
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Home probable</FieldLabel>
                    <div className="mt-1 text-sm text-white/85">
                      {row.probableHomePitcher || "-"}
                    </div>
                  </div>
                </div>
              )}
              {row.note ? (
                <div className="mt-2 text-[11px] leading-5 text-white/45">{row.note}</div>
              ) : null}
            </div>
          );

          return row.href ? (
            <a
              key={row.id}
              href={row.href}
              className="block transition-colors hover:bg-white/[0.02]"
            >
              {content}
            </a>
          ) : (
            <div key={row.id}>{content}</div>
          );
        })}
      </div>
    </BlockShell>
  );
}

function ExecutionChecklistBlock({
  block,
}: {
  block: Extract<AgentUiBlock, { type: "execution_checklist" }>;
}) {
  return (
    <BlockShell data-testid="agent-ui-execution-checklist">
      <Kicker>{block.props.title || "Execution"}</Kicker>
      {block.props.summary ? (
        <div className="mt-2 text-sm leading-6 text-white/50">{block.props.summary}</div>
      ) : null}
      <div className="mt-3 space-y-2">
        {block.props.items.map((item, index) => (
          <div
            key={item.id}
            className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2.5"
          >
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-[11px] font-medium text-white/55">
              {index + 1}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-white/90">{item.label}</div>
                <Pill
                  className="py-0.5"
                  tone={
                    item.status === "done"
                      ? "positive"
                      : item.status === "blocked"
                        ? "negative"
                        : item.status === "pending"
                          ? "warning"
                          : "accent"
                  }
                >
                  {getChecklistStatusLabel(item.status)}
                </Pill>
              </div>
              {item.detail ? (
                <div className="mt-1 text-[11px] leading-5 text-white/45">{item.detail}</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </BlockShell>
  );
}

function ToolCatalogSummaryBlock({
  block,
}: {
  block: Extract<AgentUiBlock, { type: "tool_catalog_summary" }>;
}) {
  return (
    <BlockShell data-testid="agent-ui-tool-catalog-summary">
      <Kicker>{block.props.title || "Tool catalog"}</Kicker>
      {block.props.helper ? (
        <div className="mt-2 text-sm leading-6 text-white/50">{block.props.helper}</div>
      ) : null}
      <div className="mt-3 space-y-3">
        {block.props.groups.map((group) => (
          <div key={group.id} className="rounded-lg border border-white/[0.06] bg-black/10 p-3">
            <div className="text-[11px] font-medium uppercase tracking-wider text-white/40">
              {group.label}
            </div>
            <div className="mt-2 space-y-2">
              {group.tools.map((tool) => (
                <div
                  key={`${group.id}-${tool.name}`}
                  className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-white/90">{tool.name}</div>
                    {tool.riskLevel ? <Pill>{tool.riskLevel} risk</Pill> : null}
                    {tool.presentationProfile ? (
                      <Pill tone="accent">{tool.presentationProfile}</Pill>
                    ) : null}
                    {tool.primaryEntityType ? <Pill>{tool.primaryEntityType}</Pill> : null}
                  </div>
                  <div className="mt-1 text-[11px] leading-5 text-white/45">{tool.description}</div>
                  {tool.examplePrompt ? (
                    <div className="mt-2 text-[11px] leading-5 text-sky-200/80">
                      Example: {tool.examplePrompt}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
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
                <div className="mt-2 text-sm leading-6 text-white/50">{source.factSummary}</div>
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
            <div
              key={source.id}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
            >
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
          {block.props.trigger ? <Pill>{block.props.trigger.replace(/_/g, " ")}</Pill> : null}
          {block.props.transport ? <Pill>via {block.props.transport}</Pill> : null}
          {block.props.createdAt ? (
            <Pill>{formatDateTime(block.props.createdAt) || "Recent"}</Pill>
          ) : null}
        </div>
      )}
    </BlockShell>
  );
}

function renderBlock(block: AgentUiBlock, onOpenPlayer: (playerId: string) => void) {
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
    case "stat_highlight_strip":
      return <StatHighlightStripBlock block={block} />;
    case "leaderboard_table":
      return <LeaderboardTableBlock block={block} onOpenPlayer={onOpenPlayer} />;
    case "entity_table":
      return <EntityTableBlock block={block} onOpenPlayer={onOpenPlayer} />;
    case "schedule_board":
      return <ScheduleBoardBlock block={block} />;
    case "execution_checklist":
      return <ExecutionChecklistBlock block={block} />;
    case "tool_catalog_summary":
      return <ToolCatalogSummaryBlock block={block} />;
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
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);

  const sortedBlocks = [...(blocks || [])].sort((left, right) => {
    return (left.priority || 0) - (right.priority || 0);
  });

  if (sortedBlocks.length === 0) {
    return null;
  }

  return (
    <>
      <div className={cn("space-y-3", className)}>
        {sortedBlocks.map((block, index) => (
          <div key={`${block.type}-${block.slot || "slot"}-${index}`}>
            {renderBlock(block, setActivePlayerId)}
          </div>
        ))}
      </div>
      <PlayerModal
        playerId={activePlayerId}
        open={Boolean(activePlayerId)}
        onOpenChange={(open) => {
          if (!open) {
            setActivePlayerId(null);
          }
        }}
      />
    </>
  );
}
