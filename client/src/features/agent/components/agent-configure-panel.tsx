import { useState } from "react";
import {
  ChevronDown,
  Clock,
  Database,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  Brain,
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AgentProfileResponse, AgentScheduleSummary, ProviderMode } from "../types";

interface AgentDataSource {
  id: string;
  kind: "built_in" | "external";
  name: string;
  description: string | null;
  url: string | null;
  authType: string;
  enabled: boolean;
  available: boolean;
  lastVerifiedAt: string | null;
  lastError: string | null;
  createdAt: string | null;
  editable: boolean;
  removable: boolean;
  capabilitySummary: string | null;
}

const SCHEDULE_TEMPLATES: Array<{
  jobType: AgentScheduleSummary["jobType"];
  title: string;
  description: string;
}> = [
  {
    jobType: "daily_setup_review",
    title: "Daily Setup Review",
    description: "Morning overview of your setup with the single highest-leverage insight.",
  },
  {
    jobType: "pre_lock_nudge",
    title: "Pre-Lock Nudge",
    description: "Quick check before game locks for any immediate risk.",
  },
  {
    jobType: "injury_watch",
    title: "Injury Watch",
    description: "Monitor injury and availability changes that affect your setup.",
  },
  {
    jobType: "idle_balance_nudge",
    title: "Idle Balance Nudge",
    description: "Check if your available balance is idle enough to deploy.",
  },
  {
    jobType: "boost_window",
    title: "Boost Window Check",
    description: "Alert when boost slots have timing issues or obvious opportunities.",
  },
];

function SectionHeader({
  icon: Icon,
  title,
  badge,
}: {
  icon: typeof Database;
  title: string;
  badge?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-white/[0.06] to-white/[0.02] ring-1 ring-white/[0.08]">
        <Icon className="h-4 w-4 text-white/50" />
      </div>
      <div className="text-sm font-semibold text-white/90">{title}</div>
      {badge && (
        <Badge className="rounded-full bg-white/[0.06] text-[10px] text-white/40 hover:bg-white/[0.06]">
          {badge}
        </Badge>
      )}
    </div>
  );
}

function BuiltInDataSection({ profileData }: { profileData: AgentProfileResponse | undefined }) {
  const mlb = profileData?.capabilities.dataSources?.builtIn[0] || null;
  const projectedToolCountMatch = mlb?.capabilitySummary?.match(/(\d+)\s+tool/);
  const projectedToolCount = projectedToolCountMatch ? Number(projectedToolCountMatch[1]) : null;
  const mlbStatus = mlb
    ? mlb.available
      ? "Connected"
      : mlb.enabled
        ? "Unavailable"
        : "Disabled"
    : "Loading";
  const mlbBadgeClass = mlb
    ? mlb.available
      ? "bg-emerald-500/20 text-emerald-300"
      : mlb.enabled
        ? "bg-amber-500/20 text-amber-300"
        : "bg-white/[0.06] text-white/40"
    : "bg-white/[0.06] text-white/40";

  return (
    <div className="space-y-3">
      <SectionHeader icon={Database} title="Built-in Intelligence" />
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/70">MLB Data Feed</span>
            {projectedToolCount != null && mlb?.available && (
              <span className="text-[10px] text-white/30">{projectedToolCount} tools</span>
            )}
          </div>
          <Badge className={cn("rounded-full text-[10px]", mlbBadgeClass)}>{mlbStatus}</Badge>
        </div>
        {mlb?.capabilitySummary && (
          <p className="mt-1.5 text-[11px] text-white/30">{mlb.capabilitySummary}</p>
        )}
        {mlb && !mlb.available && mlb.enabled && (
          <p className="mt-1.5 text-[11px] text-white/30">
            The MLB enrichment service is starting up or offline. Native Sportfolio MLB tools still
            remain primary.
          </p>
        )}
      </div>
    </div>
  );
}

