import { Loader2, MessageSquare, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  formatDomainLabel,
  formatThreadTimestamp,
  getReadableAgentError,
  getThreadTitle,
} from "../lib/agent-view";
import type { AgentThreadSummary } from "../types";

export function AgentStatusPill({
  label,
  tone = "default",
  className,
}: {
  label: string;
  tone?: "default" | "warning" | "muted";
  className?: string;
}) {
  const toneClassName =
    tone === "warning"
      ? "border-brand/30 bg-brand/10 text-brand"
      : tone === "muted"
        ? "border-border/60 bg-surface-raised/40 text-content/40"
        : "border-market-positive/25 bg-market-positive/10 text-market-positive";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider",
        toneClassName,
        className,
      )}
    >
      {label}
    </span>
  );
}

export function AgentErrorState({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-panel border border-market-negative/20 bg-market-negative/20 p-4 text-market-negative">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-2 text-sm leading-6 text-market-negative/80">
        {getReadableAgentError(error, "The agent request failed.")}
      </div>
      <Button
        className="mt-3 h-8 rounded-panel border-market-negative/30 bg-market-negative/20 px-3 text-xs text-market-negative hover:bg-market-negative/35"
        variant="outline"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}

export function AgentThreadPanel({
  threads,
  activeThreadId,
  isLoading,
  error,
  onRetry,
  onSelect,
  onStartFresh,
  onClose,
}: {
  threads: AgentThreadSummary[];
  activeThreadId: string | null;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  onSelect: (threadId: string) => void;
  onStartFresh: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/60 bg-surface-raised/40 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-gradient-to-br from-brand/20 to-brand/10 ring-1 ring-border/60">
            <MessageSquare className="h-4 w-4 text-brand" />
          </div>
          <div>
            <div className="text-sm font-semibold text-content">Conversations</div>
            <div className="text-[11px] text-content/40">
              Recent asks, staged plans, and active threads.
            </div>
          </div>
        </div>
        <Button
          className="mt-4 h-9 w-full rounded-panel border-border/60 bg-surface-raised/40 px-3 text-xs font-medium text-content hover:bg-surface-raised/40"
          variant="outline"
          onClick={() => {
            onStartFresh();
            onClose();
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Chat
        </Button>
      </div>

      <ScrollArea className="flex-1 px-3 py-3">
        {error ? (
          <AgentErrorState
            title="Couldn't load your conversations"
            error={error}
            onRetry={onRetry}
          />
        ) : isLoading && threads.length === 0 ? (
          <div className="flex items-center justify-center gap-2 rounded-panel border border-border/60 bg-surface-raised/40 p-4 text-xs text-content/40">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading conversation history...
          </div>
        ) : threads.length === 0 ? (
          <div className="rounded-panel border border-dashed border-border/60 bg-surface-raised/40 px-3 py-4 text-xs text-content/30">
            Your chats will show up here after your first message.
          </div>
        ) : (
          <div className="space-y-1.5">
            {threads.map((thread, index) => {
              const isActive = thread.id === activeThreadId;
              const preview = thread.pendingActionBundle?.summary || thread.lastMessagePreview;

              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => {
                    onSelect(thread.id);
                    onClose();
                  }}
                  className={cn(
                    "w-full rounded-panel border px-3 py-3 text-left transition-all",
                    isActive
                      ? "border-brand/30 bg-brand/5 text-content"
                      : "border-border/60 bg-surface-raised/40 text-content hover:border-border/60 hover:bg-surface-raised/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-content">
                        {getThreadTitle(thread, index)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {thread.pendingActionBundle ? (
                          <Badge className="rounded-pill bg-brand/15 text-[10px] text-brand hover:bg-brand/15">
                            Plan Ready
                          </Badge>
                        ) : (
                          <span className="text-[10px] font-medium uppercase tracking-wider text-content/30">
                            {formatDomainLabel(thread.domain)}
                          </span>
                        )}
                        <span className="text-[10px] text-content/20">
                          {thread.channel === "sms" ? "Legacy SMS" : "In app"}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 text-[10px] text-content/25">
                      {formatThreadTimestamp(thread.lastMessageAt || thread.updatedAt)}
                    </div>
                  </div>
                  {preview && (
                    <div className="mt-2 border-l-2 border-border/60 pl-3 text-[11px] leading-5 text-content/35">
                      {preview}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
