import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, Loader2, MessageSquare, Plus, Settings2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AgentComposer } from "./components/agent-composer";
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
  AgentThreadMessage,
  AgentThreadSummary,
  ProviderMode,
} from "./types";

export default function AgentShell() {
  const { toast } = useToast();
  const threadEndRef = useRef<HTMLDivElement>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isDraftConversation, setIsDraftConversation] = useState(false);
  const [drawerState, setDrawerState] = useState<AgentDrawerState>(null);
  const [composerValue, setComposerValue] = useState("");
  const [pendingUserMessage, setPendingUserMessage] = useState<PendingUserMessage | null>(null);
  const [isCreatingThread, setIsCreatingThread] = useState(false);

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
    data: threadsData,
    isLoading: isLoadingThreads,
    error: threadsError,
    refetch: refetchThreads,
  } = useQuery<AgentThreadSummary[]>({
    queryKey: ["/api/agent/threads"],
  });
  const {
    data: messagesData,
    isLoading: isLoadingMessages,
    error: messagesError,
    refetch: refetchMessages,
  } = useQuery<AgentThreadMessage[]>({
    queryKey: activeThreadId
      ? ["/api/agent/threads", activeThreadId, "messages"]
      : ["/api/agent/threads", "draft", "messages"],
    enabled: Boolean(activeThreadId),
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
    if (!threadsData) {
      return;
    }

    if (activeThreadId && !threadsData.some((thread) => thread.id === activeThreadId)) {
      if (threadsData.length > 0) {
        setActiveThreadId(threadsData[0].id);
        setIsDraftConversation(false);
      } else {
        setActiveThreadId(null);
      }
      return;
    }

    if (isDraftConversation) {
      return;
    }

    if (!activeThreadId && threadsData.length > 0) {
      setActiveThreadId(threadsData[0].id);
    }
  }, [activeThreadId, isDraftConversation, threadsData]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const viewport = threadEndRef.current?.closest("[data-radix-scroll-area-viewport]");
      if (!(viewport instanceof HTMLElement)) {
        return;
      }

      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: pendingUserMessage ? "smooth" : "auto",
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [messagesData?.length, pendingUserMessage?.id]);

  const activeThread = threadsData?.find((thread) => thread.id === activeThreadId) || null;

  const invalidateThreadQueries = async (threadId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/agent/threads"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/agent/threads", threadId, "messages"] }),
    ]);
  };

  const invalidateGameplayQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/scouts"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/scouts/status"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] }),
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return (
            typeof key === "string" &&
            (key.startsWith("/api/daily-boosts") ||
              key.startsWith("/api/lp") ||
              key.startsWith("/api/amm/"))
          );
        },
      }),
    ]);
  };

  const sendMessageMutation = useMutation({
    mutationFn: async ({ threadId, message }: { threadId: string; message: string }) => {
      const res = await apiRequest("POST", `/api/agent/threads/${threadId}/messages`, { message });
      return res.json();
    },
    onSuccess: async (_result, variables) => {
      await invalidateThreadQueries(variables.threadId);
    },
    onError: (error) => {
      toast({
        title: "Failed to send message",
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
      await invalidateThreadQueries(threadId);
      await invalidateGameplayQueries();
    },
    onError: (error) => {
      toast({
        title: "Failed to confirm plan",
        description: getReadableAgentError(error, "The plan could not be confirmed."),
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
      await invalidateThreadQueries(threadId);
    },
    onError: (error) => {
      toast({
        title: "Failed to cancel plan",
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
      toast({ title: "Agent settings updated", description: "Your chat preferences were saved." });
    },
    onError: (error) => {
      toast({
        title: "Failed to save settings",
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
    onError: (error) => {
      toast({
        title: "Failed to save BYOK",
        description: getReadableAgentError(error, "The BYOK configuration could not be saved."),
        variant: "destructive",
      });
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
      toast({ title: "BYOK removed", description: "The stored API key was removed." });
    },
    onError: (error) => {
      toast({
        title: "Failed to remove BYOK",
        description: getReadableAgentError(error, "The saved key could not be removed."),
        variant: "destructive",
      });
    },
  });

  const createThread = async () => {
    const res = await apiRequest("POST", "/api/agent/threads", {});
    const thread = (await res.json()) as AgentThreadSummary;
    setActiveThreadId(thread.id);
    setIsDraftConversation(false);
    await queryClient.invalidateQueries({ queryKey: ["/api/agent/threads"] });
    return thread;
  };

  const handleStartFreshChat = () => {
    setDrawerState(null);
    setIsDraftConversation(true);
    setActiveThreadId(null);
    setPendingUserMessage(null);
    setComposerValue("");
  };

  const handleSend = async () => {
    const message = composerValue.trim();
    if (!message || sendMessageMutation.isPending || isCreatingThread) {
      return;
    }

    const optimisticMessage: PendingUserMessage = {
      id: `pending-${Date.now()}`,
      contentText: message,
      createdAt: new Date().toISOString(),
    };

    setComposerValue("");
    setPendingUserMessage(optimisticMessage);

    let threadId = activeThreadId;

    try {
      if (!threadId) {
        setIsCreatingThread(true);
        const thread = await createThread();
        threadId = thread.id;
      }

      await sendMessageMutation.mutateAsync({ threadId, message });
      setPendingUserMessage(null);
    } catch {
      setPendingUserMessage(null);
      setComposerValue(message);
    } finally {
      setIsCreatingThread(false);
    }
  };

  const pendingBundle = activeThread?.pendingActionBundle || null;
  const canAnalyze = Boolean(profileData?.capabilities.canAnalyze);
  const statusTone = profileError
    ? "warning"
    : pendingBundle
      ? "warning"
      : !enabled || !canAnalyze || sendMessageMutation.isPending || isCreatingThread
        ? "muted"
        : "default";
  const statusLabel = profileError
    ? "Needs Attention"
    : pendingBundle
      ? "Plan Ready"
      : !enabled
        ? "Paused"
        : !canAnalyze
          ? "Setup Needed"
          : sendMessageMutation.isPending || isCreatingThread
            ? "Sending"
            : "Ready";

  const isSendDisabled =
    !enabled ||
    !canAnalyze ||
    !composerValue.trim() ||
    sendMessageMutation.isPending ||
    isCreatingThread ||
    Boolean(threadsError) ||
    Boolean(activeThreadId && messagesError);

  const starterPrompts = [
    "Review my setup",
    "What should I do with my idle balance?",
    "Who should get my community boost today?",
  ];

  const title =
    activeThread && threadsData
      ? getThreadTitle(
          activeThread,
          threadsData.findIndex((thread) => thread.id === activeThread.id),
        )
      : "New Chat";

  const subtitle = pendingBundle
    ? "Review the staged proposal below before anything executes."
    : !enabled
      ? "Enable the agent from Settings when you're ready to continue."
      : !canAnalyze
        ? "Finish your setup to start a new conversation."
        : "Use plain language. The agent will stage any action for confirmation before it changes your account.";

  const closeDrawer = () => setDrawerState(null);

  return (
    <>
      <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,#06080d_0%,#0b1120_48%,#080d18_100%)] px-2 py-2 sm:px-4 sm:py-4">
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col rounded-md border border-[#2a2e39] bg-[#131722] font-mono text-slate-100 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.78)]">
          <div className="border-b border-[#2a2e39] px-3 py-3 sm:px-4 sm:py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <div className="rounded-sm border border-amber-500/30 bg-amber-500/10 p-2 text-amber-300">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Sportfolio Agent
                    </div>
                    <div className="mt-1 truncate text-lg font-semibold tracking-tight text-slate-50 sm:text-xl">
                      {title}
                    </div>
                  </div>
                  <AgentStatusPill label={statusLabel} tone={statusTone} />
                </div>
                <div className="mt-2 max-w-3xl text-xs leading-6 text-slate-400">{subtitle}</div>
              </div>

              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Button
                  variant="outline"
                  asChild
                  className="h-9 rounded-sm border-[#2a2e39] bg-[#171c29] px-3 text-xs uppercase tracking-[0.12em] text-slate-100 hover:bg-[#202637] hover:text-slate-50"
                >
                  <Link href="/">
                    <ArrowLeft className="mr-2 h-3.5 w-3.5" />
                    Dashboard
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  className="h-9 rounded-sm border-[#2a2e39] bg-[#171c29] px-3 text-xs uppercase tracking-[0.12em] text-slate-100 hover:bg-[#202637] hover:text-slate-50"
                  onClick={() => setDrawerState("threads")}
                >
                  <MessageSquare className="mr-2 h-3.5 w-3.5" />
                  History
                </Button>
                <Button
                  variant="outline"
                  className="h-9 rounded-sm border-[#2a2e39] bg-[#171c29] px-3 text-xs uppercase tracking-[0.12em] text-slate-100 hover:bg-[#202637] hover:text-slate-50"
                  onClick={handleStartFreshChat}
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  New Chat
                </Button>
                <Button
                  variant="outline"
                  className="h-9 rounded-sm border-[#2a2e39] bg-[#171c29] px-3 text-xs uppercase tracking-[0.12em] text-slate-100 hover:bg-[#202637] hover:text-slate-50"
                  onClick={() => setDrawerState("settings")}
                >
                  <Settings2 className="mr-2 h-3.5 w-3.5" />
                  Settings
                </Button>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden px-1.5 pb-1.5 pt-1.5 sm:px-2 sm:pb-2 sm:pt-2">
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-sm border border-[#2a2e39] bg-[linear-gradient(180deg,#0f1726_0%,#0d1422_32%,#0f1625_100%)]">
              <ScrollArea className="min-h-0 flex-1">
                <div className="mx-auto flex min-h-full max-w-[54rem] flex-col px-3 py-3 sm:px-4 sm:py-4">
                  {profileError && !profileData && !isLoadingProfile ? (
                    <AgentErrorState
                      title="Couldn't load agent settings"
                      error={profileError}
                      onRetry={() => {
                        void refetchProfile();
                      }}
                    />
                  ) : threadsError ? (
                    <AgentErrorState
                      title="Couldn't load your conversations"
                      error={threadsError}
                      onRetry={() => {
                        void refetchThreads();
                      }}
                    />
                  ) : activeThreadId && messagesError ? (
                    <AgentErrorState
                      title="Couldn't load this conversation"
                      error={messagesError}
                      onRetry={() => {
                        void refetchMessages();
                      }}
                    />
                  ) : isLoadingThreads && !threadsData ? (
                    <div className="flex items-center justify-center gap-2 rounded-sm border border-[#2a2e39] bg-[#171c29] p-4 text-xs text-slate-300 shadow-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading conversations...
                    </div>
                  ) : activeThreadId && isLoadingMessages && !messagesData ? (
                    <div className="flex items-center justify-center gap-2 rounded-sm border border-[#2a2e39] bg-[#171c29] p-4 text-xs text-slate-300 shadow-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading conversation...
                    </div>
                  ) : !messagesData || messagesData.length === 0 ? (
                    <AgentEmptyConversationState
                      isDraftConversation={isDraftConversation || !activeThreadId}
                      enabled={enabled}
                      canAnalyze={canAnalyze}
                      starterPrompts={starterPrompts}
                      onUseStarterPrompt={setComposerValue}
                    />
                  ) : (
                    <AgentMessageList
                      messages={messagesData}
                      pendingUserMessage={pendingUserMessage}
                      onConfirmPlan={() => {
                        if (activeThreadId) {
                          confirmMutation.mutate(activeThreadId);
                        }
                      }}
                      onCancelPlan={() => {
                        if (activeThreadId) {
                          cancelMutation.mutate(activeThreadId);
                        }
                      }}
                      isConfirming={confirmMutation.isPending}
                      isCanceling={cancelMutation.isPending}
                      endRef={threadEndRef}
                    />
                  )}

                  {(!messagesData || messagesData.length === 0) && pendingUserMessage && (
                    <div className="mt-3">
                      <AgentMessageList
                        messages={[]}
                        pendingUserMessage={pendingUserMessage}
                        onConfirmPlan={() => undefined}
                        onCancelPlan={() => undefined}
                        isConfirming={false}
                        isCanceling={false}
                        endRef={threadEndRef}
                      />
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="border-t border-[#2a2e39] bg-[#111522] px-3 py-3 sm:px-4">
                <div className="mx-auto max-w-[54rem]">
                  <AgentComposer
                    value={composerValue}
                    onChange={setComposerValue}
                    onSend={() => {
                      void handleSend();
                    }}
                    disabled={isSendDisabled}
                    isSending={sendMessageMutation.isPending || isCreatingThread}
                    enabled={enabled}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Sheet
        open={drawerState === "threads"}
        onOpenChange={(open) => setDrawerState(open ? "threads" : null)}
      >
        <SheetContent
          side="left"
          className="w-full max-w-md border-[#2a2e39] bg-[#131722] p-0 text-slate-100"
        >
          <AgentThreadPanel
            threads={threadsData || []}
            activeThreadId={activeThreadId}
            isLoading={isLoadingThreads}
            error={threadsError}
            onRetry={() => {
              void refetchThreads();
            }}
            onSelect={(threadId) => {
              setActiveThreadId(threadId);
              setIsDraftConversation(false);
              setPendingUserMessage(null);
            }}
            onStartFresh={handleStartFreshChat}
            onClose={closeDrawer}
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
