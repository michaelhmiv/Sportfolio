import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { LiveLogViewer } from "@/components/live-log-viewer";
import { Switch } from "@/components/ui/switch";
import {
  Settings,
  RefreshCw,
  TrendingUp,
  Users,
  Database,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  Download,
  FileText,
  Plus,
  Edit,
  Trash2,
  Eye,
  EyeOff,
  Send,
  Twitter,
  Sparkles,
  AlertCircle,
} from "lucide-react";

interface SystemStats {
  totalUsers: number;
  totalPlayers: number;
  playersBySport?: Record<string, number>;
  apiRequestsToday: number;
  lastJobRuns: {
    jobName: string;
    status: string;
    finishedAt: string | null;
    recordsProcessed: number;
    errorCount: number;
  }[];
}

type ApiHealthStatus = "success" | "degraded" | "failed";

interface ApiHealthCheckResult {
  id: string;
  label: string;
  category: "dependency" | "jobs" | "route";
  status: ApiHealthStatus;
  details: string;
  durationMs: number;
  checkedAt: string;
  path?: string;
}

interface ApiHealthReport {
  runId: string;
  status: ApiHealthStatus;
  checkedAt: string;
  durationMs: number;
  baseUrl: string;
  reason: string;
  summary: {
    total: number;
    success: number;
    degraded: number;
    failed: number;
    routeChecks: number;
  };
  checks: ApiHealthCheckResult[];
}

interface ApiHealthRun {
  id: string;
  status: ApiHealthStatus;
  scheduledFor: string;
  startedAt: string;
  finishedAt: string | null;
  requestCount: number;
  recordsProcessed: number;
  errorCount: number;
  errorMessage: string | null;
}

interface ApiHealthResponse {
  ok: boolean;
  inProgress?: boolean;
  message?: string;
  report: ApiHealthReport | null;
  isStale: boolean;
  staleThresholdMs: number;
  recentRuns: ApiHealthRun[];
}

const SPORTS = ["NBA", "NFL", "MLB", "NASCAR"] as const;

const jobDescriptions = {
  roster_sync: "Sync NBA player roster from MySportsFeeds",
  sync_player_game_logs: "Cache all player game logs with pre-calculated fantasy points",
  schedule_sync: "Update game schedules and live scores",
  stats_sync: "Sync completed game statistics",
  lock_boost_shares: "Lock boosted shares once games start",
  snapshot_share_payouts: "Snapshot started-game holdings for payout settlement",
  settle_boosts: "Settle locked boosts and credit payouts",
  settle_share_payouts: "Settle pending game-based share payouts",
  settle_community_boosts: "Settle community boost multipliers and payouts",
  api_health_check: "Run API dependency and route smoke checks",
  // NFL jobs
  nfl_roster_sync: "Sync NFL player roster",
  nfl_schedule_sync: "Sync NFL schedule",
  nfl_stats_sync: "Sync NFL stats",
  // MLB jobs
  mlb_roster_sync: "Sync MLB player roster",
  mlb_schedule_sync: "Sync MLB schedule",
  mlb_stats_sync: "Sync MLB stats",
  // NASCAR jobs
  nascar_roster_sync: "Sync NASCAR driver roster (Cup, Xfinity, Trucks)",
  nascar_schedule_sync: "Sync NASCAR race schedule",
  nascar_live_sync: "Sync live NASCAR race data",
  nascar_stats_sync: "Sync NASCAR race statistics",
};

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  publishedAt: string | null;
  createdAt: string;
}

interface TweetSettings {
  id: number;
  enabled: boolean;
  promptTemplate: string | null;
  includeRisers: boolean;
  includeVolume: boolean;
  includeMarketCap: boolean;
  maxPlayers: number;
  updatedAt: string;
}

interface TweetHistory {
  id: number;
  content: string;
  tweetId: string | null;
  status: string;
  error: string | null;
  createdAt: string;
}

interface TweetData {
  settings: TweetSettings;
  history: TweetHistory[];
  status: {
    twitter: { configured: boolean; ready: boolean };
    perplexity: { configured: boolean; ready: boolean };
  };
}

interface TweetPreview {
  content: string;
  playerData: any;
  aiSummary: string | null;
  characterCount: number;
  settings: TweetSettings;
}

type ManagedProviderKey = "chutes" | "minimax" | "openrouter";

interface ManagedProviderStatus {
  key: ManagedProviderKey;
  label: string;
  configured: boolean;
  baseUrl: string;
  defaultModel: string | null;
  models: string[];
}

interface AgentSystemSettingsResponse {
  settings: {
    id: string;
    managedProvider: ManagedProviderKey;
    managedModel: string | null;
    updatedAt: string;
  };
  managedProvider: ManagedProviderStatus;
  managedProviders: ManagedProviderStatus[];
}

interface AgentProviderModelCatalogResponse {
  provider: ManagedProviderKey;
  source: "configured" | "remote" | "configured+remote";
  warning: string | null;
  fetchedAt: string;
  models: Array<{
    id: string;
    name: string;
    contextLength: number | null;
  }>;
}

