import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bot,
  Loader2,
  MoreHorizontal,
  PanelLeft,
  Settings2,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
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
  const [pendingThreadSelectionId, setPendingThreadSelectionId] = useState<string | null>(null);
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
    queryKey: ["/api/agent/threads", activeThreadId || "inactive", "messages"],
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

    if (pendingThreadSelectionId) {
      if (threadsData.some((thread) => thread.id === pendingThreadSelectionId)) {
        setPendingThreadSelectionId(null);
      }
      return;
    }

    if (activeThreadId && !threadsData.some((thread) => thread.id === activeThreadId)) {
      setActiveThreadId(threadsData[0]?.id || null);
      return;
    }

    if (!activeThreadId && threadsData.length > 0) {
      setActiveThreadId(threadsData[0].id);
    }
  }, [activeThreadId, pendingThreadSelectionId, threadsData]);

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
    setPendingThreadSelectionId(thread.id);
    setActiveThreadId(thread.id);
    await queryClient.invalidateQueries({ queryKey: ["/api/agent/threads"] });
    return thread;
  };

  const handleSelectThread = (threadId: string) => {
    setPendingThreadSelectionId(null);
    setActiveThreadId(threadId);
    setPendingUserMessage(null);
    setComposerValue("");
  };

  const handleStartFreshChat = async () => {
    if (isCreatingThread) {
      return;
    }

    setDrawerState(null);
    setPendingUserMessage(null);
    setComposerValue("");

    try {
      setIsCreatingThread(true);
      await createThread();
    } catch (error) {
      toast({
        title: "Failed to start a new chat",
        description: getReadableAgentError(error, "A new conversation could not be started."),
        variant: "destructive",
      });
    } finally {
      setIsCreatingThread(false);
    }
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
  const statusTone =
    profileError ||
    pendingBundle ||
    !enabled ||
    !canAnalyze ||
    sendMessageMutation.isPending ||
    isCreatingThread
      ? profileError || pendingBundle
        ? "warning"
        : "muted"
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
  const mobileStatusClassName =
    statusTone === "warning"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
      : statusTone === "muted"
        ? "border-slate-600 bg-slate-800/80 text-slate-300"
        : "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";

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

  const activeThreadIndex = activeThread
    ? (threadsData?.findIndex((thread) => thread.id === activeThread.id) ?? -1)
    : -1;
  const title =
    activeThread && !activeThread.lastMessageAt && !activeThread.title?.trim()
      ? "New Chat"
      : activeThread && activeThreadIndex >= 0
        ? getThreadTitle(activeThread, activeThreadIndex)
        : "New Chat";
  const subtitle = pendingBundle
    ? "Review the staged proposal below before anything executes."
    : !enabled
      ? "Enable the agent from Settings when you're ready to continue."
      : !canAnalyze
        ? "Finish your setup to start a new conversation."
        : "Use plain language. The agent will stage any action for confirmation before it changes your account.";
  const isFreshConversation = !activeThreadId || !activeThread?.lastMessageAt;
  const shouldShowEmptyState = !messagesData || messagesData.length === 0;
  const shellPaddingStyle = {
    paddingTop: "max(env(safe-area-inset-top), 0.5rem)",
    paddingLeft: "max(env(safe-area-inset-left), 0.5rem)",
    paddingRight: "max(env(safe-area-inset-right), 0.5rem)",
  };
  const composerPaddingStyle = {
    paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)",
  };

  return (
    <>
      <div
        className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,#06080d_0%,#0b1120_48%,#080d18_100%)]"
        style={shellPaddingStyle}
      >
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[92rem] flex-1 overflow-hidden rounded-md border border-[#2a2e39] bg-[#131722] font-mono text-slate-100 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.78)]">
          <aside className="hidden min-h-0 w-[320px] min-w-[320px] flex-col border-r border-[#2a2e39] bg-[#101521] md:flex">
            <AgentThreadPanel
              threads={threadsData || []}
              activeThreadId={activeThreadId}
              isLoading={isLoadingThreads}
              error={threadsError}
              onRetry={() => {
                void refetchThreads();
              }}
              onSelect={handleSelectThread}
              onStartFresh={() => {
                void handleStartFreshChat();
              }}
              onClose={() => undefined}
            />
          </aside>

          <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header className="border-b border-[#2a2e39] bg-[#131722] px-3 py-3 sm:px-4">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-sm border-[#2a2e39] bg-[#171c29] text-slate-100 hover:bg-[#202637] md:hidden"
                  onClick={() => setDrawerState("threads")}
                >
                  <PanelLeft className="h-4 w-4" />
                  <span className="sr-only">Open conversation history</span>
                </Button>

                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="hidden h-9 w-9 items-center justify-center rounded-sm border border-amber-500/30 bg-amber-500/10 text-amber-300 sm:flex">
                    <Bot className="h-4 w-4" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      <span>Sportfolio Agent</span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-sm border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] sm:hidden",
                          mobileStatusClassName,
                        )}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    <div
                      data-testid="agent-thread-title"
                      className="mt-1 truncate text-sm font-semibold tracking-tight text-slate-50 sm:text-lg"
                    >
                      {title}
                    </div>
                    <div className="mt-1 hidden max-w-3xl text-xs leading-5 text-slate-400 sm:block">
                      {subtitle}
                    </div>
                  </div>
                </div>

                <AgentStatusPill
                  label={statusLabel}
                  tone={statusTone}
                  className="hidden xl:inline-flex"
                />

                <div className="hidden items-center gap-2 md:flex">
                  <Button
                    variant="outline"
                    className="h-9 rounded-sm border-[#2a2e39] bg-[#171c29] px-3 text-xs uppercase tracking-[0.12em] text-slate-100 hover:bg-[#202637] hover:text-slate-50"
                    onClick={() => {
                      void handleStartFreshChat();
                    }}
                    disabled={isCreatingThread}
                  >
                    {isCreatingThread ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <SquarePen className="mr-2 h-3.5 w-3.5" />
                    )}
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
                </div>

                <div className="flex items-center gap-2 md:hidden">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 rounded-sm border-[#2a2e39] bg-[#171c29] text-slate-100 hover:bg-[#202637]"
                    onClick={() => {
                      void handleStartFreshChat();
                    }}
                    disabled={isCreatingThread}
                  >
                    {isCreatingThread ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <SquarePen className="h-4 w-4" />
                    )}
                    <span className="sr-only">Start a new chat</span>
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 rounded-sm border-[#2a2e39] bg-[#171c29] text-slate-100 hover:bg-[#202637]"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Open agent actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="border-[#2a2e39] bg-[#131722] p-1 text-slate-100"
                    >
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
            </header>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,#0f1726_0%,#0d1422_32%,#0f1625_100%)]">
              <ScrollArea className="min-h-0 flex-1">
                <div className="mx-auto flex min-h-full w-full max-w-[56rem] flex-col px-3 py-4 sm:px-5 sm:py-5">
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
                  ) : shouldShowEmptyState ? (
                    <AgentEmptyConversationState
                      isDraftConversation={isFreshConversation}
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

                  {shouldShowEmptyState && pendingUserMessage && (
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

              <div
                className="border-t border-[#2a2e39] bg-[#111522] px-3 pt-3 sm:px-4"
                style={composerPaddingStyle}
              >
                <div className="mx-auto w-full max-w-[56rem]">
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
          </section>
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
            threads={threadsData || []}
            activeThreadId={activeThreadId}
            isLoading={isLoadingThreads}
            error={threadsError}
            onRetry={() => {
              void refetchThreads();
            }}
            onSelect={handleSelectThread}
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
