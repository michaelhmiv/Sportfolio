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
import {
  ArrowRightLeft,
  TrendingUp,
  TrendingDown,
  Loader2,
  Flame,
  Droplets,
  CheckCircle2,
  AlertCircle,
  TriangleAlert,
  X,
} from "lucide-react";
import { ShareCounter, MoneyCounter } from "@/components/ui/animated-counter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { formatAdaptiveCurrency } from "@/lib/currency";
import { apiRequest } from "@/lib/queryClient";
import { hapticSuccess, hapticError, hapticMedium } from "@/lib/haptics";
import { cn } from "@/lib/utils";

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
/** Net factor applied to gross SB output after LP + burn fees (1 − 0.01 − 0.01). */
const SELLER_NET_FACTOR = 0.98;

/**
 * Closed-form inverse of the AMM sell formula.
 * Returns the raw (un-ceiled) shares needed to receive `targetSB` after fees.
 * Formula: sharesNeeded = k / (playMoney − targetSB / SELLER_NET_FACTOR) − poolShares
 */
function deriveSellShares(targetSB: number, poolShares: number, poolPlayMoney: number): number {
  const k = poolShares * poolPlayMoney;
  const denominator = poolPlayMoney - targetSB / SELLER_NET_FACTOR;
  if (denominator <= 0) return Infinity;
  return Math.max(0, k / denominator - poolShares);
}

/**
 * Maps a raw server/network error to a short, human-readable inline message.
 * Prefers the structured `code` field from JSON error responses (FU1);
 * falls back to substring matching for legacy/network errors.
 */