export default function Admin() {
  const { toast } = useToast();
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());
  const [backfillStartDate, setBackfillStartDate] = useState("2025-11-17");
  const [backfillEndDate, setBackfillEndDate] = useState("2025-11-21");
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [backfillOperationId, setBackfillOperationId] = useState<string | null>(null);
  const [jobOperationIds, setJobOperationIds] = useState<Map<string, string>>(new Map());

  // Blog post state
  const [blogDialogOpen, setBlogDialogOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<BlogPost | null>(null);
  const [blogTitle, setBlogTitle] = useState("");
  const [blogSlug, setBlogSlug] = useState("");
  const [blogExcerpt, setBlogExcerpt] = useState("");
  const [blogContent, setBlogContent] = useState("");
  const [blogPublished, setBlogPublished] = useState(false);

  // Tweet automation state
  const [tweetPreview, setTweetPreview] = useState<TweetPreview | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [customDraft, setCustomDraft] = useState<string | null>(null);
  const [isDrafting, setIsDrafting] = useState(false);
  const [agentManagedProviderDraft, setAgentManagedProviderDraft] =
    useState<ManagedProviderKey>("chutes");
  const [agentManagedModelDraft, setAgentManagedModelDraft] = useState("");

  // Premium grant state
  const [grantUsername, setGrantUsername] = useState("");
  const [grantQuantity, setGrantQuantity] = useState("");

  const adminStatsRefetchMs = runningJobs.size > 0 || isBackfilling ? 15000 : 120000;
  const apiHealthRefetchMs = runningJobs.size > 0 ? 30000 : 120000;

  const { data: stats, isLoading } = useQuery<SystemStats>({
    queryKey: ["/api/admin/stats"],
    refetchInterval: adminStatsRefetchMs,
    staleTime: 10000,
  });

  const { data: apiHealth, refetch: refetchApiHealth } = useQuery<ApiHealthResponse>({
    queryKey: ["/api/admin/api-health"],
    refetchInterval: apiHealthRefetchMs,
    staleTime: 10000,
  });

  const { data: agentSystemSettings } = useQuery<AgentSystemSettingsResponse>({
    queryKey: ["/api/admin/agent/settings"],
    staleTime: 10000,
  });

  const {
    data: agentProviderModelCatalog,
    isLoading: isAgentProviderModelCatalogLoading,
    refetch: refetchAgentProviderModelCatalog,
  } = useQuery<AgentProviderModelCatalogResponse>({
    queryKey: ["/api/admin/agent/providers", agentManagedProviderDraft, "models"],
    staleTime: 300000,
    enabled: Boolean(agentSystemSettings),
  });

  useEffect(() => {
    if (!agentSystemSettings) {
      return;
    }

    setAgentManagedProviderDraft(agentSystemSettings.settings.managedProvider);
    setAgentManagedModelDraft(agentSystemSettings.settings.managedModel || "");
  }, [agentSystemSettings]);

  const selectedAgentManagedProvider =
    agentSystemSettings?.managedProviders.find(
      (provider) => provider.key === agentManagedProviderDraft,
    ) || null;
  const agentModelSuggestions = agentProviderModelCatalog?.models || [];
  const agentModelSourceDescription =
    agentProviderModelCatalog?.source === "configured+remote"
      ? "configured defaults and the live provider catalog"
      : agentProviderModelCatalog?.source === "remote"
        ? "the live provider catalog"
        : "configured defaults";

  const runApiHealthMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/api-health/run", {});
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-health"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: data.status === "success" ? "API health check passed" : "API health check completed",
        description:
          data.status === "success"
            ? `${data.report?.summary?.total ?? 0} checks passed`
            : `${data.report?.summary?.failed ?? 0} failed, ${data.report?.summary?.degraded ?? 0} degraded`,
        variant: data.status === "failed" ? "destructive" : undefined,
      });
    },
    onError: (error: any) => {
      toast({
        title: "API health check failed",
        description: error.message || "Unable to run API health checker",
        variant: "destructive",
      });
    },
  });

  const triggerJobMutation = useMutation({
    mutationFn: async ({ jobName, operationId }: { jobName: string; operationId: string }) => {
      const res = await apiRequest("POST", "/api/admin/jobs/trigger", { jobName, operationId });
      return await res.json();
    },
    onMutate: ({ jobName, operationId }) => {
      setRunningJobs((prev) => new Set(prev).add(jobName));
      setJobOperationIds((prev) => new Map(prev).set(jobName, operationId));
    },
    onSuccess: (data, { jobName }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: data.status === "degraded" ? "Job completed with errors" : "Job completed",
        description: `${jobName}: ${data.result.recordsProcessed} records processed, ${data.result.errorCount} errors`,
        variant: data.status === "degraded" ? "destructive" : undefined,
      });
    },
    onError: (error: any, { jobName }) => {
      toast({
        title: "Job failed",
        description: error.message || `Failed to run ${jobName}`,
        variant: "destructive",
      });
    },
    onSettled: (_, __, { jobName }) => {
      setRunningJobs((prev) => {
        const next = new Set(prev);
        next.delete(jobName);
        return next;
      });
    },
  });

  const updateAgentSystemSettingsMutation = useMutation({
    mutationFn: async ({
      managedProvider,
      managedModel,
    }: {
      managedProvider: ManagedProviderKey;
      managedModel: string | null;
    }) => {
      const res = await apiRequest("PATCH", "/api/admin/agent/settings", {
        managedProvider,
        managedModel,
      });
      return (await res.json()) as AgentSystemSettingsResponse;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/admin/agent/settings"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/agent/profile"] });
      toast({
        title: "Agent provider updated",
        description: `${data.managedProvider.label} is now the default system AI.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update agent provider",
        description: error.message || "Unable to update the default system AI provider",
        variant: "destructive",
      });
    },
  });

  const handleTriggerJob = (jobName: string) => {
    const operationId = `job-${jobName}-${Date.now()}`;
    triggerJobMutation.mutate({ jobName, operationId });
  };

  const backfillMutation = useMutation({
    mutationFn: async ({
      startDate,
      endDate,
      operationId,
    }: {
      startDate: string;
      endDate: string;
      operationId: string;
    }) => {
      const res = await apiRequest("POST", "/api/admin/backfill", {
        startDate,
        endDate,
        operationId,
      });
      return await res.json();
    },
    onMutate: ({ operationId }) => {
      setIsBackfilling(true);
      setBackfillOperationId(operationId);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title: data.status === "degraded" ? "Backfill completed with errors" : "Backfill completed",
        description: `${data.result.recordsProcessed} game logs cached, ${data.result.errorCount} errors, ${data.result.requestCount} API requests`,
        variant: data.status === "degraded" ? "destructive" : undefined,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Backfill failed",
        description: error.message || "Failed to run backfill",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsBackfilling(false);
    },
  });

  const handleBackfill = () => {
    if (!backfillStartDate || !backfillEndDate) {
      toast({
        title: "Invalid dates",
        description: "Please select both start and end dates",
        variant: "destructive",
      });
      return;
    }

    // Generate unique operation ID
    const operationId = `backfill-${Date.now()}`;
    backfillMutation.mutate({
      startDate: backfillStartDate,
      endDate: backfillEndDate,
      operationId,
    });
  };

  // Blog posts query
  const { data: blogPostsData } = useQuery<{ posts: BlogPost[]; total: number }>({
    queryKey: ["/api/admin/blog"],
  });

  // Tweet data query
  const { data: tweetData, refetch: refetchTweets } = useQuery<TweetData>({
    queryKey: ["/api/admin/tweets"],
    refetchInterval: 180000,
  });

  // Tweet mutations
  const updateTweetSettingsMutation = useMutation({
    mutationFn: async (data: Partial<TweetSettings>) => {
      const res = await apiRequest("PATCH", "/api/admin/tweets/settings", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tweets"] });
      toast({ title: "Settings updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handlePreviewTweet = async () => {
    setIsPreviewLoading(true);
    try {
      const res = await apiRequest("POST", "/api/admin/tweets/preview", {});
      const data = await res.json();
      setTweetPreview(data);
    } catch (error: any) {
      toast({ title: "Preview failed", description: error.message, variant: "destructive" });
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handlePostTweet = async () => {
    setIsPosting(true);
    try {
      const res = await apiRequest("POST", "/api/admin/tweets/post", {});
      const data = await res.json();
      if (data.success) {
        toast({ title: "Tweet posted!", description: `Tweet ID: ${data.tweetId}` });
        setTweetPreview(null);
        refetchTweets();
      } else {
        toast({ title: "Failed to post", description: data.error, variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Failed to post", description: error.message, variant: "destructive" });
    } finally {
      setIsPosting(false);
    }
  };

  const handleTestTwitter = async () => {
    try {
      const res = await apiRequest("POST", "/api/admin/tweets/test-twitter", {});
      const data = await res.json();
      toast({
        title: data.success ? "Twitter connected!" : "Twitter connection failed",
        description: data.username ? `Logged in as @${data.username}` : data.error,
        variant: data.success ? undefined : "destructive",
      });
    } catch (error: any) {
      toast({ title: "Test failed", description: error.message, variant: "destructive" });
    }
  };

  const handleTestPerplexity = async () => {
    try {
      const res = await apiRequest("POST", "/api/admin/tweets/test-perplexity", {});
      const data = await res.json();
      toast({
        title: data.success ? "Perplexity connected!" : "Perplexity connection failed",
        description: data.success ? "API key is valid" : data.error,
        variant: data.success ? undefined : "destructive",
      });
    } catch (error: any) {
      toast({ title: "Test failed", description: error.message, variant: "destructive" });
    }
  };

  const handleDraftCustomTweet = async () => {
    if (!customPrompt.trim()) {
      toast({
        title: "Enter a prompt",
        description: "Describe what you want to tweet about",
        variant: "destructive",
      });
      return;
    }
    setIsDrafting(true);
    try {
      const res = await apiRequest("POST", "/api/admin/tweets/draft", { prompt: customPrompt });
      const data = await res.json();
      if (data.success) {
        setCustomDraft(data.content);
        toast({ title: "Draft ready!", description: "Review and edit before posting" });
      } else {
        toast({ title: "Draft failed", description: data.error, variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Draft failed", description: error.message, variant: "destructive" });
    } finally {
      setIsDrafting(false);
    }
  };

  const handlePostCustomDraft = async () => {
    if (!customDraft) return;
    setIsPosting(true);
    try {
      const res = await apiRequest("POST", "/api/admin/tweets/post", {
        customContent: customDraft,
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Tweet posted!", description: `Tweet ID: ${data.tweetId}` });
        setCustomDraft(null);
        setCustomPrompt("");
        refetchTweets();
      } else {
        toast({ title: "Failed to post", description: data.error, variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Failed to post", description: error.message, variant: "destructive" });
    } finally {
      setIsPosting(false);
    }
  };

  // Premium grant mutation
  const grantPremiumMutation = useMutation({
    mutationFn: async (data: { username: string; quantity: number }) => {
      const res = await apiRequest("POST", "/api/admin/premium/grant", data);
      return await res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Premium shares granted",
        description: `Granted ${data.granted} shares to ${data.user.username} (${data.previousQuantity} → ${data.newQuantity})`,
      });
      setGrantUsername("");
      setGrantQuantity("");
    },
    onError: (error: any) => {
      toast({
        title: "Failed to grant shares",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleGrantPremium = () => {
    if (!grantUsername.trim()) {
      toast({ title: "Username required", variant: "destructive" });
      return;
    }
    const qty = parseInt(grantQuantity, 10);
    if (isNaN(qty) || qty <= 0) {
      toast({ title: "Quantity must be a positive number", variant: "destructive" });
      return;
    }
    grantPremiumMutation.mutate({ username: grantUsername.trim(), quantity: qty });
  };

  // Duplicate game cleanup mutation
  const cleanupDuplicatesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/games/cleanup-duplicates", {});
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      toast({
        title: data.success ? "Cleanup complete" : "Cleanup failed",
        description: data.message,
        variant: data.success ? undefined : "destructive",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Cleanup failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const seedMissingPoolsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/seed-missing-pools", {});
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({
        title:
          data.status === "degraded"
            ? "Pool seeding completed with errors"
            : "Pool seeding completed",
        description: data.message,
        variant: data.status === "degraded" ? "destructive" : undefined,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Pool seeding failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCleanupDuplicates = () => {
    if (
      confirm(
        "This will delete legacy MySportsFeeds game records that have BallDontLie equivalents. Continue?",
      )
    ) {
      cleanupDuplicatesMutation.mutate();
    }
  };

  const handleSeedMissingPools = () => {
    if (confirm("Seed missing pools and repair unseeded legacy pools for all active players?")) {
      seedMissingPoolsMutation.mutate();
    }
  };

  const handleSaveAgentSystemSettings = () => {
    const selectedProvider = selectedAgentManagedProvider;

    if (!selectedProvider) {
      toast({
        title: "Provider unavailable",
        description: "Select a valid managed AI provider first",
        variant: "destructive",
      });
      return;
    }

    const normalizedModel = agentManagedModelDraft.trim();
    const effectiveModel = normalizedModel || selectedProvider.defaultModel || "";

    if (!selectedProvider.configured) {
      toast({
        title: "Provider not configured",
        description: `${selectedProvider.label} is missing credentials in the server environment`,
        variant: "destructive",
      });
      return;
    }

    if (!effectiveModel) {
      toast({
        title: "Model required",
        description: `Set a model for ${selectedProvider.label} before saving`,
        variant: "destructive",
      });
      return;
    }

    updateAgentSystemSettingsMutation.mutate({
      managedProvider: agentManagedProviderDraft,
      managedModel: normalizedModel || null,
    });
  };

  // Blog mutations
  const createBlogPostMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/blog", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/blog"] });
      setBlogDialogOpen(false);
      resetBlogForm();
      toast({
        title: "Blog post created",
        description: "Your blog post has been created successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create post",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateBlogPostMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/admin/blog/${id}`, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/blog"] });
      setBlogDialogOpen(false);
      resetBlogForm();
      toast({
        title: "Blog post updated",
        description: "Your blog post has been updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update post",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteBlogPostMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/blog/${id}`, {});
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/blog"] });
      toast({
        title: "Blog post deleted",
        description: "The blog post has been deleted",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to delete post",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetBlogForm = () => {
    setBlogTitle("");
    setBlogSlug("");
    setBlogExcerpt("");
    setBlogContent("");
    setBlogPublished(false);
    setEditingPost(null);
  };

  const handleOpenBlogDialog = (post?: BlogPost) => {
    if (post) {
      setEditingPost(post);
      setBlogTitle(post.title);
      setBlogSlug(post.slug);
      setBlogExcerpt(post.excerpt);
      setBlogContent(post.content);
      setBlogPublished(!!post.publishedAt);
    } else {
      resetBlogForm();
    }
    setBlogDialogOpen(true);
  };

  const handleSaveBlogPost = () => {
    if (!blogTitle || !blogSlug || !blogExcerpt || !blogContent) {
      toast({
        title: "Validation error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    const data = {
      title: blogTitle,
      slug: blogSlug,
      excerpt: blogExcerpt,
      content: blogContent,
      publishedAt: blogPublished ? new Date().toISOString() : null,
    };

    if (editingPost) {
      updateBlogPostMutation.mutate({ id: editingPost.id, data });
    } else {
      createBlogPostMutation.mutate(data);
    }
  };

  const handleDeleteBlogPost = (id: string) => {
    if (confirm("Are you sure you want to delete this blog post?")) {
      deleteBlogPostMutation.mutate(id);
    }
  };

  // Auto-generate slug from title
  const handleTitleChange = (value: string) => {
    setBlogTitle(value);
    if (!editingPost) {
      const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      setBlogSlug(slug);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-3 sm:p-6 lg:p-8 flex items-center justify-center">
        <div className="text-muted-foreground">Loading admin panel...</div>
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="w-4 h-4 text-positive" />;
      case "degraded":
        return <Activity className="w-4 h-4 text-yellow-500" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-destructive" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return <Badge className="bg-positive/10 text-positive border-positive/20">Success</Badge>;
      case "degraded":
        return (
          <Badge className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20">
            Degraded
          </Badge>
        );
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background p-3 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Settings className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Admin Panel</h1>
            <p className="text-muted-foreground">System management and monitoring</p>
          </div>
        </div>

        {/* System Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <Card data-testid="card-total-users">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-primary" />
                <span className="text-sm text-muted-foreground">Total Users</span>
              </div>
              <div className="text-2xl font-bold">{stats?.totalUsers.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card data-testid="card-total-players">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                <span className="text-sm text-muted-foreground">Total Players</span>
              </div>
              <div className="text-2xl font-bold">{stats?.totalPlayers.toLocaleString()}</div>
            </CardContent>
          </Card>

          <Card data-testid="card-api-requests">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Database className="w-4 h-4 text-primary" />
                <span className="text-sm text-muted-foreground">API Requests</span>
              </div>
              <div className="text-2xl font-bold">{stats?.apiRequestsToday.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-1">Today</div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {SPORTS.map((sport) => (
            <Card key={sport} data-testid={`card-players-${sport.toLowerCase()}`}>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground mb-1">{sport} Players</div>
                <div className="text-xl font-bold">
                  {(stats?.playersBySport?.[sport] || 0).toLocaleString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card data-testid="card-agent-system-provider">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              Agent System AI
            </CardTitle>
            <CardDescription>
              Switch the default managed provider used by Sportfolio AI while keeping BYOK support
              unchanged.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {agentSystemSettings ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {agentSystemSettings.managedProviders.map((provider) => (
                    <Badge
                      key={provider.key}
                      variant={
                        provider.key === agentSystemSettings.settings.managedProvider
                          ? "default"
                          : "outline"
                      }
                    >
                      {provider.label}
                      {!provider.configured ? " (Not configured)" : ""}
                    </Badge>
                  ))}
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="agent-managed-provider">Managed Provider</Label>
                    <select
                      id="agent-managed-provider"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={agentManagedProviderDraft}
                      onChange={(event) => {
                        const nextProvider = event.target.value as ManagedProviderKey;
                        const nextProviderStatus = agentSystemSettings.managedProviders.find(
                          (provider) => provider.key === nextProvider,
                        );
                        setAgentManagedProviderDraft(nextProvider);
                        setAgentManagedModelDraft(nextProviderStatus?.defaultModel || "");
                      }}
                      data-testid="select-agent-managed-provider"
                    >
                      {agentSystemSettings.managedProviders.map((provider) => (
                        <option key={provider.key} value={provider.key}>
                          {provider.label}
                          {!provider.configured ? " (not configured)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="agent-managed-model">Managed Model Override</Label>
                    <Input
                      id="agent-managed-model"
                      list="agent-managed-model-options"
                      value={agentManagedModelDraft}
                      onChange={(event) => setAgentManagedModelDraft(event.target.value)}
                      placeholder={
                        selectedAgentManagedProvider?.defaultModel || "Enter any supported model id"
                      }
                      data-testid="input-agent-managed-model"
                    />
                    <datalist id="agent-managed-model-options">
                      {agentModelSuggestions.map((model) => (
                        <option key={model.id} value={model.id} label={model.name} />
                      ))}
                    </datalist>
                    <p className="text-xs text-muted-foreground">
                      Leave blank to use the provider default. For OpenRouter, you can enter any
                      supported model id even if it is not shown in the suggestion list.
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border p-3 text-sm space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-medium">Available models</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {isAgentProviderModelCatalogLoading
                          ? "Loading model catalog..."
                          : agentModelSuggestions.length > 0
                            ? `${agentModelSuggestions.length.toLocaleString()} models loaded from ${agentModelSourceDescription}.`
                            : "No model suggestions available. You can still enter a model id manually."}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void refetchAgentProviderModelCatalog();
                      }}
                      disabled={isAgentProviderModelCatalogLoading}
                      data-testid="button-refresh-agent-model-catalog"
                    >
                      {isAgentProviderModelCatalogLoading ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                          Refreshing...
                        </>
                      ) : (
                        "Refresh Models"
                      )}
                    </Button>
                  </div>
                  {agentProviderModelCatalog?.warning ? (
                    <div className="text-xs text-yellow-600 dark:text-yellow-400">
                      {agentProviderModelCatalog.warning}
                    </div>
                  ) : null}
                </div>

                {selectedAgentManagedProvider?.models.length ? (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">Quick picks</div>
                    <div className="flex flex-wrap gap-2">
                      {selectedAgentManagedProvider.models.map((model) => (
                        <Button
                          key={model}
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setAgentManagedModelDraft(model)}
                          data-testid={`button-agent-model-${model.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                        >
                          {model}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-lg border p-3 text-sm">
                  <div className="font-medium">
                    Active: {agentSystemSettings.managedProvider.label}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    Base URL: {agentSystemSettings.managedProvider.baseUrl}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    Model: {agentSystemSettings.managedProvider.defaultModel || "Not set"}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    Updated: {new Date(agentSystemSettings.settings.updatedAt).toLocaleString()}
                  </div>
                </div>

                <Button
                  onClick={handleSaveAgentSystemSettings}
                  disabled={updateAgentSystemSettingsMutation.isPending}
                  data-testid="button-save-agent-system-settings"
                >
                  {updateAgentSystemSettingsMutation.isPending ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Agent AI"
                  )}
                </Button>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">Loading agent system settings...</div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-api-health-monitor">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5" />
                  API Health Monitor
                </CardTitle>
                <CardDescription>
                  Daily automated checks with on-demand smoke testing for core API flows.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => refetchApiHealth()}
                  disabled={runApiHealthMutation.isPending}
                  data-testid="button-refresh-api-health"
                >
                  Refresh
                </Button>
                <Button
                  size="sm"
                  onClick={() => runApiHealthMutation.mutate()}
                  disabled={runApiHealthMutation.isPending}
                  data-testid="button-run-api-health"
                >
                  {runApiHealthMutation.isPending ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-1" />
                      Run now
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {apiHealth?.report ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {getStatusBadge(apiHealth.report.status)}
                  {apiHealth.isStale && (
                    <Badge className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20">
                      Stale
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Last checked {new Date(apiHealth.report.checkedAt).toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Duration {apiHealth.report.durationMs}ms
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <div className="rounded-lg border p-2">
                    <div className="text-xs text-muted-foreground">Total checks</div>
                    <div className="text-lg font-semibold">{apiHealth.report.summary.total}</div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="text-xs text-muted-foreground">Success</div>
                    <div className="text-lg font-semibold text-positive">
                      {apiHealth.report.summary.success}
                    </div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="text-xs text-muted-foreground">Degraded</div>
                    <div className="text-lg font-semibold text-yellow-600 dark:text-yellow-400">
                      {apiHealth.report.summary.degraded}
                    </div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="text-xs text-muted-foreground">Failed</div>
                    <div className="text-lg font-semibold text-destructive">
                      {apiHealth.report.summary.failed}
                    </div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="text-xs text-muted-foreground">Route checks</div>
                    <div className="text-lg font-semibold">
                      {apiHealth.report.summary.routeChecks}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {apiHealth.report.checks.map((check) => (
                    <div
                      key={check.id}
                      className="flex items-start justify-between gap-3 rounded-lg border p-3"
                      data-testid={`api-health-check-${check.id}`}
                    >
                      <div className="flex items-start gap-2">
                        {getStatusIcon(check.status)}
                        <div>
                          <div className="text-sm font-semibold">{check.label}</div>
                          <div className="text-xs text-muted-foreground">{check.details}</div>
                          {check.path && (
                            <div className="text-[11px] text-muted-foreground font-mono mt-1">
                              {check.path}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {check.durationMs}ms
                      </div>
                    </div>
                  ))}
                </div>

                {apiHealth.recentRuns.length > 0 && (
                  <div className="pt-2 border-t">
                    <div className="text-sm font-semibold mb-2">Recent Daily Runs</div>
                    <div className="space-y-1">
                      {apiHealth.recentRuns.slice(0, 5).map((run) => (
                        <div
                          key={run.id}
                          className="flex items-center justify-between text-xs rounded border px-2 py-1.5"
                        >
                          <div className="flex items-center gap-2">
                            {getStatusIcon(run.status)}
                            <span className="font-mono">{run.status}</span>
                            <span className="text-muted-foreground">
                              {run.finishedAt
                                ? new Date(run.finishedAt).toLocaleString()
                                : new Date(run.startedAt).toLocaleString()}
                            </span>
                          </div>
                          <span className="text-muted-foreground">
                            {run.errorCount} errors, {run.recordsProcessed} checks
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                {apiHealth?.inProgress
                  ? apiHealth.message || "API health check is running. Refresh in a moment."
                  : "No API health report yet. Run a check now to initialize monitoring."}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Premium Shares Grant */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              Grant Premium Shares
            </CardTitle>
            <CardDescription>Manually grant premium shares to a user by username.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="grant-username">Username</Label>
                  <Input
                    id="grant-username"
                    type="text"
                    placeholder="Enter username"
                    value={grantUsername}
                    onChange={(e) => setGrantUsername(e.target.value)}
                    disabled={grantPremiumMutation.isPending}
                    data-testid="input-grant-username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="grant-quantity">Quantity</Label>
                  <Input
                    id="grant-quantity"
                    type="number"
                    min="1"
                    placeholder="Number of shares"
                    value={grantQuantity}
                    onChange={(e) => setGrantQuantity(e.target.value)}
                    disabled={grantPremiumMutation.isPending}
                    data-testid="input-grant-quantity"
                  />
                </div>
              </div>
              <Button
                onClick={handleGrantPremium}
                disabled={grantPremiumMutation.isPending}
                className="gap-2"
                data-testid="button-grant-premium"
              >
                {grantPremiumMutation.isPending ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Granting...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Grant Shares
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Game Data Migration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="w-5 h-5" />
              Game Data Migration
            </CardTitle>
            <CardDescription>
              Clean up legacy MySportsFeeds game records after migrating to BallDontLie API.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-4 rounded-lg border bg-muted/30">
                <h4 className="font-semibold mb-2">What this does:</h4>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Finds legacy game records (gameId starting with 18447)</li>
                  <li>Checks if a BallDontLie equivalent exists for the same teams/time</li>
                  <li>Deletes the legacy record if a BDL equivalent exists</li>
                  <li>Keeps the legacy record if it's the only available data</li>
                </ul>
              </div>
              <Button
                onClick={handleCleanupDuplicates}
                disabled={cleanupDuplicatesMutation.isPending}
                variant="outline"
                className="gap-2"
              >
                {cleanupDuplicatesMutation.isPending ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Cleaning up...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Clean Up Duplicate Games
                  </>
                )}
              </Button>
              {cleanupDuplicatesMutation.isSuccess && cleanupDuplicatesMutation.data && (
                <div className="p-3 rounded-lg border bg-positive/10 text-positive">
                  <div className="font-semibold">Cleanup Results:</div>
                  <div className="text-sm">{cleanupDuplicatesMutation.data.message}</div>
                  <div className="text-xs mt-1">
                    {cleanupDuplicatesMutation.data.deletedCount} deleted,{" "}
                    {cleanupDuplicatesMutation.data.keptCount} kept
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5" />
              AMM Pool Seeding
            </CardTitle>
            <CardDescription>
              Seed missing AMM pools and repair unseeded legacy pool liquidity.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="p-4 rounded-lg border bg-muted/30 text-sm text-muted-foreground">
                This initializes missing pools and repairs unseeded legacy pools with no trades.
                Existing traded pools are not modified.
              </div>
              <Button
                onClick={handleSeedMissingPools}
                disabled={seedMissingPoolsMutation.isPending}
                variant="outline"
                className="gap-2"
                data-testid="button-seed-missing-pools"
              >
                {seedMissingPoolsMutation.isPending ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Seeding...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Seed Missing Pools
                  </>
                )}
              </Button>
              {seedMissingPoolsMutation.isSuccess && seedMissingPoolsMutation.data && (
                <div className="p-3 rounded-lg border bg-positive/10 text-positive">
                  <div className="font-semibold">Seeding Results:</div>
                  <div className="text-sm">{seedMissingPoolsMutation.data.message}</div>
                  <div className="text-xs mt-1">
                    {seedMissingPoolsMutation.data.seededCount} seeded,{" "}
                    {seedMissingPoolsMutation.data.repairedCount ?? 0} repaired,{" "}
                    {seedMissingPoolsMutation.data.failedCount} failed
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Backfill Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              Game Logs Backfill
            </CardTitle>
            <CardDescription>
              Manually backfill game logs for a specific date range. The daily cron job only fetches
              yesterday's games. Use this for initial setup or catching up after downtime.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="backfill-start-date">Start Date</Label>
                  <Input
                    id="backfill-start-date"
                    type="date"
                    value={backfillStartDate}
                    onChange={(e) => setBackfillStartDate(e.target.value)}
                    disabled={isBackfilling}
                    data-testid="input-backfill-start-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="backfill-end-date">End Date</Label>
                  <Input
                    id="backfill-end-date"
                    type="date"
                    value={backfillEndDate}
                    onChange={(e) => setBackfillEndDate(e.target.value)}
                    disabled={isBackfilling}
                    data-testid="input-backfill-end-date"
                  />
                </div>
              </div>
              <Button
                onClick={handleBackfill}
                disabled={isBackfilling}
                className="gap-2"
                data-testid="button-run-backfill"
              >
                {isBackfilling ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Running Backfill...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Run Backfill
                  </>
                )}
              </Button>
              <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                <strong>Note:</strong> Backfilling is slow (~5-10 minutes for full season). Each
                date requires a 5-second API call. The daily cron job completes in ~5 seconds since
                it only fetches yesterday.
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Live Log Viewer for Backfill */}
        {backfillOperationId && (
          <LiveLogViewer
            operationId={backfillOperationId}
            title="Backfill Game Logs - Live Status"
            description="Real-time progress and logs from the backfill operation"
            onComplete={() => {
              setBackfillOperationId(null);
            }}
          />
        )}

        {/* Job Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5" />
              Background Jobs
            </CardTitle>
            <CardDescription>
              Manually trigger background sync jobs. In production, these should run via external
              cron service.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(jobDescriptions).map(([jobName, description]) => (
              <div
                key={jobName}
                className="flex items-center justify-between p-4 rounded-lg border"
              >
                <div className="flex-1">
                  <div className="font-semibold font-mono text-sm mb-1">{jobName}</div>
                  <div className="text-sm text-muted-foreground">{description}</div>
                </div>
                <Button
                  onClick={() => handleTriggerJob(jobName)}
                  disabled={runningJobs.has(jobName)}
                  size="sm"
                  className="gap-2"
                  data-testid={`button-trigger-${jobName}`}
                >
                  {runningJobs.has(jobName) ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      Run Now
                    </>
                  )}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Live Log Viewers for Triggered Jobs */}
        {Array.from(jobOperationIds.entries()).map(([jobName, operationId]) => (
          <LiveLogViewer
            key={operationId}
            operationId={operationId}
            title={`${jobName} - Live Status`}
            description={`Real-time progress and logs from ${jobName} job`}
            onComplete={() => {
              setJobOperationIds((prev) => {
                const next = new Map(prev);
                next.delete(jobName);
                return next;
              });
            }}
          />
        ))}

        {/* Blog Posts Management */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                <div>
                  <CardTitle>Blog Posts</CardTitle>
                  <CardDescription>Manage blog content for SEO and user engagement</CardDescription>
                </div>
              </div>
              <Dialog open={blogDialogOpen} onOpenChange={setBlogDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    className="gap-2"
                    onClick={() => handleOpenBlogDialog()}
                    data-testid="button-create-blog-post"
                  >
                    <Plus className="w-4 h-4" />
                    New Post
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{editingPost ? "Edit Blog Post" : "Create Blog Post"}</DialogTitle>
                    <DialogDescription>
                      {editingPost
                        ? "Update your blog post content"
                        : "Create a new blog post for Sportfolio"}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="blog-title">Title</Label>
                      <Input
                        id="blog-title"
                        placeholder="Enter blog post title"
                        value={blogTitle}
                        onChange={(e) => handleTitleChange(e.target.value)}
                        data-testid="input-blog-title"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="blog-slug">Slug (URL)</Label>
                      <Input
                        id="blog-slug"
                        placeholder="url-friendly-slug"
                        value={blogSlug}
                        onChange={(e) => setBlogSlug(e.target.value)}
                        data-testid="input-blog-slug"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="blog-excerpt">Excerpt</Label>
                      <Textarea
                        id="blog-excerpt"
                        placeholder="Brief summary (shown in blog listing)"
                        value={blogExcerpt}
                        onChange={(e) => setBlogExcerpt(e.target.value)}
                        rows={3}
                        data-testid="textarea-blog-excerpt"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="blog-content">Content (Markdown supported)</Label>
                      <Textarea
                        id="blog-content"
                        placeholder="Full blog post content - supports markdown formatting (headings, lists, links, bold, italic, code blocks, etc.)"
                        value={blogContent}
                        onChange={(e) => setBlogContent(e.target.value)}
                        rows={15}
                        className="font-mono text-sm"
                        data-testid="textarea-blog-content"
                      />
                      <p className="text-xs text-muted-foreground">
                        Use markdown syntax: **bold**, *italic*, # Headings, - Lists, [links](url),
                        ```code blocks```, etc.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="blog-published"
                        type="checkbox"
                        checked={blogPublished}
                        onChange={(e) => setBlogPublished(e.target.checked)}
                        className="h-4 w-4"
                        data-testid="checkbox-blog-published"
                      />
                      <Label htmlFor="blog-published">Published (visible to public)</Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setBlogDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSaveBlogPost} data-testid="button-save-blog-post">
                      {editingPost ? "Update" : "Create"} Post
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {blogPostsData && blogPostsData.posts.length > 0 ? (
              <div className="space-y-2">
                {blogPostsData.posts.map((post) => (
                  <div
                    key={post.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover-elevate"
                    data-testid={`blog-post-item-${post.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-sm truncate">{post.title}</h3>
                        {post.publishedAt ? (
                          <Badge variant="default" className="text-xs">
                            <Eye className="w-3 h-3 mr-1" />
                            Published
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            <EyeOff className="w-3 h-3 mr-1" />
                            Draft
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{post.excerpt}</p>
                      <p className="text-xs text-muted-foreground mt-1">/{post.slug}</p>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleOpenBlogDialog(post)}
                        data-testid={`button-edit-blog-${post.id}`}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDeleteBlogPost(post.id)}
                        data-testid={`button-delete-blog-${post.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No blog posts yet. Create your first post to improve SEO and engage users!
              </div>
            )}
          </CardContent>
        </Card>

        {/* Twitter Automation */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="flex items-center gap-2">
                <Twitter className="w-5 h-5" />
                Twitter Automation
              </CardTitle>
              <div className="flex items-center gap-2">
                <Label htmlFor="tweet-enabled" className="text-sm">
                  Auto-post
                </Label>
                <Switch
                  id="tweet-enabled"
                  checked={tweetData?.settings?.enabled ?? false}
                  onCheckedChange={(checked) =>
                    updateTweetSettingsMutation.mutate({ enabled: checked })
                  }
                  data-testid="switch-tweet-enabled"
                />
              </div>
            </div>
            <CardDescription>Daily market tweets with AI-powered player insights</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Service Status */}
            <div className="flex flex-wrap gap-2">
              <Badge variant={tweetData?.status?.twitter?.configured ? "default" : "secondary"}>
                <Twitter className="w-3 h-3 mr-1" />
                X/Twitter:{" "}
                {tweetData?.status?.twitter?.configured ? "Configured" : "Not configured"}
              </Badge>
              <Badge variant={tweetData?.status?.perplexity?.configured ? "default" : "secondary"}>
                <Sparkles className="w-3 h-3 mr-1" />
                Perplexity:{" "}
                {tweetData?.status?.perplexity?.configured ? "Configured" : "Not configured"}
              </Badge>
            </div>

            {/* Test Connections */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleTestTwitter}
                data-testid="button-test-twitter"
              >
                Test X Connection
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleTestPerplexity}
                data-testid="button-test-perplexity"
              >
                Test Perplexity
              </Button>
            </div>

            {/* Tweet Settings */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="include-risers"
                  checked={tweetData?.settings?.includeRisers ?? true}
                  onChange={(e) =>
                    updateTweetSettingsMutation.mutate({ includeRisers: e.target.checked })
                  }
                  className="h-4 w-4"
                  data-testid="checkbox-include-risers"
                />
                <Label htmlFor="include-risers" className="text-xs">
                  Top Risers
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="include-volume"
                  checked={tweetData?.settings?.includeVolume ?? true}
                  onChange={(e) =>
                    updateTweetSettingsMutation.mutate({ includeVolume: e.target.checked })
                  }
                  className="h-4 w-4"
                  data-testid="checkbox-include-volume"
                />
                <Label htmlFor="include-volume" className="text-xs">
                  Volume
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="include-marketcap"
                  checked={tweetData?.settings?.includeMarketCap ?? true}
                  onChange={(e) =>
                    updateTweetSettingsMutation.mutate({ includeMarketCap: e.target.checked })
                  }
                  className="h-4 w-4"
                  data-testid="checkbox-include-marketcap"
                />
                <Label htmlFor="include-marketcap" className="text-xs">
                  Market Cap
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="max-players" className="text-xs">
                  Max Players:
                </Label>
                <Input
                  id="max-players"
                  type="number"
                  min={1}
                  max={5}
                  value={tweetData?.settings?.maxPlayers ?? 3}
                  onChange={(e) =>
                    updateTweetSettingsMutation.mutate({
                      maxPlayers: parseInt(e.target.value) || 3,
                    })
                  }
                  className="w-14 h-7 text-xs"
                  data-testid="input-max-players"
                />
              </div>
            </div>

            {/* Daily Tweet Actions */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Daily Auto-Tweet</h4>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={handlePreviewTweet}
                  disabled={isPreviewLoading}
                  data-testid="button-preview-tweet"
                >
                  {isPreviewLoading ? (
                    <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Eye className="w-4 h-4 mr-1" />
                  )}
                  Preview Daily
                </Button>
                <Button
                  size="sm"
                  onClick={handlePostTweet}
                  disabled={isPosting || !tweetData?.status?.twitter?.configured}
                  data-testid="button-post-tweet"
                >
                  {isPosting ? (
                    <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-1" />
                  )}
                  Post Daily
                </Button>
              </div>
            </div>

            {/* Custom AI Tweet Drafting */}
            <div className="space-y-2 pt-3 border-t">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Custom AI Tweet
              </h4>
              <p className="text-xs text-muted-foreground">
                Ask Perplexity to draft a tweet using your market data + fantasy stats
              </p>
              <Textarea
                placeholder="e.g. Draft a tweet about the top 5 fantasy performers from last night's games..."
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={2}
                className="text-sm"
                data-testid="textarea-custom-prompt"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={handleDraftCustomTweet}
                  disabled={isDrafting || !tweetData?.status?.perplexity?.configured}
                  data-testid="button-draft-custom"
                >
                  {isDrafting ? (
                    <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 mr-1" />
                  )}
                  Draft with AI
                </Button>
              </div>

              {/* Custom Draft Result */}
              {customDraft && (
                <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">AI Draft</span>
                    <Badge
                      variant={customDraft.length <= 280 ? "default" : "destructive"}
                      className="text-xs"
                    >
                      {customDraft.length}/280
                    </Badge>
                  </div>
                  <Textarea
                    value={customDraft}
                    onChange={(e) => setCustomDraft(e.target.value)}
                    rows={4}
                    className="text-sm font-mono"
                    data-testid="textarea-custom-draft"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handlePostCustomDraft}
                      disabled={isPosting || customDraft.length > 280}
                      data-testid="button-post-custom"
                    >
                      {isPosting ? (
                        <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4 mr-1" />
                      )}
                      Post This Tweet
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setCustomDraft(null)}>
                      Discard
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Tweet Preview */}
            {tweetPreview && (
              <div className="p-3 rounded-lg border bg-muted/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold">Preview</span>
                  <Badge
                    variant={tweetPreview.characterCount <= 280 ? "default" : "destructive"}
                    className="text-xs"
                  >
                    {tweetPreview.characterCount}/280
                  </Badge>
                </div>
                <pre className="text-sm whitespace-pre-wrap font-mono">{tweetPreview.content}</pre>
                {tweetPreview.aiSummary && (
                  <div className="mt-2 pt-2 border-t">
                    <span className="text-xs text-muted-foreground">
                      AI Summary (expanded): {tweetPreview.aiSummary}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Recent Tweet History */}
            {tweetData?.history && tweetData.history.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Recent Tweets</h4>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {tweetData.history.slice(0, 5).map((tweet) => (
                    <div
                      key={tweet.id}
                      className="flex items-center justify-between p-2 rounded border text-xs"
                    >
                      <div className="flex-1 min-w-0 mr-2">
                        <span className="truncate block">{tweet.content.slice(0, 60)}...</span>
                        <span className="text-muted-foreground">
                          {new Date(tweet.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {tweet.status === "posted" ? (
                        <Badge variant="default" className="text-xs shrink-0">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Posted
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs shrink-0">
                          <AlertCircle className="w-3 h-3 mr-1" />
                          Failed
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Job History */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Recent Job Runs
            </CardTitle>
            <CardDescription>Last execution status for each job</CardDescription>
          </CardHeader>
          <CardContent>
            {stats?.lastJobRuns && stats.lastJobRuns.length > 0 ? (
              <div className="space-y-3">
                {stats.lastJobRuns.map((job) => (
                  <div
                    key={job.jobName}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div className="flex items-center gap-3">
                      {getStatusIcon(job.status)}
                      <div>
                        <div className="font-mono text-sm font-semibold">{job.jobName}</div>
                        <div className="text-xs text-muted-foreground">
                          {job.finishedAt ? new Date(job.finishedAt).toLocaleString() : "Never run"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right hidden sm:block">
                        <div className="text-sm">{job.recordsProcessed} records</div>
                        {job.errorCount > 0 && (
                          <div className="text-xs text-destructive">{job.errorCount} errors</div>
                        )}
                      </div>
                      {getStatusBadge(job.status)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">No job history available</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
