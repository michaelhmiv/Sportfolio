import { formatDistanceToNow } from "date-fns";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  Activity,
  ArrowDownRight,
  ArrowUpDown,
  ArrowUpRight,
  Camera,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  Edit2,
  LineChart as LineChartIcon,
  Loader2,
  Moon,
  Settings,
  Sun,
  Trophy,
  Upload,
  Wallet,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Player } from "@shared/schema";
import { CliAccessCard } from "@/components/cli-access-card";
import { PlayerName } from "@/components/player-name";
import { SmsAccessCard } from "@/components/sms-access-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useWebSocket } from "@/lib/websocket";

type LeaderboardCategory =
  | "netWorth"
  | "cashBalance"
  | "portfolioValue"
  | "tradingVolume24h"
  | "marketOrders";

interface RankedMetric {
  category: LeaderboardCategory;
  label: string;
  rank: number | null;
  value: number;
  rankChange: number | null;
}

interface PerformanceWindow {
  amount: number | null;
  percent: number | null;
  rankChange: number | null;
}

interface ProfileHolding {
  id: string;
  assetId: string;
  quantity: number;
  avgCostBasis: number;
  lastTradePrice: number;
  marketValue: number;
  pnl: number;
  pnlPercent: number;
  shareOfPortfolio: number;
  player?: Player;
}

interface ProfileActivity {
  id: string;
  timestamp: string;
  category: "market" | "scout";
  type: string;
  description: string;
  cashDelta?: string;
  shareDelta?: number;
  metadata: {
    playerId?: string;
    playerName?: string;
  };
}

interface UserProfileResponse {
  user: {
    id: string;
    username: string;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl?: string | null;
    isAdmin: boolean;
    isPremium: boolean;
    createdAt: string;
  };
  updatedAt: string;
  stats: {
    netWorth: number;
    cashBalance: number;
    portfolioValue: number;
    tradingVolume24h: number;
    totalMarketOrders: number;
    totalTradesExecuted: number;
    holdingsCount: number;
    activeSports: number;
  };
  rankings: Record<LeaderboardCategory, RankedMetric>;
  performance: {
    change24h: PerformanceWindow;
    change7d: PerformanceWindow;
    change30d: PerformanceWindow;
  };
  history: {
    timeRange: string;
    points: Array<{
      date: string;
      cashBalance: number;
      portfolioValue: number;
      netWorth: number;
      cashRank: number | null;
      portfolioRank: number | null;
      netWorthRank: number | null;
    }>;
  };
  holdingsSummary: {
    topHoldings: ProfileHolding[];
    sportExposure: Array<{ sport: string; value: number; percentage: number }>;
  };
  activity: ProfileActivity[];
  holdings: ProfileHolding[];
}

type PublicHoldingsSortField =
  | "name"
  | "quantity"
  | "avgCost"
  | "price"
  | "value"
  | "pnl"
  | "weight";
type SortDirection = "asc" | "desc";

// Compact mobile standards aligned with the dashboard density.
const PROFILE_COMPACT_TYPE = {
  pageTitle: "text-xl font-bold sm:text-2xl",
  sectionTitle: "terminal-heading text-sm font-medium uppercase tracking-wide",
  label: "text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs",
  meta: "text-[10px] text-muted-foreground sm:text-xs",
  body: "text-xs text-muted-foreground sm:text-sm",
  primaryValue: "font-mono text-base font-bold sm:text-xl",
  secondaryValue: "font-mono text-xs font-semibold sm:text-sm",
};

const PUBLIC_HOLDINGS_SORT_OPTIONS: Array<{ value: PublicHoldingsSortField; label: string }> = [
  { value: "value", label: "Value" },
  { value: "pnl", label: "P&L" },
  { value: "weight", label: "Weight" },
  { value: "quantity", label: "Quantity" },
  { value: "price", label: "Price" },
  { value: "avgCost", label: "Avg Cost" },
  { value: "name", label: "Name" },
];

