/**
 * AMM Trade Panel
 * 
 * Allows instant buying and selling of player shares using the
 * constant product Automated Market Maker (AMM) pools.
 * 
 * Features:
 * - Buy/Sell toggle
 * - Real-time price quotes
 * - Slippage warnings
 * - Instant trade execution
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowRightLeft, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle,
  CheckCircle2,
  Loader2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

interface AmmTradePanelProps {
  playerId: string;
  playerName: string;
  currentPrice: number | null;
  userBalance: number;
  userShares: number;
  onTradeSuccess?: () => void;
}

type TradeType = "buy" | "sell";

interface QuoteData {
  type: TradeType;
  sbIn?: number;
  sharesOut?: number;
  sharesIn?: number;
  sbOut?: number;
  effectivePrice: number;
  currentPrice: number;
  slippagePercent: number;
  newPoolPrice: number;
}

export function AmmTradePanel({
  playerId,
  playerName,
  currentPrice,
  userBalance,
  userShares,
  onTradeSuccess,
}: AmmTradePanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  
  const [tradeType, setTradeType] = useState<TradeType>("buy");
  const [amount, setAmount] = useState<string>("");
  const [maxSlippage, setMaxSlippage] = useState<number>(5); // 5% default
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);

  // Fetch pool data
  const { data: poolData } = useQuery({
    queryKey: ["/api/amm", playerId],
    queryFn: async () => {
      const res = await fetch(`/api/amm/${playerId}`);
      if (!res.ok) throw new Error("Failed to fetch pool data");
      return res.json();
    },
    enabled: !!playerId,
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Debounced quote fetch
  const fetchQuote = useCallback(async () => {
    if (!amount || parseFloat(amount) <= 0) {
      setQuote(null);
      return;
    }

    setIsLoadingQuote(true);
    try {
      const value = parseFloat(amount);
      const queryType = tradeType === "buy" ? "buy" : "sell";
      
      const res = await fetch(
        `/api/amm/${playerId}/quote?type=${queryType}&amount=${value}`
      );
      
      if (!res.ok) throw new Error("Failed to fetch quote");
      const data = await res.json();
      setQuote(data);
    } catch (error) {
      console.error("Error fetching quote:", error);
      setQuote(null);
    } finally {
      setIsLoadingQuote(false);
    }
  }, [amount, tradeType, playerId]);

  // Fetch quote when amount or trade type changes
  useEffect(() => {
    const timer = setTimeout(fetchQuote, 300); // Debounce 300ms
    return () => clearTimeout(timer);
  }, [fetchQuote]);

  // Execute buy mutation
  const buyMutation = useMutation({
    mutationFn: async (sbAmount: number) => {
      const res = await fetch(`/api/amm/${playerId}/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          sbAmount, 
          maxSlippage: maxSlippage / 100 
        }),
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to execute buy");
      }
      
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Purchase Successful!",
        description: `Bought ${data.sharesReceived.toFixed(2)} shares at $${data.pricePerShare.toFixed(2)}`,
      });
      
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["/api/amm", playerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
      
      setAmount("");
      setQuote(null);
      onTradeSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Purchase Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Execute sell mutation
  const sellMutation = useMutation({
    mutationFn: async (sharesAmount: number) => {
      const res = await fetch(`/api/amm/${playerId}/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          sharesAmount, 
          maxSlippage: maxSlippage / 100 
        }),
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to execute sell");
      }
      
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Sale Successful!",
        description: `Sold ${data.sharesSold} shares at $${data.pricePerShare.toFixed(2)}`,
      });
      
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["/api/amm", playerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
      
      setAmount("");
      setQuote(null);
      onTradeSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Sale Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleExecute = () => {
    if (!quote) return;
    
    if (tradeType === "buy") {
      const sbAmount = parseFloat(amount);
      if (sbAmount > userBalance) {
        toast({
          title: "Insufficient Balance",
          description: `You need $${sbAmount.toFixed(2)} but only have $${userBalance.toFixed(2)}`,
          variant: "destructive",
        });
        return;
      }
      buyMutation.mutate(sbAmount);
    } else {
      const sharesAmount = parseInt(amount);
      if (sharesAmount > userShares) {
        toast({
          title: "Insufficient Shares",
          description: `You want to sell ${sharesAmount} shares but only have ${userShares}`,
          variant: "destructive",
        });
        return;
      }
      sellMutation.mutate(sharesAmount);
    }
  };

  const isExecuting = buyMutation.isPending || sellMutation.isPending;
  const showHighSlippage = quote && quote.slippagePercent > 5;
  const showExtremeSlippage = quote && quote.slippagePercent > maxSlippage;

  if (!isAuthenticated) {
    return (
      <div className="p-4 border rounded-lg bg-muted/50 text-center">
        <p className="text-sm text-muted-foreground">
          Sign in to trade shares
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Trade Type Toggle */}
      <div className="flex gap-2">
        <Button
          variant={tradeType === "buy" ? "default" : "outline"}
          className="flex-1"
          onClick={() => {
            setTradeType("buy");
            setAmount("");
            setQuote(null);
          }}
        >
          <TrendingUp className="w-4 h-4 mr-2" />
          Buy
        </Button>
        <Button
          variant={tradeType === "sell" ? "default" : "outline"}
          className="flex-1"
          onClick={() => {
            setTradeType("sell");
            setAmount("");
            setQuote(null);
          }}
        >
          <TrendingDown className="w-4 h-4 mr-2" />
          Sell
        </Button>
      </div>

      {/* Amount Input */}
      <div className="space-y-2">
        <Label htmlFor="amount">
          {tradeType === "buy" ? "Amount to Spend (SB)" : "Shares to Sell"}
        </Label>
        <div className="flex gap-2">
          <Input
            id="amount"
            type="number"
            placeholder={tradeType === "buy" ? "100" : "10"}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min={tradeType === "buy" ? 1 : 1}
            step={tradeType === "buy" ? 0.01 : 1}
          />
          {tradeType === "buy" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAmount(userBalance.toFixed(2))}
            >
              Max
            </Button>
          )}
          {tradeType === "sell" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAmount(userShares.toString())}
            >
              Max
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {tradeType === "buy" 
            ? `Balance: $${userBalance.toFixed(2)}` 
            : `Shares owned: ${userShares}`}
        </p>
      </div>

      {/* Quote Display */}
      {quote && (
        <div className="p-3 border rounded-lg bg-accent/5 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Current Price:</span>
            <span>${quote.currentPrice.toFixed(2)}</span>
          </div>
          
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {tradeType === "buy" ? "Shares Received:" : "SB Received:"}
            </span>
            <span className="font-medium">
              {tradeType === "buy" 
                ? quote.sharesOut?.toFixed(4) 
                : `$${quote.sbOut?.toFixed(2)}`}
            </span>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Effective Price:</span>
            <span>${quote.effectivePrice.toFixed(2)}</span>
          </div>

          <div className="flex justify-between text-sm items-center">
            <span className="text-muted-foreground">Slippage:</span>
            <Badge 
              variant={quote.slippagePercent > 5 ? "destructive" : "secondary"}
              className="text-xs"
            >
              {quote.slippagePercent.toFixed(2)}%
            </Badge>
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">New Pool Price:</span>
            <span>${quote.newPoolPrice.toFixed(2)}</span>
          </div>

          {showHighSlippage && (
            <div className="flex items-center gap-2 text-xs text-amber-600 mt-2">
              <AlertTriangle className="w-4 h-4" />
              <span>High slippage warning - large trade relative to pool size</span>
            </div>
          )}

          {showExtremeSlippage && (
            <div className="flex items-center gap-2 text-xs text-destructive mt-2">
              <AlertTriangle className="w-4 h-4" />
              <span>Slippage exceeds max allowed ({maxSlippage}%)</span>
            </div>
          )}
        </div>
      )}

      {/* Max Slippage Setting */}
      <div className="space-y-2">
        <Label htmlFor="maxSlippage">Max Slippage (%)</Label>
        <Input
          id="maxSlippage"
          type="number"
          value={maxSlippage}
          onChange={(e) => setMaxSlippage(parseFloat(e.target.value) || 5)}
          min={0.1}
          max={50}
          step={0.5}
        />
      </div>

      {/* Execute Button */}
      <Button
        className="w-full"
        size="lg"
        disabled={
          !quote || 
          isExecuting || 
          isLoadingQuote || 
          showExtremeSlippage ||
          (tradeType === "buy" && parseFloat(amount) > userBalance) ||
          (tradeType === "sell" && parseInt(amount) > userShares)
        }
        onClick={handleExecute}
      >
        {isExecuting ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Executing...
          </>
        ) : (
          <>
            <ArrowRightLeft className="w-4 h-4 mr-2" />
            {tradeType === "buy" ? "Buy Shares" : "Sell Shares"}
          </>
        )}
      </Button>

      {/* Pool Info */}
      {poolData && (
        <div className="pt-4 border-t text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between">
            <span>Pool Shares:</span>
            <span>{parseFloat(poolData.shares).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Pool Liquidity:</span>
            <span>${parseFloat(poolData.playMoney).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Total Trades:</span>
            <span>{poolData.totalTrades.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}
