import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { useSport } from "@/lib/sport-context";
import { LivePriceTicker } from "@/components/ui/animated-price";

interface MarketActivity {
  id: string;
  activityType: "trade";
  price: string | null;
  currentPrice: string; // Enriched from backend - current AMM pool price
  playerId: string;
  playerFirstName: string;
  playerLastName: string;
  priceChange24h: string; // From enriched backend
}

export function MarketTicker() {
  const { sport } = useSport();

  const { data: activity } = useQuery<MarketActivity[]>({
    queryKey: ["/api/market/activity", sport],
    queryFn: async () => {
      const res = await fetch(`/api/market/activity?sport=${sport}&limit=30`); // Queue up last 30
      if (!res.ok) throw new Error("Failed to fetch market activity");
      return res.json();
    },
    staleTime: Infinity, // Keep data forever once fetched
  });

  if (!activity || activity.length === 0) return null;

  // Transform to ticker items
  const tickerItems = activity
    .map((item) => {
      const displayPrice = item.currentPrice ? parseFloat(item.currentPrice) : 0;
      return {
        symbol: `${item.playerFirstName?.charAt(0) || ""}. ${item.playerLastName || "Unknown"}`,
        price: displayPrice,
        change: parseFloat(item.priceChange24h || "0"), // Use 24h change
        link: `/player/${item.playerId}`,
      };
    })
    .filter((item) => item.price > 0);

  return (
    <div className="border-b bg-card/80 backdrop-blur-sm relative z-40">
      <div
        className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 w-8"
        style={{ background: "linear-gradient(to right, hsl(var(--card)), transparent)" }}
      />
      <div
        className="pointer-events-none absolute bottom-0 right-0 top-0 z-10 w-8"
        style={{ background: "linear-gradient(to left, hsl(var(--card)), transparent)" }}
      />

      <div className="h-10 flex items-center overflow-hidden bg-black/40 border-y border-white/5">
        <div className="flex items-center px-4 border-r border-white/10 h-full mr-2 z-20 bg-background/50 backdrop-blur shrink-0">
          <Activity className="w-4 h-4 text-primary mr-2" />
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Live Market
          </span>
        </div>
        <LivePriceTicker prices={tickerItems} className="flex-1" />
      </div>
    </div>
  );
}
