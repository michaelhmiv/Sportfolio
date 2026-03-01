import { calculateAccrualUpdate } from "@shared/vesting-utils";
import { storage } from "../storage";

export interface AgentVestingClaimDistribution {
  playerId: string;
  playerName: string | null;
  shares: number;
}

export interface AgentVestingClaimPreview {
  claimableShares: number;
  distributionCount: number;
  usingSplits: boolean;
  targetDescription: string;
  primaryPlayerId: string;
  primaryPlayerName: string | null;
  distributions: AgentVestingClaimDistribution[];
}

async function loadCurrentVestingState(userId: string) {
  const [user, vestingData, splits] = await Promise.all([
    storage.getUser(userId),
    storage.getVesting(userId),
    storage.getVestingSplits(userId),
  ]);

  if (!user || !vestingData) {
    return null;
  }

  const now = new Date();
  const isPremium = user.isPremium || false;
  const capLimit = isPremium ? 4800 : 2400;
  const totalSharesPerHour = isPremium ? 200 : 100;
  const effectiveLastAccruedAt = vestingData.lastAccruedAt || vestingData.updatedAt || now;

  const update = calculateAccrualUpdate(
    {
      sharesAccumulated: vestingData.sharesAccumulated,
      residualMs: vestingData.residualMs || 0,
      lastAccruedAt: effectiveLastAccruedAt,
      sharesPerHour: totalSharesPerHour,
      capLimit,
    },
    now,
  );

  return {
    user,
    vestingData,
    splits,
    now,
    claimableShares: update.sharesAccumulated,
  };
}

function buildSplitDistributions(
  splits: Awaited<ReturnType<typeof storage.getVestingSplits>>,
  totalAccumulated: number,
) {
  const totalRate = 100;
  const distributions = splits.map((split) => {
    const proportion = split.sharesPerHour / totalRate;
    const shares = Math.floor(proportion * totalAccumulated);
    return { ...split, shares };
  });
  const remainder = totalAccumulated - distributions.reduce((sum, entry) => sum + entry.shares, 0);
  const sortedByRate = [...distributions].sort(
    (left, right) => right.sharesPerHour - left.sharesPerHour,
  );

  for (let index = 0; index < remainder; index += 1) {
    const target = sortedByRate[index];
    if (target) {
      target.shares += 1;
    }
  }

  return distributions.filter((entry) => entry.shares > 0);
}

export async function previewVestingClaim(
  userId: string,
): Promise<AgentVestingClaimPreview | null> {
  const state = await loadCurrentVestingState(userId);
  if (!state || state.claimableShares <= 0) {
    return null;
  }

  const usingSplits = state.splits.length > 0;
  if (!usingSplits) {
    if (!state.vestingData.playerId) {
      return null;
    }

    const player = await storage.getPlayer(state.vestingData.playerId);
    if (!player) {
      return null;
    }

    const playerName = `${player.firstName} ${player.lastName}`;
    return {
      claimableShares: state.claimableShares,
      distributionCount: 1,
      usingSplits: false,
      targetDescription: `${state.claimableShares} share${state.claimableShares === 1 ? "" : "s"} into ${playerName}`,
      primaryPlayerId: player.id,
      primaryPlayerName: playerName,
      distributions: [
        {
          playerId: player.id,
          playerName,
          shares: state.claimableShares,
        },
      ],
    };
  }

  const distributions = buildSplitDistributions(state.splits, state.claimableShares);
  if (distributions.length === 0) {
    return null;
  }

  const players = await storage.getPlayersByIds(distributions.map((entry) => entry.playerId));
  const playersById = new Map(
    players.map((player) => [player.id, `${player.firstName} ${player.lastName}`]),
  );
  const distributionPreview = distributions.map((entry) => ({
    playerId: entry.playerId,
    playerName: playersById.get(entry.playerId) || null,
    shares: entry.shares,
  }));
  const primary = [...distributionPreview].sort((left, right) => right.shares - left.shares)[0];
  const describedPlayers = distributionPreview
    .slice()
    .sort((left, right) => right.shares - left.shares)
    .slice(0, 2)
    .map((entry) => entry.playerName || entry.playerId);

  return {
    claimableShares: state.claimableShares,
    distributionCount: distributionPreview.length,
    usingSplits: true,
    targetDescription:
      distributionPreview.length === 1
        ? `${state.claimableShares} share${state.claimableShares === 1 ? "" : "s"} into ${describedPlayers[0]}`
        : `${state.claimableShares} shares across ${distributionPreview.length} vesting targets (led by ${describedPlayers.join(" and ")})`,
    primaryPlayerId: primary?.playerId || "vesting_multi",
    primaryPlayerName: primary?.playerName || null,
    distributions: distributionPreview,
  };
}

export async function claimVestingShares(userId: string): Promise<AgentVestingClaimPreview> {
  const preview = await previewVestingClaim(userId);
  if (!preview) {
    throw new Error("No shares to claim");
  }

  const holdings = await storage.getBatchHoldings(
    userId,
    "player",
    preview.distributions.map((entry) => entry.playerId),
  );

  for (const distribution of preview.distributions) {
    const holding = holdings.get(distribution.playerId);
    if (holding) {
      const newQuantity = Number.parseFloat(holding.quantity) + distribution.shares;
      const newTotalCost = Number.parseFloat(holding.totalCostBasis);
      const newAvgCost = newQuantity > 0 ? newTotalCost / newQuantity : 0;
      await storage.updateHolding(
        userId,
        "player",
        distribution.playerId,
        newQuantity,
        newAvgCost.toFixed(4),
      );
    } else {
      await storage.updateHolding(
        userId,
        "player",
        distribution.playerId,
        distribution.shares,
        "0.0000",
      );
    }

    await storage.createVestingClaim({
      userId,
      playerId: distribution.playerId,
      sharesClaimed: distribution.shares,
    });
  }

  await storage.incrementTotalSharesVested(userId, preview.claimableShares);

  const now = new Date();
  await storage.updateVesting(userId, {
    sharesAccumulated: 0,
    lastClaimedAt: now,
    lastAccruedAt: now,
    updatedAt: now,
    residualMs: 0,
    capReachedAt: null,
  });

  return preview;
}
