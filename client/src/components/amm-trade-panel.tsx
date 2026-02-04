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
  initialTradeType?: "buy" | "sell";
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
  initialTradeType,
}: AmmTradePanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();

  const [tradeType, setTradeType] = useState<TradeType>(initialTradeType || "buy");
  const [amount, setAmount] = useState<string>("");
  const [maxSlippage, setMaxSlippage] = useState<number>(2); // 2% default - more reasonable for most trades
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
    refetchIntervalInBackground: false, // Don't poll when tab is inactive
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

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Failed to fetch quote" }));
        throw new Error(errorData.error || "Failed to fetch quote");
      }
      const data = await res.json();
      setQuote(data);
    } catch (error) {
      console.error("Error fetching quote:", error);
      setQuote(null);
      // Only show error toast if it's not a network cancellation
      if (error instanceof Error && error.message !== "Failed to fetch quote") {
        toast({
          title: "Quote Error",
          description: error.message,
          variant: "destructive",
        });
      }
    } finally {
      setIsLoadingQuote(false);
    }
  }, [amount, tradeType, playerId, toast]);

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
      const sharesAmount = parseFloat(amount);
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
            step={tradeType === "buy" ? 0.01 : 0.0001}
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
        <div className="p-4 border rounded-lg bg-accent/5 space-y-3">
          {/* Primary Trade Info */}
          <div className="text-center pb-3 border-b border-border/50">
            <div className="text-3xl font-bold text-foreground">
              {tradeType === "buy"
                ? quote.sharesOut?.toFixed(4)
                : `$${quote.sbOut?.toFixed(2)}`}
            </div>
            <div className="text-sm text-muted-foreground">
              {tradeType === "buy" ? "Shares You'll Receive" : "SB You'll Receive"}
            </div>
          </div>

          {/* Slippage Indicator - PROMINENT */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Price Impact</span>
              <div className="flex items-center gap-2">
                <Badge
                  variant={quote.slippagePercent > 5 ? "destructive" : quote.slippagePercent > 1 ? "outline" : "default"}
                  className={`text-xs ${quote.slippagePercent > 5 ? '' : quote.slippagePercent > 1 ? 'border-amber-500 text-amber-600' : 'bg-green-100 text-green-700'}`}
                >
                  {quote.slippagePercent.toFixed(2)}%
                </Badge>
                {quote.slippagePercent > maxSlippage && (
                  <span className="text-xs text-destructive font-medium">EXCEEDS LIMIT</span>
                )}
              </div>
            </div>

            {/* Visual Slippage Bar */}
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className={`h-full transition-all ${quote.slippagePercent > 5
                    ? 'bg-destructive'
                    : quote.slippagePercent > 1
                      ? 'bg-amber-500'
                      : 'bg-green-500'
                  }`}
                style={{ width: `${Math.min(quote.slippagePercent * 5, 100)}%` }}
              />
            </div>

            {/* Slippage Context */}
            <div className="text-xs text-muted-foreground flex justify-between">
              <span>0%</span>
              <span>Acceptable: &lt;1%</span>
              <span>High: &gt;5%</span>
            </div>
          </div>

          {/* Pool Context */}
          {poolData && (
            <div className="pt-2 border-t border-border/50">
              <div className="text-xs text-muted-foreground mb-1">Pool Liquidity</div>
              <div className="flex gap-2 text-xs">
                <div className="bg-muted px-2 py-1 rounded flex-1 text-center">
                  <span className="font-medium">{poolData.shares?.toLocaleString() || 'N/A'}</span>
                  <div className="text-muted-foreground">Shares</div>
                </div>
                <div className="bg-muted px-2 py-1 rounded flex-1 text-center">
                  <span className="font-medium">${poolData.playMoney?.toLocaleString() || 'N/A'}</span>
                  <div className="text-muted-foreground">Liquidity</div>
                </div>
                <div className="bg-muted px-2 py-1 rounded flex-1 text-center">
                  <span className="font-medium">{poolData.totalTrades?.toLocaleString() || '0'}</span>
                  <div className="text-muted-foreground">Trades</div>
                </div>
              </div>
            </div>
          )}

          {/* Detailed Breakdown */}
          <div className="space-y-1.5 pt-2 border-t border-border/50">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Current Market Price:</span>
              <span>${quote.currentPrice.toFixed(2)}/share</span>
            </div>

            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Your Effective Price:</span>
              <span className={quote.slippagePercent > 1 ? 'text-amber-600' : ''}>
                ${quote.effectivePrice.toFixed(2)}/share
              </span>
            </div>

            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Price After Trade:</span>
              <span>${quote.newPoolPrice.toFixed(2)}/share</span>
            </div>
          </div>

          {/* Warnings */}
          {quote.slippagePercent > 1 && quote.slippagePercent <= 5 && (
            <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50 p-2 rounded">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Your trade will move the price by {quote.slippagePercent.toFixed(2)}%. Consider a smaller trade for better pricing.</span>
            </div>
          )}

          {quote.slippagePercent > 5 && (
            <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 p-2 rounded">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                <strong>High price impact warning!</strong> This trade will move the price significantly ({quote.slippagePercent.toFixed(2)}%).
                Consider reducing trade size or splitting into smaller trades.
              </span>
            </div>
          )}

          {quote.slippagePercent > maxSlippage && (
            <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 p-2 rounded">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                Trade blocked: Slippage ({quote.slippagePercent.toFixed(2)}%) exceeds your maximum allowed ({maxSlippage}%).
                Increase your slippage tolerance or reduce trade size.
              </span>
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
          (tradeType === "sell" && parseFloat(amount) > userShares)
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
