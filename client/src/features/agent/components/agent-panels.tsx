import { KeyRound, Loader2, MessageSquare, Plus, Settings2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  formatDomainLabel,
  formatThreadTimestamp,
  getReadableAgentError,
  getThreadTitle,
} from "../lib/agent-view";
import type { AgentProfileResponse, AgentThreadSummary, ProviderMode } from "../types";

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
      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
      : tone === "muted"
        ? "border-slate-600 bg-slate-800/80 text-slate-300"
        : "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]",
        "font-mono",
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
    <div className="rounded-sm border border-red-500/40 bg-red-950/40 p-4 font-mono text-red-100">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-2 text-sm leading-6 text-red-100/90">
        {getReadableAgentError(error, "The agent request failed.")}
      </div>
      <Button
        className="mt-3 h-8 rounded-sm border-red-400/40 bg-red-900/20 px-3 text-[11px] uppercase tracking-[0.08em] text-red-100 hover:bg-red-900/35"
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
      <div className="border-b border-[#2a2e39] px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="rounded-sm border border-[#2a2e39] bg-[#171c29] p-2 text-amber-300">
            <MessageSquare className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-50">Conversation History</div>
            <div className="text-[11px] text-slate-400">
              Recent chats and staged plans live here.
            </div>
          </div>
        </div>
        <Button
          className="mt-3 h-8 w-full rounded-sm border-[#2a2e39] bg-[#171c29] px-3 text-[11px] uppercase tracking-[0.08em] text-slate-100 hover:bg-[#202637]"
          variant="outline"
          onClick={() => {
            onStartFresh();
            onClose();
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Start Fresh Chat
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
          <div className="flex items-center justify-center gap-2 rounded-sm border border-[#2a2e39] bg-[#171c29] p-4 text-xs text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading conversation history...
          </div>
        ) : threads.length === 0 ? (
          <div className="rounded-sm border border-dashed border-[#2a2e39] bg-[#171c29] px-3 py-4 text-xs text-slate-400">
            Your conversations will show up here after your first message.
          </div>
        ) : (
          <div className="space-y-2">
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
                    "w-full rounded-sm border px-3 py-2.5 text-left transition-colors",
                    isActive
                      ? "border-amber-500/40 bg-amber-500/10 text-slate-50 shadow-sm"
                      : "border-[#2a2e39] bg-[#171c29] text-slate-100 hover:border-slate-600 hover:bg-[#202637]",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-slate-50">
                        {getThreadTitle(thread, index)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {thread.pendingActionBundle ? (
                          <Badge className="bg-amber-600 text-white hover:bg-amber-600">
                            Plan Ready
                          </Badge>
                        ) : (
                          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">
                            {formatDomainLabel(thread.domain)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-[10px] text-slate-400">
                      {formatThreadTimestamp(thread.lastMessageAt || thread.updatedAt)}
                    </div>
                  </div>
                  {preview && (
                    <div className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-slate-400">
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

export function AgentSettingsPanel({
  profileData,
  isLoadingProfile,
  profileError,
  onRetry,
  enabled,
  onEnabledChange,
  providerMode,
  onProviderModeChange,
  userPromptTemplate,
  onUserPromptTemplateChange,
  defaultSport,
  onDefaultSportChange,
  baseUrl,
  onBaseUrlChange,
  model,
  onModelChange,
  apiKey,
  onApiKeyChange,
  onSaveProfile,
  isSavingProfile,
  onSaveByok,
  isSavingByok,
  onClearByok,
  isClearingByok,
}: {
  profileData: AgentProfileResponse | undefined;
  isLoadingProfile: boolean;
  profileError: unknown;
  onRetry: () => void;
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  providerMode: ProviderMode;
  onProviderModeChange: (value: ProviderMode) => void;
  userPromptTemplate: string;
  onUserPromptTemplateChange: (value: string) => void;
  defaultSport: string;
  onDefaultSportChange: (value: string) => void;
  baseUrl: string;
  onBaseUrlChange: (value: string) => void;
  model: string;
  onModelChange: (value: string) => void;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  onSaveProfile: () => void;
  isSavingProfile: boolean;
  onSaveByok: () => void;
  isSavingByok: boolean;
  onClearByok: () => void;
  isClearingByok: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[#2a2e39] px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="rounded-sm border border-[#2a2e39] bg-[#171c29] p-2 text-amber-300">
            <Settings2 className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-50">Agent Settings</div>
            <div className="text-[11px] text-slate-400">
              Keep the conversation simple. Configure the operator here.
            </div>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 py-4">
        {isLoadingProfile ? (
          <div className="flex items-center gap-2 rounded-sm border border-[#2a2e39] bg-[#171c29] p-4 text-xs text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading settings...
          </div>
        ) : profileError ? (
          <AgentErrorState
            title="Couldn't load agent settings"
            error={profileError}
            onRetry={onRetry}
          />
        ) : (
          <div className="space-y-4 pb-5">
            <section className="rounded-sm border border-[#2a2e39] bg-[#171c29] p-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-slate-50">Availability</div>
                  <div className="mt-1 text-xs leading-5 text-slate-400">
                    Pause new plans without removing your configuration.
                  </div>
                </div>
                <Switch checked={enabled} onCheckedChange={onEnabledChange} />
              </div>
              <div className="mt-3 rounded-sm border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs leading-5 text-emerald-100">
                <div className="flex items-center gap-2 font-semibold">
                  <ShieldCheck className="h-4 w-4" />
                  Hosted web research
                </div>
                <div className="mt-1">
                  {profileData?.capabilities.canUseWebResearch
                    ? profileData.capabilities.webResearchProvider === "brave"
                      ? "Brave Search is available for managed and BYOK conversations."
                      : "Web research is available."
                    : "Server-side research is not configured."}
                </div>
              </div>
            </section>

            <section className="rounded-sm border border-[#2a2e39] bg-[#171c29] p-3">
              <div className="text-sm font-semibold text-slate-50">Model Source</div>
              <div className="mt-1 text-xs leading-5 text-slate-400">
                Choose between the platform-managed runtime or your own compatible provider.
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-slate-300" htmlFor="agent-source">
                    AI Source
                  </Label>
                  <Select
                    value={providerMode}
                    onValueChange={(value) => onProviderModeChange(value as ProviderMode)}
                  >
                    <SelectTrigger
                      id="agent-source"
                      className="h-9 rounded-sm border-[#2a2e39] bg-[#0f1420] text-slate-100"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-[#2a2e39] bg-[#131722] text-slate-100">
                      <SelectItem value="managed">Sportfolio AI</SelectItem>
                      <SelectItem value="byok">Bring Your Own API</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300" htmlFor="agent-sport">
                    Focus Sport
                  </Label>
                  <Select value={defaultSport} onValueChange={onDefaultSportChange}>
                    <SelectTrigger
                      id="agent-sport"
                      className="h-9 rounded-sm border-[#2a2e39] bg-[#0f1420] text-slate-100"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-[#2a2e39] bg-[#131722] text-slate-100">
                      <SelectItem value="ALL">All Sports</SelectItem>
                      <SelectItem value="NBA">NBA</SelectItem>
                      <SelectItem value="NFL">NFL</SelectItem>
                      <SelectItem value="MLB">MLB</SelectItem>
                      <SelectItem value="NASCAR">NASCAR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                className="mt-3 h-9 w-full rounded-sm bg-slate-100 text-xs uppercase tracking-[0.08em] text-slate-950 hover:bg-slate-200"
                onClick={onSaveProfile}
                disabled={isSavingProfile}
              >
                {isSavingProfile && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Chat Settings
              </Button>
            </section>

            <section className="rounded-sm border border-[#2a2e39] bg-[#171c29] p-3">
              <div className="text-sm font-semibold text-slate-50">Playbook</div>
              <div className="mt-1 text-xs leading-5 text-slate-400">
                Keep this concise. It should shape tone and preferences, not become a full prompt
                dump.
              </div>
              <div className="mt-3 space-y-2">
                <Label className="text-slate-300" htmlFor="agent-playbook">
                  Agent Playbook
                </Label>
                <Textarea
                  id="agent-playbook"
                  className="rounded-sm border-[#2a2e39] bg-[#0f1420] text-slate-100"
                  value={userPromptTemplate}
                  onChange={(event) => onUserPromptTemplateChange(event.target.value)}
                  rows={7}
                />
              </div>
            </section>

            <section className="rounded-sm border border-[#2a2e39] bg-[#171c29] p-3">
              <div className="text-sm font-semibold text-slate-50">Connection Details</div>
              <div className="mt-1 text-xs leading-5 text-slate-400">
                Managed mode uses the platform default. BYOK credentials stay behind an explicit
                advanced section.
              </div>

              {providerMode === "managed" ? (
                <div className="mt-3 rounded-sm border border-sky-500/30 bg-sky-500/10 p-2.5 text-sm text-sky-100">
                  Managed mode is using {profileData?.profile.model || "the configured default"}.
                </div>
              ) : (
                <Collapsible className="mt-3 rounded-sm border border-amber-500/30 bg-amber-500/10 p-2.5">
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className="h-8 w-full justify-start rounded-sm px-2 text-[11px] uppercase tracking-[0.08em] text-amber-100 hover:bg-amber-500/10 hover:text-amber-50"
                    >
                      <KeyRound className="mr-2 h-4 w-4" />
                      Advanced BYOK Settings
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 px-2 pt-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label className="text-slate-300" htmlFor="agent-base-url">
                          Base URL
                        </Label>
                        <Input
                          id="agent-base-url"
                          className="h-9 rounded-sm border-[#2a2e39] bg-[#0f1420] text-slate-100"
                          value={baseUrl}
                          onChange={(event) => onBaseUrlChange(event.target.value)}
                          placeholder="https://api.openai.com/v1"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-slate-300" htmlFor="agent-model">
                          Model
                        </Label>
                        <Input
                          id="agent-model"
                          className="h-9 rounded-sm border-[#2a2e39] bg-[#0f1420] text-slate-100"
                          value={model}
                          onChange={(event) => onModelChange(event.target.value)}
                          placeholder="gpt-4o-mini"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-300" htmlFor="agent-api-key">
                        API Key
                      </Label>
                      <Input
                        id="agent-api-key"
                        className="h-9 rounded-sm border-[#2a2e39] bg-[#0f1420] text-slate-100"
                        type="password"
                        value={apiKey}
                        onChange={(event) => onApiKeyChange(event.target.value)}
                        placeholder={
                          profileData?.secret.configured
                            ? `Saved key ending in ${profileData.secret.keyLast4 || "****"}`
                            : "Paste a compatible API key"
                        }
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        className="h-9 rounded-sm bg-slate-100 text-xs uppercase tracking-[0.08em] text-slate-950 hover:bg-slate-200"
                        onClick={onSaveByok}
                        disabled={
                          isSavingByok || !apiKey.trim() || !baseUrl.trim() || !model.trim()
                        }
                      >
                        {isSavingByok && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save BYOK
                      </Button>
                      {profileData?.secret.configured && (
                        <Button
                          variant="outline"
                          className="h-9 rounded-sm border-[#2a2e39] bg-[#0f1420] text-xs uppercase tracking-[0.08em] text-slate-100 hover:bg-[#202637]"
                          onClick={onClearByok}
                          disabled={isClearingByok}
                        >
                          {isClearingByok && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Remove Saved Key
                        </Button>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </section>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
