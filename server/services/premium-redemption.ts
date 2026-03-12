import { storage } from "../storage";

async function recordPremiumActivityEvent(event: {
  userId: string;
  eventType: "premium_credit" | "premium_redeem" | "premium_admin_credit";
  quantityDelta: number;
  amountCents?: number;
  daysGranted?: number;
  premiumExpiresAtAfter?: Date | string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await storage.createPremiumActivityEvent({
      userId: event.userId,
      eventType: event.eventType,
      quantityDelta: event.quantityDelta,
      amountCents: event.amountCents,
      daysGranted: event.daysGranted,
      premiumExpiresAtAfter:
        event.premiumExpiresAtAfter instanceof Date
          ? event.premiumExpiresAtAfter
          : typeof event.premiumExpiresAtAfter === "string"
            ? new Date(event.premiumExpiresAtAfter)
            : undefined,
      referenceId: event.referenceId,
      metadata: event.metadata ?? {},
    });
  } catch (error: any) {
    console.warn("[PREMIUM_ACTIVITY] Could not record premium activity:", error?.message || error);
  }
}

export async function redeemPremiumShare(userId: string) {
  const user = await storage.getUser(userId);
  if (!user) {
    throw new Error("User not found");
  }

  const premiumHolding = await storage.getHolding(user.id, "premium", "premium");
  if (!premiumHolding || parseFloat(premiumHolding.quantity) < 1) {
    throw new Error("No premium shares to redeem");
  }

  const remainingShares = Math.max(parseFloat(premiumHolding.quantity) - 1, 0);

  await storage.updateHolding(user.id, "premium", "premium", remainingShares, "0.0000");

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await storage.updateUserPremiumStatus(user.id, true, expiresAt);

  await recordPremiumActivityEvent({
    userId: user.id,
    eventType: "premium_redeem",
    quantityDelta: -1,
    daysGranted: 30,
    premiumExpiresAtAfter: expiresAt,
    metadata: {
      source: "premium_redeem",
      remainingShares,
    },
  });

  return {
    success: true,
    isPremium: true,
    premiumExpiresAt: expiresAt.toISOString(),
    remainingShares,
  };
}
