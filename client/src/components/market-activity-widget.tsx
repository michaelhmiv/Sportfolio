import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock } from "lucide-react";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { useWebSocket } from "@/lib/websocket";
import { queryClient } from "@/lib/queryClient";
import { PlayerName } from "@/components/player-name";
import { UserName } from "@/components/user-name";
import { AnimatedList } from "@/components/ui/animated-list";
import { useAppState } from "@/hooks/use-app-state";

interface MarketActivity {
  activityType: "trade";
  id: string;
  playerId: string;
  playerFirstName: string;
  playerLastName: string;
  playerTeam: string;
  buyerId: string | null;
  buyerUsername: string | null;
  sellerId: string | null;
  sellerUsername: string | null;
  quantity: number;
  price: string | null;
  timestamp: string;
}

interface MarketActivityWidgetProps {
  sport?: string;
  limit?: number;
  title?: string;
  className?: string;
}

export function MarketActivityWidget({
  sport,
  limit = 10,
  title = "Market Activity",
  className,
}: MarketActivityWidgetProps = {}) {
  const { subscribe } = useWebSocket();
  const { shouldPoll, isMobile } = useAppState();
  const pollingInterval = shouldPoll ? 60000 : false;

  const { data: activity = [], isLoading } = useQuery<MarketActivity[]>({
    queryKey: ["/api/market/activity", sport || "ALL", limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (sport && sport !== "ALL") {
        params.set("sport", sport);
      }

      const response = await fetch(`/api/market/activity?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch market activity");
      return response.json();
    },
    refetchInterval: pollingInterval,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  });

  // Subscribe to WebSocket market activity events for real-time updates
  useEffect(() => {
    const unsubscribe = subscribe("marketActivity", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/market/activity"] });
    });
    return unsubscribe;
  }, [subscribe]);

  const getActivityIcon = (item: MarketActivity) => {
    return <span className="text-blue-500 font-bold text-lg">▲</span>;
  };

  const getActivityText = (item: MarketActivity) => {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-muted-foreground text-xs">Trade:</span>
        {item.buyerId && item.buyerUsername && (
          <span className="font-medium text-xs">
            {item.buyerId === "pool" ? (
              "Pool"
            ) : (
              <UserName userId={item.buyerId} username={item.buyerUsername} className="text-xs" />
            )}
          </span>
        )}
        <span className="text-muted-foreground text-xs">bought from</span>
        {item.sellerId && item.sellerUsername && (
          <span className="font-medium text-xs">
            {item.sellerId === "pool" ? (
              "Pool"
            ) : (
              <UserName userId={item.sellerId} username={item.sellerUsername} className="text-xs" />
            )}
          </span>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wide">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-muted-foreground text-sm">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-wide">{title}</CardTitle>
        <Clock className="w-4 h-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-2">
        {activity.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground text-sm">No recent activity</div>
        ) : (
          <>
            <AnimatedList
              items={activity.slice(0, 5)}
              keyExtractor={(item) => `${item.activityType}-${item.id}`}
              animateDirection="right"
              staggerDelay={0.05}
              highlightNew={true}
              renderItem={(item) => (
                <div
                  className="flex items-center justify-between py-2 border-b last:border-0"
                  data-testid={`activity-${item.activityType}-${item.id}`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="flex-shrink-0">{getActivityIcon(item)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">
                        <PlayerName
                          playerId={item.playerId}
                          firstName={item.playerFirstName}
                          lastName={item.playerLastName}
                          className="text-sm"
                        />
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {item.playerTeam}
                      </div>
                      {getActivityText(item)}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <div className="font-mono font-bold text-sm">
                      {item.price ? `$${item.price}` : "-"}
                    </div>
                    <div className="text-xs text-muted-foreground">{item.quantity} shares</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              )}
            />
            <Link href="/pools?tab=activity">
              <Button
                variant="outline"
                className="w-full"
                data-testid="button-view-market-activity"
              >
                View More Activity
              </Button>
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