function DataSourcesSection() {
  const { toast } = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newAuthType, setNewAuthType] = useState("none");
  const [newAuthToken, setNewAuthToken] = useState("");

  const { data: sources, isLoading } = useQuery<AgentDataSource[]>({
    queryKey: ["/api/agent/mcp-sources"],
  });

  const sourceList = sources || [];
  const externalSourceCount = sourceList.filter((source) => source.kind === "external").length;

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/agent/mcp-sources", {
        name: newName.trim(),
        url: newUrl.trim(),
        authType: newAuthType,
        authToken: newAuthToken.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/mcp-sources"] });
      setIsAdding(false);
      setNewName("");
      setNewUrl("");
      setNewAuthType("none");
      setNewAuthToken("");
      toast({ title: "Data source added" });
    },
    onError: (error) => {
      toast({
        title: "Failed to add source",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ sourceId, enabled }: { sourceId: string; enabled: boolean }) => {
      await apiRequest("PATCH", `/api/agent/mcp-sources/${sourceId}`, { enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/mcp-sources"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      await apiRequest("DELETE", `/api/agent/mcp-sources/${sourceId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/mcp-sources"] });
      toast({ title: "Data source removed" });
    },
  });

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={Database}
        title="Data Sources"
        badge={sources ? `${externalSourceCount}/5 external` : undefined}
      />
      <p className="text-xs leading-5 text-white/35">
        Native Sportfolio tools stay primary for portfolio and gameplay state. Built-in and external
        MCP sources are optional enrichment that Hermes uses only when native tools do not already
        cover the request cleanly.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading sources...
        </div>
      ) : (
        <>
          {sourceList.length === 0 && !isAdding && (
            <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-4 text-center text-xs text-white/30">
              No data sources connected yet.
            </div>
          )}

          {sourceList.map((source) => (
            <div
              key={source.id}
              className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white/90">{source.name}</span>
                  {source.kind === "built_in" && (
                    <Badge className="rounded-full bg-sky-500/10 text-[10px] text-sky-300 hover:bg-sky-500/10">
                      Built-in
                    </Badge>
                  )}
                  {source.lastError ? (
                    <Badge className="rounded-full bg-red-500/10 text-[10px] text-red-300 hover:bg-red-500/10">
                      Error
                    </Badge>
                  ) : !source.enabled ? (
                    <Badge className="rounded-full bg-white/[0.06] text-[10px] text-white/40 hover:bg-white/[0.06]">
                      Disabled
                    </Badge>
                  ) : source.available ? (
                    <Badge className="rounded-full bg-emerald-500/10 text-[10px] text-emerald-300 hover:bg-emerald-500/10">
                      Connected
                    </Badge>
                  ) : (
                    <Badge className="rounded-full bg-amber-500/10 text-[10px] text-amber-300 hover:bg-amber-500/10">
                      Unavailable
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] leading-4 text-white/30">
                  {source.url || source.description || "Hermes-managed data source"}
                </div>
              </div>
              <Switch
                checked={source.enabled}
                onCheckedChange={(enabled) =>
                  toggleMutation.mutate({ sourceId: source.id, enabled })
                }
              />
              {source.removable ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white/20 hover:bg-red-500/10 hover:text-red-300"
                  onClick={() => deleteMutation.mutate(source.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <div className="h-8 w-8 shrink-0" />
              )}
            </div>
          ))}
        </>
      )}

      {isAdding ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-white/50 text-xs">Name</Label>
              <Input
                className="h-9 rounded-lg border-white/[0.08] bg-white/[0.03] text-white/90"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="FanGraphs Projections"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-white/50 text-xs">Auth Type</Label>
              <Select value={newAuthType} onValueChange={setNewAuthType}>
                <SelectTrigger className="h-9 rounded-lg border-white/[0.08] bg-white/[0.03] text-white/90">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/[0.08] bg-[#141824] text-white/90">
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="bearer">Bearer Token</SelectItem>
                  <SelectItem value="api_key">API Key</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-white/50 text-xs">URL (HTTPS)</Label>
            <Input
              className="h-9 rounded-lg border-white/[0.08] bg-white/[0.03] text-white/90"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://your-mcp-server.example.com"
            />
          </div>
          {newAuthType !== "none" && (
            <div className="space-y-1.5">
              <Label className="text-white/50 text-xs">
                {newAuthType === "bearer" ? "Bearer Token" : "API Key"}
              </Label>
              <Input
                className="h-9 rounded-lg border-white/[0.08] bg-white/[0.03] text-white/90"
                type="password"
                value={newAuthToken}
                onChange={(e) => setNewAuthToken(e.target.value)}
                placeholder="Paste your token"
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button
              className="h-9 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-4 text-xs font-medium text-black hover:from-amber-400 hover:to-amber-500"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !newName.trim() || !newUrl.trim()}
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Source
            </Button>
            <Button
              variant="ghost"
              className="h-9 rounded-xl text-xs text-white/40 hover:bg-white/[0.06]"
              onClick={() => setIsAdding(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          className="h-9 w-full rounded-xl border border-dashed border-white/[0.08] text-xs text-white/40 hover:bg-white/[0.04] hover:text-white/60"
          onClick={() => setIsAdding(true)}
          disabled={externalSourceCount >= 5}
        >
          <Plus className="mr-2 h-3.5 w-3.5" />
          Add data source
        </Button>
      )}
    </div>
  );
}

function SchedulesSection({ schedules }: { schedules: AgentScheduleSummary[] | undefined }) {
  return (
    <div className="space-y-3">
      <SectionHeader icon={Clock} title="Schedules" />
      <p className="text-xs leading-5 text-white/35">
        Recurring proactive check-ins. Hermes runs these automatically and posts insights to your
        chat.
      </p>

      <div className="space-y-2">
        {SCHEDULE_TEMPLATES.map((template) => {
          const activeSchedule = (schedules || []).find(
            (schedule) => schedule.jobType === template.jobType,
          );
          const isActive = activeSchedule?.enabled ?? false;

          return (
            <div
              key={template.jobType}
              className={cn(
                "rounded-xl border px-4 py-3 transition-colors",
                isActive
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : "border-white/[0.06] bg-white/[0.02]",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white/90">{template.title}</span>
                    {isActive && (
                      <Badge className="rounded-full bg-emerald-500/15 text-[10px] text-emerald-300 hover:bg-emerald-500/15">
                        Active
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-4 text-white/35">
                    {template.description}
                  </div>
                  {activeSchedule?.nextRunAt && (
                    <div className="mt-1 text-[10px] text-white/25">
                      Next:{" "}
                      {new Date(activeSchedule.nextRunAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </div>
                  )}
                </div>
                <div className="shrink-0">
                  {isActive ? (
                    <Badge className="rounded-full bg-emerald-500/10 px-2 text-[10px] text-emerald-300 hover:bg-emerald-500/10">
                      On
                    </Badge>
                  ) : (
                    <Badge className="rounded-full bg-white/[0.04] px-2 text-[10px] text-white/25 hover:bg-white/[0.04]">
                      Off
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-white/20">
        To enable or disable schedules, ask Hermes in chat: "Set up a daily setup review for me"
      </p>
    </div>
  );
}

function MemorySkillsSection() {
  return (
    <div className="space-y-3">
      <SectionHeader icon={Brain} title="Memory & Skills" />
      <p className="text-xs leading-5 text-white/35">
        Hermes keeps limited Sportfolio-specific memory and can reuse successful workflow patterns.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-white/35">
            Memory
          </div>
          <div className="mt-2 text-sm text-white/70">
            Hermes stores compact user-scoped preferences, goals, and interaction notes that help
            with future Sportfolio turns.
          </div>
          <div className="mt-3 text-[10px] text-white/20">
            To manage: "What do you remember about me?" or "Forget my risk tolerance preference"
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-[10px] font-medium uppercase tracking-wider text-white/35">
            Skills
          </div>
          <div className="mt-2 text-sm text-white/70">
            When Hermes solves a repeatable Sportfolio workflow cleanly, it can save that pattern as
            a reusable skill without widening backend access.
          </div>
          <div className="mt-3 text-[10px] text-white/20">
            To manage: "What skills have you learned?" or "List my runtime skills"
          </div>
        </div>
      </div>
    </div>
  );
}

function GeneralSettingsSection({
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
  if (isLoadingProfile) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-white/40">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading settings...
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-950/20 p-4">
        <div className="text-sm font-semibold text-red-100">Couldn't load settings</div>
        <Button
          className="mt-2 h-8 rounded-xl border-red-400/30 bg-red-900/20 px-3 text-xs text-red-100 hover:bg-red-900/35"
          variant="outline"
          onClick={onRetry}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Availability */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white/90">Availability</div>
            <div className="mt-1 text-xs leading-5 text-white/40">
              Pause new plans without removing your configuration.
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={onEnabledChange} />
        </div>
        <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-xs leading-5 text-emerald-100">
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
      </div>

      {/* Model Source */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-sm font-semibold text-white/90">Model Source</div>
        <div className="mt-1 text-xs leading-5 text-white/40">
          Choose between the platform-managed runtime or your own compatible provider.
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-white/50 text-xs">AI Source</Label>
            <Select
              value={providerMode}
              onValueChange={(value) => onProviderModeChange(value as ProviderMode)}
            >
              <SelectTrigger className="h-9 rounded-lg border-white/[0.08] bg-white/[0.03] text-white/90">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-white/[0.08] bg-[#141824] text-white/90">
                <SelectItem value="managed">Sportfolio AI</SelectItem>
                <SelectItem value="byok">Bring Your Own API</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-white/50 text-xs">Focus Sport</Label>
            <Select value={defaultSport} onValueChange={onDefaultSportChange}>
              <SelectTrigger className="h-9 rounded-lg border-white/[0.08] bg-white/[0.03] text-white/90">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-white/[0.08] bg-[#141824] text-white/90">
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
          className="mt-3 h-9 w-full rounded-xl bg-white/90 text-xs font-medium text-black hover:bg-white"
          onClick={onSaveProfile}
          disabled={isSavingProfile}
        >
          {isSavingProfile && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Chat Settings
        </Button>
      </div>

      {/* Playbook */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-sm font-semibold text-white/90">Playbook</div>
        <div className="mt-1 text-xs leading-5 text-white/40">
          Shape tone and preferences. Keep it concise.
        </div>
        <div className="mt-3 space-y-1.5">
          <Label className="text-white/50 text-xs">Agent Playbook</Label>
          <Textarea
            className="rounded-lg border-white/[0.08] bg-white/[0.03] text-white/90"
            value={userPromptTemplate}
            onChange={(event) => onUserPromptTemplateChange(event.target.value)}
            rows={7}
          />
        </div>
      </div>

      {/* Connection Details */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="text-sm font-semibold text-white/90">Connection Details</div>
        <div className="mt-1 text-xs leading-5 text-white/40">
          Managed mode uses the platform default. BYOK credentials are behind the advanced section.
        </div>

        {providerMode === "managed" ? (
          <div className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5 text-sm text-sky-100">
            Managed mode is using {profileData?.profile.model || "the configured default"}.
          </div>
        ) : (
          <Collapsible className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 w-full justify-start rounded-lg px-2 text-xs text-amber-100 hover:bg-amber-500/10 hover:text-amber-50"
              >
                <KeyRound className="mr-2 h-4 w-4" />
                Advanced BYOK Settings
                <ChevronDown className="ml-auto h-3.5 w-3.5" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 px-2 pt-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-white/50 text-xs">Base URL</Label>
                  <Input
                    className="h-9 rounded-lg border-white/[0.08] bg-white/[0.03] text-white/90"
                    value={baseUrl}
                    onChange={(event) => onBaseUrlChange(event.target.value)}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-white/50 text-xs">Model</Label>
                  <Input
                    className="h-9 rounded-lg border-white/[0.08] bg-white/[0.03] text-white/90"
                    value={model}
                    onChange={(event) => onModelChange(event.target.value)}
                    placeholder="gpt-4o-mini"
                  />
                  <p className="text-[11px] leading-4 text-white/35">
                    OpenRouter example: <span className="font-mono">minimax/minimax-m2.7</span>
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-white/50 text-xs">API Key</Label>
                <Input
                  className="h-9 rounded-lg border-white/[0.08] bg-white/[0.03] text-white/90"
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
                  className="h-9 rounded-xl bg-white/90 text-xs font-medium text-black hover:bg-white"
                  onClick={onSaveByok}
                  disabled={isSavingByok || !apiKey.trim() || !baseUrl.trim() || !model.trim()}
                >
                  {isSavingByok && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save BYOK
                </Button>
                {profileData?.secret.configured && (
                  <Button
                    variant="ghost"
                    className="h-9 rounded-xl text-xs text-white/40 hover:bg-white/[0.06]"
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
      </div>
    </div>
  );
}

export function AgentConfigurePanel({
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
  schedules,
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
  schedules: AgentScheduleSummary[] | undefined;
}) {
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-2xl space-y-8 px-4 py-6 sm:px-6">
        <BuiltInDataSection profileData={profileData} />

        <div className="border-t border-white/[0.04]" />

        <DataSourcesSection />

        <div className="border-t border-white/[0.04]" />

        <SchedulesSection schedules={schedules} />

        <div className="border-t border-white/[0.04]" />

        <MemorySkillsSection />

        <div className="border-t border-white/[0.04]" />

        <div className="space-y-3">
          <SectionHeader icon={KeyRound} title="General Settings" />
          <GeneralSettingsSection
            profileData={profileData}
            isLoadingProfile={isLoadingProfile}
            profileError={profileError}
            onRetry={onRetry}
            enabled={enabled}
            onEnabledChange={onEnabledChange}
            providerMode={providerMode}
            onProviderModeChange={onProviderModeChange}
            userPromptTemplate={userPromptTemplate}
            onUserPromptTemplateChange={onUserPromptTemplateChange}
            defaultSport={defaultSport}
            onDefaultSportChange={onDefaultSportChange}
            baseUrl={baseUrl}
            onBaseUrlChange={onBaseUrlChange}
            model={model}
            onModelChange={onModelChange}
            apiKey={apiKey}
            onApiKeyChange={onApiKeyChange}
            onSaveProfile={onSaveProfile}
            isSavingProfile={isSavingProfile}
            onSaveByok={onSaveByok}
            isSavingByok={isSavingByok}
            onClearByok={onClearByok}
            isClearingByok={isClearingByok}
          />
        </div>
      </div>
    </ScrollArea>
  );
}
