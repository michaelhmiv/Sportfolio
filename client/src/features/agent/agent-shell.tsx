import {
  ArrowLeft,
  Bot,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Settings2,
  Sparkles,
  SquarePen,
  Layers,
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
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { AgentComposer } from "./components/agent-composer";
import { AgentConfigurePanel } from "./components/agent-configure-panel";
import { AgentStrategiesPanel } from "./components/agent-strategies-panel";
import { AgentUiBlockList } from "./components/agent-ui-blocks";
import { AgentEmptyConversationState, AgentMessageList } from "./components/agent-conversation";
import { AgentErrorState, AgentThreadPanel } from "./components/agent-panels";
import { AgentStatusHeader } from "./components/agent-status-header";
import { AgentCommandBar } from "./components/agent-command-bar";
import { getThreadTitle } from "./lib/agent-view";
import { useAgentShell, type WorkspaceTab } from "./hooks/use-agent-shell";

const WORKSPACE_TABS: Array<{ id: WorkspaceTab; label: string; icon: typeof MessageCircle }> = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "strategies", label: "Strategies", icon: Layers },
  { id: "configure", label: "Configure", icon: Settings2 },
];

const STARTER_PROMPTS = [
  "Review my setup for today.",
  "What should I be watching right now?",
  "Stage a trade plan for my idle cash.",
];

