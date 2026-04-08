import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getReadableAgentError } from "../lib/agent-view";
import type { PendingUserMessage } from "../components/agent-conversation";
import type {
  AgentProfileResponse,
  AgentStrategyDetail,
  AgentStrategySummary,
  AgentThreadMessage,
  AgentTurnProgressEvent,
  AgentThreadRuntimeDetails,
  AgentThreadSummary,
  ProviderMode,
} from "../types";

export type WorkspaceTab = "chat" | "strategies" | "configure";
export type StrategyDetailTab = "overview" | "chat" | "rules";

type PendingTurnStreamTarget = "chat" | "strategy";

const TERMINAL_TURN_EVENTS = new Set<AgentTurnProgressEvent["eventType"]>([
  "turn_completed",
  "turn_failed",
]);

function createTurnId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useAgentShell() {
  const { toast } = useToast();
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const strategyScrollRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const strategyEndRef = useRef<HTMLDivElement>(null);
  const strategyCreateTargetTabRef = useRef<StrategyDetailTab>("overview");
  const strategySelectionInitializedRef = useRef(false);
  const turnEventSourceRef = useRef<{ chat: EventSource | null; strategy: EventSource | null }>({
    chat: null,
    strategy: null,
  });

  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("chat");
  const [isMobileStrategyDetailOpen, setIsMobileStrategyDetailOpen] = useState(false);
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
  const [drawerOpen, setDrawerOpen] = useState<"threads" | "settings" | null>(null);

  const [enabled, setEnabled] = useState(true);
  const [providerMode, setProviderMode] = useState<ProviderMode>("managed");
  const [userPromptTemplate, setUserPromptTemplate] = useState("");
  const [defaultSport, setDefaultSport] = useState("ALL");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");

  const closeTurnStream = (target: PendingTurnStreamTarget) => {
    const current = turnEventSourceRef.current[target];
    if (!current) {
      return;
    }
    current.close();
    turnEventSourceRef.current[target] = null;
  };

  const appendTurnProgressEvent = (
    target: PendingTurnStreamTarget,
    event: AgentTurnProgressEvent,
  ) => {
    const updater = (current: PendingUserMessage | null) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        progressEvents: [...(current.progressEvents || []), event].slice(-16),
      };
    };

    if (target === "chat") {
      setPendingChatMessage(updater);
      return;
    }

    setPendingStrategyMessage(updater);
  };

  const startTurnProgressStream = (input: {
    target: PendingTurnStreamTarget;
    threadId: string;
    turnId: string;
  }) => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return () => undefined;
    }

    closeTurnStream(input.target);
    const stream = new EventSource(
      `/api/agent/threads/${input.threadId}/turns/${input.turnId}/events`,
      { withCredentials: true },
    );
    turnEventSourceRef.current[input.target] = stream;

    stream.onmessage = (raw) => {
      try {
        const parsed = JSON.parse(raw.data) as AgentTurnProgressEvent;
        if (!parsed || typeof parsed.eventType !== "string") {
          return;
        }
        appendTurnProgressEvent(input.target, parsed);
        if (TERMINAL_TURN_EVENTS.has(parsed.eventType)) {
          closeTurnStream(input.target);
        }
      } catch {
        // ignore malformed progress payloads
      }
    };

    stream.onerror = () => {
      closeTurnStream(input.target);
    };

    return () => closeTurnStream(input.target);
  };

  useEffect(() => {
    return () => {
      closeTurnStream("chat");
      closeTurnStream("strategy");
    };
  }, []);

  // --- Queries ---

  const {
    data: profileData,
    isLoading: isLoadingProfile,
    error: profileError,
    refetch: refetchProfile,
  } = useQuery<AgentProfileResponse>({ queryKey: ["/api/agent/profile"] });

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
  } = useQuery<AgentStrategySummary[]>({ queryKey: ["/api/agent/strategies"] });

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

  // --- Effects ---

  useEffect(() => {
    if (!profileData) return;
    setEnabled(profileData.profile.enabled);
    setProviderMode(profileData.profile.providerMode);
    setUserPromptTemplate(profileData.profile.userPromptTemplate);
    setDefaultSport(profileData.profile.defaultSport || "ALL");
    setBaseUrl(profileData.profile.baseUrl || "");
    setModel(profileData.profile.model || "");
  }, [profileData]);

  useEffect(() => {
    if (!chatThreads) return;
    if (pendingChatSelectionId) {
      if (chatThreads.some((t) => t.id === pendingChatSelectionId)) {
        setPendingChatSelectionId(null);
      }
      return;
    }
    if (activeChatThreadId && !chatThreads.some((t) => t.id === activeChatThreadId)) {
      setActiveChatThreadId(chatThreads[0]?.id || null);
      return;
    }
    if (!activeChatThreadId && chatThreads.length > 0) {
      setActiveChatThreadId(chatThreads[0].id);
    }
  }, [activeChatThreadId, chatThreads, pendingChatSelectionId]);

  useEffect(() => {
    const strategies = strategiesData || [];
    if (selectedStrategyId && !strategies.some((s) => s.id === selectedStrategyId)) {
      setSelectedStrategyId(null);
    }
  }, [selectedStrategyId, strategiesData]);

  useEffect(() => {
    if (!selectedStrategyId) setIsMobileStrategyDetailOpen(false);
  }, [selectedStrategyId]);

  useEffect(() => {
    if (strategySelectionInitializedRef.current) return;
    const strategies = strategiesData || [];
    if (strategies.length === 0) return;
    setSelectedStrategyId((c) => c || strategies[0].id);
    strategySelectionInitializedRef.current = true;
  }, [strategiesData]);

  useEffect(() => {
    const viewport = chatScrollRef.current;
    if (!viewport) return;
    const frameId = window.requestAnimationFrame(() => {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: pendingChatMessage ? "smooth" : "auto",
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [chatMessages?.length, pendingChatMessage?.id]);

  useEffect(() => {
    const viewport = strategyScrollRef.current;
    if (!viewport) return;
    const frameId = window.requestAnimationFrame(() => {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: pendingStrategyMessage ? "smooth" : "auto",
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [strategyMessages?.length, pendingStrategyMessage?.id]);

  // --- Derived ---

  const activeChatThread = chatThreads?.find((t) => t.id === activeChatThreadId) || null;
  const canAnalyze = Boolean(profileData?.capabilities.canAnalyze);

  // --- Invalidation helpers ---

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

  // --- Mutations ---

  const sendMessageMutation = useMutation({
    mutationFn: async ({
      threadId,
      message,
      turnId,
    }: {
      threadId: string;
      message: string;
      turnId?: string;
    }) => {
      const res = await apiRequest("POST", `/api/agent/threads/${threadId}/messages`, {
        message,
        turnId,
      });
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
        const next = (current || []).filter((s) => s.id !== result.id);
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

  // --- Action handlers ---

  const createChatThread = async () => {
    const res = await apiRequest("POST", "/api/agent/threads", { workspace: "chat" });
    const thread = (await res.json()) as AgentThreadSummary;
    setPendingChatSelectionId(thread.id);
    setActiveChatThreadId(thread.id);
    await queryClient.invalidateQueries({ queryKey: ["/api/agent/threads"] });
    return thread;
  };

  const handleStartFreshChat = async () => {
    if (isCreatingChat) return;
    setDrawerOpen(null);
    closeTurnStream("chat");
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

  const handleSendChat = async (messageOverride?: string) => {
    const message = (messageOverride ?? chatComposerValue).trim();
    if (!message || sendMessageMutation.isPending || isCreatingChat) return;
    const optimisticMessage: PendingUserMessage = {
      id: `pending-chat-${Date.now()}`,
      contentText: message,
      createdAt: new Date().toISOString(),
      progressEvents: [],
    };
    setChatComposerValue("");
    setPendingChatMessage(optimisticMessage);
    let threadId = activeChatThreadId;
    let stopTurnProgressStream: () => void = () => {};
    try {
      if (!threadId) {
        setIsCreatingChat(true);
        const thread = await createChatThread();
        threadId = thread.id;
      }
      const turnId = createTurnId();
      stopTurnProgressStream = startTurnProgressStream({
        target: "chat",
        threadId,
        turnId,
      });
      await sendMessageMutation.mutateAsync({ threadId, message, turnId });
      setPendingChatMessage(null);
    } catch {
      setPendingChatMessage(null);
      setChatComposerValue(message);
    } finally {
      stopTurnProgressStream();
      closeTurnStream("chat");
      setIsCreatingChat(false);
    }
  };

  const handleSendStrategy = async (messageOverride?: string) => {
    const message = (messageOverride ?? strategyComposerValue).trim();
    if (!message || sendMessageMutation.isPending || !strategyConversationThreadId || !enabled)
      return;
    const optimisticMessage: PendingUserMessage = {
      id: `pending-strategy-${Date.now()}`,
      contentText: message,
      createdAt: new Date().toISOString(),
      progressEvents: [],
    };
    setStrategyComposerValue("");
    setPendingStrategyMessage(optimisticMessage);
    let stopTurnProgressStream: () => void = () => {};
    try {
      const turnId = createTurnId();
      stopTurnProgressStream = startTurnProgressStream({
        target: "strategy",
        threadId: strategyConversationThreadId,
        turnId,
      });
      await sendMessageMutation.mutateAsync({
        threadId: strategyConversationThreadId,
        message,
        turnId,
      });
      setPendingStrategyMessage(null);
    } catch {
      setPendingStrategyMessage(null);
      setStrategyComposerValue(message);
    } finally {
      stopTurnProgressStream();
      closeTurnStream("strategy");
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

  const isChatSending =
    sendMessageMutation.isPending &&
    ((sendMessageMutation.variables as { threadId?: string } | undefined)?.threadId ===
      activeChatThreadId ||
      isCreatingChat);
  const isStrategySending =
    sendMessageMutation.isPending &&
    (sendMessageMutation.variables as { threadId?: string } | undefined)?.threadId ===
      strategyConversationThreadId;

  return {
    // Refs
    chatScrollRef,
    strategyScrollRef,
    chatEndRef,
    strategyEndRef,

    // State
    workspaceTab,
    setWorkspaceTab,
    isMobileStrategyDetailOpen,
    setIsMobileStrategyDetailOpen,
    drawerOpen,
    setDrawerOpen,
    activeChatThreadId,
    setActiveChatThreadId,
    selectedStrategyId,
    setSelectedStrategyId,
    strategyDetailTab,
    setStrategyDetailTab,
    chatComposerValue,
    setChatComposerValue,
    strategyComposerValue,
    setStrategyComposerValue,
    pendingChatMessage,
    setPendingChatMessage,
    pendingStrategyMessage,
    isCreatingChat,

    // Settings state
    enabled,
    setEnabled,
    providerMode,
    setProviderMode,
    userPromptTemplate,
    setUserPromptTemplate,
    defaultSport,
    setDefaultSport,
    baseUrl,
    setBaseUrl,
    model,
    setModel,
    apiKey,
    setApiKey,

    // Queries
    profileData,
    isLoadingProfile,
    profileError,
    refetchProfile,
    chatThreads,
    isLoadingChatThreads,
    chatThreadsError,
    refetchChatThreads,
    chatMessages,
    isLoadingChatMessages,
    chatMessagesError,
    refetchChatMessages,
    runtimeDetails,
    runtimeDetailsError,
    refetchRuntimeDetails,
    strategiesData,
    isLoadingStrategies,
    strategiesError,
    refetchStrategies,
    strategyDetail,
    isLoadingStrategyDetail,
    strategyDetailError,
    refetchStrategyDetail,
    strategyConversationThreadId,
    strategyMessages,
    isLoadingStrategyMessages,
    strategyMessagesError,
    refetchStrategyMessages,

    // Derived
    activeChatThread,
    canAnalyze,

    // Mutations
    sendMessageMutation,
    confirmMutation,
    cancelMutation,
    saveProfileMutation,
    saveByokMutation,
    clearByokMutation,
    createStrategyMutation,
    updateStrategyMutation,
    activateStrategyMutation,
    reviewStrategyMutation,
    pauseStrategyMutation,
    archiveStrategyMutation,
    runStrategyMutation,

    // Handlers
    handleStartFreshChat,
    handleSendChat,
    handleSendStrategy,
    handleCreateBlankStrategy,
    handleSaveCurrentChatAsStrategy,

    // Computed
    isChatSending,
    isStrategySending,
  };
}