function formatCurrency(value: number) {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatSignedCurrency(value: number) {
  return `${value >= 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatQuantity(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatMetricValue(category: LeaderboardCategory, value: number) {
  if (category === "marketOrders") {
    return `${Math.round(value).toLocaleString()} orders`;
  }

  return formatCurrency(value);
}

function RankMovement({ change }: { change: number | null }) {
  if (change === null || change === 0) {
    return <span className={PROFILE_COMPACT_TYPE.meta}>Flat</span>;
  }

  const positive = change > 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] sm:text-xs",
        positive ? "text-positive" : "text-destructive",
      )}
    >
      <Icon className="h-3 w-3" />
      {positive ? "+" : ""}
      {change}
    </span>
  );
}

function PerformanceCard({ label, value }: { label: string; value: PerformanceWindow }) {
  const amount = value.amount ?? 0;
  const positive = amount >= 0;

  return (
    <Card variant="terminal">
      <CardContent className="p-4">
        <div className={PROFILE_COMPACT_TYPE.label}>{label}</div>
        {value.amount !== null ? (
          <>
            <div
              className={cn(
                "mt-2 font-mono text-base font-bold sm:text-lg",
                positive ? "text-positive" : "text-destructive",
              )}
            >
              {positive ? "+" : ""}
              {formatCurrency(amount)}
            </div>
            <div
              className={cn("mt-2 flex items-center justify-between", PROFILE_COMPACT_TYPE.meta)}
            >
              <span>
                {value.percent !== null
                  ? `${value.percent >= 0 ? "+" : ""}${value.percent.toFixed(2)}%`
                  : "No %"}
              </span>
              <RankMovement change={value.rankChange} />
            </div>
          </>
        ) : (
          <div className={cn("mt-2", PROFILE_COMPACT_TYPE.body)}>Not enough history yet</div>
        )}
      </CardContent>
    </Card>
  );
}

function SortIcon({
  active,
  direction,
  align = "left",
}: {
  active: boolean;
  direction: SortDirection;
  align?: "left" | "right";
}) {
  if (!active) {
    return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
  }

  const Icon = direction === "asc" ? ChevronUp : ChevronDown;
  return <Icon className={cn("ml-1 h-3 w-3", align === "right" && "order-last ml-1")} />;
}

export default function UserProfile() {
  const params = useParams();
  const userId = params.id;
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const { subscribe, connectionState, isConnected } = useWebSocket();

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAvatarDialogOpen, setIsAvatarDialogOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [publicHoldingsSortField, setPublicHoldingsSortField] =
    useState<PublicHoldingsSortField>("value");
  const [publicHoldingsSortDirection, setPublicHoldingsSortDirection] =
    useState<SortDirection>("desc");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem("theme") as "light" | "dark" | null;
    const initialTheme = stored || "dark";
    setTheme(initialTheme);
    document.documentElement.classList.toggle("dark", initialTheme === "dark");
  }, []);

  useEffect(() => {
    if (!userId) return;

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: [`/api/user/${userId}/profile`] });
    };

    const unsubPortfolio = subscribe("portfolio", (data) => {
      if (!data?.userId || data.userId === userId) invalidate();
    });
    const unsubScouts = subscribe("scouts", (data) => {
      if (!data?.userId || data.userId === userId) invalidate();
    });
    const unsubTrade = subscribe("trade", () => invalidate());

    return () => {
      unsubPortfolio();
      unsubScouts();
      unsubTrade();
    };
  }, [subscribe, userId]);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
  };

  const { data: profile, isLoading } = useQuery<UserProfileResponse>({
    queryKey: [`/api/user/${userId}/profile`],
  });

  const updateUsernameMutation = useMutation({
    mutationFn: async (username: string) => {
      const response = await apiRequest("POST", "/api/user/update-username", { username });
      return response.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [`/api/user/${userId}/profile`] });
      void queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setIsEditDialogOpen(false);
      setNewUsername("");
      toast({
        title: "Username updated",
        description: "Your public profile name has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  const updateProfileImageMutation = useMutation({
    mutationFn: async (profileImageUrl: string) => {
      const response = await apiRequest("POST", "/api/user/update-profile-image", {
        profileImageUrl,
      });
      return response.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [`/api/user/${userId}/profile`] });
      void queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setIsAvatarDialogOpen(false);
      toast({
        title: "Profile picture updated",
        description: "Your avatar is live on your public profile.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const handleUpdateUsername = () => {
    if (newUsername.trim()) {
      updateUsernameMutation.mutate(newUsername.trim());
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please choose an image under 20MB.",
        variant: "destructive",
      });
      return;
    }

    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      toast({
        title: "Unsupported image",
        description: "Use JPEG, PNG, WebP, or GIF.",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    try {
      const supabase = await getSupabase();
      const ext = file.name.split(".").pop() || "jpg";
      const fileName = `${currentUser?.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(fileName, file, {
        cacheControl: "3600",
        upsert: true,
      });
      if (error) throw error;

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(fileName);

      await updateProfileImageMutation.mutateAsync(publicUrl);
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description:
          error.message || "Could not upload the image. Confirm the avatars bucket exists.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  if (isLoading) {
    return (
      <div className="terminal-page flex items-center justify-center p-4 text-muted-foreground">
        Loading profile...
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="terminal-page flex items-center justify-center p-4">
        <Card variant="terminal">
          <CardContent className="py-8 text-center text-muted-foreground">
            User not found
          </CardContent>
        </Card>
      </div>
    );
  }

  const { user, stats, rankings, performance, history, holdingsSummary, activity, holdings } =
    profile;
  const isOwnProfile = currentUser?.id === user.id;
  const initials = user.username.slice(0, 2).toUpperCase();
  const memberSince = new Date(user.createdAt).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const liveLabel =
    connectionState === "connected"
      ? "Live"
      : connectionState === "connecting"
        ? "Connecting"
        : connectionState === "error"
          ? "Connection issue"
          : "Reconnecting";
  const headlineMetrics: Array<{
    category: LeaderboardCategory;
    label: string;
    value: string;
    icon: typeof DollarSign;
  }> = [
    {
      category: "netWorth",
      label: "Net Worth",
      value: formatCurrency(stats.netWorth),
      icon: DollarSign,
    },
    {
      category: "portfolioValue",
      label: "Portfolio",
      value: formatCurrency(stats.portfolioValue),
      icon: LineChartIcon,
    },
    {
      category: "cashBalance",
      label: "Cash",
      value: formatCurrency(stats.cashBalance),
      icon: Wallet,
    },
    {
      category: "tradingVolume24h",
      label: "24h Volume",
      value: formatCurrency(stats.tradingVolume24h),
      icon: Activity,
    },
  ];
  const publicHoldings = holdings.filter(
    (holding): holding is ProfileHolding & { player: Player } => Boolean(holding.player),
  );
  const sortedPublicHoldings = publicHoldings.slice().sort((left, right) => {
    const leftName = `${left.player.lastName} ${left.player.firstName}`.toLowerCase();
    const rightName = `${right.player.lastName} ${right.player.firstName}`.toLowerCase();

    if (publicHoldingsSortField === "name") {
      return publicHoldingsSortDirection === "asc"
        ? leftName.localeCompare(rightName)
        : rightName.localeCompare(leftName);
    }

    const leftValue =
      publicHoldingsSortField === "quantity"
        ? left.quantity
        : publicHoldingsSortField === "avgCost"
          ? left.avgCostBasis
          : publicHoldingsSortField === "price"
            ? left.lastTradePrice
            : publicHoldingsSortField === "value"
              ? left.marketValue
              : publicHoldingsSortField === "pnl"
                ? left.pnl
                : left.shareOfPortfolio;
    const rightValue =
      publicHoldingsSortField === "quantity"
        ? right.quantity
        : publicHoldingsSortField === "avgCost"
          ? right.avgCostBasis
          : publicHoldingsSortField === "price"
            ? right.lastTradePrice
            : publicHoldingsSortField === "value"
              ? right.marketValue
              : publicHoldingsSortField === "pnl"
                ? right.pnl
                : right.shareOfPortfolio;

    return publicHoldingsSortDirection === "asc" ? leftValue - rightValue : rightValue - leftValue;
  });

  const handlePublicHoldingsSort = (field: PublicHoldingsSortField) => {
    if (publicHoldingsSortField === field) {
      setPublicHoldingsSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setPublicHoldingsSortField(field);
    setPublicHoldingsSortDirection(field === "name" ? "asc" : "desc");
  };

  return (
    <div className="terminal-page p-3 sm:p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <Card variant="terminal">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                {isOwnProfile ? (
                  <Dialog open={isAvatarDialogOpen} onOpenChange={setIsAvatarDialogOpen}>
                    <DialogTrigger asChild>
                      <button className="group relative">
                        <Avatar className="h-24 w-24">
                          <AvatarImage
                            src={user.profileImageUrl || undefined}
                            alt={user.username}
                          />
                          <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
                        </Avatar>
                        <div className="absolute inset-0 flex items-center justify-center rounded-sm bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                          <Camera className="h-6 w-6 text-white" />
                        </div>
                      </button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-sm rounded-sm border border-border bg-card">
                      <DialogHeader>
                        <DialogTitle>Change Profile Picture</DialogTitle>
                        <DialogDescription>
                          Upload a new public avatar or take one with your camera.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-3 py-4">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          className="hidden"
                          onChange={handleFileUpload}
                        />
                        <input
                          ref={cameraInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          capture="user"
                          className="hidden"
                          onChange={handleFileUpload}
                        />
                        <Button
                          variant="terminalOutline"
                          className="h-12 w-full gap-2"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isUploading}
                        >
                          {isUploading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Upload className="h-4 w-4" />
                          )}
                          Upload Photo
                        </Button>
                        <Button
                          variant="terminalOutline"
                          className="h-12 w-full gap-2"
                          onClick={() => cameraInputRef.current?.click()}
                          disabled={isUploading}
                        >
                          {isUploading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Camera className="h-4 w-4" />
                          )}
                          Take Photo
                        </Button>
                      </div>
                      <DialogFooter>
                        <Button
                          variant="terminalOutline"
                          onClick={() => setIsAvatarDialogOpen(false)}
                        >
                          Cancel
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                ) : (
                  <Avatar className="h-24 w-24">
                    <AvatarImage src={user.profileImageUrl || undefined} alt={user.username} />
                    <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
                  </Avatar>
                )}

                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className={PROFILE_COMPACT_TYPE.pageTitle}>@{user.username}</h1>
                    {user.isPremium && (
                      <Badge className="gap-1">
                        <Trophy className="h-3 w-3" />
                        Premium
                      </Badge>
                    )}
                    <Badge variant={isConnected ? "default" : "outline"}>{liveLabel}</Badge>
                  </div>
                  <div
                    className={cn(
                      "mt-3 flex flex-wrap items-center gap-3",
                      PROFILE_COMPACT_TYPE.body,
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      Member since {memberSince}
                    </span>
                    <span>
                      Updated{" "}
                      {formatDistanceToNow(new Date(profile.updatedAt), { addSuffix: true })}
                    </span>
                    <span>{stats.activeSports} sports active</span>
                  </div>
                </div>
              </div>

              {isOwnProfile && (
                <div className="flex flex-wrap gap-2">
                  <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="terminalOutline" size="sm" className="gap-2">
                        <Edit2 className="h-3 w-3" />
                        Edit Username
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="rounded-sm border border-border bg-card">
                      <DialogHeader>
                        <DialogTitle>Change Username</DialogTitle>
                        <DialogDescription>
                          Choose a unique public username using 3-20 letters, numbers, underscores,
                          or hyphens.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="py-4">
                        <Input
                          value={newUsername}
                          onChange={(event) => setNewUsername(event.target.value)}
                          maxLength={20}
                          placeholder="Enter new username"
                        />
                      </div>
                      <DialogFooter>
                        <Button
                          variant="terminalOutline"
                          onClick={() => setIsEditDialogOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleUpdateUsername}
                          disabled={updateUsernameMutation.isPending || !newUsername.trim()}
                        >
                          {updateUsernameMutation.isPending ? "Saving..." : "Save"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  <Button
                    variant="terminalOutline"
                    size="sm"
                    className="gap-2"
                    onClick={toggleTheme}
                  >
                    {theme === "light" ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
                    {theme === "light" ? "Dark Mode" : "Light Mode"}
                  </Button>
                  {user.isAdmin && (
                    <Link href="/admin">
                      <Button variant="terminalOutline" size="sm" className="gap-2">
                        <Settings className="h-3 w-3" />
                        Admin
                      </Button>
                    </Link>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-4">
          {headlineMetrics.map((metric) => {
            const Icon = metric.icon;
            const ranking = rankings[metric.category];
            return (
              <Link key={metric.category} href={`/leaderboards#${metric.category}`}>
                <Card variant="terminal" className="hover-elevate cursor-pointer">
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <span className={PROFILE_COMPACT_TYPE.label}>{metric.label}</span>
                    </div>
                    <div className={PROFILE_COMPACT_TYPE.primaryValue}>{metric.value}</div>
                    <div
                      className={cn(
                        "mt-1 flex items-center justify-between",
                        PROFILE_COMPACT_TYPE.meta,
                      )}
                    >
                      <span>{ranking.rank ? `Rank #${ranking.rank}` : "Unranked"}</span>
                      <RankMovement change={ranking.rankChange} />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <PerformanceCard label="24h Change" value={performance.change24h} />
              <PerformanceCard label="7d Change" value={performance.change7d} />
              <PerformanceCard label="30d Change" value={performance.change30d} />
            </div>

            <Card variant="terminal">
              <CardHeader>
                <CardTitle className={PROFILE_COMPACT_TYPE.sectionTitle}>Net Worth Trend</CardTitle>
              </CardHeader>
              <CardContent>
                {history.points.length > 1 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={history.points}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="date"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={11}
                        tickFormatter={(value) =>
                          new Date(value).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        }
                      />
                      <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={11}
                        tickFormatter={(value) => `$${Math.round(value).toLocaleString()}`}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "4px",
                        }}
                        formatter={(value: number) => [formatCurrency(value), "Net Worth"]}
                        labelFormatter={(value) =>
                          new Date(value).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="netWorth"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={history.points.length < 16}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState
                    icon="chart"
                    title="No trend history yet"
                    description="This profile will show a net worth curve once portfolio snapshots accumulate."
                    size="sm"
                    className="py-6"
                    variant="terminal"
                  />
                )}
              </CardContent>
            </Card>

            <Card variant="terminal">
              <CardHeader>
                <CardTitle className={PROFILE_COMPACT_TYPE.sectionTitle}>
                  Leaderboard Standing
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(Object.values(rankings) as RankedMetric[]).map((metric) => (
                  <Link key={metric.category} href={`/leaderboards#${metric.category}`}>
                    <div className="terminal-shell flex items-center justify-between p-3 hover-elevate">
                      <div>
                        <div className="text-sm font-medium">{metric.label}</div>
                        <div className={PROFILE_COMPACT_TYPE.meta}>
                          {metric.rank ? `Rank #${metric.rank}` : "Not ranked yet"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={PROFILE_COMPACT_TYPE.secondaryValue}>
                          {formatMetricValue(metric.category, metric.value)}
                        </div>
                        <RankMovement change={metric.rankChange} />
                      </div>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>

            <Card variant="terminal">
              <CardHeader>
                <CardTitle className={PROFILE_COMPACT_TYPE.sectionTitle}>
                  Recent Public Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {activity.length === 0 ? (
                  <EmptyState
                    icon="inbox"
                    title="No recent public activity"
                    description="Trades and scouting rewards will appear here once this account starts moving."
                    size="sm"
                    className="py-6"
                    variant="terminal"
                  />
                ) : (
                  <div className="space-y-3">
                    {activity.map((entry) => (
                      <div
                        key={entry.id}
                        className="terminal-shell flex items-start justify-between gap-3 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              "flex flex-wrap items-center gap-2",
                              PROFILE_COMPACT_TYPE.meta,
                            )}
                          >
                            <span className="uppercase tracking-wide">{entry.category}</span>
                            <span>-</span>
                            <span>
                              {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                            </span>
                          </div>
                          <div className="mt-1 text-sm font-medium">
                            {entry.metadata.playerId ? (
                              <Link href={`/player/${entry.metadata.playerId}`}>
                                <span className="cursor-pointer hover:text-primary">
                                  {entry.description}
                                </span>
                              </Link>
                            ) : (
                              entry.description
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          {entry.cashDelta && (
                            <div
                              className={cn(
                                PROFILE_COMPACT_TYPE.secondaryValue,
                                parseFloat(entry.cashDelta) >= 0
                                  ? "text-positive"
                                  : "text-destructive",
                              )}
                            >
                              {parseFloat(entry.cashDelta) >= 0 ? "+" : ""}
                              {formatCurrency(parseFloat(entry.cashDelta))}
                            </div>
                          )}
                          {entry.shareDelta !== undefined && entry.shareDelta !== 0 && (
                            <div className={PROFILE_COMPACT_TYPE.meta}>
                              {entry.shareDelta > 0 ? "+" : ""}
                              {entry.shareDelta} shares
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            {isOwnProfile && <SmsAccessCard />}
            {isOwnProfile && <CliAccessCard />}

            <Card variant="terminal">
              <CardHeader>
                <CardTitle className={PROFILE_COMPACT_TYPE.sectionTitle}>Top Holdings</CardTitle>
              </CardHeader>
              <CardContent>
                {holdingsSummary.topHoldings.length === 0 ? (
                  <EmptyState
                    icon="wallet"
                    title="No public holdings"
                    description="Once this account holds player shares, its top positions will show here."
                    size="sm"
                    className="py-6"
                    variant="terminal"
                  />
                ) : (
                  <div className="space-y-3">
                    {holdingsSummary.topHoldings.map((holding) => {
                      const player = holding.player;
                      if (!player) return null;
                      return (
                        <Link key={holding.id} href={`/player/${holding.assetId}`}>
                          <div className="terminal-shell flex items-center justify-between gap-3 p-3 hover-elevate">
                            <div className="min-w-0">
                              <div className="text-sm font-medium">
                                <PlayerName
                                  playerId={player.id}
                                  firstName={player.firstName}
                                  lastName={player.lastName}
                                />
                              </div>
                              <div className={PROFILE_COMPACT_TYPE.meta}>
                                {player.team} - {player.position} -{" "}
                                {holding.shareOfPortfolio.toFixed(1)}% of portfolio
                              </div>
                            </div>
                            <div className="text-right">
                              <div className={PROFILE_COMPACT_TYPE.secondaryValue}>
                                {formatCurrency(holding.marketValue)}
                              </div>
                              <div
                                className={cn(
                                  PROFILE_COMPACT_TYPE.meta,
                                  holding.pnl >= 0 ? "text-positive" : "text-destructive",
                                )}
                              >
                                {formatSignedCurrency(holding.pnl)}
                              </div>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card variant="terminal">
              <CardHeader>
                <CardTitle className={PROFILE_COMPACT_TYPE.sectionTitle}>
                  Portfolio Exposure
                </CardTitle>
              </CardHeader>
              <CardContent>
                {holdingsSummary.sportExposure.length === 0 ? (
                  <p className={PROFILE_COMPACT_TYPE.body}>No sport exposure yet.</p>
                ) : (
                  <div className="space-y-3">
                    {holdingsSummary.sportExposure.map((row) => (
                      <div key={row.sport} className="space-y-1">
                        <div className="flex items-center justify-between text-xs sm:text-sm">
                          <span className="font-medium">{row.sport}</span>
                          <span className="font-mono">{formatCurrency(row.value)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-sm bg-muted">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${Math.min(row.percentage, 100)}%` }}
                          />
                        </div>
                        <div className={PROFILE_COMPACT_TYPE.meta}>
                          {row.percentage.toFixed(1)}% of portfolio value
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card variant="terminal">
              <CardHeader>
                <CardTitle className={PROFILE_COMPACT_TYPE.sectionTitle}>Trader Snapshot</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs sm:text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">24h trading volume</span>
                  <span className="font-mono">{formatCurrency(stats.tradingVolume24h)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Market orders</span>
                  <span className="font-mono">{stats.totalMarketOrders.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Trades executed</span>
                  <span className="font-mono">{stats.totalTradesExecuted.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Public holdings</span>
                  <span className="font-mono">{stats.holdingsCount.toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card variant="terminal">
          <CardHeader className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle className={PROFILE_COMPACT_TYPE.sectionTitle}>
                All Public Holdings
              </CardTitle>
              <p className={PROFILE_COMPACT_TYPE.meta}>
                {publicHoldings.length.toLocaleString()} positions visible
              </p>
            </div>
            <div className="flex items-center gap-2 sm:hidden">
              <Select
                value={publicHoldingsSortField}
                onValueChange={(value) =>
                  setPublicHoldingsSortField(value as PublicHoldingsSortField)
                }
              >
                <SelectTrigger
                  className="h-8 w-[118px] text-xs"
                  data-testid="select-profile-holdings-sort"
                >
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  {PUBLIC_HOLDINGS_SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() =>
                  setPublicHoldingsSortDirection((current) => (current === "asc" ? "desc" : "asc"))
                }
                data-testid="button-profile-holdings-sort-direction"
              >
                {publicHoldingsSortDirection === "asc" ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div
              className={cn(
                "hidden items-center gap-2 sm:ml-auto sm:flex",
                PROFILE_COMPACT_TYPE.meta,
              )}
            >
              <span>Click columns to sort</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {publicHoldings.length === 0 ? (
              <EmptyState
                icon="wallet"
                title="No holdings yet"
                description="This trader has not built a public portfolio yet."
                size="sm"
                className="py-4"
                variant="terminal"
              />
            ) : (
              <div>
                <div className="divide-y divide-border sm:hidden">
                  {sortedPublicHoldings.map((holding) => (
                    <div key={holding.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <Link href={`/player/${holding.assetId}`}>
                            <div className="cursor-pointer text-sm font-medium hover:text-primary">
                              <PlayerName
                                playerId={holding.player.id}
                                firstName={holding.player.firstName}
                                lastName={holding.player.lastName}
                              />
                            </div>
                          </Link>
                          <div className={PROFILE_COMPACT_TYPE.meta}>
                            {holding.player.team} - {holding.player.position} -{" "}
                            {formatQuantity(holding.quantity)} shares
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={PROFILE_COMPACT_TYPE.secondaryValue}>
                            {formatCurrency(holding.marketValue)}
                          </div>
                          <div
                            className={cn(
                              PROFILE_COMPACT_TYPE.meta,
                              holding.pnl >= 0 ? "text-positive" : "text-destructive",
                            )}
                          >
                            {formatSignedCurrency(holding.pnl)} (
                            {formatSignedPercent(holding.pnlPercent)})
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                        <div>
                          <div className={PROFILE_COMPACT_TYPE.label}>Avg Cost</div>
                          <div className={PROFILE_COMPACT_TYPE.secondaryValue}>
                            {formatCurrency(holding.avgCostBasis)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={PROFILE_COMPACT_TYPE.label}>Last Price</div>
                          <div className={PROFILE_COMPACT_TYPE.secondaryValue}>
                            {formatCurrency(holding.lastTradePrice)}
                          </div>
                        </div>
                        <div>
                          <div className={PROFILE_COMPACT_TYPE.label}>Weight</div>
                          <div className={PROFILE_COMPACT_TYPE.secondaryValue}>
                            {holding.shareOfPortfolio.toFixed(1)}%
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={PROFILE_COMPACT_TYPE.label}>Qty</div>
                          <div className={PROFILE_COMPACT_TYPE.secondaryValue}>
                            {formatQuantity(holding.quantity)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full">
                    <thead className="border-b bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <button
                            className="flex items-center hover:text-foreground"
                            onClick={() => handlePublicHoldingsSort("name")}
                            data-testid="th-profile-holdings-sort-name"
                          >
                            Asset
                            <SortIcon
                              active={publicHoldingsSortField === "name"}
                              direction={publicHoldingsSortDirection}
                            />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <button
                            className="ml-auto flex items-center justify-end hover:text-foreground"
                            onClick={() => handlePublicHoldingsSort("quantity")}
                            data-testid="th-profile-holdings-sort-quantity"
                          >
                            Qty
                            <SortIcon
                              active={publicHoldingsSortField === "quantity"}
                              direction={publicHoldingsSortDirection}
                              align="right"
                            />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <button
                            className="ml-auto flex items-center justify-end hover:text-foreground"
                            onClick={() => handlePublicHoldingsSort("avgCost")}
                            data-testid="th-profile-holdings-sort-avgcost"
                          >
                            Avg
                            <SortIcon
                              active={publicHoldingsSortField === "avgCost"}
                              direction={publicHoldingsSortDirection}
                              align="right"
                            />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <button
                            className="ml-auto flex items-center justify-end hover:text-foreground"
                            onClick={() => handlePublicHoldingsSort("price")}
                            data-testid="th-profile-holdings-sort-price"
                          >
                            Price
                            <SortIcon
                              active={publicHoldingsSortField === "price"}
                              direction={publicHoldingsSortDirection}
                              align="right"
                            />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <button
                            className="ml-auto flex items-center justify-end hover:text-foreground"
                            onClick={() => handlePublicHoldingsSort("value")}
                            data-testid="th-profile-holdings-sort-value"
                          >
                            Value
                            <SortIcon
                              active={publicHoldingsSortField === "value"}
                              direction={publicHoldingsSortDirection}
                              align="right"
                            />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <button
                            className="ml-auto flex items-center justify-end hover:text-foreground"
                            onClick={() => handlePublicHoldingsSort("pnl")}
                            data-testid="th-profile-holdings-sort-pnl"
                          >
                            P&amp;L
                            <SortIcon
                              active={publicHoldingsSortField === "pnl"}
                              direction={publicHoldingsSortDirection}
                              align="right"
                            />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <button
                            className="ml-auto flex items-center justify-end hover:text-foreground"
                            onClick={() => handlePublicHoldingsSort("weight")}
                            data-testid="th-profile-holdings-sort-weight"
                          >
                            Weight
                            <SortIcon
                              active={publicHoldingsSortField === "weight"}
                              direction={publicHoldingsSortDirection}
                              align="right"
                            />
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPublicHoldings.map((holding) => (
                        <tr
                          key={holding.id}
                          className="border-b border-border/70 transition-colors hover:bg-muted/30"
                        >
                          <td className="px-3 py-2">
                            <Link href={`/player/${holding.assetId}`}>
                              <div className="min-w-0 cursor-pointer">
                                <div className="text-sm font-medium hover:text-primary">
                                  <PlayerName
                                    playerId={holding.player.id}
                                    firstName={holding.player.firstName}
                                    lastName={holding.player.lastName}
                                  />
                                </div>
                                <div className={PROFILE_COMPACT_TYPE.meta}>
                                  {holding.player.team} - {holding.player.position} -{" "}
                                  {holding.player.sport}
                                </div>
                              </div>
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className={PROFILE_COMPACT_TYPE.secondaryValue}>
                              {formatQuantity(holding.quantity)}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className={PROFILE_COMPACT_TYPE.secondaryValue}>
                              {formatCurrency(holding.avgCostBasis)}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className={PROFILE_COMPACT_TYPE.secondaryValue}>
                              {formatCurrency(holding.lastTradePrice)}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className={PROFILE_COMPACT_TYPE.secondaryValue}>
                              {formatCurrency(holding.marketValue)}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div
                              className={cn(
                                PROFILE_COMPACT_TYPE.secondaryValue,
                                holding.pnl >= 0 ? "text-positive" : "text-destructive",
                              )}
                            >
                              {formatSignedCurrency(holding.pnl)}
                            </div>
                            <div
                              className={cn(
                                PROFILE_COMPACT_TYPE.meta,
                                holding.pnl >= 0 ? "text-positive" : "text-destructive",
                              )}
                            >
                              {formatSignedPercent(holding.pnlPercent)}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className={PROFILE_COMPACT_TYPE.secondaryValue}>
                              {holding.shareOfPortfolio.toFixed(1)}%
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
