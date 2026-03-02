import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bot,
  Check,
  KeyRound,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  User2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type ProviderMode = "managed" | "byok";

interface AgentProfileResponse {
  profile: {
    enabled: boolean;
    providerMode: ProviderMode;
    model: string;
    baseUrl: string | null;
    userPromptTemplate: string;
    defaultSport: string | null;
  };
  secret: {
    configured: boolean;
    keyLast4: string | null;
  };
  capabilities: {
    canAnalyze: boolean;
    canAutoExecute: boolean;
    canUseWebResearch: boolean;
    webResearchProvider: "brave" | null;
  };
}

interface AgentCitation {
  id: string;
  title: string;
  sourceName: string;
  url: string;
  publishedAt: string | null;
  retrievedAt: string;
  factSummary: string;
  relevanceScore: number;
}

interface AgentAction {
  actionType:
    | "scout_set_count"
    | "pool_buy"
    | "pool_sell"
    | "pool_add_liquidity"
    | "pool_add_liquidity_optimal"
    | "pool_zap_add_shares"
    | "pool_zap_add_sb"
    | "pool_remove_liquidity"
    | "holdings_condense"
    | "daily_boost_assign"
    | "daily_boost_remove"
    | "watchlist_add_player"
    | "watchlist_remove_player"
    | "community_boost_create"
    | "vesting_claim";
  playerId: string;
  playerName?: string;
  status?: string;
  reasoning: string;
  confidence: number;
  targetCount?: number;
  currentCount?: number;
  evidence?: Record<string, string | null>;
  riskFlags?: string[];
  sbAmount?: number;
  availableBalanceBefore?: number | null;
  availableBalanceAfter?: number | null;
  sharesAmount?: number;
  availableSharesBefore?: number | null;
  availableSharesAfter?: number | null;
  maxSlippage?: number;
  estimatedSharesOut?: number | null;
  estimatedSbOut?: number | null;
  estimatedPricePerShare?: number | null;
  estimatedSlippagePercent?: number | null;
  shares?: number;
  playMoney?: number;
  estimatedOwnershipPercent?: number | null;
  maxShares?: number;
  maxPlayMoney?: number;
  sb?: number;
  estimatedLpSharesMinted?: number | null;
  lpShares?: number;
  currentLpShares?: number | null;
  remainingLpShares?: number | null;
  estimatedPlayMoneyOut?: number | null;
  sharesToCondense?: number;
  expectedPowerGained?: number;
  expectedPoweredShareCount?: number;
  sport?: string;
  slotTier?: 2 | 3 | 4 | 5;
  sharesEntered?: 1;
  boostDate?: string;
  gameId?: string | null;
  gameStartTime?: string | null;
  opponent?: string | null;
  availableShares?: number;
  powerLevel?: number | null;
  boostId?: string;
  watchlistId?: string | null;
  watchlistName?: string | null;
  removeFromAll?: boolean;
  communitySharesAvailable?: number;
  claimableShares?: number;
  distributionCount?: number;
  targetDescription?: string | null;
}

interface AgentActionBundle {
  id: string;
  status:
    | "pending_clarification"
    | "pending_confirmation"
    | "applied"
    | "rejected"
    | "failed"
    | "expired";
  domain:
    | "scouting"
    | "player_pools"
    | "daily_boosts"
    | "community_boosts"
    | "watchlists"
    | "vesting"
    | "sportfolio";
  summary: string;
  warnings: string[];
  actions: AgentAction[];
  workflowType: "single_action" | "multi_action" | "clarification";
  steps: Array<{
    id: string;
    title: string;
    status: "ready" | "needs_clarification" | "blocked" | "completed" | "failed" | "cancelled";
    action: AgentAction | null;
    clarificationPrompt?: string | null;
  }>;
  pendingClarification?: AgentPendingClarification | null;
  runId: string | null;
  createdAt: string;
  confirmedAt: string | null;
  appliedAt: string | null;
}

interface AgentPendingClarification {
  kind: "player_name";
  prompt: string;
  missingFields: string[];
  workflowTitle?: string | null;
  workflowPreviewSteps?: string[];
}

interface AgentThreadSummary {
  id: string;
  title: string | null;
  channel: "in_app" | "sms";
  domain:
    | "scouting"
    | "player_pools"
    | "daily_boosts"
    | "community_boosts"
    | "watchlists"
    | "vesting"
    | "sportfolio";
  status: string;
  lastMessageAt: string | null;
  updatedAt: string;
  createdAt: string;
  lastMessagePreview: string | null;
  pendingActionBundle: AgentActionBundle | null;
}

interface AgentThreadMessage {
  id: string;
  role: "user" | "assistant" | "system";
  messageType: "chat" | "plan" | "confirmation" | "result" | "error";
  contentText: string;
  createdAt: string;
  runId: string | null;
  actionBundle: AgentActionBundle | null;
  citations?: AgentCitation[] | null;
  pendingClarification?: AgentPendingClarification | null;
}

function getReadableAgentError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const rawMessage = error.message.trim();
  if (!rawMessage) {
    return fallback;
  }

  const jsonMatch = rawMessage.match(/^\d+\s*:\s*(\{[\s\S]*\})$/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as { error?: unknown; message?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim()) {
        return parsed.error.trim();
      }
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        return parsed.message.trim();
      }
    } catch {
      // Fall through to simpler normalization below.
    }
  }

  if (rawMessage.includes("Failed to fetch")) {
    return "The agent could not reach the server. Check the backend and try again.";
  }

  return rawMessage.replace(/^\d+\s*:\s*/, "").trim() || fallback;
}