export default function AgentShell() {
  const isMobile = useIsMobile();
  const shell = useAgentShell();

  const shouldShowChatEmptyState =
    (!shell.activeChatThreadId || (shell.chatMessages || []).length === 0) &&
    !shell.pendingChatMessage;

  const activeTitle =
    shell.workspaceTab === "chat"
      ? shell.activeChatThread
        ? getThreadTitle(
            shell.activeChatThread,
            (shell.chatThreads || []).findIndex((t) => t.id === shell.activeChatThread!.id),
          )
        : "New Chat"
      : shell.workspaceTab === "strategies"
        ? shell.isMobileStrategyDetailOpen
          ? shell.strategyDetail?.name || "Strategies"
          : "Strategies"
        : "Configure";

  return (
    <>
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden overscroll-none bg-[#0a0e1a] text-white">
        <div className="mx-auto flex h-full min-h-0 min-w-0 w-full max-w-[96rem] flex-col">
          {/* ── Top Bar ── */}
          <header className="shrink-0 border-b border-white/[0.06] bg-white/[0.02] px-3 py-2.5 sm:px-5 sm:py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400/20 to-amber-600/10 ring-1 ring-white/[0.08]">
                  <Bot className="h-4.5 w-4.5 text-amber-300" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-white/30">
                    Hermes
                  </p>
                  <p className="truncate text-sm font-semibold text-white/90">{activeTitle}</p>
                </div>
              </div>

              {/* Desktop actions */}
              <div className="hidden items-center gap-2 md:flex">
                {shell.workspaceTab === "chat" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 rounded-lg text-white/50 hover:bg-white/[0.06] hover:text-white/80"
                    onClick={() => void shell.handleStartFreshChat()}
                    disabled={shell.isCreatingChat}
                  >
                    {shell.isCreatingChat ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <SquarePen className="h-3.5 w-3.5" />
                    )}
                    New chat
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="h-8 gap-1.5 rounded-lg text-white/50 hover:bg-white/[0.06] hover:text-white/80"
                >
                  <Link href="/">
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Dashboard
                  </Link>
                </Button>
              </div>

              {/* Mobile actions */}
              <div className="flex items-center gap-1.5 md:hidden">
                {shell.workspaceTab === "chat" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg text-white/40 hover:bg-white/[0.06]"
                    onClick={() => shell.setDrawerOpen("threads")}
                  >
                    <SquarePen className="h-4 w-4" />
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg text-white/40 hover:bg-white/[0.06]"
                      data-testid="agent-shell-more-menu-trigger"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="min-w-[180px] rounded-xl border-white/[0.08] bg-[#141824] p-1 text-white/80"
                  >
                    {shell.workspaceTab === "chat" && (
                      <DropdownMenuItem
                        className="gap-2 rounded-lg px-3 py-2.5 text-sm focus:bg-white/[0.06]"
                        onSelect={() => void shell.handleStartFreshChat()}
                        data-testid="agent-shell-new-chat-menu-item"
                      >
                        <SquarePen className="h-4 w-4 text-white/40" />
                        New chat
                      </DropdownMenuItem>
                    )}
                    {shell.workspaceTab === "chat" && (
                      <DropdownMenuItem
                        className="gap-2 rounded-lg px-3 py-2.5 text-sm focus:bg-white/[0.06]"
                        onSelect={() => shell.handleSaveCurrentChatAsStrategy()}
                        disabled={
                          !shell.activeChatThreadId || shell.createStrategyMutation.isPending
                        }
                        data-testid="agent-shell-save-as-strategy-menu-item"
                      >
                        <Sparkles className="h-4 w-4 text-white/40" />
                        Save as strategy
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      asChild
                      className="gap-2 rounded-lg px-3 py-2.5 text-sm focus:bg-white/[0.06]"
                    >
                      <Link href="/">
                        <ArrowLeft className="h-4 w-4 text-white/40" />
                        Dashboard
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Workspace tabs */}
            <div className="mt-2.5 flex gap-1">
              {WORKSPACE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => shell.setWorkspaceTab(tab.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                    shell.workspaceTab === tab.id
                      ? "bg-white/[0.08] text-white shadow-sm"
                      : "text-white/40 hover:bg-white/[0.04] hover:text-white/60",
                  )}
                  data-testid={`agent-workspace-${tab.id}`}
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>
          </header>

          {/* ── Content Area ── */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {shell.profileError && !shell.profileData && !shell.isLoadingProfile ? (
              <div className="p-4">
                <AgentErrorState
                  title="Couldn't load agent settings"
                  error={shell.profileError}
                  onRetry={() => void shell.refetchProfile()}
                />
              </div>
            ) : shell.chatThreadsError ? (
              <div className="p-4">
                <AgentErrorState
                  title="Couldn't load your chats"
                  error={shell.chatThreadsError}
                  onRetry={() => void shell.refetchChatThreads()}
                />
              </div>
            ) : (
              <>
                {/* ── Chat Tab ── */}
                <div
                  className={cn(
                    "min-h-0 flex-1 flex-col overflow-hidden",
                    shell.workspaceTab === "chat" ? "flex" : "hidden",
                  )}
                >
                  <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[17rem_minmax(0,1fr)] md:gap-0">
                    {/* Thread sidebar — desktop only */}
                    <aside className="hidden min-h-0 border-r border-white/[0.06] bg-white/[0.01] md:block">
                      <AgentThreadPanel
                        threads={shell.chatThreads || []}
                        activeThreadId={shell.activeChatThreadId}
                        isLoading={shell.isLoadingChatThreads}
                        error={shell.chatThreadsError}
                        onRetry={() => void shell.refetchChatThreads()}
                        onSelect={(threadId) => {
                          shell.setActiveChatThreadId(threadId);
                          shell.setPendingChatMessage(null);
                          shell.setChatComposerValue("");
                        }}
                        onStartFresh={() => void shell.handleStartFreshChat()}
                        onClose={() => undefined}
                      />
                    </aside>

                    {/* Chat main */}
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                      {/* Status header */}
                      <div className="shrink-0 border-b border-white/[0.04] px-3 py-2 sm:px-4 md:px-5">
                        <AgentStatusHeader
                          activeThread={shell.activeChatThread}
                          messages={shell.chatMessages}
                          runtimeDetails={shell.runtimeDetails}
                          enabled={shell.enabled}
                          canAnalyze={shell.canAnalyze}
                        />
                      </div>

                      {/* Messages */}
                      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                        {shell.activeChatThreadId && shell.chatMessagesError ? (
                          <div className="p-4">
                            <AgentErrorState
                              title="Couldn't load this chat"
                              error={shell.chatMessagesError}
                              onRetry={() => void shell.refetchChatMessages()}
                            />
                          </div>
                        ) : shell.runtimeDetailsError && shell.activeChatThreadId ? (
                          <div className="p-4">
                            <AgentErrorState
                              title="Couldn't load chat updates"
                              error={shell.runtimeDetailsError}
                              onRetry={() => void shell.refetchRuntimeDetails()}
                            />
                          </div>
                        ) : (
                          <>
                            <div
                              ref={shell.chatScrollRef}
                              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 md:px-5"
                              data-testid="agent-chat-scroll"
                            >
                              {shell.isLoadingChatMessages &&
                              !shell.chatMessages &&
                              shell.activeChatThreadId ? (
                                <div className="flex min-h-[12rem] items-center justify-center gap-2 text-sm text-white/40">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Loading chat...
                                </div>
                              ) : shouldShowChatEmptyState ? (
                                <div className="space-y-6">
                                  <AgentEmptyConversationState
                                    isDraftConversation={!shell.activeChatThreadId}
                                    enabled={shell.enabled}
                                    canAnalyze={shell.canAnalyze}
                                    starterPrompts={STARTER_PROMPTS}
                                    onUseStarterPrompt={shell.setChatComposerValue}
                                  />
                                  <AgentCommandBar
                                    onAction={(prompt) => {
                                      shell.setChatComposerValue(prompt);
                                    }}
                                  />
                                </div>
                              ) : (
                                <AgentMessageList
                                  messages={shell.chatMessages || []}
                                  pendingUserMessage={shell.pendingChatMessage}
                                  onConfirmPlan={() => {
                                    if (shell.activeChatThreadId) {
                                      shell.confirmMutation.mutate(shell.activeChatThreadId);
                                    }
                                  }}
                                  onCancelPlan={() => {
                                    if (shell.activeChatThreadId) {
                                      shell.cancelMutation.mutate(shell.activeChatThreadId);
                                    }
                                  }}
                                  isConfirming={shell.confirmMutation.isPending}
                                  isCanceling={shell.cancelMutation.isPending}
                                  endRef={shell.chatEndRef}
                                />
                              )}
                            </div>

                            {/* Composer */}
                            <div className="shrink-0 border-t border-white/[0.06] bg-white/[0.02] px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:px-4 sm:py-2.5 md:px-5">
                              <AgentComposer
                                value={shell.chatComposerValue}
                                onChange={shell.setChatComposerValue}
                                onSend={(messageOverride) =>
                                  void shell.handleSendChat(messageOverride)
                                }
                                disabled={
                                  !shell.enabled ||
                                  !shell.chatComposerValue.trim() ||
                                  shell.isChatSending
                                }
                                isSending={shell.isChatSending}
                                enabled={shell.enabled}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Strategies Tab ── */}
                <div
                  className={cn(
                    "min-h-0 flex-1 flex-col overflow-hidden",
                    shell.workspaceTab === "strategies" ? "flex" : "hidden",
                  )}
                >
                  {shell.strategiesError ? (
                    <div className="p-4">
                      <AgentErrorState
                        title="Couldn't load strategies"
                        error={shell.strategiesError}
                        onRetry={() => void shell.refetchStrategies()}
                      />
                    </div>
                  ) : shell.strategyDetailError && shell.selectedStrategyId ? (
                    <div className="p-4">
                      <AgentErrorState
                        title="Couldn't load strategy details"
                        error={shell.strategyDetailError}
                        onRetry={() => void shell.refetchStrategyDetail()}
                      />
                    </div>
                  ) : shell.strategyMessagesError && shell.strategyConversationThreadId ? (
                    <div className="p-4">
                      <AgentErrorState
                        title="Couldn't load the strategy chat"
                        error={shell.strategyMessagesError}
                        onRetry={() => void shell.refetchStrategyMessages()}
                      />
                    </div>
                  ) : (
                    <AgentStrategiesPanel
                      strategies={shell.strategiesData}
                      strategyDetail={shell.strategyDetail}
                      strategyMessages={
                        shell.isLoadingStrategyMessages ? [] : shell.strategyMessages
                      }
                      selectedStrategyId={shell.selectedStrategyId}
                      detailTab={shell.strategyDetailTab}
                      isLoading={shell.isLoadingStrategies}
                      isDetailLoading={shell.isLoadingStrategyDetail}
                      isCreating={shell.createStrategyMutation.isPending}
                      isSavingId={
                        shell.updateStrategyMutation.isPending
                          ? ((
                              shell.updateStrategyMutation.variables as
                                | { strategyId?: string }
                                | undefined
                            )?.strategyId ?? null)
                          : null
                      }
                      isActivatingId={
                        shell.activateStrategyMutation.isPending
                          ? ((shell.activateStrategyMutation.variables as string | undefined) ??
                            null)
                          : null
                      }
                      isReviewingId={
                        shell.reviewStrategyMutation.isPending
                          ? ((shell.reviewStrategyMutation.variables as string | undefined) ?? null)
                          : null
                      }
                      isPausingId={
                        shell.pauseStrategyMutation.isPending
                          ? ((shell.pauseStrategyMutation.variables as string | undefined) ?? null)
                          : null
                      }
                      isArchivingId={
                        shell.archiveStrategyMutation.isPending
                          ? ((shell.archiveStrategyMutation.variables as string | undefined) ??
                            null)
                          : null
                      }
                      isRunningId={
                        shell.runStrategyMutation.isPending
                          ? ((shell.runStrategyMutation.variables as string | undefined) ?? null)
                          : null
                      }
                      strategyComposerValue={shell.strategyComposerValue}
                      onStrategyComposerChange={shell.setStrategyComposerValue}
                      onStrategySend={(messageOverride) =>
                        void shell.handleSendStrategy(messageOverride)
                      }
                      pendingStrategyMessage={shell.pendingStrategyMessage}
                      strategyScrollViewportRef={shell.strategyScrollRef}
                      strategyThreadEndRef={shell.strategyEndRef}
                      mobileDetailOpen={shell.isMobileStrategyDetailOpen}
                      onSelect={(strategyId) => {
                        shell.setSelectedStrategyId(strategyId);
                        shell.setIsMobileStrategyDetailOpen(Boolean(strategyId));
                      }}
                      onCloseMobileDetail={() => shell.setIsMobileStrategyDetailOpen(false)}
                      onCreateBlank={shell.handleCreateBlankStrategy}
                      onSave={(strategyId, payload) => {
                        shell.updateStrategyMutation.mutate({ strategyId, payload });
                      }}
                      onActivate={(strategyId) => shell.activateStrategyMutation.mutate(strategyId)}
                      onReview={(strategyId) => shell.reviewStrategyMutation.mutate(strategyId)}
                      onPause={(strategyId) => shell.pauseStrategyMutation.mutate(strategyId)}
                      onArchive={(strategyId) => shell.archiveStrategyMutation.mutate(strategyId)}
                      onRunNow={(strategyId) => shell.runStrategyMutation.mutate(strategyId)}
                      onDetailTabChange={shell.setStrategyDetailTab}
                      onConfirmStrategyPlan={() => {
                        if (shell.strategyConversationThreadId) {
                          shell.confirmMutation.mutate(shell.strategyConversationThreadId);
                        }
                      }}
                      onCancelStrategyPlan={() => {
                        if (shell.strategyConversationThreadId) {
                          shell.cancelMutation.mutate(shell.strategyConversationThreadId);
                        }
                      }}
                      isConfirmingStrategyPlan={shell.confirmMutation.isPending}
                      isCancelingStrategyPlan={shell.cancelMutation.isPending}
                      isSendingStrategyMessage={shell.isStrategySending}
                      agentEnabled={shell.enabled}
                    />
                  )}
                </div>

                {/* ── Configure Tab ── */}
                <div
                  className={cn(
                    "min-h-0 flex-1 flex-col overflow-hidden",
                    shell.workspaceTab === "configure" ? "flex" : "hidden",
                  )}
                >
                  <AgentConfigurePanel
                    profileData={shell.profileData}
                    isLoadingProfile={shell.isLoadingProfile}
                    profileError={shell.profileError}
                    onRetry={() => void shell.refetchProfile()}
                    enabled={shell.enabled}
                    onEnabledChange={shell.setEnabled}
                    providerMode={shell.providerMode}
                    onProviderModeChange={shell.setProviderMode}
                    userPromptTemplate={shell.userPromptTemplate}
                    onUserPromptTemplateChange={shell.setUserPromptTemplate}
                    defaultSport={shell.defaultSport}
                    onDefaultSportChange={shell.setDefaultSport}
                    baseUrl={shell.baseUrl}
                    onBaseUrlChange={shell.setBaseUrl}
                    model={shell.model}
                    onModelChange={shell.setModel}
                    apiKey={shell.apiKey}
                    onApiKeyChange={shell.setApiKey}
                    onSaveProfile={() => shell.saveProfileMutation.mutate()}
                    isSavingProfile={shell.saveProfileMutation.isPending}
                    onSaveByok={() => shell.saveByokMutation.mutate()}
                    isSavingByok={shell.saveByokMutation.isPending}
                    onClearByok={() => shell.clearByokMutation.mutate()}
                    isClearingByok={shell.clearByokMutation.isPending}
                    schedules={shell.runtimeDetails?.schedules}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Thread Drawer (mobile) ── */}
      <Sheet
        open={shell.drawerOpen === "threads"}
        onOpenChange={(open) => shell.setDrawerOpen(open ? "threads" : null)}
      >
        <SheetContent
          side="left"
          className="w-full border-white/[0.08] bg-[#0f1320] p-0 text-white md:max-w-md"
        >
          <AgentThreadPanel
            threads={shell.chatThreads || []}
            activeThreadId={shell.activeChatThreadId}
            isLoading={shell.isLoadingChatThreads}
            error={shell.chatThreadsError}
            onRetry={() => void shell.refetchChatThreads()}
            onSelect={(threadId) => {
              shell.setActiveChatThreadId(threadId);
              shell.setPendingChatMessage(null);
              shell.setChatComposerValue("");
            }}
            onStartFresh={() => void shell.handleStartFreshChat()}
            onClose={() => shell.setDrawerOpen(null)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
