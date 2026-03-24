import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  Loader2,
  MoreHorizontal,
  PanelLeft,
  Settings2,
  Sparkles,
  SquarePen,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { AgentComposer } from "./components/agent-composer";
import { AgentStrategiesPanel } from "./components/agent-strategies-panel";
import { AgentUiBlockList } from "./components/agent-ui-blocks";
import {
  AgentEmptyConversationState,
  AgentMessageList,
  type PendingUserMessage,
} from "./components/agent-conversation";
import {
  AgentErrorState,
  AgentSettingsPanel,
  AgentStatusPill,
  AgentThreadPanel,
} from "./components/agent-panels";
import { getReadableAgentError, getThreadTitle } from "./lib/agent-view";
import type {
  AgentDrawerState,
  AgentProfileResponse,
  AgentStrategyDetail,
  AgentStrategySummary,
  AgentThreadMessage,
  AgentThreadRuntimeDetails,
  AgentThreadSummary,
  ProviderMode,
} from "./types";
import type { AgentUiBlock } from "@shared/agent-ui";

type WorkspaceTab = "chat" | "strategies";
type StrategyDetailTab = "overview" | "chat" | "rules";

function formatAgentDateTime(value: string | null | undefined) {
  if (!value) {
    return "Recent";
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
    .find((message) => message.role === "assistant");
  const topLevelMessageBlocks = (latestAssistantMessage?.uiBlocks || []).filter(
    (block) => block.slot === "chat_header" || block.slot === "chat_inline",
  );

  if (topLevelMessageBlocks.length > 0) {
    return topLevelMessageBlocks;
  }

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
        sources: runtimeDetails!.researchSources.slice(0, 2).map((source) => ({
          id: source.id,
          title: source.title,
          sourceName: source.sourceName,
          retrievedAt: source.retrievedAt,
          url: source.url,
          factSummary: source.factSummary,
        })),
      },
    });
  }

  return blocks;
}