function ErrorStateCard({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/90 p-5 text-red-950">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-2 text-sm leading-6 text-red-900/90">
        {getReadableAgentError(error, "The agent request failed.")}
      </div>
      <Button className="mt-4" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function formatCurrency(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return `$${value.toFixed(2)}`;
}

function formatNumericValue(value: number | null | undefined, fractionDigits = 0) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatUnitValue(
  value: number | null | undefined,
  singular: string,
  plural: string,
  fractionDigits = 0,
) {
  const formattedValue = formatNumericValue(value, fractionDigits);
  if (!formattedValue) {
    return null;
  }

  return `${formattedValue} ${Math.abs(value || 0) === 1 ? singular : plural}`;
}

function formatShareCount(value: number | null | undefined, fractionDigits = 0) {
  return formatUnitValue(value, "share", "shares", fractionDigits);
}

function formatLpShareCount(value: number | null | undefined, fractionDigits = 2) {
  return formatUnitValue(value, "LP share", "LP shares", fractionDigits);
}

function formatPercent(value: number | null | undefined, fractionDigits = 2) {
  const formattedValue = formatNumericValue(value, fractionDigits);
  return formattedValue ? `${formattedValue}%` : null;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDomainLabel(domain: AgentActionBundle["domain"]) {
  switch (domain) {
    case "player_pools":
      return "Player Pools";
    case "daily_boosts":
      return "Daily Boosts";
    case "community_boosts":
      return "Community Boosts";
    case "watchlists":
      return "Watchlists";
    case "vesting":
      return "Vesting";
    case "sportfolio":
      return "Sportfolio";
    case "scouting":
    default:
      return "Scouting";
  }
}

function getActionMeta(action: AgentAction) {
  switch (action.actionType) {
    case "pool_buy":
      return action.estimatedSharesOut != null
        ? `about ${action.estimatedSharesOut.toFixed(4)} shares`
        : "market buy";
    case "pool_sell":
      return action.estimatedSbOut != null
        ? `about ${formatCurrency(action.estimatedSbOut)} back`
        : "market sell";
    case "pool_add_liquidity":
      return `${action.shares || 0} shares + ${formatCurrency(action.playMoney) || "$0.00"}`;
    case "pool_add_liquidity_optimal":
      return `up to ${action.maxShares || 0} shares + ${formatCurrency(action.maxPlayMoney) || "$0.00"}`;
    case "pool_zap_add_shares":
      return `${action.shares || 0} share${action.shares === 1 ? "" : "s"} single-sided`;
    case "pool_zap_add_sb":
      return `${formatCurrency(action.sb) || "$0.00"} single-sided`;
    case "pool_remove_liquidity":
      return `${action.lpShares || 0} LP shares`;
    case "holdings_condense":
      return `${action.sharesToCondense || 0} shares -> ${action.expectedPoweredShareCount || 0} powered share`;
    case "daily_boost_assign":
      return `${action.slotTier || 0}x slot${action.boostDate ? ` | ${action.boostDate}` : ""}`;
    case "daily_boost_remove":
      return `${action.slotTier || 0}x slot`;
    case "watchlist_add_player":
      return action.watchlistName || "default watchlist";
    case "watchlist_remove_player":
      return action.removeFromAll ? "all watchlists" : action.watchlistName || "watchlist";
    case "community_boost_create":
      return `${action.boostDate || ""}${action.communitySharesAvailable != null ? ` | ${action.communitySharesAvailable} share${action.communitySharesAvailable === 1 ? "" : "s"} ready` : ""}`;
    case "vesting_claim":
      return (
        action.targetDescription ||
        `${action.distributionCount || 0} vesting target${action.distributionCount === 1 ? "" : "s"}`
      );
    case "scout_set_count":
    default:
      return `${action.currentCount || 0} to ${action.targetCount || 0} scouts`;
  }
}

type ActionComparisonRow = {
  label: string;
  current: string;
  proposed: string;
  detail?: string;
};

function getActionTargetLabel(action: AgentAction) {
  return action.playerName || action.playerId || "this move";
}

function formatScoutChange(targetCount: number, currentCount: number) {
  const delta = targetCount - currentCount;
  if (delta > 0) {
    return `Add ${delta} scout${delta === 1 ? "" : "s"}`;
  }
  if (delta < 0) {
    const removed = Math.abs(delta);
    return `Pull ${removed} scout${removed === 1 ? "" : "s"}`;
  }
  return "Keep the current scout count";
}

function getScoutComparisonRows(action: AgentAction): ActionComparisonRow[] {
  const currentCount = action.currentCount || 0;
  const targetCount = action.targetCount || 0;

  return [
    {
      label: "Scout allocation",
      current: `${currentCount} scout${currentCount === 1 ? "" : "s"} on ${getActionTargetLabel(action)}`,
      proposed: `${targetCount} scout${targetCount === 1 ? "" : "s"} on ${getActionTargetLabel(action)}`,
    },
    {
      label: "Net change",
      current: "No reallocation queued",
      proposed: formatScoutChange(targetCount, currentCount),
    },
  ];
}

function getPoolBuyComparisonRows(action: AgentAction): ActionComparisonRow[] {
  const balanceBefore = formatCurrency(action.availableBalanceBefore);
  const balanceAfter = formatCurrency(action.availableBalanceAfter);
  const sharesOut = formatShareCount(action.estimatedSharesOut, 4);
  const price = formatCurrency(action.estimatedPricePerShare);
  const slippage = formatPercent(action.estimatedSlippagePercent);

  return [
    {
      label: "Available balance",
      current: balanceBefore || "No cash committed yet",
      proposed:
        balanceAfter ||
        `Spend ${formatCurrency(action.sbAmount) || "$0.00"} from your available balance`,
      detail: "This reflects your liquid balance before the order reaches the pool.",
    },
    {
      label: "Position size",
      current: `No new ${getActionTargetLabel(action)} shares added yet`,
      proposed: sharesOut
        ? `Add about ${sharesOut}`
        : `Buy ${getActionTargetLabel(action)} at market`,
    },
    {
      label: "Execution terms",
      current: "Live AMM quote only",
      proposed:
        [price ? `${price} per share` : null, slippage ? `${slippage} max slippage` : null]
          .filter(Boolean)
          .join(" | ") || "Market quote locked only when you confirm",
      detail: "Pool pricing can move until you confirm the staged order.",
    },
  ];
}

function getPoolSellComparisonRows(action: AgentAction): ActionComparisonRow[] {
  const sharesBefore = formatShareCount(action.availableSharesBefore);
  const sharesAfter = formatShareCount(action.availableSharesAfter);
  const balanceBefore = formatCurrency(action.availableBalanceBefore);
  const balanceAfter = formatCurrency(action.availableBalanceAfter);
  const proceeds = formatCurrency(action.estimatedSbOut);
  const price = formatCurrency(action.estimatedPricePerShare);
  const slippage = formatPercent(action.estimatedSlippagePercent);

  return [
    {
      label: "Available shares",
      current: sharesBefore || "Current share inventory",
      proposed:
        sharesAfter ||
        `Sell ${formatShareCount(action.sharesAmount) || `${action.sharesAmount || 0} shares`} from your wallet`,
    },
    {
      label: "Available balance",
      current: balanceBefore || "Current liquid balance",
      proposed:
        balanceAfter ||
        (proceeds ? `${proceeds} added to available balance` : "Sale proceeds credited"),
    },
    {
      label: "Execution terms",
      current: "No sale staged yet",
      proposed:
        [
          proceeds ? `${proceeds} estimated back` : null,
          price ? `${price} per share` : null,
          slippage ? `${slippage} max slippage` : null,
        ]
          .filter(Boolean)
          .join(" | ") || "Market quote locked only when you confirm",
      detail: "Final proceeds can drift with the pool before execution.",
    },
  ];
}

function getPoolAddLiquidityComparisonRows(action: AgentAction): ActionComparisonRow[] {
  const sharesBefore = formatShareCount(action.availableSharesBefore, 2);
  const sharesAfter = formatShareCount(action.availableSharesAfter, 2);
  const balanceBefore = formatCurrency(action.availableBalanceBefore);
  const balanceAfter = formatCurrency(action.availableBalanceAfter);
  const depositShares = formatShareCount(action.shares, 2);
  const depositCash = formatCurrency(action.playMoney) || "$0.00";
  const ownership = formatPercent(action.estimatedOwnershipPercent);

  return [
    {
      label: "Wallet shares",
      current: sharesBefore || "Wallet shares unchanged",
      proposed: sharesAfter || `${depositShares || "Shares"} moved into LP`,
    },
    {
      label: "Available balance",
      current: balanceBefore || "Available balance unchanged",
      proposed: balanceAfter || `${depositCash} moved into LP`,
    },
    {
      label: "Pool deposit",
      current: "No LP deposit staged yet",
      proposed: `${depositShares || "0 shares"} + ${depositCash}`,
    },
    {
      label: "Estimated pool ownership",
      current: "Current LP position stays as-is",
      proposed: ownership
        ? `About ${ownership} after execution`
        : "Ownership updates when the deposit lands",
      detail: "The estimate is based on the current pool snapshot.",
    },
  ];
}

function getPoolAddLiquidityOptimalComparisonRows(action: AgentAction): ActionComparisonRow[] {
  const sharesBefore = formatShareCount(action.availableSharesBefore, 2);
  const sharesAfter = formatShareCount(action.availableSharesAfter, 2);
  const balanceBefore = formatCurrency(action.availableBalanceBefore);
  const balanceAfter = formatCurrency(action.availableBalanceAfter);
  const maxShares = formatShareCount(action.maxShares, 2) || "0 shares";
  const maxCash = formatCurrency(action.maxPlayMoney) || "$0.00";
  const ownership = formatPercent(action.estimatedOwnershipPercent);

  return [
    {
      label: "Wallet shares",
      current: sharesBefore || "Wallet shares unchanged",
      proposed: sharesAfter || `Use up to ${maxShares} depending on the live pool ratio at confirm`,
      detail: "Anything the optimal-ratio route does not need stays in your wallet.",
    },
    {
      label: "Available balance",
      current: balanceBefore || "Available balance unchanged",
      proposed: balanceAfter || `Use up to ${maxCash} depending on the live pool ratio at confirm`,
    },
    {
      label: "LP cap",
      current: "No LP deposit staged yet",
      proposed: `${maxShares} max + ${maxCash} max`,
    },
    {
      label: "Estimated pool ownership",
      current: "Current LP position stays as-is",
      proposed: ownership
        ? `About ${ownership} if the preview ratio holds`
        : "Ownership depends on the pool ratio at confirm",
    },
  ];
}

function getPoolZapSharesComparisonRows(action: AgentAction): ActionComparisonRow[] {
  const sharesBefore = formatShareCount(action.availableSharesBefore, 2);
  const sharesAfter = formatShareCount(action.availableSharesAfter, 2);
  const lpOut = formatLpShareCount(action.estimatedLpSharesMinted, 4);
  const sharesUsed = formatShareCount(action.shares, 2) || "0 shares";

  return [
    {
      label: "Wallet shares",
      current: sharesBefore || "Share inventory unchanged",
      proposed: sharesAfter || `${sharesUsed} routed into a single-sided LP add`,
    },
    {
      label: "LP output",
      current: "No LP shares minted yet",
      proposed: lpOut ? `Mint about ${lpOut}` : "LP shares are quoted live at confirm",
      detail: "The zap performs an internal swap first, so the final mint can move with the pool.",
    },
  ];
}

function getPoolZapSbComparisonRows(action: AgentAction): ActionComparisonRow[] {
  const balanceBefore = formatCurrency(action.availableBalanceBefore);
  const balanceAfter = formatCurrency(action.availableBalanceAfter);
  const lpOut = formatLpShareCount(action.estimatedLpSharesMinted, 4);
  const sbUsed = formatCurrency(action.sb) || "$0.00";

  return [
    {
      label: "Available balance",
      current: balanceBefore || "Cash inventory unchanged",
      proposed: balanceAfter || `${sbUsed} routed into a single-sided LP add`,
    },
    {
      label: "LP output",
      current: "No LP shares minted yet",
      proposed: lpOut ? `Mint about ${lpOut}` : "LP shares are quoted live at confirm",
      detail: "The single-sided route swaps into the pool first, so the preview can drift.",
    },
  ];
}

function getPoolRemoveLiquidityComparisonRows(action: AgentAction): ActionComparisonRow[] {
  const currentLpShares = formatLpShareCount(action.currentLpShares, 2);
  const remainingLpShares = formatLpShareCount(action.remainingLpShares, 2);
  const sharesOut = formatShareCount(action.estimatedSharesOut, 4);
  const cashOut = formatCurrency(action.estimatedPlayMoneyOut);

  return [
    {
      label: "LP position",
      current: currentLpShares || "LP shares stay in the pool",
      proposed:
        remainingLpShares ||
        `Burn ${formatLpShareCount(action.lpShares, 2) || `${action.lpShares || 0} LP shares`}`,
    },
    {
      label: "Shares returned",
      current: "No player shares back yet",
      proposed: sharesOut
        ? `Receive about ${sharesOut}`
        : "Player-share output updates from the live pool snapshot",
    },
    {
      label: "Cash returned",
      current: "No play money back yet",
      proposed: cashOut
        ? `${cashOut} returned to available balance`
        : "Play-money output updates from the live pool snapshot",
      detail: "Both sides of the LP removal are estimated from the current position snapshot.",
    },
  ];
}

function getHoldingsCondenseComparisonRows(action: AgentAction): ActionComparisonRow[] {
  const sharesBefore = formatShareCount(action.availableSharesBefore);
  const sharesAfter = formatShareCount(action.availableSharesAfter);

  return [
    {
      label: "Raw shares",
      current: sharesBefore || `${action.sharesToCondense || 0} raw shares available to condense`,
      proposed: sharesAfter || `${action.sharesToCondense || 0} raw shares consumed`,
    },
    {
      label: "Power outcome",
      current: "No added power yet",
      proposed: `${action.expectedPoweredShareCount || 0} powered share(s), +${action.expectedPowerGained || 0} power`,
    },
  ];
}

function getDailyBoostAssignComparisonRows(action: AgentAction): ActionComparisonRow[] {
  const availableShares = action.availableShares;
  const gameWindow = formatDateTime(action.gameStartTime);

  return [
    {
      label: "Boost slot",
      current: `${action.slotTier || 0}x slot stays open in this plan`,
      proposed: `${getActionTargetLabel(action)} in the ${action.slotTier || 0}x slot`,
    },
    {
      label: "Player inventory",
      current:
        availableShares != null
          ? `${formatShareCount(availableShares) || `${availableShares} shares`} available`
          : "Inventory unchanged",
      proposed:
        availableShares != null
          ? `${formatShareCount(Math.max(availableShares - 1, 0)) || "0 shares"} left after reserving the boost share`
          : "One eligible share reserved for the slot",
    },
    {
      label: "Boost power",
      current: "No share locked into the slot yet",
      proposed:
        action.powerLevel != null
          ? `${formatNumericValue(action.powerLevel, 2) || action.powerLevel.toString()} power enters the slot`
          : "Best eligible share is used at confirm",
    },
    {
      label: "Lock window",
      current: "Slot stays flexible until game lock",
      proposed: gameWindow
        ? `Locks at ${gameWindow}${action.opponent ? ` (${action.opponent})` : ""}`
        : "Locks when the scheduled game starts",
    },
  ];
}

function getDailyBoostRemoveComparisonRows(action: AgentAction): ActionComparisonRow[] {
  const gameWindow = formatDateTime(action.gameStartTime);

  return [
    {
      label: "Boost slot",
      current: `${action.slotTier || 0}x slot assigned to ${getActionTargetLabel(action)}`,
      proposed: `${action.slotTier || 0}x slot cleared`,
    },
    {
      label: "Share reservation",
      current: "One eligible share is tied to this slot",
      proposed: "The slot opens back up and the share stays free until the game locks",
    },
    {
      label: "Removal window",
      current: gameWindow
        ? `Can still be changed before ${gameWindow}`
        : "Still inside the removal window",
      proposed: gameWindow
        ? `Confirm before ${gameWindow} to clear it in time`
        : "Clears immediately if you confirm now",
    },
  ];
}

function getWatchlistAddComparisonRows(action: AgentAction): ActionComparisonRow[] {
  return [
    {
      label: "Watchlist status",
      current: `${getActionTargetLabel(action)} not in ${action.watchlistName || "the watchlist"}`,
      proposed: `${getActionTargetLabel(action)} added to ${action.watchlistName || "the watchlist"}`,
    },
    {
      label: "Portfolio impact",
      current: "Cash, shares, and boosts stay unchanged",
      proposed: "Only tracking changes; your portfolio stays unchanged",
    },
  ];
}

function getWatchlistRemoveComparisonRows(action: AgentAction): ActionComparisonRow[] {
  return [
    {
      label: "Watchlist status",
      current: `${getActionTargetLabel(action)} tracked in ${
        action.removeFromAll ? "your watchlists" : action.watchlistName || "the watchlist"
      }`,
      proposed: `${getActionTargetLabel(action)} removed from tracking`,
    },
    {
      label: "Portfolio impact",
      current: "Cash, shares, and boosts stay unchanged",
      proposed: "Only tracking changes; your portfolio stays unchanged",
    },
  ];
}

function getCommunityBoostComparisonRows(action: AgentAction): ActionComparisonRow[] {
  const communityShares = action.communitySharesAvailable;
  const gameWindow = formatDateTime(action.gameStartTime);

  return [
    {
      label: "Community shares",
      current:
        communityShares != null
          ? `${formatShareCount(communityShares) || `${communityShares} shares`} available`
          : "Community share balance unchanged",
      proposed:
        communityShares != null
          ? `${formatShareCount(Math.max(communityShares - 1, 0)) || "0 shares"} remaining after the burn`
          : "One community share burns on confirm",
    },
    {
      label: "Boost board",
      current: "No community boost staged yet",
      proposed: `${getActionTargetLabel(action)} on ${action.boostDate || "the selected slate"}`,
    },
    {
      label: "Game window",
      current: "No boost attached to this game yet",
      proposed: gameWindow
        ? `${action.opponent ? `${action.opponent} ` : ""}at ${gameWindow}`
        : "Applies only while the target game is still eligible",
    },
  ];
}

function getVestingClaimComparisonRows(action: AgentAction): ActionComparisonRow[] {
  return [
    {
      label: "Claimable shares",
      current: `${formatShareCount(action.claimableShares) || `${action.claimableShares || 0} shares`} ready now`,
      proposed: "Claimable vesting balance resets after the claim",
    },
    {
      label: "Distribution target",
      current: "Shares still sit inside vesting",
      proposed:
        action.targetDescription ||
        `${action.distributionCount || 0} vesting target${action.distributionCount === 1 ? "" : "s"} credited`,
    },
    {
      label: "Portfolio availability",
      current: "Those shares are not back in active inventory yet",
      proposed: "Claimed shares move back into your usable holdings",
    },
  ];
}

function getActionComparisonRows(action: AgentAction): ActionComparisonRow[] {
  switch (action.actionType) {
    case "scout_set_count":
      return getScoutComparisonRows(action);
    case "pool_buy":
      return getPoolBuyComparisonRows(action);
    case "pool_sell":
      return getPoolSellComparisonRows(action);
    case "pool_add_liquidity":
      return getPoolAddLiquidityComparisonRows(action);
    case "pool_add_liquidity_optimal":
      return getPoolAddLiquidityOptimalComparisonRows(action);
    case "pool_zap_add_shares":
      return getPoolZapSharesComparisonRows(action);
    case "pool_zap_add_sb":
      return getPoolZapSbComparisonRows(action);
    case "pool_remove_liquidity":
      return getPoolRemoveLiquidityComparisonRows(action);
    case "holdings_condense":
      return getHoldingsCondenseComparisonRows(action);
    case "daily_boost_assign":
      return getDailyBoostAssignComparisonRows(action);
    case "daily_boost_remove":
      return getDailyBoostRemoveComparisonRows(action);
    case "watchlist_add_player":
      return getWatchlistAddComparisonRows(action);
    case "watchlist_remove_player":
      return getWatchlistRemoveComparisonRows(action);
    case "community_boost_create":
      return getCommunityBoostComparisonRows(action);
    case "vesting_claim":
      return getVestingClaimComparisonRows(action);
    default:
      return [
        {
          label: "Planned change",
          current: "Current state stays as-is",
          proposed: getActionMeta(action),
        },
      ];
  }
}

function ActionComparisonGrid({ action }: { action: AgentAction }) {
  const rows = getActionComparisonRows(action);

  return (
    <div className="mt-3 space-y-2">
      {rows.map((row) => (
        <div
          key={`${action.actionType}-${row.label}`}
          className="rounded-xl border border-border/60 bg-background/70 p-2.5"
        >
          <div className="text-[11px] font-medium text-slate-600">{row.label}</div>
          {row.detail && (
            <div className="mt-1 text-[11px] leading-5 text-slate-500">{row.detail}</div>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border/60 bg-slate-50 px-2.5 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Current
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-700">{row.current}</div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700">
                After Confirm
              </div>
              <div className="mt-1 text-xs leading-5 text-amber-950">{row.proposed}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ClarificationCard({ clarification }: { clarification: AgentPendingClarification }) {
  return (
    <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50/90 p-3 text-sky-950">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">
        Waiting On One Detail
      </div>
      <div className="mt-2 text-sm leading-6">{clarification.prompt}</div>
      <div className="mt-2 text-xs text-sky-800/80">
        Reply with the missing detail and the agent will pick the plan back up.
      </div>
    </div>
  );
}

function CitationList({ citations }: { citations: AgentCitation[] }) {
  if (citations.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2 rounded-2xl border border-sky-200 bg-sky-50/80 p-3 text-sky-950">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-700">
        External Sources
      </div>
      {citations.map((citation) => (
        <a
          key={citation.id}
          href={citation.url}
          target="_blank"
          rel="noreferrer"
          className="block rounded-xl bg-white/80 p-3 transition-colors hover:bg-white"
        >
          <div className="text-xs font-medium text-sky-800">
            {citation.sourceName}
            {citation.publishedAt ? ` | ${citation.publishedAt}` : ""}
          </div>
          <div className="mt-1 text-sm font-medium text-slate-900">{citation.title}</div>
          <div className="mt-1 text-xs leading-5 text-slate-700">{citation.factSummary}</div>
        </a>
      ))}
    </div>
  );
}

function getThreadTitle(thread: AgentThreadSummary, index: number) {
  const trimmedTitle = thread.title?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  return `Chat ${index + 1}`;
}

function formatThreadTimestamp(value: string | null) {
  if (!value) {
    return "New";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Recent";
  }

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function ThreadList({
  threads,
  activeThreadId,
  onSelect,
}: {
  threads: AgentThreadSummary[];
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
}) {
  if (threads.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
        Your conversations will show up here after you start chatting.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {threads.map((thread, index) => {
        const isActive = thread.id === activeThreadId;
        const preview = thread.pendingActionBundle?.summary || thread.lastMessagePreview;

        return (
          <button
            key={thread.id}
            type="button"
            onClick={() => onSelect(thread.id)}
            className={cn(
              "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
              isActive
                ? "border-amber-300 bg-amber-50/90 text-slate-950 shadow-sm"
                : "border-border/60 bg-background hover:border-border hover:bg-muted/40",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-foreground">
                  {getThreadTitle(thread, index)}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {thread.pendingActionBundle ? "Plan waiting" : formatDomainLabel(thread.domain)}
                </div>
              </div>
              <div className="shrink-0 text-[11px] text-muted-foreground">
                {formatThreadTimestamp(thread.lastMessageAt || thread.updatedAt)}
              </div>
            </div>
            {preview && (
              <div className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                {preview}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function BundleCard({
  bundle,
  onConfirm,
  onCancel,
  isConfirming,
  isCanceling,
}: {
  bundle: AgentActionBundle;
  onConfirm: () => void;
  onCancel: () => void;
  isConfirming: boolean;
  isCanceling: boolean;
}) {
  const isPending = bundle.status === "pending_confirmation";
  const isAwaitingDetail = bundle.status === "pending_clarification";
  const renderedSteps = bundle.steps.length > 0 ? bundle.steps : [];

  return (
    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-slate-900">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-amber-600 text-white hover:bg-amber-600">
          {isPending
            ? "Pending Confirmation"
            : isAwaitingDetail
              ? "Waiting On Detail"
              : bundle.status}
        </Badge>
        <Badge variant="outline">{formatDomainLabel(bundle.domain)}</Badge>
        <span className="text-xs text-amber-950/80">
          {new Date(bundle.createdAt).toLocaleString()}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6">{bundle.summary}</p>
      {renderedSteps.length > 0 && (
        <div className="mt-3 space-y-2">
          {renderedSteps.map((step) => (
            <div
              key={`${bundle.id}-${step.id}`}
              className="rounded-xl border border-amber-200/80 bg-white/90 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">{step.title}</div>
                <div className="text-xs font-medium text-muted-foreground">{step.status}</div>
              </div>
              {step.action ? (
                <>
                  <div className="mt-1 text-xs font-medium text-muted-foreground">
                    {getActionMeta(step.action)}
                  </div>
                  <ActionComparisonGrid action={step.action} />
                  <div className="mt-2 text-sm leading-6 text-slate-700">
                    {step.action.reasoning}
                  </div>
                </>
              ) : step.clarificationPrompt ? (
                <div className="mt-1 text-sm text-slate-700">{step.clarificationPrompt}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {isAwaitingDetail && bundle.pendingClarification && (
        <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/80 px-3 py-2 text-sm text-sky-950">
          {bundle.pendingClarification.prompt}
        </div>
      )}
      {bundle.warnings.length > 0 && (
        <div className="mt-3 space-y-2">
          {bundle.warnings.map((warning) => (
            <div
              key={warning}
              className="rounded-xl border border-amber-300 bg-white/70 px-3 py-2 text-xs text-amber-950"
            >
              {warning}
            </div>
          ))}
        </div>
      )}
      {isPending && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={onConfirm} disabled={isConfirming || isCanceling}>
            {isConfirming ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Confirm Changes
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={isConfirming || isCanceling}>
            {isCanceling ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <X className="mr-2 h-4 w-4" />
            )}
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

export default function AgentPage() {
  const { toast } = useToast();
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [composerValue, setComposerValue] = useState("");
  const [didBootstrapThread, setDidBootstrapThread] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [providerMode, setProviderMode] = useState<ProviderMode>("managed");
  const [userPromptTemplate, setUserPromptTemplate] = useState("");
  const [defaultSport, setDefaultSport] = useState("ALL");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");

  const {
    data: profileData,
    isLoading: isLoadingProfile,
    error: profileError,
    refetch: refetchProfile,
  } = useQuery<AgentProfileResponse>({
    queryKey: ["/api/agent/profile"],
  });
  const {
    data: threadsData,
    isLoading: isLoadingThreads,
    error: threadsError,
    refetch: refetchThreads,
  } = useQuery<AgentThreadSummary[]>({
    queryKey: ["/api/agent/threads"],
  });
  const {
    data: activeThread,
    error: activeThreadError,
    refetch: refetchActiveThread,
  } = useQuery<AgentThreadSummary>({
    queryKey: activeThreadId
      ? ["/api/agent/threads", activeThreadId]
      : ["/api/agent/threads", "none"],
    enabled: Boolean(activeThreadId),
  });
  const {
    data: messagesData,
    isLoading: isLoadingMessages,
    error: messagesError,
    refetch: refetchMessages,
  } = useQuery<AgentThreadMessage[]>({
    queryKey: activeThreadId
      ? ["/api/agent/threads", activeThreadId, "messages"]
      : ["/api/agent/threads", "none", "messages"],
    enabled: Boolean(activeThreadId),
  });

  useEffect(() => {
    if (!profileData) return;
    setEnabled(profileData.profile.enabled);
    setProviderMode(profileData.profile.providerMode);
    setUserPromptTemplate(profileData.profile.userPromptTemplate);
    setDefaultSport(profileData.profile.defaultSport || "ALL");
    setBaseUrl(profileData.profile.baseUrl || "");
    setModel(profileData.profile.model || "");
  }, [profileData]);

  const invalidateThreadQueries = async (threadId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/agent/threads"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/agent/threads", threadId] }),
      queryClient.invalidateQueries({ queryKey: ["/api/agent/threads", threadId, "messages"] }),
    ]);
  };

  const invalidateGameplayQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/scouts"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/scouts/status"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/activity"] }),
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return (
            typeof key === "string" &&
            (key.startsWith("/api/daily-boosts") ||
              key.startsWith("/api/lp") ||
              key.startsWith("/api/amm/"))
          );
        },
      }),
    ]);
  };

  const createThreadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/agent/threads", {});
      return (await res.json()) as AgentThreadSummary;
    },
    onSuccess: (thread) => {
      setActiveThreadId(thread.id);
      queryClient.invalidateQueries({ queryKey: ["/api/agent/threads"] });
    },
    onError: (error) => {
      toast({
        title: "Failed to start chat",
        description: (error as Error).message,
        variant: "destructive",
      });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({ threadId, message }: { threadId: string; message: string }) => {
      const res = await apiRequest("POST", `/api/agent/threads/${threadId}/messages`, { message });
      return res.json();
    },
    onSuccess: async (_result, variables) => {
      await invalidateThreadQueries(variables.threadId);
    },
    onError: (error) => {
      toast({
        title: "Failed to send message",
        description: (error as Error).message,
        variant: "destructive",
      });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await apiRequest("POST", `/api/agent/threads/${threadId}/confirm`, {});
      return res.json();
    },
    onSuccess: async (_result, threadId) => {
      await invalidateThreadQueries(threadId);
      await invalidateGameplayQueries();
    },
    onError: (error) => {
      toast({
        title: "Failed to confirm plan",
        description: (error as Error).message,
        variant: "destructive",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (threadId: string) => {
      const res = await apiRequest("POST", `/api/agent/threads/${threadId}/cancel`, {});
      return res.json();
    },
    onSuccess: async (_result, threadId) => {
      await invalidateThreadQueries(threadId);
    },
    onError: (error) => {
      toast({
        title: "Failed to cancel plan",
        description: (error as Error).message,
        variant: "destructive",
      });
    },
  });

  const saveProfileMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/agent/profile", {
        enabled,
        providerMode,
        userPromptTemplate,
        defaultSport: defaultSport === "ALL" ? null : defaultSport,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/profile"] });
      toast({ title: "Agent settings updated", description: "Your agent playbook is saved." });
    },
    onError: (error) => {
      toast({
        title: "Failed to save settings",
        description: (error as Error).message,
        variant: "destructive",
      });
    },
  });

  const saveByokMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/agent/byok-key", { apiKey, baseUrl, model });
      return res.json();
    },
    onSuccess: () => {
      setApiKey("");
      queryClient.invalidateQueries({ queryKey: ["/api/agent/profile"] });
      toast({ title: "BYOK saved", description: "Your API key was stored securely." });
    },
    onError: (error) => {
      toast({
        title: "Failed to save BYOK",
        description: (error as Error).message,
        variant: "destructive",
      });
    },
  });

  const clearByokMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/agent/byok-key");
      return res.json();
    },
    onSuccess: () => {
      setApiKey("");
      queryClient.invalidateQueries({ queryKey: ["/api/agent/profile"] });
      toast({ title: "BYOK removed", description: "The stored API key was removed." });
    },
    onError: (error) => {
      toast({
        title: "Failed to remove BYOK",
        description: (error as Error).message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (threadsData && threadsData.length > 0) {
      setDidBootstrapThread(true);
      if (!activeThreadId || !threadsData.some((thread) => thread.id === activeThreadId)) {
        setActiveThreadId(threadsData[0].id);
      }
      return;
    }

    if (
      !didBootstrapThread &&
      !isLoadingThreads &&
      threadsData &&
      threadsData.length === 0 &&
      !createThreadMutation.isPending
    ) {
      setDidBootstrapThread(true);
      createThreadMutation.mutate();
    }
  }, [activeThreadId, createThreadMutation, didBootstrapThread, isLoadingThreads, threadsData]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeThread?.pendingActionBundle?.id, messagesData?.length]);

  const handleSend = async () => {
    const message = composerValue.trim();
    if (!message || sendMessageMutation.isPending) return;

    try {
      let threadId = activeThreadId;
      if (!threadId) {
        const thread = await createThreadMutation.mutateAsync();
        threadId = thread.id;
      }

      setComposerValue("");
      await sendMessageMutation.mutateAsync({ threadId, message });
    } catch {
      // Mutation handlers already surface errors.
    }
  };

  const pendingBundle = activeThread?.pendingActionBundle || null;
  const hasConversationLoadError = Boolean(activeThreadId && (activeThreadError || messagesError));
  const isBootstrappingThread =
    createThreadMutation.isPending && !activeThreadId && !hasConversationLoadError;
  const isSendDisabled =
    !enabled ||
    !profileData?.capabilities.canAnalyze ||
    !composerValue.trim() ||
    sendMessageMutation.isPending ||
    createThreadMutation.isPending ||
    Boolean(threadsError) ||
    hasConversationLoadError;
  const starterPrompts = [
    "Review my setup",
    "What should I do with my idle balance?",
    "Who should get my community boost today?",
  ];

  return (
    <div className="min-h-screen bg-background px-3 py-3 sm:px-6 sm:py-5">
      <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-6xl flex-col">
        <div className="mb-4 flex flex-col gap-3 rounded-3xl border border-border/70 bg-background p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-2xl bg-amber-100 p-2 text-amber-700">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Agent</h1>
                <p className="text-sm text-muted-foreground">
                  Cleaner chat, simpler controls, and confirmation-gated actions.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {formatDomainLabel(activeThread?.domain || "sportfolio")}
              </Badge>
              <Badge variant={profileData?.capabilities.canAnalyze ? "default" : "secondary"}>
                {profileData?.capabilities.canAnalyze ? "Ready" : "Setup Needed"}
              </Badge>
              {profileData?.capabilities.canUseWebResearch && (
                <Badge variant="outline">
                  {profileData.capabilities.webResearchProvider === "brave"
                    ? "Brave Research"
                    : "Web Research"}
                </Badge>
              )}
              {profileError && <Badge variant="destructive">Settings Error</Badge>}
              <Badge variant={enabled ? "default" : "secondary"}>
                {enabled ? "Live" : "Paused"}
              </Badge>
              {pendingBundle && (
                <Badge className="bg-amber-600 text-white hover:bg-amber-600">Plan Ready</Badge>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" className="lg:hidden">
                  <MessageSquare className="mr-2 h-4 w-4" />
                  Chats
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-full max-w-sm p-0">
                <SheetHeader className="border-b border-border/70 px-5 py-4 text-left">
                  <SheetTitle>Chats</SheetTitle>
                  <SheetDescription>Pick a conversation from a simple list.</SheetDescription>
                </SheetHeader>
                <div className="p-4">
                  {threadsError ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-900">
                      Could not load chats right now.
                    </div>
                  ) : (
                    <ThreadList
                      threads={threadsData || []}
                      activeThreadId={activeThreadId}
                      onSelect={setActiveThreadId}
                    />
                  )}
                </div>
              </SheetContent>
            </Sheet>

            <Button
              variant="outline"
              onClick={() => createThreadMutation.mutate()}
              disabled={createThreadMutation.isPending}
            >
              {createThreadMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              New Chat
            </Button>

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">
                  <Settings2 className="mr-2 h-4 w-4" />
                  Settings
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-lg">
                <SheetHeader>
                  <SheetTitle>Agent Settings</SheetTitle>
                  <SheetDescription>
                    Keep the chat clean here. Provider and playbook controls live in this sheet.
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-6 space-y-6">
                  {isLoadingProfile ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading settings...
                    </div>
                  ) : profileError ? (
                    <ErrorStateCard
                      title="Couldn't load agent settings"
                      error={profileError}
                      onRetry={() => {
                        void refetchProfile();
                      }}
                    />
                  ) : (
                    <>
                      <div className="rounded-2xl border bg-muted/20 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">Enable Agent</div>
                            <div className="text-xs text-muted-foreground">
                              Pause new agent plans without removing your setup.
                            </div>
                          </div>
                          <Switch checked={enabled} onCheckedChange={setEnabled} />
                        </div>
                        <div className="mt-3 text-xs text-muted-foreground">
                          Hosted web research:{" "}
                          {profileData?.capabilities.canUseWebResearch
                            ? profileData.capabilities.webResearchProvider === "brave"
                              ? "Brave Search is available for managed and BYOK chats."
                              : "Available."
                            : "not configured on the server."}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="agent-playbook">Agent Playbook</Label>
                        <Textarea
                          id="agent-playbook"
                          value={userPromptTemplate}
                          onChange={(event) => setUserPromptTemplate(event.target.value)}
                          rows={6}
                        />
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="agent-source">AI Source</Label>
                          <Select
                            value={providerMode}
                            onValueChange={(value) => setProviderMode(value as ProviderMode)}
                          >
                            <SelectTrigger id="agent-source">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="managed">Sportfolio AI</SelectItem>
                              <SelectItem value="byok">Bring Your Own API</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="agent-sport">Focus Sport</Label>
                          <Select value={defaultSport} onValueChange={setDefaultSport}>
                            <SelectTrigger id="agent-sport">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ALL">All Sports</SelectItem>
                              <SelectItem value="NBA">NBA</SelectItem>
                              <SelectItem value="NFL">NFL</SelectItem>
                              <SelectItem value="MLB">MLB</SelectItem>
                              <SelectItem value="NASCAR">NASCAR</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <Button
                        className="w-full"
                        onClick={() => saveProfileMutation.mutate()}
                        disabled={saveProfileMutation.isPending}
                      >
                        {saveProfileMutation.isPending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Save Settings
                      </Button>

                      {providerMode === "managed" ? (
                        <div className="rounded-2xl border border-blue-200 bg-blue-50/80 p-4 text-sm text-blue-950">
                          <div className="flex items-center gap-2 font-medium">
                            <ShieldCheck className="h-4 w-4" />
                            Managed mode uses{" "}
                            {profileData?.profile.model || "the configured default"}.
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                          <div className="flex items-center gap-2 text-sm font-medium text-amber-950">
                            <KeyRound className="h-4 w-4" />
                            Bring Your Own API
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor="agent-base-url">Base URL</Label>
                              <Input
                                id="agent-base-url"
                                value={baseUrl}
                                onChange={(event) => setBaseUrl(event.target.value)}
                                placeholder="https://api.openai.com/v1"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="agent-model">Model</Label>
                              <Input
                                id="agent-model"
                                value={model}
                                onChange={(event) => setModel(event.target.value)}
                                placeholder="gpt-4o-mini"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="agent-api-key">API Key</Label>
                            <Input
                              id="agent-api-key"
                              type="password"
                              value={apiKey}
                              onChange={(event) => setApiKey(event.target.value)}
                              placeholder={
                                profileData?.secret.configured
                                  ? `Saved key ending in ${profileData.secret.keyLast4 || "****"}`
                                  : "Paste a compatible API key"
                              }
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              onClick={() => saveByokMutation.mutate()}
                              disabled={
                                saveByokMutation.isPending ||
                                !apiKey.trim() ||
                                !baseUrl.trim() ||
                                !model.trim()
                              }
                            >
                              {saveByokMutation.isPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              )}
                              Save BYOK
                            </Button>
                            {profileData?.secret.configured && (
                              <Button
                                variant="outline"
                                onClick={() => clearByokMutation.mutate()}
                                disabled={clearByokMutation.isPending}
                              >
                                {clearByokMutation.isPending && (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                )}
                                Remove Saved Key
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {profileError && !isLoadingProfile && (
          <div className="mb-4">
            <ErrorStateCard
              title="Couldn't load agent settings"
              error={profileError}
              onRetry={() => {
                void refetchProfile();
              }}
            />
          </div>
        )}

        <div className="grid flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="hidden overflow-hidden rounded-[2rem] border border-border/80 bg-background shadow-sm lg:flex lg:flex-col">
            <div className="border-b border-border/70 px-4 py-4">
              <div className="text-sm font-semibold text-foreground">Chats</div>
              <div className="text-xs text-muted-foreground">
                Swap threads from a simple conversation rail.
              </div>
            </div>
            <ScrollArea className="flex-1 px-3 py-3">
              {threadsError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-900">
                  Could not load chats right now.
                </div>
              ) : (
                <ThreadList
                  threads={threadsData || []}
                  activeThreadId={activeThreadId}
                  onSelect={setActiveThreadId}
                />
              )}
            </ScrollArea>
          </div>

          <div className="flex flex-1 flex-col overflow-hidden rounded-[2rem] border border-border/80 bg-background shadow-sm">
            <div className="flex items-center justify-between border-b border-border/70 px-4 py-3.5 sm:px-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-amber-600" />
                  <div className="truncate text-sm font-medium sm:text-base">
                    {activeThread
                      ? getThreadTitle(
                          activeThread,
                          threadsData?.findIndex((thread) => thread.id === activeThread.id) ?? 0,
                        )
                      : "Agent chat"}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {pendingBundle
                    ? "There is a plan waiting for confirmation."
                    : "Ask for the read first, then stage the move when you want it."}
                </div>
              </div>
              {pendingBundle && (
                <Badge className="bg-amber-600 text-white hover:bg-amber-600">Plan Ready</Badge>
              )}
            </div>

            <ScrollArea className="flex-1">
              <div className="mx-auto max-w-3xl space-y-4 px-4 py-4 sm:px-6 sm:py-5">
                {threadsError ? (
                  <ErrorStateCard
                    title="Couldn't load your agent chats"
                    error={threadsError}
                    onRetry={() => {
                      void refetchThreads();
                    }}
                  />
                ) : hasConversationLoadError ? (
                  <ErrorStateCard
                    title="Couldn't load this conversation"
                    error={activeThreadError || messagesError}
                    onRetry={() => {
                      void refetchActiveThread();
                      void refetchMessages();
                    }}
                  />
                ) : isBootstrappingThread ? (
                  <div className="flex items-center justify-center gap-2 rounded-2xl border border-border/70 bg-muted/20 p-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Starting your first agent chat...
                  </div>
                ) : isLoadingMessages && activeThreadId ? (
                  <div className="flex items-center justify-center gap-2 rounded-2xl border border-border/70 bg-muted/20 p-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading conversation...
                  </div>
                ) : !messagesData || messagesData.length === 0 ? (
                  <div className="rounded-3xl border border-border/70 bg-muted/20 p-6 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2 font-medium text-foreground">
                      <Sparkles className="h-4 w-4 text-amber-600" />
                      Start the conversation.
                    </div>
                    <p className="mt-2 leading-6">
                      Use the chat like a normal assistant. Ask for a read first, then give the
                      direct instruction when you want a staged move.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {starterPrompts.map((prompt) => (
                        <Button
                          key={prompt}
                          type="button"
                          variant="outline"
                          className="rounded-2xl"
                          onClick={() => setComposerValue(prompt)}
                        >
                          {prompt}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messagesData.map((message) => {
                    const isUser = message.role === "user";
                    return (
                      <div
                        key={message.id}
                        className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
                      >
                        <div
                          className={cn(
                            "w-full rounded-3xl px-4 py-3.5 sm:max-w-[86%]",
                            isUser
                              ? "bg-slate-900 text-white"
                              : message.messageType === "error"
                                ? "border border-red-200 bg-red-50 text-red-900"
                                : "border border-border/70 bg-muted/10",
                          )}
                        >
                          <div
                            className={cn(
                              "mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em]",
                              isUser ? "text-slate-300" : "text-muted-foreground",
                            )}
                          >
                            {isUser ? (
                              <User2 className="h-3.5 w-3.5" />
                            ) : (
                              <Bot className="h-3.5 w-3.5" />
                            )}
                            {isUser ? "You" : "Agent"}
                          </div>
                          <div className="whitespace-pre-wrap text-sm leading-6">
                            {message.contentText}
                          </div>
                          {message.citations && message.citations.length > 0 && (
                            <CitationList citations={message.citations} />
                          )}
                          <div
                            className={cn(
                              "mt-3 text-[11px]",
                              isUser ? "text-slate-400" : "text-muted-foreground",
                            )}
                          >
                            {new Date(message.createdAt).toLocaleString()}
                          </div>
                          {message.actionBundle && activeThreadId && (
                            <BundleCard
                              bundle={message.actionBundle}
                              onConfirm={() => confirmMutation.mutate(activeThreadId)}
                              onCancel={() => cancelMutation.mutate(activeThreadId)}
                              isConfirming={confirmMutation.isPending}
                              isCanceling={cancelMutation.isPending}
                            />
                          )}
                          {!message.actionBundle && message.pendingClarification && (
                            <ClarificationCard clarification={message.pendingClarification} />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={threadEndRef} />
              </div>
            </ScrollArea>

            <div className="border-t border-border/70 bg-background px-4 py-3 sm:px-6">
              <div className="mx-auto max-w-3xl">
                <div className="rounded-[1.75rem] border border-border/70 bg-background px-3 py-2.5 shadow-sm">
                  <div className="flex items-end gap-3">
                    <Textarea
                      className="min-h-[56px] flex-1 resize-none border-0 bg-transparent px-0 py-1 shadow-none focus-visible:ring-0"
                      value={composerValue}
                      onChange={(event) => setComposerValue(event.target.value)}
                      rows={2}
                      placeholder={
                        enabled
                          ? 'Try "Review my setup" or "Buy $100 of Nikola Jokic."'
                          : "Re-enable the agent in Settings to send a request."
                      }
                      disabled={!enabled}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                          event.preventDefault();
                          void handleSend();
                        }
                      }}
                    />
                    <Button
                      className="h-11 w-11 shrink-0 rounded-full p-0"
                      onClick={() => void handleSend()}
                      disabled={isSendDisabled}
                    >
                      {sendMessageMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      <span className="sr-only">Send</span>
                    </Button>
                  </div>
                  <div className="mt-2 px-1 text-[11px] text-muted-foreground">
                    Plans are staged first. Press Cmd/Ctrl+Enter to send.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
