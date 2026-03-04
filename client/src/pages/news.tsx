import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { BarChart3, Clock, ExternalLink, Loader2, Newspaper, RefreshCw, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { DailyDigestTab, type Digest } from "@/components/news/daily-digest-tab";
import { PlayerLinkedText } from "@/components/player-linked-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, authenticatedFetch } from "@/lib/queryClient";
import { useNewsNotifications } from "@/lib/news-notification-context";

interface NewsItem {
  id: string;
  headline: string;
  briefing: string;
  sourceUrl: string | null;
  sport: string;
  createdAt: string;
}

interface NewsFetchResponse {
  recordsProcessed: number;
  stories?: Array<{ headline: string }>;
  error?: string;
}

function getNewsFetchToastContent(data: NewsFetchResponse): {
  title: string;
  description: string;
  variant: "default" | "destructive";
} {
  if (data.recordsProcessed > 0) {
    const storyText = data.recordsProcessed === 1 ? "story" : "stories";
    return {
      title: `${data.recordsProcessed} New ${storyText} Fetched`,
      description: data.stories?.[0]?.headline
        ? `"${data.stories[0].headline.substring(0, 55)}..."${
            data.recordsProcessed > 1 ? ` +${data.recordsProcessed - 1} more` : ""
          }`
        : "Breaking news has been added.",
      variant: "default",
    };
  }

  if (data.error) {
    return {
      title: "Fetch Issue",
      description: data.error,
      variant: "destructive",
    };
  }

  return {
    title: "Already Up-to-Date",
    description: "No new breaking news at this time.",
    variant: "default",
  };
}

function GeneralNewsTab({ newsLoading, news }: { newsLoading: boolean; news?: NewsItem[] }) {
  if (newsLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <Card key={i} variant="terminal">
            <CardHeader>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-12 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!news?.length) {
    return (
      <Card variant="terminal">
        <CardContent className="py-12 text-center">
          <Newspaper className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
          <h3 className="terminal-heading mb-1 text-sm">No News Yet</h3>
          <p className="terminal-subtle">Breaking sports news will appear here. Check back soon!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {news.map((item, index) => (
        <motion.div
          key={item.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
        >
          <Card variant="terminal" className="transition-colors hover:border-primary/30">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className={
                        item.sport === "NFL"
                          ? "rounded-sm border border-orange-500/20 bg-orange-500/10 font-mono text-[11px] uppercase tracking-[0.08em] text-orange-500"
                          : "rounded-sm border border-blue-500/20 bg-blue-500/10 font-mono text-[11px] uppercase tracking-[0.08em] text-blue-500"
                      }
                    >
                      {item.sport}
                    </Badge>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <CardTitle className="text-lg leading-tight">
                    <PlayerLinkedText text={item.headline} />
                  </CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <PlayerLinkedText
                text={item.briefing}
                className="mb-3 block text-sm text-muted-foreground"
              />
              {item.sourceUrl && (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Source
                </a>
              )}
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

export default function NewsPage() {
  const [activeTab, setActiveTab] = useState("general");
  const { isAuthenticated, user } = useAuth();
  const { markNewsAsRead, refreshUnreadCount, hasUnreadDigest } = useNewsNotifications();
  const { toast } = useToast();
  const isAdmin = user?.isAdmin || false;

  const {
    data: newsData,
    isLoading: newsLoading,
    refetch: refetchNews,
  } = useQuery<{
    news: NewsItem[];
  }>({
    queryKey: ["/api/news"],
  });

  const {
    data: digestData,
    isLoading: digestLoading,
    refetch: refetchDigest,
  } = useQuery<{
    digest: Digest;
  }>({
    queryKey: ["/api/news/digest"],
    enabled: isAuthenticated,
  });

  const { data: dashboardData } = useQuery<{ user: { balance: string; portfolioValue: string } }>({
    queryKey: ["/api/dashboard"],
    enabled: isAuthenticated,
  });

  const triggerNewsFetch = useMutation({
    mutationFn: async (): Promise<NewsFetchResponse> => {
      const response = await authenticatedFetch("/api/admin/jobs/news_fetch/trigger", {
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to trigger news fetch");
      return response.json();
    },
    onSuccess: (data) => {
      const toastContent = getNewsFetchToastContent(data);
      toast(toastContent);
      refetchNews();
      queryClient.invalidateQueries({ queryKey: ["/api/news"] });
    },
    onError: (error: unknown) => {
      toast({
        title: "Fetch Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (isAuthenticated) {
      markNewsAsRead().then(() => refreshUnreadCount());
    }
  }, [isAuthenticated, markNewsAsRead, refreshUnreadCount]);

  const handleRefresh = () => {
    refetchNews();
    if (isAuthenticated) refetchDigest();
  };

  return (
    <div className="terminal-page">
      <div className="container mx-auto max-w-4xl px-4 py-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="terminal-shell flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div>
                <div className="terminal-strip mb-3">
                  <Newspaper className="h-3.5 w-3.5" />
                  Market News Desk
                </div>
                <h1 className="terminal-heading text-2xl">News Hub</h1>
                <p className="terminal-subtle mt-2">Breaking sports news and your daily brief</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <Button
                  variant="terminalOutline"
                  size="sm"
                  onClick={() => triggerNewsFetch.mutate()}
                  disabled={triggerNewsFetch.isPending}
                  className="gap-2 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                >
                  {triggerNewsFetch.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  Fetch Now
                </Button>
              )}
              <Button variant="terminalOutline" size="sm" onClick={handleRefresh} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList variant="terminal" className="grid w-full grid-cols-2">
              <TabsTrigger variant="terminal" value="general" className="gap-2">
                <Newspaper className="h-4 w-4" />
                General News
              </TabsTrigger>
              <TabsTrigger
                variant="terminal"
                value="digest"
                className="gap-2"
                disabled={!isAuthenticated}
              >
                <BarChart3 className="h-4 w-4" />
                Daily Brief
                {hasUnreadDigest && (
                  <span className="ml-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-500" />
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-4">
              <GeneralNewsTab newsLoading={newsLoading} news={newsData?.news} />
            </TabsContent>

            <TabsContent value="digest" className="space-y-4">
              <DailyDigestTab
                isAuthenticated={isAuthenticated}
                digestLoading={digestLoading}
                digest={digestData?.digest}
                isPremium={user?.isPremium || false}
                availableBalance={dashboardData?.user?.balance}
              />
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </div>
  );
}
