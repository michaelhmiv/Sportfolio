import { Bot, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentThreadRuntimeDetails, AgentThreadSummary, AgentThreadMessage } from "../types";
import type { AgentUiBlock } from "@shared/agent-ui";
import { AgentUiBlockList } from "./agent-ui-blocks";

function buildChatHeaderBlocks({
  activeThread,
  messages,
  runtimeDetails,
}: {
  activeThread: AgentThreadSummary | null;
  messages: AgentThreadMessage[] | undefined;
  runtimeDetails: AgentThreadRuntimeDetails | undefined;
}): AgentUiBlock[] {
  const latestAssistantMessage = [...(messages || [])]
    .reverse()
    .find((m) => m.role === "assistant");
  const topLevelBlocks = (latestAssistantMessage?.uiBlocks || []).filter(
    (b) => b.slot === "chat_header" || b.slot === "chat_inline",
  );

  if (topLevelBlocks.length > 0) return topLevelBlocks;

  const objective = runtimeDetails?.activeObjective;
  const pendingBundle = activeThread?.pendingActionBundle || null;
  const blocks: AgentUiBlock[] = [
    {
      type: "goal_strip",
      slot: "chat_header",
      priority: 10,
      props: {
        eyebrow: "Current goal",
        title: objective?.title || activeThread?.title || "Start a chat with Hermes",
        status:
          pendingBundle || latestAssistantMessage?.pendingClarification
            ? "waiting_on_you"
            : objective?.status || "tracking",
        summary:
          pendingBundle?.summary ||
          objective?.summary ||
          activeThread?.lastMessagePreview ||
          "Use Chat for one-off asks, quick reads, and direct portfolio instructions.",
        nextStep:
          objective?.nextStep ||
          (pendingBundle ? "Review the staged plan below." : "Ask Hermes for the next move."),
        badge:
          runtimeDetails?.sinceLastUserMessage?.eventCount &&
          runtimeDetails.sinceLastUserMessage.eventCount > 0
            ? `${runtimeDetails.sinceLastUserMessage.eventCount} new`
            : null,
      },
    },
  ];

  if (latestAssistantMessage?.pendingClarification) {
    blocks.push({
      type: "clarification_card",
      slot: "chat_inline",
      priority: 20,
      props: {
        title: "Waiting on you",
        prompt: latestAssistantMessage.pendingClarification.prompt,
        helper: "Reply in chat and Hermes will keep going.",
        choices: latestAssistantMessage.pendingClarification.workflowPreviewSteps || [],
      },
    });
  } else if (pendingBundle) {
    blocks.push({
      type: "pending_decision",
      slot: "chat_inline",
      priority: 20,
      props: {
        title: "Pending plan",
        summary: pendingBundle.summary,
        risk: latestAssistantMessage?.confirmationPreview?.riskClass || null,
        helper:
          latestAssistantMessage?.confirmationPreview?.estimatedImpact ||
          latestAssistantMessage?.confirmationPreview?.warnings?.[0] ||
          "Review the staged action details in the latest Hermes reply.",
        actionLabel: "Review the staged plan",
      },
    });
  }

  if ((runtimeDetails?.researchSources.length || 0) > 0) {
    blocks.push({
      type: "source_list",
      slot: "chat_inline",
      priority: 40,
      props: {
        title: "Recent sources",
        sources: runtimeDetails!.researchSources.slice(0, 2).map((s) => ({
          id: s.id,
          title: s.title,
          sourceName: s.sourceName,
          retrievedAt: s.retrievedAt,
          url: s.url,
          factSummary: s.factSummary,
        })),
      },
    });
  }

  return blocks;
}

export function AgentStatusHeader({
  activeThread,
  messages,
  runtimeDetails,
  enabled,
  canAnalyze,
}: {
  activeThread: AgentThreadSummary | null;
  messages: AgentThreadMessage[] | undefined;
  runtimeDetails: AgentThreadRuntimeDetails | undefined;
  enabled: boolean;
  canAnalyze: boolean;
}) {
  const objective = runtimeDetails?.activeObjective;
  const latestAssistantMessage = [...(messages || [])]
    .reverse()
    .find((m) => m.role === "assistant");
  const waitingOnYou = Boolean(
    activeThread?.pendingActionBundle || latestAssistantMessage?.pendingClarification,
  );
  const statusLabel = !enabled
    ? "Paused"
    : !canAnalyze
      ? "Unavailable"
      : waitingOnYou
        ? "Waiting"
        : "Ready";
  const statusColor =
    !enabled || !canAnalyze ? "bg-slate-500" : waitingOnYou ? "bg-amber-400" : "bg-emerald-400";

  const blocks = buildChatHeaderBlocks({ activeThread, messages, runtimeDetails });
  const inlineBlocks = blocks.filter((b) => b.type !== "goal_strip");

  const headline =
    objective?.summary ||
    activeThread?.pendingActionBundle?.summary ||
    activeThread?.lastMessagePreview ||
    "Use chat for reads, instructions, and staging moves.";

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 md:px-4 md:py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400/20 to-amber-600/10">
            <Bot className="h-4 w-4 text-amber-300" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-white/90">
                {objective?.title || activeThread?.title || "General conversation"}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                  !enabled || !canAnalyze
                    ? "bg-slate-500/10 text-slate-400"
                    : waitingOnYou
                      ? "bg-amber-500/10 text-amber-300"
                      : "bg-emerald-500/10 text-emerald-300",
                )}
              >
                <Circle className={cn("h-1.5 w-1.5 fill-current", statusColor)} />
                {statusLabel}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-white/40">{headline}</p>
          </div>
        </div>
      </div>

      {inlineBlocks.length > 0 && (
        <div className="hidden md:block">
          <AgentUiBlockList blocks={inlineBlocks} />
        </div>
      )}
    </div>
  );
}
