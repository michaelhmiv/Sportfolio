import { useState, type RefObject } from "react";
import { Bot, Check, ChevronDown, Loader2, Sparkles, User2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  formatDomainLabel,
  getActionComparisonRows,
  getActionMeta,
  getActionPreviewRows,
  getBundleStatusLabel,
  getPrimaryClarification,
} from "../lib/agent-view";
import type {
  AgentAction,
  AgentActionBundle,
  AgentCitation,
  AgentConfirmationPreview,
  AgentPendingClarification,
  AgentThreadMessage,
  AgentToolTrace,
} from "../types";
import { AgentUiBlockList } from "./agent-ui-blocks";

export interface PendingUserMessage {
  id: string;
  contentText: string;
  createdAt: string;
}

function formatPreviewValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "--";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "--" : value.map((entry) => String(entry)).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function PreviewStateBlock({ label, state }: { label: string; state: Record<string, unknown> }) {
  const entries = Object.entries(state);
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="rounded-sm border border-[#2a2e39] bg-[#121826] p-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 space-y-2">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-3">
            <div className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{key}</div>
            <div className="text-right text-xs leading-5 text-slate-100">
              {formatPreviewValue(value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfirmationPreviewCard({ preview }: { preview: AgentConfirmationPreview }) {
  const riskClassName =
    preview.riskClass === "high"
      ? "border-red-500/30 bg-red-500/10 text-red-100"
      : preview.riskClass === "medium"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";

  return (
    <div className="mt-3 rounded-sm border border-[#2a2e39] bg-[#101521] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Confirmation Preview
        </div>
        <span
          className={cn(
            "rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]",
            riskClassName,
          )}
        >
          {preview.riskClass} risk
        </span>
      </div>
      <div className="mt-2 text-sm font-semibold text-slate-100">{preview.actionSummary}</div>
      {preview.estimatedImpact && (
        <div className="mt-2 text-xs leading-5 text-slate-300">{preview.estimatedImpact}</div>
      )}
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <PreviewStateBlock label="Before" state={preview.beforeState} />
        <PreviewStateBlock label="After" state={preview.afterState} />
      </div>
      {preview.warnings.length > 0 && (
        <div className="mt-3 rounded-sm border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs leading-5 text-amber-100">
          {preview.warnings[0]}
        </div>
      )}
    </div>
  );
}

function ToolTraceRow({ entry }: { entry: AgentToolTrace }) {
  const toneClassName =
    entry.status === "failed"
      ? "border-red-500/25 bg-red-500/10 text-red-100"
      : entry.status === "skipped"
        ? "border-slate-600 bg-slate-800/70 text-slate-300"
        : "border-emerald-500/25 bg-emerald-500/10 text-emerald-100";

  return (
    <div className="rounded-sm border border-[#2a2e39] bg-[#121826] p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-300">
          {entry.phase}
        </span>
        <span
          className={cn(
            "rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]",
            toneClassName,
          )}
        >
          {entry.status}
        </span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
          {entry.latencyMs}ms
        </span>
      </div>
      <div className="mt-2 text-xs font-semibold text-slate-100">{entry.toolName}</div>
      <div className="mt-1 text-xs leading-5 text-slate-300">{entry.summary}</div>
    </div>
  );
}

function HermesRunCard({
  toolTrace,
  skillsUsed,
  memoryInfluences,
  generatedBy,
  scheduleJobType,
}: {
  toolTrace: AgentToolTrace[];
  skillsUsed: string[];
  memoryInfluences: string[];
  generatedBy: AgentThreadMessage["generatedBy"];
  scheduleJobType: AgentThreadMessage["scheduleJobType"];
}) {
  if (
    toolTrace.length === 0 &&
    skillsUsed.length === 0 &&
    memoryInfluences.length === 0 &&
    generatedBy !== "hermes_schedule" &&
    generatedBy !== "hermes_strategy"
  ) {
    return null;
  }

  return (
    <div className="mt-3 rounded-sm border border-[#2a2e39] bg-[#101521] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Hermes Run
        </div>
        {generatedBy === "hermes_schedule" && (
          <Badge className="bg-sky-500/20 text-sky-200 hover:bg-sky-500/20">
            {scheduleJobType ? scheduleJobType.replace(/_/g, " ") : "scheduled"}
          </Badge>
        )}
        {generatedBy === "hermes_strategy" && (
          <Badge className="bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/20">
            strategy run
          </Badge>
        )}
        {skillsUsed.length > 0 && (
          <Badge variant="outline" className="border-[#2a2e39] text-slate-300">
            {skillsUsed.length} skill{skillsUsed.length === 1 ? "" : "s"}
          </Badge>
        )}
        {memoryInfluences.length > 0 && (
          <Badge variant="outline" className="border-[#2a2e39] text-slate-300">
            {memoryInfluences.length} memory cue{memoryInfluences.length === 1 ? "" : "s"}
          </Badge>
        )}
      </div>

      {memoryInfluences.length > 0 && (
        <div className="mt-3 rounded-sm border border-[#2a2e39] bg-[#121826] p-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            What Hermes remembered
          </div>
          <div className="mt-2 space-y-1.5 text-xs leading-5 text-slate-300">
            {memoryInfluences.slice(0, 3).map((entry) => (
              <div key={entry}>{entry}</div>
            ))}
          </div>
        </div>
      )}

      {toolTrace.length > 0 && (
        <div className="mt-3 space-y-2">
          {toolTrace.map((entry, index) => (
            <ToolTraceRow key={`${entry.toolName}-${entry.phase}-${index}`} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function CitationList({ citations }: { citations: AgentCitation[] }) {
  if (citations.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2 rounded-sm border border-sky-500/30 bg-sky-500/10 p-2.5 text-sky-100">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-300">
        External Sources
      </div>
      {citations.map((citation) => (
        <a
          key={citation.id}
          href={citation.url}
          target="_blank"
          rel="noreferrer"
          className="block rounded-sm border border-sky-500/20 bg-[#121a2a] p-2.5 transition-colors hover:bg-[#182236]"
        >
          <div className="text-xs font-medium text-sky-300">
            {citation.sourceName}
            {citation.publishedAt ? ` | ${citation.publishedAt}` : ""}
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-100">{citation.title}</div>
          <div className="mt-1 text-xs leading-5 text-slate-300">{citation.factSummary}</div>
        </a>
      ))}
    </div>
  );
}

function ClarificationPrompt({ clarification }: { clarification: AgentPendingClarification }) {
  return (
    <div className="mt-3 rounded-sm border border-sky-500/30 bg-sky-500/10 p-2.5 text-sky-100">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-300">
        Waiting On One Detail
      </div>
      <div className="mt-2 text-sm leading-6">{clarification.prompt}</div>
      <div className="mt-2 text-xs text-sky-200/80">
        Reply naturally and the agent will continue the staged workflow.
      </div>
    </div>
  );
}

function ActionPreview({ action }: { action: AgentAction }) {
  const previewRows = getActionPreviewRows(action);

  return (
    <div className="mt-3 grid gap-2 md:grid-cols-2">
      {previewRows.map((row) => (
        <div
          key={`${action.actionType}-${row.label}`}
          className="rounded-sm border border-[#2a2e39] bg-[#121826] p-2.5"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            {row.label}
          </div>
          <div className="mt-2 text-xs leading-5 text-slate-400">Now: {row.current}</div>
          <div className="mt-1 text-sm font-medium leading-6 text-slate-100">
            After: {row.proposed}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActionDetails({ action }: { action: AgentAction }) {
  const rows = getActionComparisonRows(action);

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={`${action.actionType}-${row.label}`}
          className="rounded-sm border border-[#2a2e39] bg-[#121826] p-2.5"
        >
          <div className="text-xs font-semibold text-slate-100">{row.label}</div>
          {row.detail && <div className="mt-1 text-xs leading-5 text-slate-400">{row.detail}</div>}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-sm border border-[#2a2e39] bg-[#0f1420] p-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                Current
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-200">{row.current}</div>
            </div>
            <div className="rounded-sm border border-amber-500/30 bg-amber-500/10 p-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-300">
                After Confirm
              </div>
              <div className="mt-1 text-xs leading-5 text-amber-100">{row.proposed}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProposalCard({
  bundle,
  onConfirm,
  onCancel,
  isConfirming,
  isCanceling,
}: {
  bundle: AgentActionBundle;
  onConfirm: () => void;
  onCancel: () => void;
  isConfirming: boolean;
  isCanceling: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const primaryAction =
    bundle.steps.find((step) => step.action)?.action || bundle.actions.find(Boolean) || null;
  const clarification = getPrimaryClarification(bundle);
  const isPending = bundle.status === "pending_confirmation";

  return (
    <div className="mt-3 rounded-sm border border-[#2a2e39] bg-[#101521] p-3 text-slate-100">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-amber-600 text-white hover:bg-amber-600">
          {getBundleStatusLabel(bundle.status)}
        </Badge>
        <Badge variant="outline" className="border-[#2a2e39] text-slate-300">
          {formatDomainLabel(bundle.domain)}
        </Badge>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
          {new Date(bundle.createdAt).toLocaleString()}
        </span>
      </div>

      <div className="mt-2 text-sm leading-6 text-slate-200">{bundle.summary}</div>

      {primaryAction && (
        <div className="mt-3 rounded-sm border border-[#2a2e39] bg-[#121826] p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            Staged Move
          </div>
          <div className="mt-1.5 text-sm font-semibold text-slate-50">
            {getActionMeta(primaryAction)}
          </div>
          <ActionPreview action={primaryAction} />
        </div>
      )}

      {clarification && <ClarificationPrompt clarification={clarification} />}

      {bundle.warnings.length > 0 && (
        <div className="mt-3 rounded-sm border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs leading-5 text-amber-100">
          {bundle.warnings[0]}
        </div>
      )}

      {isPending && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            className="h-8 rounded-sm bg-amber-500 px-3 text-[11px] uppercase tracking-[0.08em] text-slate-950 hover:bg-amber-400"
            onClick={onConfirm}
            disabled={isConfirming || isCanceling}
          >
            {isConfirming ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Confirm
          </Button>
          <Button
            variant="outline"
            className="h-8 rounded-sm border-[#2a2e39] bg-[#121826] px-3 text-[11px] uppercase tracking-[0.08em] text-slate-100 hover:bg-[#182236]"
            onClick={onCancel}
            disabled={isConfirming || isCanceling}
          >
            {isCanceling ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <X className="mr-2 h-4 w-4" />
            )}
            Cancel
          </Button>
        </div>
      )}

      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <Button
          type="button"
          variant="ghost"
          className="mt-2 h-auto px-0 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500 hover:bg-transparent hover:text-slate-100"
          onClick={() => setIsExpanded((current) => !current)}
        >
          <ChevronDown
            className={cn("mr-2 h-4 w-4 transition-transform", isExpanded && "rotate-180")}
          />
          {isExpanded ? "Hide Details" : "Show Details"}
        </Button>
        <CollapsibleContent className="space-y-3 pt-3">
          {bundle.steps.map((step) => (
            <div
              key={`${bundle.id}-${step.id}`}
              className="rounded-sm border border-[#2a2e39] bg-[#121826] p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-50">{step.title}</div>
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {step.status}
                </span>
              </div>
              {step.action ? (
                <>
                  <div className="mt-2 text-xs text-slate-400">{getActionMeta(step.action)}</div>
                  <div className="mt-3">
                    <ActionDetails action={step.action} />
                  </div>
                  <div className="mt-3 text-sm leading-6 text-slate-200">
                    {step.action.reasoning}
                  </div>
                </>
              ) : step.clarificationPrompt ? (
                <div className="mt-3 text-sm leading-6 text-slate-200">
                  {step.clarificationPrompt}
                </div>
              ) : null}
            </div>
          ))}

          {bundle.warnings.length > 1 && (
            <div className="space-y-2">
              {bundle.warnings.slice(1).map((warning) => (
                <div
                  key={warning}
                  className="rounded-sm border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
                >
                  {warning}
                </div>
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function MessageBubble({
  message,
  onConfirmPlan,
  onCancelPlan,
  isConfirming,
  isCanceling,
  isPendingSend = false,
}: {
  message: AgentThreadMessage | PendingUserMessage;
  onConfirmPlan: () => void;
  onCancelPlan: () => void;
  isConfirming: boolean;
  isCanceling: boolean;
  isPendingSend?: boolean;
}) {
  const isRealMessage = "role" in message;
  const inlineUiBlocks =
    isRealMessage && message.uiBlocks
      ? message.uiBlocks.filter(
          (block) =>
            block.slot !== "chat_header" &&
            block.slot !== "chat_inline" &&
            block.slot !== "strategy_overview" &&
            block.slot !== "strategy_rules",
        )
      : [];
  const isUser = isRealMessage ? message.role === "user" : true;
  const isError = isRealMessage && message.messageType === "error";
  const speakerLabel = isUser
    ? "You"
    : isRealMessage && message.role === "system"
      ? "Update"
      : "Agent";

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "w-full rounded-sm px-3 py-2.5 sm:max-w-[84%]",
          isUser
            ? "border border-amber-500/35 bg-[#241702] text-amber-50 shadow-sm"
            : isError
              ? "border border-red-500/40 bg-red-950/40 text-red-100"
              : "border border-[#2a2e39] bg-[#171c29] text-slate-100 shadow-sm",
        )}
      >
        <div
          className={cn(
            "mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em]",
            isUser ? "text-amber-200/80" : "text-slate-400",
          )}
        >
          {isUser ? <User2 className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
          {speakerLabel}
          {isPendingSend && <span className="text-[10px] text-amber-200/70">Sending...</span>}
        </div>

        <div className="whitespace-pre-wrap text-[13px] leading-6">{message.contentText}</div>

        {inlineUiBlocks.length > 0 && <AgentUiBlockList blocks={inlineUiBlocks} className="mt-3" />}

        {isRealMessage && message.citations && message.citations.length > 0 && (
          <CitationList citations={message.citations} />
        )}
        {isRealMessage && message.confirmationPreview && !message.actionBundle && (
          <ConfirmationPreviewCard preview={message.confirmationPreview} />
        )}
        {isRealMessage && (
          <HermesRunCard
            toolTrace={message.toolTrace || []}
            skillsUsed={message.skillsUsed || []}
            memoryInfluences={message.memoryInfluences || []}
            generatedBy={message.generatedBy || null}
            scheduleJobType={message.scheduleJobType || null}
          />
        )}
        {isRealMessage && message.actionBundle && (
          <ProposalCard
            bundle={message.actionBundle}
            onConfirm={onConfirmPlan}
            onCancel={onCancelPlan}
            isConfirming={isConfirming}
            isCanceling={isCanceling}
          />
        )}
        {isRealMessage && !message.actionBundle && message.pendingClarification && (
          <ClarificationPrompt clarification={message.pendingClarification} />
        )}

        <div className={cn("mt-3 text-[11px]", isUser ? "text-amber-200/70" : "text-slate-500")}>
          {new Date(message.createdAt).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

export function AgentEmptyConversationState({
  isDraftConversation,
  enabled,
  canAnalyze,
  starterPrompts,
  onUseStarterPrompt,
}: {
  isDraftConversation: boolean;
  enabled: boolean;
  canAnalyze: boolean;
  starterPrompts: string[];
  onUseStarterPrompt: (prompt: string) => void;
}) {
  return (
    <div className="rounded-sm border border-[#2a2e39] bg-[#171c29] p-3 text-sm text-slate-300 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-50">
        <Sparkles className="h-4 w-4 text-amber-400" />
        {isDraftConversation ? "Start a fresh chat." : "Your agent is ready."}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-400">
        {enabled && canAnalyze
          ? "Use plain language. Ask for a read or give a direct instruction when you want Hermes to stage a move."
          : "The agent needs to be enabled and configured before you can send the next request."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {starterPrompts.map((prompt) => (
          <Button
            key={prompt}
            type="button"
            variant="outline"
            className="h-7 rounded-sm border-[#2a2e39] bg-[#0f1420] px-2.5 text-[10px] uppercase tracking-[0.12em] text-slate-100 hover:bg-[#202637]"
            onClick={() => onUseStarterPrompt(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function AgentMessageList({
  messages,
  pendingUserMessage,
  onConfirmPlan,
  onCancelPlan,
  isConfirming,
  isCanceling,
  endRef,
}: {
  messages: AgentThreadMessage[];
  pendingUserMessage: PendingUserMessage | null;
  onConfirmPlan: () => void;
  onCancelPlan: () => void;
  isConfirming: boolean;
  isCanceling: boolean;
  endRef: RefObject<HTMLDivElement>;
}) {
  return (
    <div className="space-y-3">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          onConfirmPlan={onConfirmPlan}
          onCancelPlan={onCancelPlan}
          isConfirming={isConfirming}
          isCanceling={isCanceling}
        />
      ))}
      {pendingUserMessage && (
        <MessageBubble
          message={pendingUserMessage}
          onConfirmPlan={onConfirmPlan}
          onCancelPlan={onCancelPlan}
          isConfirming={isConfirming}
          isCanceling={isCanceling}
          isPendingSend
        />
      )}
      <div ref={endRef} />
    </div>
  );
}
