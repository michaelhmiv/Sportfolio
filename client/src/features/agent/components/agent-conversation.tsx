import { useState, type RefObject } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
  User2,
  X,
  Wrench,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "wouter";
import { PlayerModal } from "@/components/player-modal";
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
  AgentTurnProgressEvent,
} from "../types";
import { AgentUiBlockList } from "./agent-ui-blocks";

export interface PendingUserMessage {
  id: string;
  contentText: string;
  createdAt: string;
  progressEvents?: AgentTurnProgressEvent[];
}

function extractPlayerIdFromHref(href?: string | null) {
  if (!href) {
    return null;
  }

  const match = href.match(/^\/player\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function AssistantMarkdown({
  contentText,
  onOpenPlayer,
}: {
  contentText: string;
  onOpenPlayer: (playerId: string) => void;
}) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        table: ({ children, ...props }) => (
          <div className="agent-markdown-table-shell">
            <table {...props}>{children}</table>
          </div>
        ),
        a: ({ href, children, ...props }) => {
          const playerId = extractPlayerIdFromHref(href);

          if (playerId) {
            return (
              <button
                type="button"
                onClick={() => onOpenPlayer(playerId)}
                className="text-left text-sky-300 underline decoration-sky-300/30 underline-offset-2 transition-colors hover:decoration-sky-300/60"
              >
                {children}
              </button>
            );
          }

          if (href?.startsWith("/")) {
            return (
              <Link
                href={href}
                className="text-sky-300 underline decoration-sky-300/30 underline-offset-2 transition-colors hover:decoration-sky-300/60"
              >
                {children}
              </Link>
            );
          }

          return (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              {...props}
              className="text-sky-300 underline decoration-sky-300/30 underline-offset-2 transition-colors hover:decoration-sky-300/60"
            >
              {children}
            </a>
          );
        },
      }}
    >
      {contentText}
    </Markdown>
  );
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
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-white/40">{label}</div>
      <div className="mt-2 space-y-2">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-3">
            <div className="text-[11px] uppercase tracking-wide text-white/40">{key}</div>
            <div className="text-right text-xs leading-5 text-white/80">
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
      ? "border-red-500/30 bg-red-500/10 text-red-200"
      : preview.riskClass === "medium"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";

  return (
    <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-white/40">
          Confirmation Preview
        </div>
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            riskClassName,
          )}
        >
          {preview.riskClass} risk
        </span>
      </div>
      <div className="mt-2 text-sm font-semibold text-white/90">{preview.actionSummary}</div>
      {preview.estimatedImpact && (
        <div className="mt-2 text-xs leading-5 text-white/60">{preview.estimatedImpact}</div>
      )}
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <PreviewStateBlock label="Before" state={preview.beforeState} />
        <PreviewStateBlock label="After" state={preview.afterState} />
      </div>
      {preview.warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">
          {preview.warnings[0]}
        </div>
      )}
    </div>
  );
}