function classifyTradeError(error: Error): string {
  // throwIfResNotOk wraps errors as "STATUS: bodyText"
  const colonIdx = error.message.indexOf(": ");
  if (colonIdx !== -1) {
    const body = error.message.slice(colonIdx + 2);
    try {
      const parsed = JSON.parse(body) as { code?: string };
      if (parsed.code) {
        switch (parsed.code) {
          case "INSUFFICIENT_BALANCE":
            return "Insufficient balance to complete this trade.";
          case "SLIPPAGE_EXCEEDED":
            return "Slippage tolerance exceeded. Try a smaller amount or raise the limit in Advanced settings.";
          case "INSUFFICIENT_SHARES":
            return "Insufficient available shares.";
          case "SHARES_LOCKED":
            return "These shares are locked and cannot be traded.";
          case "POOL_NOT_INITIALIZED":
            return "Pool not initialized. Add liquidity first.";
          case "INVALID_INPUT":
            return "Invalid trade input. Please check the amount and try again.";
        }
      }
    } catch {
      // Not JSON — fall through to substring matching
    }
  }
  // Fallback: substring matching on the full message
  const msg = error.message.toLowerCase();
  if (msg.includes("insufficient balance") || msg.includes("available balance")) {
    return "Insufficient balance to complete this trade.";
  }
  if (msg.includes("slippage")) {
    return "Slippage tolerance exceeded. Try a smaller amount or raise the limit in Advanced settings.";
  }
  if ((msg.includes("insufficient") || msg.includes("available")) && msg.includes("shares")) {
    return "Insufficient available shares. Some may be locked.";
  }
  if (msg.includes("locked")) {
    return "These shares are locked and cannot be traded.";
  }
  return "Trade failed. Please try again.";
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
  const [sliderValue, setSliderValue] = useState<number>(0);
  const [maxSlippage, setMaxSlippage] = useState<number>(10); // 10% default - generous
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [tradeResult, setTradeResult] = useState<{
    type: TradeType;
    shares: number;
    sbAmount: number;
  } | null>(null);
  /** FU2: whether the sell input is in "shares" or "sb" (target SB to receive) mode. */
  const [sellInputMode, setSellInputMode] = useState<"shares" | "sb">("shares");

  // Fetch pool data
  const { data: poolData } = useQuery<PoolSnapshot>({
    queryKey: ["/api/amm", playerId],
    queryFn: async () => {
      const res = await fetch(`/api/amm/${playerId}`, { credentials: "include" });
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

  /**
   * FU2: Maximum SB a user can receive by selling all their shares.
   * Used as the slider ceiling when sellInputMode === "sb".
   */
  const maxSBFromSelling = useMemo(() => {
    if (!isPoolInitialized || tradeType !== "sell") return 0;
    if (!userShares || userShares <= 0) return 0;
    const poolShares = Number(poolData?.shares ?? 0);
    const poolPlayMoney = Number(poolData?.playMoney ?? 0);
    if (!poolShares || !poolPlayMoney) return 0;
    const k = poolShares * poolPlayMoney;
    const newPoolShares = poolShares + userShares;
    const newPoolPlayMoney = k / newPoolShares;
    const grossSB = poolPlayMoney - newPoolPlayMoney;
    return Math.max(0, grossSB * SELLER_NET_FACTOR);
  }, [isPoolInitialized, tradeType, userShares, poolData]);

  /**
   * FU2: Whole-integer share count derived from the SB target the user typed.
   * Only meaningful when sellInputMode === "sb".
   */
  const derivedSellSharesCount = useMemo(() => {
    if (sellInputMode !== "sb") return 0;
    const targetSB = parseFloat(amount || "0");
    if (!targetSB || targetSB <= 0) return 0;
    const poolShares = Number(poolData?.shares ?? 0);
    const poolPlayMoney = Number(poolData?.playMoney ?? 0);
    if (!poolShares || !poolPlayMoney) return 0;
    const raw = deriveSellShares(targetSB, poolShares, poolPlayMoney);
    if (!isFinite(raw) || raw <= 0) return 0;
    return Math.ceil(raw);
  }, [sellInputMode, amount, poolData]);

  // Calculate max amount based on trade type and current slippage constraint
  const maxAmount = isPoolInitialized
    ? tradeType === "buy"
      ? Math.min(userBalance, maxBuyAmountBySlippage)
      : userShares
    : 0;

  const amountFromSliderPercentage = useCallback(
    (percentage: number) => {
      if (tradeType === "sell" && sellInputMode === "sb") {
        return ((maxSBFromSelling * percentage) / 100).toFixed(2);
      }
      const rawAmount = (maxAmount * percentage) / 100;
      if (tradeType === "buy") {
        return rawAmount.toFixed(2);
      }
      return Math.floor(rawAmount).toString();
    },
    [maxAmount, maxSBFromSelling, tradeType, sellInputMode],
  );

  // Handle slider change
  const handleSliderChange = useCallback(
    (value: number[]) => {
      const percentage = value[0];
      setSliderValue(percentage);
      setInlineError(null);

      if (
        maxAmount > 0 ||
        (tradeType === "sell" && sellInputMode === "sb" && maxSBFromSelling > 0)
      ) {
        setAmount(amountFromSliderPercentage(percentage));
      }
    },
    [maxAmount, maxSBFromSelling, amountFromSliderPercentage, tradeType, sellInputMode],
  );

  // Handle quick select buttons
  const handleQuickSelect = useCallback(
    (percentage: number) => {
      setSliderValue(percentage);
      setInlineError(null);

      if (
        maxAmount > 0 ||
        (tradeType === "sell" && sellInputMode === "sb" && maxSBFromSelling > 0)
      ) {
        setAmount(amountFromSliderPercentage(percentage));
      }
    },
    [maxAmount, maxSBFromSelling, amountFromSliderPercentage, tradeType, sellInputMode],
  );

  // Handle manual input change
  const handleManualInputChange = useCallback(
    (value: string) => {
      setInlineError(null);
      setTradeResult(null);
      // For selling shares in shares mode, enforce whole numbers
      if (tradeType === "sell" && sellInputMode === "shares") {
        const intValue = Math.floor(parseFloat(value || "0"));
        setAmount(intValue.toString());
      } else {
        setAmount(value);
      }

      // Update slider to match manual input
      const numValue = parseFloat(value || "0");
      const modeMax = tradeType === "sell" && sellInputMode === "sb" ? maxSBFromSelling : maxAmount;
      if (!isNaN(numValue) && modeMax > 0) {
        const clampedValue = Math.min(numValue, modeMax);
        const percentage = Math.min((clampedValue / modeMax) * 100, 100);
        setSliderValue(percentage);
      } else {
        setSliderValue(0);
      }
    },
    [maxAmount, maxSBFromSelling, tradeType, sellInputMode],
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
      const queryType = tradeType === "buy" ? "buy" : "sell";
      let queryAmount: number;

      if (tradeType === "sell" && sellInputMode === "sb") {
        // Derive the required shares from the target SB amount
        queryAmount = derivedSellSharesCount;
        if (!queryAmount || queryAmount <= 0) {
          setQuote(null);
          setIsLoadingQuote(false);
          return;
        }
      } else {
        queryAmount = parseFloat(amount);
      }

      const res = await fetch(`/api/amm/${playerId}/quote?type=${queryType}&amount=${queryAmount}`);

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
  }, [
    amount,
    tradeType,
    sellInputMode,
    derivedSellSharesCount,
    playerId,
    toast,
    isPoolInitialized,
  ]);

  // Fetch quote when amount, trade type, or sell mode changes
  useEffect(() => {
    const timer = setTimeout(fetchQuote, 300);
    return () => clearTimeout(timer);
  }, [fetchQuote]);

  // Reset amount, feedback, and sell mode when trade type changes
  useEffect(() => {
    setAmount("");
    setSliderValue(0);
    setQuote(null);
    setInlineError(null);
    setTradeResult(null);
    setSellInputMode("shares"); // FU2: always reset to shares mode on trade type switch
  }, [tradeType]);

  useEffect(() => {
    const amountValue = parseFloat(amount || "0");
    const modeMax = tradeType === "sell" && sellInputMode === "sb" ? maxSBFromSelling : maxAmount;
    if (!amount || !isFinite(amountValue) || amountValue <= modeMax) {
      return;
    }

    const clampedPercentage = modeMax > 0 ? 100 : 0;
    setSliderValue(clampedPercentage);
    setAmount(amountFromSliderPercentage(clampedPercentage));
  }, [amount, maxAmount, maxSBFromSelling, amountFromSliderPercentage, tradeType, sellInputMode]);

  // Auto-dismiss the inline success banner after 6 seconds
  useEffect(() => {
    if (!tradeResult) return;
    const timer = setTimeout(() => setTradeResult(null), 6000);
    return () => clearTimeout(timer);
  }, [tradeResult]);

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

      setTradeResult({
        type: "buy",
        shares: data.sharesReceived,
        sbAmount: data.totalCost,
      });
      setAmount("");
      setSliderValue(0);
      setQuote(null);
      onTradeSuccess?.();
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
      setInlineError(classifyTradeError(error));
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

      setTradeResult({
        type: "sell",
        shares: data.sharesSold,
        sbAmount: data.totalProceeds,
      });
      setAmount("");
      setSliderValue(0);
      setQuote(null);
      onTradeSuccess?.();
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
      setInlineError(classifyTradeError(error));
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
        setInlineError(
          `Insufficient balance. Need $${sbAmount.toFixed(2)} but you have $${userBalance.toFixed(2)}.`,
        );
        return;
      }
      void hapticMedium();
      buyMutation.mutate(sbAmount);
    } else {
      // FU2: use derived share count when in SB-target mode
      const sharesAmount = sellInputMode === "sb" ? derivedSellSharesCount : parseFloat(amount);
      if (sharesAmount > userShares) {
        void hapticError();
        setInlineError(
          `Insufficient shares. You have ${userShares} but tried to sell ${sharesAmount}.`,
        );
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

  /** FU4: Computed slippage warning level based on quote vs maxSlippage. */
  const slippageWarningLevel = useMemo<"none" | "warn" | "exceeded">(() => {
    if (!quote) return "none";
    if (quote.slippagePercent >= maxSlippage) return "exceeded";
    if (quote.slippagePercent >= maxSlippage * 0.75) return "warn";
    return "none";
  }, [quote, maxSlippage]);

  if (!isAuthenticated) {
    return (
      <div className="p-4 border rounded-sm bg-muted/40 text-center">
        <p className="text-sm text-muted-foreground">Sign in to trade shares</p>
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
          <Label>
            {tradeType === "buy"
              ? "Amount to Spend"
              : sellInputMode === "sb"
                ? "Target SB to Receive"
                : "Shares to Sell"}
          </Label>
          <span className="text-xs text-muted-foreground">
            {tradeType === "buy"
              ? `Balance: $${userBalance.toFixed(2)}`
              : `Owned: ${Math.floor(userShares)} shares`}
          </span>
        </div>

        {/* FU2: Sell input mode toggle — only shown in sell mode */}
        {tradeType === "sell" && (
          <div className="flex gap-1">
            <Button
              variant={sellInputMode === "shares" ? "default" : "outline"}
              size="sm"
              className="flex-1 text-xs"
              onClick={() => {
                setSellInputMode("shares");
                setAmount("");
                setSliderValue(0);
                setQuote(null);
              }}
              disabled={!isPoolInitialized}
            >
              # Shares
            </Button>
            <Button
              variant={sellInputMode === "sb" ? "default" : "outline"}
              size="sm"
              className="flex-1 text-xs"
              onClick={() => {
                setSellInputMode("sb");
                setAmount("");
                setSliderValue(0);
                setQuote(null);
              }}
              disabled={!isPoolInitialized}
            >
              $ SB Target
            </Button>
          </div>
        )}

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
            Manual:
          </Label>
          <Input
            id="manual-amount"
            type="number"
            inputMode={
              tradeType === "buy" || (tradeType === "sell" && sellInputMode === "sb")
                ? "decimal"
                : "numeric"
            }
            placeholder={tradeType === "buy" ? "100" : sellInputMode === "sb" ? "50" : "10"}
            value={amount}
            onChange={(e) => handleManualInputChange(e.target.value)}
            min={tradeType === "buy" ? 0.01 : sellInputMode === "sb" ? 0.01 : 1}
            step={tradeType === "buy" ? 0.01 : sellInputMode === "sb" ? 0.01 : 1}
            className="flex-1"
            disabled={!isPoolInitialized}
          />
          <span className="text-xs font-medium text-foreground/70 whitespace-nowrap px-2 py-1 bg-muted rounded-sm">
            {tradeType === "buy" || sellInputMode === "sb" ? "SB" : "shares"}
          </span>
        </div>

        {/* FU2: Show derived share count when in SB-target mode */}
        {tradeType === "sell" && sellInputMode === "sb" && derivedSellSharesCount > 0 && (
          <p className="text-xs text-muted-foreground">
            ≈ {derivedSellSharesCount} share{derivedSellSharesCount !== 1 ? "s" : ""} required
          </p>
        )}
      </div>

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

      {/* FU4: Slippage warning — shown between quote and Advanced Settings */}
      {slippageWarningLevel !== "none" && (
        <div
          className={cn(
            "flex items-start gap-3 p-3 rounded-sm border text-sm",
            slippageWarningLevel === "warn"
              ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-700 dark:text-yellow-400"
              : "bg-destructive/10 border-destructive/20 text-destructive",
          )}
        >
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="flex-1">
            {slippageWarningLevel === "warn"
              ? `High slippage: ${quote!.slippagePercent.toFixed(1)}% (limit: ${maxSlippage}%). Consider a smaller amount.`
              : `Slippage ${quote!.slippagePercent.toFixed(1)}% exceeds your ${maxSlippage}% limit — this trade will be rejected.`}
          </p>
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

      {/* Inline error message */}
      {inlineError && (
        <div className="flex items-start gap-3 p-3 rounded-sm bg-destructive/10 border border-destructive/20 text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="flex-1 text-sm">{inlineError}</p>
          {/* FU5: use Button component for accessible dismiss */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-destructive/60 hover:text-destructive hover:bg-destructive/10"
            onClick={() => setInlineError(null)}
            aria-label="Dismiss error"
          >
            <X className="w-3 h-3" />
          </Button>
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
          (tradeType === "sell" && sellInputMode === "shares" && parseFloat(amount) > userShares) ||
          (tradeType === "sell" && sellInputMode === "sb" && derivedSellSharesCount > userShares)
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

      {/* Inline success banner — primary confirmation after server confirmation */}
      {tradeResult && (
        <div className="flex items-center gap-3 p-3 rounded-sm bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-medium">Trade complete</span>
            <span className="mx-1">·</span>
            {tradeResult.type === "buy" ? (
              <>
                +<ShareCounter value={tradeResult.shares} decimals={2} />
              </>
            ) : (
              <>
                +<MoneyCounter value={tradeResult.sbAmount} decimals={2} />
              </>
            )}
            {/* FU3: show updated balance using MoneyCounter so it animates on refetch */}
            <span className="mx-1">·</span>
            <span>Balance: $</span>
            <MoneyCounter value={userBalance} decimals={2} />
          </div>
          {/* FU5: use Button component for accessible dismiss */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-emerald-600/60 dark:text-emerald-400/60 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-500/10"
            onClick={() => setTradeResult(null)}
            aria-label="Dismiss"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
