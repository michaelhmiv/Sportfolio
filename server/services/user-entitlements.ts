import type { RewardedScoutBoostGrant, User } from "@shared/schema";
import type { IStorage } from "../storage";

export const BASE_SCOUT_CAPACITY = 5;
export const BOOSTED_SCOUT_CAPACITY = 10;

type EntitlementUser = Pick<User, "id" | "isPremium" | "premiumExpiresAt">;
type RewardedScoutBoostSnapshot = Pick<RewardedScoutBoostGrant, "expiresAt" | "revokedAt">;

export interface UserEntitlements {
  premiumActive: boolean;
  premiumExpiresAt: Date | null;
  rewardedScoutBoostActive: boolean;
  rewardedScoutBoostExpiresAt: Date | null;
  maxScouts: number;
  hasExpiredPremiumFlag: boolean;
}

export function resolveUserEntitlements(
  user: EntitlementUser,
  rewardedScoutBoost?: RewardedScoutBoostSnapshot | null,
  now: Date = new Date(),
): UserEntitlements {
  const premiumExpiresAt = user.premiumExpiresAt ?? null;
  const premiumActive =
    user.isPremium && (!premiumExpiresAt || premiumExpiresAt.getTime() > now.getTime());
  const rewardedScoutBoostExpiresAt =
    rewardedScoutBoost && !rewardedScoutBoost.revokedAt ? rewardedScoutBoost.expiresAt : null;
  const rewardedScoutBoostActive = Boolean(
    rewardedScoutBoostExpiresAt && rewardedScoutBoostExpiresAt.getTime() > now.getTime(),
  );

  return {
    premiumActive,
    premiumExpiresAt,
    rewardedScoutBoostActive,
    rewardedScoutBoostExpiresAt,
    maxScouts:
      premiumActive || rewardedScoutBoostActive ? BOOSTED_SCOUT_CAPACITY : BASE_SCOUT_CAPACITY,
    hasExpiredPremiumFlag: Boolean(
      user.isPremium && premiumExpiresAt && premiumExpiresAt.getTime() <= now.getTime(),
    ),
  };
}

export function applyEntitlementsToUser<T extends EntitlementUser>(
  user: T,
  entitlements: UserEntitlements,
) {
  return {
    ...user,
    isPremium: entitlements.premiumActive,
    premiumActive: entitlements.premiumActive,
    rewardedScoutBoostActive: entitlements.rewardedScoutBoostActive,
    rewardedScoutBoostExpiresAt: entitlements.rewardedScoutBoostExpiresAt,
    maxScouts: entitlements.maxScouts,
  };
}

export async function loadUserEntitlements(
  deps: Pick<
    IStorage,
    "getUser" | "getActiveRewardedScoutBoostForUser" | "updateUserPremiumStatus"
  >,
  userId: string,
  now: Date = new Date(),
) {
  const user = await deps.getUser(userId);
  if (!user) {
    return null;
  }

  let effectiveUser = user;
  let entitlements = resolveUserEntitlements(user, null, now);

  if (entitlements.hasExpiredPremiumFlag) {
    await deps.updateUserPremiumStatus(user.id, false, user.premiumExpiresAt ?? null);
    effectiveUser = {
      ...user,
      isPremium: false,
    };
    entitlements = resolveUserEntitlements(effectiveUser, null, now);
  }

  const rewardedScoutBoost = await deps.getActiveRewardedScoutBoostForUser(user.id, now);
  entitlements = resolveUserEntitlements(effectiveUser, rewardedScoutBoost, now);

  return {
    user: effectiveUser,
    rewardedScoutBoost,
    entitlements,
    decoratedUser: applyEntitlementsToUser(effectiveUser, entitlements),
  };
}