function ToolTraceRow({ entry }: { entry: AgentToolTrace }) {
  const toneClassName =
    entry.status === "failed"
      ? "text-red-300"
      : entry.status === "skipped"
        ? "text-white/40"
        : "text-emerald-300";

  const dotClassName =
    entry.status === "failed"
      ? "bg-red-400"
      : entry.status === "skipped"
        ? "bg-white/30"
        : "bg-emerald-400";

  return (
    <div className="flex items-start gap-2.5 py-1">
      <div className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", dotClassName)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-white/70">{entry.toolName}</span>
          <span className={cn("text-[10px] font-medium", toneClassName)}>{entry.status}</span>
          <span className="text-[10px] text-white/30">{entry.latencyMs}ms</span>
        </div>
        <div className="mt-0.5 text-[11px] leading-4 text-white/40">{entry.summary}</div>
      </div>
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
  const [isExpanded, setIsExpanded] = useState(false);

  if (
    toolTrace.length === 0 &&
    skillsUsed.length === 0 &&
    memoryInfluences.length === 0 &&
    generatedBy !== "hermes_schedule" &&
    generatedBy !== "hermes_strategy"
  ) {
    return null;
  }

  const traceCount = toolTrace.length;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
      >
        <Wrench className="h-3.5 w-3.5 text-white/30" />
        <span className="flex-1 text-xs font-medium text-white/50">
          {traceCount > 0 ? `${traceCount} tool call${traceCount === 1 ? "" : "s"}` : "Run details"}
          {skillsUsed.length > 0 &&
            ` · ${skillsUsed.length} skill${skillsUsed.length === 1 ? "" : "s"}`}
          {memoryInfluences.length > 0 &&
            ` · ${memoryInfluences.length} memory cue${memoryInfluences.length === 1 ? "" : "s"}`}
        </span>
        <div className="flex items-center gap-1.5">
          {generatedBy === "hermes_schedule" && (
            <Badge className="h-5 rounded-full bg-sky-500/15 px-2 text-[10px] text-sky-300 hover:bg-sky-500/15">
              {scheduleJobType ? scheduleJobType.replace(/_/g, " ") : "scheduled"}
            </Badge>
          )}
          {generatedBy === "hermes_strategy" && (
            <Badge className="h-5 rounded-full bg-emerald-500/15 px-2 text-[10px] text-emerald-300 hover:bg-emerald-500/15">
              strategy
            </Badge>
          )}
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-white/30" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-white/30" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="mt-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          {memoryInfluences.length > 0 && (
            <div className="mb-2 border-b border-white/[0.06] pb-2">
              <div className="text-[10px] font-medium uppercase tracking-wider text-white/30">
                Recalled
              </div>
              <div className="mt-1 space-y-1 text-[11px] leading-4 text-white/50">
                {memoryInfluences.slice(0, 3).map((entry) => (
                  <div key={entry}>{entry}</div>
                ))}
              </div>
            </div>
          )}

          {toolTrace.length > 0 && (
            <div className="space-y-0">
              {toolTrace.map((entry, index) => (
                <ToolTraceRow key={`${entry.toolName}-${entry.phase}-${index}`} entry={entry} />
              ))}
            </div>
          )}
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
    <div className="mt-3 space-y-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-sky-300/70">
        Sources
      </div>
      {citations.map((citation) => (
        <a
          key={citation.id}
          href={citation.url}
          target="_blank"
          rel="noreferrer"
          className="block rounded-lg border border-sky-500/15 bg-sky-500/5 p-3 transition-colors hover:bg-sky-500/10"
        >
          <div className="text-[11px] font-medium text-sky-300/70">
            {citation.sourceName}
            {citation.publishedAt ? ` · ${citation.publishedAt}` : ""}
          </div>
          <div className="mt-1 text-sm font-medium text-white/80">{citation.title}</div>
          <div className="mt-1 text-xs leading-5 text-white/50">{citation.factSummary}</div>
        </a>
      ))}
    </div>
  );
}

