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

import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { TrendingUp, TrendingDown, Loader2, Flame, Droplets, LogIn } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { formatAdaptiveCurrency } from "@/lib/currency";
import { apiRequest, authenticatedFetch } from "@/lib/queryClient";
import { hapticSuccess, hapticError, hapticMedium } from "@/lib/haptics";
import { Link } from "wouter";

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

interface PoolSnapshot {
  poolInitialized?: boolean;
  shares?: number;
  playMoney?: number;
}

// Fee constants
const BURN_FEE_PERCENT = 1; // 1% burned
const LP_FEE_PERCENT = 1; // 1% to LPs
const TOTAL_FEE_PERCENT = BURN_FEE_PERCENT + LP_FEE_PERCENT; // 2% total
const SLIPPAGE_SAFETY_BUFFER_PERCENT = 0.05;

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
  const [lastTradeResult, setLastTradeResult] = useState<{
    type: TradeType;
    description: string;
  } | null>(null);

  // Fetch pool data
  const { data: poolData } = useQuery<PoolSnapshot>({
    queryKey: ["/api/amm", playerId],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/amm/${playerId}`);
      if (!res.ok) throw new Error("Failed to fetch pool data");
      return res.json();
    },
    enabled: !!playerId,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
  const isPoolInitialized = poolData?.poolInitialized !== false;

  const maxBuyAmountBySlippage = useMemo(() => {
    if (!isPoolInitialized) return 0;
    if (tradeType !== "buy") return userBalance;

    const poolShares = Number(poolData?.shares ?? 0);
    const poolPlayMoney = Number(poolData?.playMoney ?? 0);

    if (!poolShares || !poolPlayMoney || poolShares <= 0 || poolPlayMoney <= 0) {
      return userBalance;
    }

    const currentPrice = poolPlayMoney / poolShares;
    if (!currentPrice || !isFinite(currentPrice)) {
      return userBalance;
    }

    const slippageLimitPercent = Math.max(0, maxSlippage - SLIPPAGE_SAFETY_BUFFER_PERCENT);

    const calculateBuySlippagePercent = (sbAmount: number): number => {
      if (sbAmount <= 0) return 0;

      const k = poolShares * poolPlayMoney;
      const poolReceives = sbAmount * (1 + LP_FEE_PERCENT / 100);
      const totalCost = sbAmount * (1 + TOTAL_FEE_PERCENT / 100);
      const newPlayMoney = poolPlayMoney + poolReceives;
      const newShares = k / newPlayMoney;
      const sharesOut = poolShares - newShares;

      if (sharesOut <= 0 || !isFinite(sharesOut)) {
        return Number.POSITIVE_INFINITY;
      }

      const effectivePrice = totalCost / sharesOut;
      if (!isFinite(effectivePrice)) {
        return Number.POSITIVE_INFINITY;
      }

      return ((effectivePrice - currentPrice) / currentPrice) * 100;
    };

    if (calculateBuySlippagePercent(0.01) > slippageLimitPercent) {
      return 0;
    }

    if (calculateBuySlippagePercent(userBalance) <= slippageLimitPercent) {
      return userBalance;
    }

    let low = 0;
    let high = userBalance;

    for (let i = 0; i < 28; i += 1) {
      const mid = (low + high) / 2;
      const slippagePercent = calculateBuySlippagePercent(mid);

      if (slippagePercent <= slippageLimitPercent) {
        low = mid;
      } else {
        high = mid;
      }
    }

    return low;
  }, [tradeType, userBalance, poolData, maxSlippage, isPoolInitialized]);

  // Calculate max amount based on trade type and current slippage constraint
  const maxAmount = isPoolInitialized
    ? tradeType === "buy"
      ? Math.min(userBalance, maxBuyAmountBySlippage)
      : userShares
    : 0;

  const amountFromSliderPercentage = useCallback(
    (percentage: number) => {
      const rawAmount = (maxAmount * percentage) / 100;
      if (tradeType === "buy") {
        return rawAmount.toFixed(2);
      }
      return Math.floor(rawAmount).toString();
    },
    [maxAmount, tradeType],
  );

  // Handle slider change
  const handleSliderChange = useCallback(
    (value: number[]) => {
      const percentage = value[0];
      setSliderValue(percentage);

      if (maxAmount > 0) {
        setAmount(amountFromSliderPercentage(percentage));
      }
    },
    [maxAmount, amountFromSliderPercentage],
  );

  // Handle quick select buttons
  const handleQuickSelect = useCallback(
    (percentage: number) => {
      setSliderValue(percentage);

      if (maxAmount > 0) {
        setAmount(amountFromSliderPercentage(percentage));
      }
    },
    [maxAmount, amountFromSliderPercentage],
  );

  // Handle manual input change
  const handleManualInputChange = useCallback(
    (value: string) => {
      // For selling shares, ensure whole numbers
      if (tradeType === "sell") {
        const intValue = Math.floor(parseFloat(value || "0"));
        setAmount(intValue.toString());
      } else {
        setAmount(value);
      }

      // Update slider to match manual input
      const numValue = parseFloat(value || "0");
      if (!isNaN(numValue) && maxAmount > 0) {
        const clampedValue = Math.min(numValue, maxAmount);
        const percentage = Math.min((clampedValue / maxAmount) * 100, 100);
        setSliderValue(percentage);
      } else {
        setSliderValue(0);
      }
    },
    [maxAmount, tradeType],
  );

  // Debounced quote fetch
  const fetchQuote = useCallback(async () => {
    if (!isPoolInitialized) {
      setQuote(null);
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setQuote(null);
      return;
    }

    setIsLoadingQuote(true);
    try {
      const value = parseFloat(amount);
      const queryType = tradeType === "buy" ? "buy" : "sell";

      const res = await authenticatedFetch(
        `/api/amm/${playerId}/quote?type=${queryType}&amount=${value}`,
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
      if (
        error instanceof Error &&
        !error.message.toLowerCase().includes("pool not initialized") &&
        error.message !== "Failed to fetch quote"
      ) {
        toast({
          title: "Quote Error",
          description: error.message,
          variant: "destructive",
        });
      }
    } finally {
      setIsLoadingQuote(false);
    }
  }, [amount, tradeType, playerId, toast, isPoolInitialized]);

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
    setLastTradeResult(null);
  }, [tradeType]);

  useEffect(() => {
    const amountValue = parseFloat(amount || "0");
    if (!amount || !isFinite(amountValue) || amountValue <= maxAmount) {
      return;
    }

    const clampedPercentage = maxAmount > 0 ? 100 : 0;
    setSliderValue(clampedPercentage);
    setAmount(amountFromSliderPercentage(clampedPercentage));
  }, [amount, maxAmount, amountFromSliderPercentage]);

  // Execute buy mutation
  const buyMutation = useMutation({
    mutationFn: async (sbAmount: number) => {
      const res = await apiRequest("POST", `/api/amm/${playerId}/buy`, {
        sbAmount,
        maxSlippage: maxSlippage / 100,
      });
      return res.json();
    },
    onMutate: async (sbAmount: number) => {
      // Cancel any in-flight refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ["/api/user"] });
      await queryClient.cancelQueries({ queryKey: ["/api/holdings"] });

      // Snapshot the current cache values for rollback
      const previousUser = queryClient.getQueryData<{ balance?: number }>(["/api/user"]);
      const previousHoldings = queryClient.getQueryData(["/api/holdings"]);

      // Optimistically deduct balance (approximate — server confirms exact shares received)
      if (previousUser?.balance !== undefined) {
        queryClient.setQueryData(["/api/user"], {
          ...previousUser,
          balance: Math.max(0, previousUser.balance - sbAmount),
        });
      }

      return { previousUser, previousHoldings };
    },
    onSuccess: (data) => {
      void hapticSuccess();
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
      setLastTradeResult({
        type: "buy",
        description: `Bought ${data.sharesReceived.toFixed(2)} shares @ $${data.pricePerShare.toFixed(2)}/share`,
      });
      setTimeout(() => setLastTradeResult(null), 6000);
    },
    onError: (error: Error, _sbAmount, context) => {
      // Roll back to the pre-mutation snapshots
      if (context?.previousUser !== undefined) {
        queryClient.setQueryData(["/api/user"], context.previousUser);
      }
      if (context?.previousHoldings !== undefined) {
        queryClient.setQueryData(["/api/holdings"], context.previousHoldings);
      }

      void hapticError();
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
    onMutate: async (sharesAmount: number) => {
      // Cancel any in-flight refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ["/api/user"] });
      await queryClient.cancelQueries({ queryKey: ["/api/holdings"] });

      // Snapshot the current cache values for rollback
      const previousUser = queryClient.getQueryData(["/api/user"]);
      const previousHoldings = queryClient.getQueryData(["/api/holdings"]);

      // Optimistically deduct shares (approximate — server confirms exact SB received)
      if (quote?.effectivePrice !== undefined) {
        const currentUser = queryClient.getQueryData<{ balance?: number }>(["/api/user"]);
        if (currentUser?.balance !== undefined) {
          queryClient.setQueryData(["/api/user"], {
            ...currentUser,
            balance: currentUser.balance + sharesAmount * quote.effectivePrice,
          });
        }
      }

      return { previousUser, previousHoldings };
    },
    onSuccess: (data) => {
      void hapticSuccess();
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
      setLastTradeResult({
        type: "sell",
        description: `Sold ${data.sharesSold} shares @ $${data.pricePerShare.toFixed(2)}/share`,
      });
      setTimeout(() => setLastTradeResult(null), 6000);
    },
    onError: (error: Error, _sharesAmount, context) => {
      // Roll back to the pre-mutation snapshots
      if (context?.previousUser !== undefined) {
        queryClient.setQueryData(["/api/user"], context.previousUser);
      }
      if (context?.previousHoldings !== undefined) {
        queryClient.setQueryData(["/api/holdings"], context.previousHoldings);
      }

      void hapticError();
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
        void hapticError();
        toast({
          title: "Insufficient Balance",
          description: `You need $${sbAmount.toFixed(2)} but only have $${userBalance.toFixed(2)}`,
          variant: "destructive",
        });
        return;
      }
      void hapticMedium();
      buyMutation.mutate(sbAmount);
    } else {
      const sharesAmount = parseFloat(amount);
      if (sharesAmount > userShares) {
        void hapticError();
        toast({
          title: "Insufficient Shares",
          description: `You want to sell ${sharesAmount} shares but only have ${userShares}`,
          variant: "destructive",
        });
        return;
      }
      void hapticMedium();
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
      <div className="p-4 border rounded-sm bg-muted/40 text-center space-y-3">
        <p className="text-sm text-muted-foreground">Sign in to trade shares</p>
        <Button variant="default" size="sm" asChild>
          <Link href="/login" className="flex items-center gap-2">
            <LogIn className="w-3.5 h-3.5" />
            Sign In
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!isPoolInitialized && (
        <div className="p-3 border rounded-sm bg-muted/40 text-sm text-muted-foreground">
          Pool not initialized yet. Add initial two-sided liquidity to start trading.
        </div>
      )}

      {/* Trade Type Toggle */}
      <div className="flex gap-2">
        <Button
          variant={tradeType === "buy" ? "default" : "outline"}
          className="flex-1"
          onClick={() => setTradeType("buy")}
          disabled={!isPoolInitialized}
        >
          <TrendingUp className="w-4 h-4 mr-2" />
          Buy
        </Button>
        <Button
          variant={tradeType === "sell" ? "default" : "outline"}
          className="flex-1"
          onClick={() => setTradeType("sell")}
          disabled={!isPoolInitialized}
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
              : `Owned: ${Math.floor(userShares)} shares`}
          </span>
        </div>

        {/* Slider */}
        <div className="space-y-2">
          <Slider
            value={[sliderValue]}
            onValueChange={handleSliderChange}
            max={100}
            step={1}
            className="w-full"
            disabled={!isPoolInitialized}
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
              disabled={!isPoolInitialized}
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
            Amount:
          </Label>
          <Input
            id="manual-amount"
            type="number"
            inputMode={tradeType === "buy" ? "decimal" : "numeric"}
            placeholder={tradeType === "buy" ? "100" : "10"}
            value={amount}
            onChange={(e) => handleManualInputChange(e.target.value)}
            min={tradeType === "buy" ? 0.01 : 1}
            step={tradeType === "buy" ? 0.01 : 1}
            className="flex-1"
            disabled={!isPoolInitialized}
          />
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {tradeType === "buy" ? "SB" : "shares"}
          </span>
        </div>
        {amount &&
          parseFloat(amount) > 0 &&
          tradeType === "buy" &&
          parseFloat(amount) > userBalance && (
            <p className="text-xs text-destructive">
              Exceeds your balance (${userBalance.toFixed(2)} available)
            </p>
          )}
        {amount &&
          parseFloat(amount) > 0 &&
          tradeType === "sell" &&
          parseFloat(amount) > userShares && (
            <p className="text-xs text-destructive">
              Exceeds your {Math.floor(userShares)} available shares
            </p>
          )}
      </div>

      {/* Quote Loading Indicator */}
      {isLoadingQuote && !quote && parseFloat(amount) > 0 && (
        <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          Fetching quote...
        </div>
      )}

      {/* Quote Display */}
      {quote && (
        <div className="p-4 border rounded-sm bg-accent/5 space-y-4">
          {/* Primary Trade Info */}
          <div className="text-center pb-3 border-b border-border/50">
            <div className="text-3xl font-bold text-foreground">
              {tradeType === "buy"
                ? Math.floor(quote.sharesOut || 0).toLocaleString()
                : `$${quote.sbOut?.toFixed(2)}`}
            </div>
            <div className="text-sm text-muted-foreground">
              {tradeType === "buy" ? "Shares You'll Receive" : "SportsBucks You'll Receive"}
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
                    {poolData.playMoney == null
                      ? "N/A"
                      : formatAdaptiveCurrency(poolData.playMoney)}
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
        <div className="space-y-2 p-3 border rounded-sm bg-muted/30">
          <Label htmlFor="maxSlippage" className="text-sm">
            Max Slippage Tolerance (%)
          </Label>
          <Input
            id="maxSlippage"
            type="number"
            inputMode="decimal"
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
          !isPoolInitialized ||
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
            {tradeType === "buy" ? (
              <TrendingUp className="w-4 h-4 mr-2" />
            ) : (
              <TrendingDown className="w-4 h-4 mr-2" />
            )}
            {tradeType === "buy" ? "Buy Shares" : "Sell Shares"}
          </>
        )}
      </Button>

      {/* Inline trade confirmation */}
      {lastTradeResult && (
        <div className="p-3 rounded-sm text-sm border border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400">
          {lastTradeResult.description}
        </div>
      )}
    </div>
  );
}
