/**
 * AMM Trade Panel
 *
 * Allows instant buying and selling of player shares using the
 * constant product Automated Market Maker (AMM) pools.
 *
 * Features:
 * - Buy/Sell toggle
 * - Real-time price quotes
 * - Slider-based amount input with quick select buttons
 * - Fee breakdown display
 * - Mobile-optimized interface
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ArrowRightLeft, TrendingUp, TrendingDown, Loader2, Flame, Droplets } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";

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

// Fee constants
const BURN_FEE_PERCENT = 1; // 1% burned
const LP_FEE_PERCENT = 1; // 1% to LPs
const TOTAL_FEE_PERCENT = BURN_FEE_PERCENT + LP_FEE_PERCENT; // 2% total

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
  const [sliderValue, setSliderValue] = useState<number>(0);
  const [maxSlippage, setMaxSlippage] = useState<number>(10); // 10% default - generous
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);

  // Calculate max amount based on trade type
  const maxAmount = tradeType === "buy" ? userBalance : userShares;

  // Fetch pool data
  const { data: poolData } = useQuery({
    queryKey: ["/api/amm", playerId],
    queryFn: async () => {
      const res = await fetch(`/api/amm/${playerId}`);
      if (!res.ok) throw new Error("Failed to fetch pool data");
      return res.json();
    },
    enabled: !!playerId,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  // Handle slider change
  const handleSliderChange = useCallback(
    (value: number[]) => {
      const percentage = value[0];
      setSliderValue(percentage);

      if (maxAmount > 0) {
        const newAmount = (maxAmount * percentage) / 100;
        // Format based on trade type
        if (tradeType === "buy") {
          setAmount(newAmount.toFixed(2));
        } else {
          setAmount(newAmount.toFixed(4));
        }
      }
    },
    [maxAmount, tradeType],
  );

  // Handle quick select buttons
  const handleQuickSelect = useCallback(
    (percentage: number) => {
      setSliderValue(percentage);

      if (maxAmount > 0) {
        const newAmount = (maxAmount * percentage) / 100;
        if (tradeType === "buy") {
          setAmount(newAmount.toFixed(2));
        } else {
          setAmount(newAmount.toFixed(4));
        }
      }
    },
    [maxAmount, tradeType],
  );

  // Handle manual input change
  const handleManualInputChange = useCallback(
    (value: string) => {
      setAmount(value);

      // Update slider to match manual input
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && maxAmount > 0) {
        const percentage = Math.min((numValue / maxAmount) * 100, 100);
        setSliderValue(percentage);
      } else {
        setSliderValue(0);
      }
    },
    [maxAmount],
  );

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

      const res = await fetch(`/api/amm/${playerId}/quote?type=${queryType}&amount=${value}`);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Failed to fetch quote" }));
        throw new Error(errorData.error || "Failed to fetch quote");
      }
      const data = await res.json();
      setQuote(data);
    } catch (error) {
      console.error("Error fetching quote:", error);
      setQuote(null);
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
    const timer = setTimeout(fetchQuote, 300);
    return () => clearTimeout(timer);
  }, [fetchQuote]);

  // Reset amount when trade type changes
  useEffect(() => {
    setAmount("");
    setSliderValue(0);
    setQuote(null);
  }, [tradeType]);

  // Execute buy mutation
  const buyMutation = useMutation({
    mutationFn: async (sbAmount: number) => {
      const res = await apiRequest("POST", `/api/amm/${playerId}/buy`, {
        sbAmount,
        maxSlippage: maxSlippage / 100,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Purchase Successful!",
        description: `Bought ${data.sharesReceived.toFixed(2)} shares at $${data.pricePerShare.toFixed(2)}`,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/amm", playerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });

      setAmount("");
      setSliderValue(0);
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
      const res = await apiRequest("POST", `/api/amm/${playerId}/sell`, {
        sharesAmount,
        maxSlippage: maxSlippage / 100,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Sale Successful!",
        description: `Sold ${data.sharesSold} shares at $${data.pricePerShare.toFixed(2)}`,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/amm", playerId] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });

      setAmount("");
      setSliderValue(0);
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

  // Calculate fee amounts
  const calculateFees = () => {
    if (!amount || parseFloat(amount) <= 0) return null;

    const amountNum = parseFloat(amount);
    const burnFee = amountNum * (BURN_FEE_PERCENT / 100);
    const lpFee = amountNum * (LP_FEE_PERCENT / 100);

    return {
      burnFee,
      lpFee,
      totalFee: burnFee + lpFee,
      netAmount: amountNum - burnFee - lpFee,
    };
  };

  const fees = calculateFees();

  if (!isAuthenticated) {
    return (
      <div className="p-4 border rounded-lg bg-muted/50 text-center">
        <p className="text-sm text-muted-foreground">Sign in to trade shares</p>
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
          onClick={() => setTradeType("buy")}
        >
          <TrendingUp className="w-4 h-4 mr-2" />
          Buy
        </Button>
        <Button
          variant={tradeType === "sell" ? "default" : "outline"}
          className="flex-1"
          onClick={() => setTradeType("sell")}
        >
          <TrendingDown className="w-4 h-4 mr-2" />
          Sell
        </Button>
      </div>

      {/* Amount Selection */}
      <div className="space-y-4">
        {/* Label with balance */}
        <div className="flex justify-between items-center">
          <Label>{tradeType === "buy" ? "Amount to Spend" : "Shares to Sell"}</Label>
          <span className="text-xs text-muted-foreground">
            {tradeType === "buy"
              ? `Balance: $${userBalance.toFixed(2)}`
              : `Owned: ${userShares.toFixed(4)} shares`}
          </span>
        </div>

        {/* Slider */}
        <div className="space-y-2">
          <Slider
            value={[sliderValue]}
            onValueChange={handleSliderChange}
            max={100}
            step={0.1}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span className="font-medium">{sliderValue.toFixed(1)}%</span>
            <span>100%</span>
          </div>
        </div>

        {/* Quick Select Buttons */}
        <div className="grid grid-cols-4 gap-2">
          {[25, 50, 75, 100].map((percent) => (
            <Button
              key={percent}
              variant="outline"
              size="sm"
              onClick={() => handleQuickSelect(percent)}
              className="text-xs"
            >
              {percent === 100 ? "Max" : `${percent}%`}
            </Button>
          ))}
        </div>

        {/* Manual Input */}
        <div className="flex items-center gap-3">
          <Label
            htmlFor="manual-amount"
            className="text-sm text-muted-foreground whitespace-nowrap"
          >
            Manual:
          </Label>
          <Input
            id="manual-amount"
            type="number"
            placeholder={tradeType === "buy" ? "100" : "10"}
            value={amount}
            onChange={(e) => handleManualInputChange(e.target.value)}
            min={0.01}
            step={tradeType === "buy" ? 0.01 : 0.0001}
            className="flex-1"
          />
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {tradeType === "buy" ? "SB" : "shares"}
          </span>
        </div>
      </div>

      {/* Quote Display */}
      {quote && (
        <div className="p-4 border rounded-lg bg-accent/5 space-y-4">
          {/* Primary Trade Info */}
          <div className="text-center pb-3 border-b border-border/50">
            <div className="text-3xl font-bold text-foreground">
              {tradeType === "buy" ? quote.sharesOut?.toFixed(4) : `$${quote.sbOut?.toFixed(2)}`}
            </div>
            <div className="text-sm text-muted-foreground">
              {tradeType === "buy" ? "Shares You'll Receive" : "SB You'll Receive"}
            </div>
          </div>

          {/* Fee Breakdown */}
          {fees && (
            <div className="space-y-2 pt-2 border-t border-border/50">
              <div className="text-xs font-medium text-muted-foreground mb-2">Fee Breakdown</div>

              <div className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-orange-500" />
                  <span>Burn Fee ({BURN_FEE_PERCENT}%)</span>
                </div>
                <span className="text-muted-foreground">
                  {tradeType === "buy"
                    ? `$${fees.burnFee.toFixed(2)}`
                    : `${(fees.burnFee / quote.effectivePrice).toFixed(4)} shares`}
                </span>
              </div>

              <div className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2">
                  <Droplets className="w-4 h-4 text-blue-500" />
                  <span>LP Fee ({LP_FEE_PERCENT}%)</span>
                </div>
                <span className="text-muted-foreground">
                  {tradeType === "buy"
                    ? `$${fees.lpFee.toFixed(2)}`
                    : `${(fees.lpFee / quote.effectivePrice).toFixed(4)} shares`}
                </span>
              </div>

              <div className="flex justify-between items-center text-sm font-medium pt-1 border-t border-dashed">
                <span>Total Fees ({TOTAL_FEE_PERCENT}%)</span>
                <span>
                  {tradeType === "buy"
                    ? `$${fees.totalFee.toFixed(2)}`
                    : `${(fees.totalFee / quote.effectivePrice).toFixed(4)} shares`}
                </span>
              </div>
            </div>
          )}

          {/* Pool Context */}
          {poolData && (
            <div className="pt-2 border-t border-border/50">
              <div className="text-xs text-muted-foreground mb-1">Pool Liquidity</div>
              <div className="flex gap-2 text-xs">
                <div className="bg-muted px-2 py-1 rounded flex-1 text-center">
                  <span className="font-medium">{poolData.shares?.toLocaleString() || "N/A"}</span>
                  <div className="text-muted-foreground">Shares</div>
                </div>
                <div className="bg-muted px-2 py-1 rounded flex-1 text-center">
                  <span className="font-medium">
                    ${poolData.playMoney?.toLocaleString() || "N/A"}
                  </span>
                  <div className="text-muted-foreground">Liquidity</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Advanced Settings Toggle */}
      <div className="pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-muted-foreground"
        >
          {showAdvanced ? "Hide Advanced" : "Show Advanced"}
        </Button>
      </div>

      {/* Advanced Settings */}
      {showAdvanced && (
        <div className="space-y-2 p-3 border rounded-lg bg-muted/30">
          <Label htmlFor="maxSlippage" className="text-sm">
            Max Slippage Tolerance (%)
          </Label>
          <Input
            id="maxSlippage"
            type="number"
            value={maxSlippage}
            onChange={(e) => {
              const value = parseFloat(e.target.value);
              if (!isNaN(value) && value >= 0.1 && value <= 50) {
                setMaxSlippage(value);
              }
            }}
            min={0.1}
            max={50}
            step={0.1}
            className="text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Trades will fail if price moves more than this percentage. Default: 10%
          </p>
        </div>
      )}

      {/* Execute Button */}
      <Button
        className="w-full"
        size="lg"
        disabled={
          !quote ||
          isExecuting ||
          isLoadingQuote ||
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
    </div>
  );
}
