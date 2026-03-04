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
  AgentPendingClarification,
  AgentThreadMessage,
} from "../types";

export interface PendingUserMessage {
  id: string;
  contentText: string;
  createdAt: string;
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
    <div className="mt-3 rounded-md border border-border/70 bg-card p-3 text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-amber-600 text-white hover:bg-amber-600">
          {getBundleStatusLabel(bundle.status)}
        </Badge>
        <Badge variant="outline">{formatDomainLabel(bundle.domain)}</Badge>
        <span className="text-[11px] text-muted-foreground">
          {new Date(bundle.createdAt).toLocaleString()}
        </span>
      </div>

      <div className="mt-2 text-sm leading-6">{bundle.summary}</div>

      {primaryAction && (
        <div className="mt-3 rounded-md border border-border/70 bg-background/40 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Staged Move
          </div>
          <div className="mt-1.5 text-sm font-semibold text-foreground">
            {getActionMeta(primaryAction)}
          </div>
          <ActionPreview action={primaryAction} />
        </div>
      )}

      {clarification && <ClarificationPrompt clarification={clarification} />}

      {bundle.warnings.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs leading-5 text-foreground">
          {bundle.warnings[0]}
        </div>
      )}

      {isPending && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            className="h-9 rounded-md bg-amber-500 text-slate-950 hover:bg-amber-400"
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
            className="h-9 rounded-md border-border/70 bg-background/40 text-foreground hover:bg-muted/30"
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
          className="mt-2 h-auto px-0 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground hover:bg-transparent hover:text-foreground"
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
              className="rounded-md border border-border/70 bg-background/40 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-foreground">{step.title}</div>
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {step.status}
                </span>
              </div>
              {step.action ? (
                <>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {getActionMeta(step.action)}
                  </div>
                  <div className="mt-3">
                    <ActionDetails action={step.action} />
                  </div>
                  <div className="mt-3 text-sm leading-6 text-foreground">
                    {step.action.reasoning}
                  </div>
                </>
              ) : step.clarificationPrompt ? (
                <div className="mt-3 text-sm leading-6 text-foreground">
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
                  className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-foreground"
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
          "w-full rounded-sm px-3 py-2.5 sm:max-w-[86%]",
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

        {isRealMessage && message.citations && message.citations.length > 0 && (
          <CitationList citations={message.citations} />
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
    <div className="rounded-sm border border-[#2a2e39] bg-[#171c29] p-4 text-sm text-slate-300 shadow-sm">
      <div className="flex items-center gap-2 font-semibold text-slate-50">
        <Sparkles className="h-4 w-4 text-amber-400" />
        {isDraftConversation ? "Start a fresh chat." : "Your agent is ready."}
      </div>
      <p className="mt-2 text-[13px] leading-6">
        {enabled && canAnalyze
          ? "Use plain language. Ask for a read, or give a direct instruction when you want the agent to stage a move."
          : "The agent needs to be enabled and configured before you can send the next request."}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {starterPrompts.map((prompt) => (
          <Button
            key={prompt}
            type="button"
            variant="outline"
            className="h-8 rounded-sm border-[#2a2e39] bg-[#0f1420] px-2.5 text-[11px] uppercase tracking-[0.08em] text-slate-100 hover:bg-[#202637]"
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
