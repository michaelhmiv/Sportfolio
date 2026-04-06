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
      ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
      : tone === "muted"
        ? "border-white/[0.08] bg-white/[0.03] text-white/40"
        : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider",
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
    <div className="rounded-xl border border-red-500/20 bg-red-950/20 p-4 text-red-100">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-2 text-sm leading-6 text-red-100/80">
        {getReadableAgentError(error, "The agent request failed.")}
      </div>
      <Button
        className="mt-3 h-8 rounded-xl border-red-400/30 bg-red-900/20 px-3 text-xs text-red-100 hover:bg-red-900/35"
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
      <div className="border-b border-white/[0.06] bg-white/[0.02] px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400/20 to-amber-600/10 ring-1 ring-white/[0.08]">
            <MessageSquare className="h-4 w-4 text-amber-300" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white/90">Conversations</div>
            <div className="text-[11px] text-white/40">
              Recent asks, staged plans, and active threads.
            </div>
          </div>
        </div>
        <Button
          className="mt-4 h-9 w-full rounded-xl border-white/[0.08] bg-white/[0.04] px-3 text-xs font-medium text-white/70 hover:bg-white/[0.08]"
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
          <div className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-white/40">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading conversation history...
          </div>
        ) : threads.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-3 py-4 text-xs text-white/30">
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
                    "w-full rounded-xl border px-3 py-3 text-left transition-all",
                    isActive
                      ? "border-amber-500/30 bg-amber-500/5 text-white"
                      : "border-white/[0.06] bg-white/[0.02] text-white/80 hover:border-white/[0.1] hover:bg-white/[0.04]",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-white/90">
                        {getThreadTitle(thread, index)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {thread.pendingActionBundle ? (
                          <Badge className="rounded-full bg-amber-500/15 text-[10px] text-amber-200 hover:bg-amber-500/15">
                            Plan Ready
                          </Badge>
                        ) : (
                          <span className="text-[10px] font-medium uppercase tracking-wider text-white/30">
                            {formatDomainLabel(thread.domain)}
                          </span>
                        )}
                        <span className="text-[10px] text-white/20">
                          {thread.channel === "sms" ? "Legacy SMS" : "In app"}
                        </span>
                      </div>
                    </div>
                    <div className="shrink-0 text-[10px] text-white/25">
                      {formatThreadTimestamp(thread.lastMessageAt || thread.updatedAt)}
                    </div>
                  </div>
                  {preview && (
                    <div className="mt-2 border-l-2 border-white/[0.06] pl-3 text-[11px] leading-5 text-white/35">
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