function ChatWorkbenchHeader({
  activeThread,
  messages,
  runtimeDetails,
  enabled,
  canAnalyze,
  onSaveAsStrategy,
  isSavingStrategy,
}: {
  activeThread: AgentThreadSummary | null;
  messages: AgentThreadMessage[] | undefined;
  runtimeDetails: AgentThreadRuntimeDetails | undefined;
  enabled: boolean;
  canAnalyze: boolean;
  onSaveAsStrategy: () => void;
  isSavingStrategy: boolean;
}) {
  const objective = runtimeDetails?.activeObjective;
  const latestAssistantMessage = [...(messages || [])]
    .reverse()
    .find((message) => message.role === "assistant");
  const blocks = buildChatHeaderBlocks({
    activeThread,
    messages,
    runtimeDetails,
  });
  const visibleBlocks = blocks.filter((block) => block.type !== "goal_strip");
  const continuity = runtimeDetails?.continuity;
  const latestSources = runtimeDetails?.researchSources.slice(0, 2) || [];
  const openLoops = continuity?.openLoops.slice(0, 2) || [];
  const recentActions = continuity?.recentActions.slice(0, 2) || [];
  const activeStrategies = continuity?.activeStrategies.slice(0, 2) || [];
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
  const headline =
    objective?.summary ||
    activeThread?.pendingActionBundle?.summary ||
    activeThread?.lastMessagePreview ||
    continuity?.headline ||
    "Use chat for one-off reads, direct instructions, and clarification before Hermes stages a move.";
  const supportRows = [
    objective?.nextStep
      ? {
          label: "Next",
          value: objective.nextStep,
        }
      : null,
    openLoops[0]
      ? {
          label: "Loop",
          value: openLoops[0].title,
        }
      : null,
    recentActions[0]
      ? {
          label: "Last action",
          value: recentActions[0].title,
        }
      : null,
    latestSources[0]
      ? {
          label: "Source",
          value: latestSources[0].sourceName || latestSources[0].title,
        }
      : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));
  const quickStats = [
    {
      label: "Open loops",
      value: String(continuity?.openLoops.length || 0),
      tone: (continuity?.openLoops.length || 0) > 0 ? "text-amber-200" : "text-slate-100",
    },
    {
      label: "Fresh sources",
      value: String(runtimeDetails?.researchSources.length || 0),
      tone: latestSources.length > 0 ? "text-sky-200" : "text-slate-100",
    },
    {
      label: "Linked strategies",
      value: String(continuity?.activeStrategies.length || 0),
      tone: (continuity?.activeStrategies.length || 0) > 0 ? "text-emerald-200" : "text-slate-100",
    },
  ];

  return (
    <div className="min-w-0 w-full space-y-1.5 md:space-y-3">
      <section className="overflow-hidden border-y border-[#1f2634] bg-[#0b1120] md:terminal-shell md:border md:border-[#1f2634] md:bg-[linear-gradient(135deg,rgba(14,19,31,0.96),rgba(8,12,23,0.98))]">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#1f2634] px-0 py-2 md:gap-3 md:px-3 md:py-3 md:sm:px-4">
          <div className="min-w-0 flex-1">
            <div className="terminal-kicker">Chat</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <div
                className="min-w-0 max-w-full truncate text-sm font-semibold text-slate-50 sm:text-base"
                data-testid="agent-thread-title"
              >
                {objective?.title || activeThread?.title || "General portfolio conversation"}
              </div>
              <AgentStatusPill
                label={statusLabel}
                tone={!enabled || !canAnalyze ? "muted" : waitingOnYou ? "warning" : "default"}
              />
            </div>
          </div>

          <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
              {activeThread ? formatAgentDateTime(activeThread.updatedAt) : "New"}
            </div>
            <Button
              variant="terminalOutline"
              className="hidden h-8 px-3 md:inline-flex"
              onClick={onSaveAsStrategy}
              disabled={!activeThread || isSavingStrategy}
            >
              {isSavingStrategy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Save as strategy
            </Button>
          </div>
        </div>

        <div className="divide-y divide-[#1f2634] md:hidden">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500">
            {quickStats.map((item) => (
              <span key={item.label}>
                <span className={item.tone}>{item.value}</span> {item.label}
              </span>
            ))}
            <span className="text-slate-300">{statusLabel}</span>
          </div>
          {supportRows[0] ? (
            <div className="flex items-start justify-between gap-3 px-0 py-1.5 text-[11px] leading-4.5 text-slate-300">
              <div className="min-w-0 truncate">
                <span className="font-mono uppercase tracking-[0.08em] text-slate-500">
                  {supportRows[0].label}
                </span>{" "}
                {supportRows[0].value}
              </div>
              {activeStrategies[0] ? (
                <div className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500">
                  {activeStrategies[0].name}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="hidden gap-3 px-3 py-3 sm:px-4 sm:py-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(15rem,18rem)]">
          <div className="min-w-0">
            <div className="text-[13px] leading-5 text-slate-200">{headline}</div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {quickStats.map((item) => (
                <div key={item.label} className="border border-[#222938] bg-[#0f1524] px-2.5 py-2">
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
                    {item.label}
                  </div>
                  <div className={cn("mt-1 text-sm font-semibold", item.tone)}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            {supportRows.length > 0 ? (
              supportRows.slice(0, 2).map((item) => (
                <div key={item.label} className="border border-[#222938] bg-[#0f1524] px-3 py-2">
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
                    {item.label}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-200">{item.value}</div>
                </div>
              ))
            ) : (
              <div className="border border-dashed border-[#222938] bg-[#0f1524] px-3 py-2.5 text-xs leading-5 text-slate-400">
                Chat stays secondary to Strategies. Use it when you need a direct answer, a quick
                read, or a staged move.
              </div>
            )}
            {activeStrategies[0] ? (
              <div className="hidden border border-[#222938] bg-[#0f1524] px-3 py-2 text-xs leading-5 text-slate-300 lg:block">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500">
                  Linked strategy
                </span>
                <div className="mt-1 text-slate-100">{activeStrategies[0].name}</div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {visibleBlocks.length > 0 ? (
        <div className="hidden md:block">
          <AgentUiBlockList blocks={visibleBlocks} />
        </div>
      ) : null}
    </div>
  );
}

export default function AgentShell() {
  const { toast } = useToast();
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const strategyScrollRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const strategyEndRef = useRef<HTMLDivElement>(null);
  const strategyCreateTargetTabRef = useRef<StrategyDetailTab>("overview");
  const strategySelectionInitializedRef = useRef(false);

  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("strategies");
  const [isMobileStrategyDetailOpen, setIsMobileStrategyDetailOpen] = useState(false);
  const [drawerState, setDrawerState] = useState<AgentDrawerState>(null);
  const [activeChatThreadId, setActiveChatThreadId] = useState<string | null>(null);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [strategyDetailTab, setStrategyDetailTab] = useState<StrategyDetailTab>("overview");
  const [pendingChatSelectionId, setPendingChatSelectionId] = useState<string | null>(null);
  const [chatComposerValue, setChatComposerValue] = useState("");
  const [strategyComposerValue, setStrategyComposerValue] = useState("");
  const [pendingChatMessage, setPendingChatMessage] = useState<PendingUserMessage | null>(null);
  const [pendingStrategyMessage, setPendingStrategyMessage] = useState<PendingUserMessage | null>(
    null,
  );
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  const [enabled, setEnabled] = useState(true);
  const [providerMode, setProviderMode] = useState<ProviderMode>("managed");
  const [userPromptTemplate, setUserPromptTemplate] = useState("");
  const [defaultSport, setDefaultSport] = useState("ALL");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");

  const {
    data: profileData,
    isLoading: isLoadingProfile,
    error: profileError,
    refetch: refetchProfile,
  } = useQuery<AgentProfileResponse>({
    queryKey: ["/api/agent/profile"],
  });

  const {
    data: chatThreads,
    isLoading: isLoadingChatThreads,
    error: chatThreadsError,
    refetch: refetchChatThreads,
  } = useQuery<AgentThreadSummary[]>({
    queryKey: ["/api/agent/threads", "chat"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/agent/threads?workspace=chat");
      return res.json();
    },
  });

  const {
    data: chatMessages,
    isLoading: isLoadingChatMessages,
    error: chatMessagesError,
    refetch: refetchChatMessages,
  } = useQuery<AgentThreadMessage[]>({
    queryKey: ["/api/agent/threads", activeChatThreadId || "inactive", "messages"],
    enabled: Boolean(activeChatThreadId),
  });

  const {
    data: runtimeDetails,
    error: runtimeDetailsError,
    refetch: refetchRuntimeDetails,
  } = useQuery<AgentThreadRuntimeDetails>({
    queryKey: ["/api/agent/threads", activeChatThreadId || "inactive", "runtime-details"],
    enabled: Boolean(activeChatThreadId),
  });

  const {
    data: strategiesData,
    isLoading: isLoadingStrategies,
    error: strategiesError,
    refetch: refetchStrategies,
  } = useQuery<AgentStrategySummary[]>({
    queryKey: ["/api/agent/strategies"],
  });

  const {
    data: strategyDetail,
    isLoading: isLoadingStrategyDetail,
    error: strategyDetailError,
    refetch: refetchStrategyDetail,
  } = useQuery<AgentStrategyDetail>({
    queryKey: ["/api/agent/strategies", selectedStrategyId || "inactive"],
    enabled: Boolean(selectedStrategyId),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/agent/strategies/${selectedStrategyId}`);
      return res.json();
    },
  });

  const strategyConversationThreadId = strategyDetail?.conversationThreadId || null;

  const {
    data: strategyMessages,
    isLoading: isLoadingStrategyMessages,
    error: strategyMessagesError,
    refetch: refetchStrategyMessages,
  } = useQuery<AgentThreadMessage[]>({
    queryKey: ["/api/agent/threads", strategyConversationThreadId || "inactive", "messages"],
    enabled: Boolean(strategyConversationThreadId),
  });

  useEffect(() => {
    if (!profileData) {
      return;
    }

    setEnabled(profileData.profile.enabled);
    setProviderMode(profileData.profile.providerMode);
    setUserPromptTemplate(profileData.profile.userPromptTemplate);
    setDefaultSport(profileData.profile.defaultSport || "ALL");
    setBaseUrl(profileData.profile.baseUrl || "");
    setModel(profileData.profile.model || "");
  }, [profileData]);

  useEffect(() => {
    if (!chatThreads) {
      return;
    }

    if (pendingChatSelectionId) {
      if (chatThreads.some((thread) => thread.id === pendingChatSelectionId)) {
        setPendingChatSelectionId(null);
      }
      return;
    }

    if (activeChatThreadId && !chatThreads.some((thread) => thread.id === activeChatThreadId)) {
      setActiveChatThreadId(chatThreads[0]?.id || null);
      return;
    }

    if (!activeChatThreadId && chatThreads.length > 0) {
      setActiveChatThreadId(chatThreads[0].id);
    }
  }, [activeChatThreadId, chatThreads, pendingChatSelectionId]);

  useEffect(() => {
    const strategies = strategiesData || [];
    if (selectedStrategyId && !strategies.some((strategy) => strategy.id === selectedStrategyId)) {
      setSelectedStrategyId(null);
    }
  }, [selectedStrategyId, strategiesData]);

  useEffect(() => {
    if (!selectedStrategyId) {
      setIsMobileStrategyDetailOpen(false);
    }
  }, [selectedStrategyId]);

  useEffect(() => {
    if (strategySelectionInitializedRef.current) {
      return;
    }

    const strategies = strategiesData || [];
    if (strategies.length === 0) {
      return;
    }

    setSelectedStrategyId((current) => current || strategies[0].id);
    strategySelectionInitializedRef.current = true;
  }, [strategiesData]);

  useEffect(() => {
    const viewport = chatScrollRef.current;
    if (!viewport) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: pendingChatMessage ? "smooth" : "auto",
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [chatMessages?.length, pendingChatMessage?.id]);

  useEffect(() => {
    const viewport = strategyScrollRef.current;
    if (!viewport) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: pendingStrategyMessage ? "smooth" : "auto",
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [strategyMessages?.length, pendingStrategyMessage?.id]);

  const activeChatThread = chatThreads?.find((thread) => thread.id === activeChatThreadId) || null;
  const canAnalyze = Boolean(profileData?.capabilities.canAnalyze);

  const invalidateChatQueries = async (threadId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/agent/threads"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/agent/threads", threadId, "messages"] }),
      queryClient.invalidateQueries({
        queryKey: ["/api/agent/threads", threadId, "runtime-details"],
      }),
    ]);
  };

  const invalidateStrategyQueries = async (strategyId?: string | null) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/agent/strategies"] }),
      queryClient.invalidateQueries({
        queryKey: ["/api/agent/strategies", strategyId || selectedStrategyId || "inactive"],
      }),
    ]);
  };

  const invalidateGameplayQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/scouts"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/scouts/status"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] }),
    ]);
  };

  const sendMessageMutation = useMutation({
    mutationFn: async ({ threadId, message }: { threadId: string; message: string }) => {
      const res = await apiRequest("POST", `/api/agent/threads/${threadId}/messages`, { message });
      return res.json();
    },
    onSuccess: async (_result, variables) => {
      await invalidateChatQueries(variables.threadId);
      if (variables.threadId === strategyConversationThreadId) {
        await queryClient.invalidateQueries({
          queryKey: ["/api/agent/threads", variables.threadId, "messages"],
        });
        await invalidateStrategyQueries(selectedStrategyId);
      }
    },
    onError: (error) => {
      toast({
        title: "Message failed",
        description: getReadableAgentError(error, "The message could not be sent."),
        variant: "destructive",
      });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await apiRequest("POST", `/api/agent/threads/${threadId}/confirm`, {});
      return res.json();
    },
    onSuccess: async (_result, threadId) => {
      await invalidateChatQueries(threadId);
      await invalidateGameplayQueries();
      if (threadId === strategyConversationThreadId) {
        await invalidateStrategyQueries(selectedStrategyId);
      }
    },
    onError: (error) => {
      toast({
        title: "Confirm failed",
        description: getReadableAgentError(error, "The staged plan could not be confirmed."),
        variant: "destructive",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await apiRequest("POST", `/api/agent/threads/${threadId}/cancel`, {});
      return res.json();
    },
    onSuccess: async (_result, threadId) => {
      await invalidateChatQueries(threadId);
      if (threadId === strategyConversationThreadId) {
        await invalidateStrategyQueries(selectedStrategyId);
      }
    },
    onError: (error) => {
      toast({
        title: "Cancel failed",
        description: getReadableAgentError(error, "The staged plan could not be canceled."),
        variant: "destructive",
      });
    },
  });

  const saveProfileMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/agent/profile", {
        enabled,
        providerMode,
        userPromptTemplate,
        defaultSport: defaultSport === "ALL" ? null : defaultSport,
      });
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/agent/profile"] });
      toast({ title: "Settings saved", description: "Your Hermes chat settings were updated." });
    },
    onError: (error) => {
      toast({
        title: "Settings failed",
        description: getReadableAgentError(error, "The settings could not be saved."),
        variant: "destructive",
      });
    },
  });

  const saveByokMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/agent/byok-key", { apiKey, baseUrl, model });
      return res.json();
    },
    onSuccess: () => {
      setApiKey("");
      void queryClient.invalidateQueries({ queryKey: ["/api/agent/profile"] });
      toast({ title: "BYOK saved", description: "Your API key was stored securely." });
    },
  });

  const clearByokMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/agent/byok-key");
      return res.json();
    },
    onSuccess: () => {
      setApiKey("");
      void queryClient.invalidateQueries({ queryKey: ["/api/agent/profile"] });
      toast({ title: "BYOK removed", description: "The saved API key was removed." });
    },
  });

  const createStrategyMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/agent/strategies", payload);
      return res.json();
    },
    onSuccess: async (result: AgentStrategySummary) => {
      queryClient.setQueryData<AgentStrategySummary[]>(["/api/agent/strategies"], (current) => {
        const next = (current || []).filter((strategy) => strategy.id !== result.id);
        return [...next, result];
      });
      setSelectedStrategyId(result.id);
      setIsMobileStrategyDetailOpen(true);
      setWorkspaceTab("strategies");
      setStrategyDetailTab(strategyCreateTargetTabRef.current);
      await invalidateStrategyQueries(result.id);
      toast({
        title: "Strategy saved",
        description: "This strategy now has its own workspace and conversation.",
      });
    },
    onError: (error) => {
      toast({
        title: "Strategy failed",
        description: getReadableAgentError(error, "The strategy could not be created."),
        variant: "destructive",
      });
    },
  });

  const updateStrategyMutation = useMutation({
    mutationFn: async ({
      strategyId,
      payload,
    }: {
      strategyId: string;
      payload: Record<string, unknown>;
    }) => {
      const res = await apiRequest("PATCH", `/api/agent/strategies/${strategyId}`, payload);
      return res.json();
    },
    onSuccess: async (result: AgentStrategySummary) => {
      setSelectedStrategyId(result.id);
      await invalidateStrategyQueries(result.id);
      toast({ title: "Strategy updated", description: "The saved rules were updated." });
    },
  });

  const activateStrategyMutation = useMutation({
    mutationFn: async (strategyId: string) => {
      const res = await apiRequest("POST", `/api/agent/strategies/${strategyId}/activate`, {});
      return res.json();
    },
    onSuccess: async (result: AgentStrategySummary) => {
      setSelectedStrategyId(result.id);
      await invalidateStrategyQueries(result.id);
      toast({ title: "Strategy active", description: "Hermes is now running this strategy live." });
    },
  });

  const reviewStrategyMutation = useMutation({
    mutationFn: async (strategyId: string) => {
      const res = await apiRequest("POST", `/api/agent/strategies/${strategyId}/review`, {});
      return res.json();
    },
    onSuccess: async (result: AgentStrategySummary) => {
      setSelectedStrategyId(result.id);
      await invalidateStrategyQueries(result.id);
      toast({
        title: "Strategy reviewed",
        description: "The saved playbook is approved and ready to activate.",
      });
    },
  });

  const pauseStrategyMutation = useMutation({
    mutationFn: async (strategyId: string) => {
      const res = await apiRequest("POST", `/api/agent/strategies/${strategyId}/pause`, {});
      return res.json();
    },
    onSuccess: async (result: AgentStrategySummary) => {
      setSelectedStrategyId(result.id);
      await invalidateStrategyQueries(result.id);
      toast({ title: "Strategy paused", description: "This strategy is no longer active." });
    },
  });

  const archiveStrategyMutation = useMutation({
    mutationFn: async (strategyId: string) => {
      const res = await apiRequest("POST", `/api/agent/strategies/${strategyId}/archive`, {});
      return res.json();
    },
    onSuccess: async (result: AgentStrategySummary) => {
      await invalidateStrategyQueries(result.id);
      toast({
        title: "Strategy archived",
        description: "The strategy was moved out of your active deck.",
      });
    },
  });

  const runStrategyMutation = useMutation({
    mutationFn: async (strategyId: string) => {
      const res = await apiRequest("POST", `/api/agent/strategies/${strategyId}/run`, {});
      return res.json();
    },
    onSuccess: async (_result, strategyId) => {
      await invalidateStrategyQueries(strategyId);
      await invalidateGameplayQueries();
      toast({ title: "Run recorded", description: "Hermes completed the latest strategy run." });
    },
  });

  const createChatThread = async () => {
    const res = await apiRequest("POST", "/api/agent/threads", { workspace: "chat" });
    const thread = (await res.json()) as AgentThreadSummary;
    setPendingChatSelectionId(thread.id);
    setActiveChatThreadId(thread.id);
    await queryClient.invalidateQueries({ queryKey: ["/api/agent/threads"] });
    return thread;
  };

  const handleStartFreshChat = async () => {
    if (isCreatingChat) {
      return;
    }

    setDrawerState(null);
    setPendingChatMessage(null);
    setChatComposerValue("");

    try {
      setIsCreatingChat(true);
      setWorkspaceTab("chat");
      await createChatThread();
    } catch (error) {
      toast({
        title: "New chat failed",
        description: getReadableAgentError(error, "A new chat could not be started."),
        variant: "destructive",
      });
    } finally {
      setIsCreatingChat(false);
    }
  };

  const handleSendChat = async () => {
    const message = chatComposerValue.trim();
    if (!message || sendMessageMutation.isPending || isCreatingChat) {
      return;
    }

    const optimisticMessage: PendingUserMessage = {
      id: `pending-chat-${Date.now()}`,
      contentText: message,
      createdAt: new Date().toISOString(),
    };

    setChatComposerValue("");
    setPendingChatMessage(optimisticMessage);

    let threadId = activeChatThreadId;
    try {
      if (!threadId) {
        setIsCreatingChat(true);
        const thread = await createChatThread();
        threadId = thread.id;
      }

      await sendMessageMutation.mutateAsync({ threadId, message });
      setPendingChatMessage(null);
    } catch {
      setPendingChatMessage(null);
      setChatComposerValue(message);
    } finally {
      setIsCreatingChat(false);
    }
  };

  const handleSendStrategy = async () => {
    const message = strategyComposerValue.trim();
    if (!message || sendMessageMutation.isPending || !strategyConversationThreadId || !enabled) {
      return;
    }

    const optimisticMessage: PendingUserMessage = {
      id: `pending-strategy-${Date.now()}`,
      contentText: message,
      createdAt: new Date().toISOString(),
    };

    setStrategyComposerValue("");
    setPendingStrategyMessage(optimisticMessage);

    try {
      await sendMessageMutation.mutateAsync({ threadId: strategyConversationThreadId, message });
      setPendingStrategyMessage(null);
    } catch {
      setPendingStrategyMessage(null);
      setStrategyComposerValue(message);
    }
  };

  const handleCreateBlankStrategy = () => {
    strategyCreateTargetTabRef.current = "chat";
    createStrategyMutation.mutate({});
  };

  const handleSaveCurrentChatAsStrategy = () => {
    if (!activeChatThreadId) {
      toast({
        title: "Open a chat first",
        description: "Start or select a chat before turning it into a strategy.",
        variant: "destructive",
      });
      return;
    }

    strategyCreateTargetTabRef.current = "overview";
    createStrategyMutation.mutate({
      threadId: activeChatThreadId,
      name: runtimeDetails?.activeObjective?.title || activeChatThread?.title || undefined,
      summary:
        runtimeDetails?.activeObjective?.summary ||
        activeChatThread?.pendingActionBundle?.summary ||
        undefined,
    });
  };

  const shouldShowChatEmptyState =
    (!activeChatThreadId || (chatMessages || []).length === 0) && !pendingChatMessage;
  const starterPrompts = [
    "Review my setup for today.",
    "What should I be watching right now?",
    "Stage a trade plan for my idle cash.",
  ];
  const activeTitle =
    workspaceTab === "chat"
      ? activeChatThread
        ? getThreadTitle(
            activeChatThread,
            (chatThreads || []).findIndex((thread) => thread.id === activeChatThread.id),
          )
        : "New Chat"
      : isMobileStrategyDetailOpen
        ? strategyDetail?.name || "Strategies"
        : "Strategies";
  const isChatSending =
    sendMessageMutation.isPending &&
    ((sendMessageMutation.variables as { threadId?: string } | undefined)?.threadId ===
      activeChatThreadId ||
      isCreatingChat);
  const isStrategySending =
    sendMessageMutation.isPending &&
    (sendMessageMutation.variables as { threadId?: string } | undefined)?.threadId ===
      strategyConversationThreadId;

  return (
    <>
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden overscroll-none bg-[radial-gradient(circle_at_top,rgba(28,38,63,0.42),transparent_42%),linear-gradient(180deg,#090d18_0%,#0b1020_48%,#0a0e18_100%)] text-slate-100">
        <div className="mx-auto flex h-full min-h-0 min-w-0 w-full max-w-[96rem] flex-col px-0 sm:px-4 lg:px-6">
          <header className="px-3 py-3 sm:px-0 sm:py-4">
            <div className="terminal-shell overflow-hidden border-[#1f2634] bg-[linear-gradient(135deg,rgba(11,16,32,0.95),rgba(8,13,24,0.98))]">
              <div className="flex items-center justify-between gap-3 border-b border-[#1f2634] px-3 py-3 sm:px-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="rounded-full border border-[#2a2e39] bg-[#131a28] p-2 text-amber-300">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="terminal-kicker">Hermes operator</div>
                      <div className="truncate text-sm font-semibold text-slate-50">
                        {activeTitle}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {workspaceTab === "chat" && (
                    <Button
                      variant="terminalOutline"
                      className="hidden h-9 px-3 md:inline-flex"
                      onClick={() => {
                        void handleStartFreshChat();
                      }}
                      disabled={isCreatingChat}
                    >
                      {isCreatingChat ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <SquarePen className="mr-2 h-4 w-4" />
                      )}
                      New chat
                    </Button>
                  )}

                  <Button
                    variant="terminalOutline"
                    className="hidden h-9 px-3 md:inline-flex"
                    onClick={() => setDrawerState("settings")}
                  >
                    <Settings2 className="mr-2 h-4 w-4" />
                    Settings
                  </Button>

                  <Button
                    variant="terminalOutline"
                    asChild
                    className="hidden h-9 px-3 md:inline-flex"
                  >
                    <Link href="/">
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Dashboard
                    </Link>
                  </Button>

                  <div className="flex items-center gap-2 md:hidden">
                    {workspaceTab === "chat" && (
                      <Button
                        variant="terminalOutline"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => setDrawerState("threads")}
                      >
                        <PanelLeft className="h-4 w-4" />
                        <span className="sr-only">Open conversation history</span>
                      </Button>
                    )}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="terminalOutline" size="icon" className="h-9 w-9">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Open agent actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="border-[#2a2e39] bg-[#131722] p-1 text-slate-100"
                      >
                        {workspaceTab === "chat" && (
                          <DropdownMenuItem
                            className="rounded-sm px-2.5 py-2 text-xs uppercase tracking-[0.1em] focus:bg-[#202637] focus:text-slate-50"
                            onSelect={() => {
                              void handleStartFreshChat();
                            }}
                          >
                            <SquarePen className="h-4 w-4" />
                            New chat
                          </DropdownMenuItem>
                        )}
                        {workspaceTab === "chat" && (
                          <DropdownMenuItem
                            className="rounded-sm px-2.5 py-2 text-xs uppercase tracking-[0.1em] focus:bg-[#202637] focus:text-slate-50"
                            onSelect={() => {
                              handleSaveCurrentChatAsStrategy();
                            }}
                            disabled={!activeChatThreadId || createStrategyMutation.isPending}
                          >
                            {createStrategyMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="h-4 w-4" />
                            )}
                            Save as strategy
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="rounded-sm px-2.5 py-2 text-xs uppercase tracking-[0.1em] focus:bg-[#202637] focus:text-slate-50"
                          onSelect={() => setDrawerState("settings")}
                        >
                          <Settings2 className="h-4 w-4" />
                          Settings
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          asChild
                          className="rounded-sm px-2.5 py-2 text-xs uppercase tracking-[0.1em] focus:bg-[#202637] focus:text-slate-50"
                        >
                          <Link href="/">
                            <ArrowLeft className="h-4 w-4" />
                            Dashboard
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>

              <div className="px-3 py-3 sm:px-4">
                <div className="flex items-center gap-3">
                  <div className="terminal-kicker hidden sm:block">Workspace</div>
                  <div className="grid w-full max-w-md grid-cols-2 gap-2">
                    <Button
                      variant={workspaceTab === "strategies" ? "terminal" : "terminalOutline"}
                      className="h-9 justify-center"
                      onClick={() => setWorkspaceTab("strategies")}
                      data-testid="agent-workspace-strategies"
                    >
                      Strategies
                    </Button>
                    <Button
                      variant={workspaceTab === "chat" ? "terminal" : "terminalOutline"}
                      className="h-9 justify-center"
                      onClick={() => setWorkspaceTab("chat")}
                      data-testid="agent-workspace-chat"
                    >
                      Chat
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 py-4 sm:px-0 sm:py-5">
            {profileError && !profileData && !isLoadingProfile ? (
              <AgentErrorState
                title="Couldn't load agent settings"
                error={profileError}
                onRetry={() => {
                  void refetchProfile();
                }}
              />
            ) : chatThreadsError ? (
              <AgentErrorState
                title="Couldn't load your chats"
                error={chatThreadsError}
                onRetry={() => {
                  void refetchChatThreads();
                }}
              />
            ) : (
              <Tabs
                value={workspaceTab}
                onValueChange={(value) => setWorkspaceTab(value as WorkspaceTab)}
                className="flex h-full min-h-0 flex-col"
              >
                <TabsContent
                  value="chat"
                  className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=inactive]:hidden"
                >
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 md:grid md:grid-cols-[18rem_minmax(0,1fr)] md:gap-4">
                    <aside className="hidden min-h-0 md:block">
                      <div className="terminal-shell h-full overflow-hidden border-[#1f2634] bg-[linear-gradient(180deg,rgba(12,17,29,0.96),rgba(8,13,24,0.98))]">
                        <AgentThreadPanel
                          threads={chatThreads || []}
                          activeThreadId={activeChatThreadId}
                          isLoading={isLoadingChatThreads}
                          error={chatThreadsError}
                          onRetry={() => {
                            void refetchChatThreads();
                          }}
                          onSelect={(threadId) => {
                            setPendingChatSelectionId(null);
                            setActiveChatThreadId(threadId);
                            setPendingChatMessage(null);
                            setChatComposerValue("");
                          }}
                          onStartFresh={() => {
                            void handleStartFreshChat();
                          }}
                          onClose={() => undefined}
                        />
                      </div>
                    </aside>

                    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                      <ChatWorkbenchHeader
                        activeThread={activeChatThread}
                        messages={chatMessages}
                        runtimeDetails={runtimeDetails}
                        enabled={enabled}
                        canAnalyze={canAnalyze}
                        onSaveAsStrategy={handleSaveCurrentChatAsStrategy}
                        isSavingStrategy={createStrategyMutation.isPending}
                      />

                      <div className="mt-1 flex min-h-0 flex-1 flex-col overflow-hidden border-y border-[#1f2634] bg-[#0b1120] md:terminal-shell md:mt-4 md:border md:bg-[linear-gradient(180deg,rgba(15,20,32,0.96),rgba(8,13,24,0.98))]">
                        {activeChatThreadId && chatMessagesError ? (
                          <div className="p-4">
                            <AgentErrorState
                              title="Couldn't load this chat"
                              error={chatMessagesError}
                              onRetry={() => {
                                void refetchChatMessages();
                              }}
                            />
                          </div>
                        ) : runtimeDetailsError && activeChatThreadId ? (
                          <div className="p-4">
                            <AgentErrorState
                              title="Couldn't load chat updates"
                              error={runtimeDetailsError}
                              onRetry={() => {
                                void refetchRuntimeDetails();
                              }}
                            />
                          </div>
                        ) : (
                          <>
                            <div className="hidden border-b border-[#222938] px-3 py-2 sm:px-4 md:block">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="terminal-kicker">Transcript</div>
                                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500">
                                  {activeChatThread
                                    ? formatAgentDateTime(activeChatThread.updatedAt)
                                    : "New"}
                                </div>
                              </div>
                            </div>
                            <div
                              ref={chatScrollRef}
                              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-0 py-2 pb-2 sm:px-4 sm:py-3 md:px-3"
                              data-testid="agent-chat-scroll"
                            >
                              {isLoadingChatMessages && !chatMessages && activeChatThreadId ? (
                                <div className="flex min-h-[12rem] items-center justify-center gap-2 text-sm text-slate-300">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Loading chat...
                                </div>
                              ) : shouldShowChatEmptyState ? (
                                <AgentEmptyConversationState
                                  isDraftConversation={!activeChatThreadId}
                                  enabled={enabled}
                                  canAnalyze={canAnalyze}
                                  starterPrompts={starterPrompts}
                                  onUseStarterPrompt={setChatComposerValue}
                                />
                              ) : (
                                <AgentMessageList
                                  messages={chatMessages || []}
                                  pendingUserMessage={pendingChatMessage}
                                  onConfirmPlan={() => {
                                    if (activeChatThreadId) {
                                      confirmMutation.mutate(activeChatThreadId);
                                    }
                                  }}
                                  onCancelPlan={() => {
                                    if (activeChatThreadId) {
                                      cancelMutation.mutate(activeChatThreadId);
                                    }
                                  }}
                                  isConfirming={confirmMutation.isPending}
                                  isCanceling={cancelMutation.isPending}
                                  endRef={chatEndRef}
                                />
                              )}
                            </div>

                            <div className="border-t border-[#222938] px-0 py-1.5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-4 sm:py-2.5 sm:pb-3 md:px-3">
                              <AgentComposer
                                value={chatComposerValue}
                                onChange={setChatComposerValue}
                                onSend={() => {
                                  void handleSendChat();
                                }}
                                disabled={!enabled || !chatComposerValue.trim() || isChatSending}
                                isSending={isChatSending}
                                enabled={enabled}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent
                  value="strategies"
                  className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=active]:flex data-[state=inactive]:hidden"
                >
                  {strategiesError ? (
                    <AgentErrorState
                      title="Couldn't load strategies"
                      error={strategiesError}
                      onRetry={() => {
                        void refetchStrategies();
                      }}
                    />
                  ) : strategyDetailError && selectedStrategyId ? (
                    <AgentErrorState
                      title="Couldn't load strategy details"
                      error={strategyDetailError}
                      onRetry={() => {
                        void refetchStrategyDetail();
                      }}
                    />
                  ) : strategyMessagesError && strategyConversationThreadId ? (
                    <AgentErrorState
                      title="Couldn't load the strategy chat"
                      error={strategyMessagesError}
                      onRetry={() => {
                        void refetchStrategyMessages();
                      }}
                    />
                  ) : (
                    <AgentStrategiesPanel
                      strategies={strategiesData}
                      strategyDetail={strategyDetail}
                      strategyMessages={isLoadingStrategyMessages ? [] : strategyMessages}
                      selectedStrategyId={selectedStrategyId}
                      detailTab={strategyDetailTab}
                      isLoading={isLoadingStrategies}
                      isDetailLoading={isLoadingStrategyDetail}
                      isCreating={createStrategyMutation.isPending}
                      isSavingId={
                        updateStrategyMutation.isPending
                          ? ((
                              updateStrategyMutation.variables as
                                | { strategyId?: string }
                                | undefined
                            )?.strategyId ?? null)
                          : null
                      }
                      isActivatingId={
                        activateStrategyMutation.isPending
                          ? ((activateStrategyMutation.variables as string | undefined) ?? null)
                          : null
                      }
                      isReviewingId={
                        reviewStrategyMutation.isPending
                          ? ((reviewStrategyMutation.variables as string | undefined) ?? null)
                          : null
                      }
                      isPausingId={
                        pauseStrategyMutation.isPending
                          ? ((pauseStrategyMutation.variables as string | undefined) ?? null)
                          : null
                      }
                      isArchivingId={
                        archiveStrategyMutation.isPending
                          ? ((archiveStrategyMutation.variables as string | undefined) ?? null)
                          : null
                      }
                      isRunningId={
                        runStrategyMutation.isPending
                          ? ((runStrategyMutation.variables as string | undefined) ?? null)
                          : null
                      }
                      strategyComposerValue={strategyComposerValue}
                      onStrategyComposerChange={setStrategyComposerValue}
                      onStrategySend={() => {
                        void handleSendStrategy();
                      }}
                      pendingStrategyMessage={pendingStrategyMessage}
                      strategyScrollViewportRef={strategyScrollRef}
                      strategyThreadEndRef={strategyEndRef}
                      mobileDetailOpen={isMobileStrategyDetailOpen}
                      onSelect={(strategyId) => {
                        setSelectedStrategyId(strategyId);
                        setIsMobileStrategyDetailOpen(Boolean(strategyId));
                      }}
                      onCloseMobileDetail={() => setIsMobileStrategyDetailOpen(false)}
                      onCreateBlank={handleCreateBlankStrategy}
                      onSave={(strategyId, payload) => {
                        updateStrategyMutation.mutate({ strategyId, payload });
                      }}
                      onActivate={(strategyId) => {
                        activateStrategyMutation.mutate(strategyId);
                      }}
                      onReview={(strategyId) => {
                        reviewStrategyMutation.mutate(strategyId);
                      }}
                      onPause={(strategyId) => {
                        pauseStrategyMutation.mutate(strategyId);
                      }}
                      onArchive={(strategyId) => {
                        archiveStrategyMutation.mutate(strategyId);
                      }}
                      onRunNow={(strategyId) => {
                        runStrategyMutation.mutate(strategyId);
                      }}
                      onDetailTabChange={setStrategyDetailTab}
                      onConfirmStrategyPlan={() => {
                        if (strategyConversationThreadId) {
                          confirmMutation.mutate(strategyConversationThreadId);
                        }
                      }}
                      onCancelStrategyPlan={() => {
                        if (strategyConversationThreadId) {
                          cancelMutation.mutate(strategyConversationThreadId);
                        }
                      }}
                      isConfirmingStrategyPlan={confirmMutation.isPending}
                      isCancelingStrategyPlan={cancelMutation.isPending}
                      isSendingStrategyMessage={isStrategySending}
                      agentEnabled={enabled}
                    />
                  )}
                </TabsContent>
              </Tabs>
            )}
          </div>
        </div>
      </div>

      <Sheet
        open={drawerState === "threads"}
        onOpenChange={(open) => setDrawerState(open ? "threads" : null)}
      >
        <SheetContent
          side="left"
          className="w-full border-[#2a2e39] bg-[#131722] p-0 text-slate-100 md:max-w-md"
        >
          <AgentThreadPanel
            threads={chatThreads || []}
            activeThreadId={activeChatThreadId}
            isLoading={isLoadingChatThreads}
            error={chatThreadsError}
            onRetry={() => {
              void refetchChatThreads();
            }}
            onSelect={(threadId) => {
              setPendingChatSelectionId(null);
              setActiveChatThreadId(threadId);
              setPendingChatMessage(null);
              setChatComposerValue("");
            }}
            onStartFresh={() => {
              void handleStartFreshChat();
            }}
            onClose={() => setDrawerState(null)}
          />
        </SheetContent>
      </Sheet>

      <Sheet
        open={drawerState === "settings"}
        onOpenChange={(open) => setDrawerState(open ? "settings" : null)}
      >
        <SheetContent
          side="right"
          className="w-full border-[#2a2e39] bg-[#131722] p-0 text-slate-100 sm:max-w-lg"
        >
          <AgentSettingsPanel
            profileData={profileData}
            isLoadingProfile={isLoadingProfile}
            profileError={profileError}
            onRetry={() => {
              void refetchProfile();
            }}
            enabled={enabled}
            onEnabledChange={setEnabled}
            providerMode={providerMode}
            onProviderModeChange={setProviderMode}
            userPromptTemplate={userPromptTemplate}
            onUserPromptTemplateChange={setUserPromptTemplate}
            defaultSport={defaultSport}
            onDefaultSportChange={setDefaultSport}
            baseUrl={baseUrl}
            onBaseUrlChange={setBaseUrl}
            model={model}
            onModelChange={setModel}
            apiKey={apiKey}
            onApiKeyChange={setApiKey}
            onSaveProfile={() => saveProfileMutation.mutate()}
            isSavingProfile={saveProfileMutation.isPending}
            onSaveByok={() => saveByokMutation.mutate()}
            isSavingByok={saveByokMutation.isPending}
            onClearByok={() => clearByokMutation.mutate()}
            isClearingByok={clearByokMutation.isPending}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