function ClarificationPrompt({ clarification }: { clarification: AgentPendingClarification }) {
  return (
    <div className="mt-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-sky-300/70">
        Need one detail
      </div>
      <div className="mt-2 text-sm leading-6 text-white/80">{clarification.prompt}</div>
      <div className="mt-2 text-xs text-sky-300/50">
        Reply naturally and the agent will continue.
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
          className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
        >
          <div className="text-[11px] font-medium uppercase tracking-wider text-white/40">
            {row.label}
          </div>
          <div className="mt-2 text-xs leading-5 text-white/40">Now: {row.current}</div>
          <div className="mt-1 text-sm font-medium leading-6 text-white/90">
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
          className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
        >
          <div className="text-xs font-semibold text-white/90">{row.label}</div>
          {row.detail && <div className="mt-1 text-xs leading-5 text-white/40">{row.detail}</div>}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.01] p-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-white/30">
                Current
              </div>
              <div className="mt-1 text-xs leading-5 text-white/70">{row.current}</div>
            </div>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-amber-300/70">
                After Confirm
              </div>
              <div className="mt-1 text-xs leading-5 text-amber-200/80">{row.proposed}</div>
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
    <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="rounded-full bg-amber-500/20 text-amber-200 hover:bg-amber-500/20">
          {getBundleStatusLabel(bundle.status)}
        </Badge>
        <Badge variant="outline" className="rounded-full border-white/[0.1] text-white/60">
          {formatDomainLabel(bundle.domain)}
        </Badge>
        <span className="text-[10px] text-white/30">
          {new Date(bundle.createdAt).toLocaleString()}
        </span>
      </div>

      <div className="mt-2.5 text-sm leading-6 text-white/70">{bundle.summary}</div>

      {primaryAction && (
        <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-white/30">
            Staged Move
          </div>
          <div className="mt-1.5 text-sm font-semibold text-white/90">
            {getActionMeta(primaryAction)}
          </div>
          <ActionPreview action={primaryAction} />
        </div>
      )}

      {clarification && <ClarificationPrompt clarification={clarification} />}

      {bundle.warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/15 bg-amber-500/5 p-3 text-xs leading-5 text-amber-200/80">
          {bundle.warnings[0]}
        </div>
      )}

      {isPending && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            className="h-9 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-4 text-xs font-medium text-black hover:from-amber-400 hover:to-amber-500"
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
            variant="ghost"
            className="h-9 rounded-xl px-4 text-xs font-medium text-white/50 hover:bg-white/[0.06] hover:text-white/70"
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
          className="mt-2 h-auto px-0 text-[11px] font-medium text-white/30 hover:bg-transparent hover:text-white/60"
          onClick={() => setIsExpanded((current) => !current)}
        >
          <ChevronDown
            className={cn("mr-1.5 h-3.5 w-3.5 transition-transform", isExpanded && "rotate-180")}
          />
          {isExpanded ? "Hide details" : "Show details"}
        </Button>
        <CollapsibleContent className="space-y-3 pt-3">
          {bundle.steps.map((step) => (
            <div
              key={`${bundle.id}-${step.id}`}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white/90">{step.title}</div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-white/30">
                  {step.status}
                </span>
              </div>
              {step.action ? (
                <>
                  <div className="mt-2 text-xs text-white/40">{getActionMeta(step.action)}</div>
                  <div className="mt-3">
                    <ActionDetails action={step.action} />
                  </div>
                  <div className="mt-3 text-sm leading-6 text-white/60">
                    {step.action.reasoning}
                  </div>
                </>
              ) : step.clarificationPrompt ? (
                <div className="mt-3 text-sm leading-6 text-white/60">
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
                  className="rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/80"
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
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const isRealMessage = "role" in message;
  const pendingProgressEvents =
    !isRealMessage && Array.isArray(message.progressEvents) ? message.progressEvents : [];
  const pendingProgressTail = pendingProgressEvents.slice(-6);
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

  return (
    <div className={cn("flex w-full gap-3", isUser ? "justify-end" : "justify-start")}>
      {/* Avatar for assistant */}
      {!isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400/20 to-amber-600/10 ring-1 ring-white/[0.08]">
          <Bot className="h-4 w-4 text-amber-300" />
        </div>
      )}

      <div
        className={cn(
          "w-full sm:max-w-[82%]",
          isUser
            ? "rounded-2xl rounded-br-md bg-blue-600/15 px-4 py-3 text-blue-50"
            : isError
              ? "rounded-2xl rounded-bl-md border border-red-500/20 bg-red-950/20 px-4 py-3 text-red-100"
              : "max-w-full text-white/80",
        )}
      >
        {isUser && (
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-blue-200/60">
            <User2 className="h-3 w-3" />
            You
            {isPendingSend && (
              <span className="text-blue-200/40">
                · {pendingProgressTail[pendingProgressTail.length - 1]?.summary || "Sending..."}
              </span>
            )}
          </div>
        )}

        {isUser ? (
          <div className="text-[13px] leading-6 whitespace-pre-wrap">{message.contentText}</div>
        ) : (
          <div className="agent-markdown text-[13.5px] leading-7">
            <AssistantMarkdown contentText={message.contentText} onOpenPlayer={setActivePlayerId} />
          </div>
        )}

        {isPendingSend && pendingProgressTail.length > 0 && (
          <div className="mt-2 space-y-1 rounded-lg border border-blue-400/20 bg-blue-500/5 px-3 py-2">
            {pendingProgressTail.map((event, index) => (
              <div
                key={`${event.eventType}-${event.timestamp}-${index}`}
                className="flex items-start gap-2 text-[11px] text-blue-100/75"
              >
                <span
                  className={cn(
                    "mt-0.5 inline-block h-1.5 w-1.5 rounded-full",
                    event.status === "failed"
                      ? "bg-red-300"
                      : event.status === "done"
                        ? "bg-emerald-300"
                        : "bg-blue-300/80",
                  )}
                />
                <span>{event.summary}</span>
              </div>
            ))}
          </div>
        )}

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

        <div className={cn("mt-2.5 text-[10px]", isUser ? "text-blue-200/40" : "text-white/20")}>
          {new Date(message.createdAt).toLocaleString()}
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
      </div>

      {/* Avatar for user */}
      {isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600/15 ring-1 ring-white/[0.08]">
          <User2 className="h-4 w-4 text-blue-300" />
        </div>
      )}
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
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="flex items-center gap-2.5 text-sm font-semibold text-white/90">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-400/20 to-amber-600/10">
          <Sparkles className="h-4 w-4 text-amber-300" />
        </div>
        {isDraftConversation ? "Start a fresh chat" : "Your agent is ready"}
      </div>
      <p className="mt-3 text-xs leading-5 text-white/40">
        {enabled && canAnalyze
          ? "Use plain language. Ask for a read or give a direct instruction when you want Hermes to stage a move."
          : "The agent needs to be enabled and configured before you can send the next request."}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {starterPrompts.map((prompt) => (
          <Button
            key={prompt}
            type="button"
            variant="ghost"
            className="h-8 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 text-[11px] font-medium text-white/50 hover:bg-white/[0.06] hover:text-white/80"
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
    <div className="space-y-4">
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
