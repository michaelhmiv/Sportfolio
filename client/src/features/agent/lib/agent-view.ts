import type {
  AgentAction,
  AgentActionBundle,
  AgentPendingClarification,
  AgentThreadSummary,
} from "../types";

export function getReadableAgentError(error: unknown, fallback: string) {
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

export function formatCurrency(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return `$${value.toFixed(2)}`;
}

export function formatNumericValue(value: number | null | undefined, fractionDigits = 0) {
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

export function formatShareCount(value: number | null | undefined, fractionDigits = 0) {
  return formatUnitValue(value, "share", "shares", fractionDigits);
}

function formatLpShareCount(value: number | null | undefined, fractionDigits = 2) {
  return formatUnitValue(value, "LP share", "LP shares", fractionDigits);
}

export function formatPercent(value: number | null | undefined, fractionDigits = 2) {
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

export function formatDomainLabel(domain: AgentActionBundle["domain"]) {
  switch (domain) {
    case "player_pools":
      return "Player Pools";
    case "daily_boosts":
      return "Daily Boosts";
    case "community_boosts":
      return "Community Boosts";
    case "watchlists":
      return "Watchlists";
    case "sportfolio":
      return "Sportfolio";
    case "scouting":
    default:
      return "Scouting";
  }
}

export function getBundleStatusLabel(status: AgentActionBundle["status"]) {
  switch (status) {
    case "pending_confirmation":
      return "Pending Confirmation";
    case "pending_clarification":
      return "Waiting On Detail";
    case "applied":
      return "Applied";
    case "rejected":
      return "Rejected";
    case "failed":
      return "Failed";
    case "expired":
    default:
      return "Expired";
  }
}

export function getActionMeta(action: AgentAction) {
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
    case "holdings_stack_shares":
      return `${action.sharesToStack || 0} shares -> ${action.expectedStackedShareCount || 0} stacked share`;
    case "daily_boost_assign":
      return `${action.slotTier || 0}x slot${action.boostDate ? ` | ${action.boostDate}` : ""}`;
    case "daily_boost_remove":
      return `${action.slotTier || 0}x slot`;
    case "watchlist_add_player":
      return action.watchlistName || "default watchlist";
    case "watchlist_remove_player":
      return action.removeFromAll ? "all watchlists" : action.watchlistName || "watchlist";
    case "community_boost_create":
      return `${action.boostDate || ""}${
        action.communitySharesAvailable != null
          ? ` | ${action.communitySharesAvailable} share${action.communitySharesAvailable === 1 ? "" : "s"} ready`
          : ""
      }`;
    case "scout_set_count":
    default:
      return `${action.currentCount || 0} to ${action.targetCount || 0} scouts`;
  }
}

export type ActionComparisonRow = {
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

function getHoldingsStackSharesComparisonRows(action: AgentAction): ActionComparisonRow[] {
  const sharesBefore = formatShareCount(action.availableSharesBefore);
  const sharesAfter = formatShareCount(action.availableSharesAfter);

  return [
    {
      label: "Raw shares",
      current: sharesBefore || `${action.sharesToStack || 0} raw shares available to stack`,
      proposed: sharesAfter || `${action.sharesToStack || 0} raw shares consumed by stacking`,
    },
    {
      label: "Stacked outcome",
      current: "No stacked multiplier yet",
      proposed: `${action.expectedStackedShareCount || 0} stacked share(s), +${
        action.expectedMultiplierGained || 0
      }x multiplier`,
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
      label: "Boost multiplier",
      current: "No share locked into the slot yet",
      proposed:
        action.shareMultiplier != null
          ? `${formatNumericValue(action.shareMultiplier, 2) || action.shareMultiplier.toString()} x enters the slot`
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

export function getActionComparisonRows(action: AgentAction): ActionComparisonRow[] {
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
    case "holdings_stack_shares":
      return getHoldingsStackSharesComparisonRows(action);
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

export function getActionPreviewRows(action: AgentAction) {
  return getActionComparisonRows(action).slice(0, 2);
}

export function getPrimaryClarification(bundle: AgentActionBundle) {
  if (bundle.pendingClarification) {
    return bundle.pendingClarification;
  }

  return (
    bundle.steps.find((step) => step.clarificationPrompt)?.clarificationPrompt
      ? {
          kind: "player_name",
          prompt: bundle.steps.find((step) => step.clarificationPrompt)?.clarificationPrompt || "",
          missingFields: [],
        }
      : null
  ) as AgentPendingClarification | null;
}

export function getThreadTitle(thread: AgentThreadSummary, index: number) {
  const trimmedTitle = thread.title?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  return `Chat ${index + 1}`;
}

export function formatThreadTimestamp(value: string | null) {
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
