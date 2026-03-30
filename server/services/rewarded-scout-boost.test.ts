import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRewardedScoutBoostSessionToken,
  grantVerifiedRewardedScoutBoost,
  verifyAdMobSsvCallbackUrl,
  verifyRewardedScoutBoostCustomData,
} from "./rewarded-scout-boost";

describe("rewarded scout boost session tokens", () => {
  beforeEach(() => {
    process.env.REWARDED_SCOUT_BOOST_SECRET = "test-rewarded-scout-secret";
  });

  it("round-trips a signed rewarded scout boost token", () => {
    const now = new Date("2026-03-29T12:00:00.000Z");
    const session = createRewardedScoutBoostSessionToken(
      "user-token",
      now,
      process.env.REWARDED_SCOUT_BOOST_SECRET,
    );

    const payload = verifyRewardedScoutBoostCustomData(
      session.customData,
      new Date("2026-03-29T12:05:00.000Z"),
      process.env.REWARDED_SCOUT_BOOST_SECRET,
    );

    expect(payload.uid).toBe("user-token");
    expect(payload.sid).toBe(session.rewardSessionId);
  });
});

describe("verifyAdMobSsvCallbackUrl", () => {
  function buildSignedCallbackUrl(customData: string) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const queryWithoutSignature = new URLSearchParams({
      ad_network: "5450213213286189855",
      ad_unit: "ca-app-pub-3940256099942544/5224354917",
      custom_data: customData,
      reward_amount: "1",
      reward_item: "scout_boost",
      timestamp: "1774785600000",
      transaction_id: "tx-signed-1",
    }).toString();
    const signature = sign(
      "sha256",
      Buffer.from(queryWithoutSignature, "utf8"),
      privateKey,
    ).toString("base64url");

    return {
      callbackUrl: `https://example.com/api/mobile/rewarded-scout-boost/admob/ssv?${queryWithoutSignature}&signature=${signature}&key_id=test-key`,
      keyMap: new Map([["test-key", publicKey.export({ format: "pem", type: "spki" }).toString()]]),
    };
  }

  it("accepts a valid signed AdMob SSV callback", async () => {
    const { callbackUrl, keyMap } = buildSignedCallbackUrl("ssb.payload.signature");
    const verified = await verifyAdMobSsvCallbackUrl(callbackUrl, async () => keyMap);

    expect(verified.transactionId).toBe("tx-signed-1");
    expect(verified.rewardItem).toBe("scout_boost");
    expect(verified.customData).toBe("ssb.payload.signature");
  });

  it("rejects a forged callback with an invalid signature", async () => {
    const { callbackUrl, keyMap } = buildSignedCallbackUrl("ssb.payload.signature");
    const tamperedUrl = callbackUrl.replace(
      "transaction_id=tx-signed-1",
      "transaction_id=tx-forged",
    );

    await expect(verifyAdMobSsvCallbackUrl(tamperedUrl, async () => keyMap)).rejects.toThrow(
      "Invalid AdMob reward callback signature",
    );
  });
});

describe("grantVerifiedRewardedScoutBoost", () => {
  beforeEach(() => {
    process.env.REWARDED_SCOUT_BOOST_SECRET = "test-rewarded-scout-secret";
  });

  function buildVerifiedCallback(
    customData: string,
    transactionId = "tx-grant-1",
    rewardUserId = "user-grant",
  ) {
    return {
      callbackUrl: "https://example.com",
      queryString: "query",
      transactionId,
      adNetwork: "admob",
      adUnitId: "ca-app-pub-3940256099942544/5224354917",
      rewardItem: "scout_boost",
      rewardAmount: 1,
      rewardUserId,
      customData,
      rewardedAt: new Date("2026-03-29T12:00:00.000Z"),
      signature: "sig",
      keyId: "test-key",
    };
  }

  it("creates a new rewarded scout boost grant when the user is eligible", async () => {
    const now = new Date("2026-03-29T12:00:00.000Z");
    const session = createRewardedScoutBoostSessionToken(
      "user-grant",
      now,
      process.env.REWARDED_SCOUT_BOOST_SECRET,
    );

    const createRewardedScoutBoostGrant = vi.fn().mockImplementation(async (grant) => ({
      id: "grant-1",
      grantedAt: now,
      createdAt: now,
      revokedAt: null,
      metadata: {},
      ...grant,
    }));

    const result = await grantVerifiedRewardedScoutBoost(
      {
        getUser: vi.fn().mockResolvedValue({
          id: "user-grant",
          isPremium: false,
          premiumExpiresAt: null,
        }),
        updateUserPremiumStatus: vi.fn().mockResolvedValue(undefined),
        getActiveRewardedScoutBoostForUser: vi.fn().mockResolvedValue(undefined),
        createRewardedScoutBoostGrant,
      },
      buildVerifiedCallback(session.customData),
      now,
    );

    expect(result.outcome).toBe("granted");
    expect(createRewardedScoutBoostGrant).toHaveBeenCalledTimes(1);
  });

  it("does not stack a second rewarded boost while one is already active", async () => {
    const now = new Date("2026-03-29T12:00:00.000Z");
    const session = createRewardedScoutBoostSessionToken(
      "user-active",
      now,
      process.env.REWARDED_SCOUT_BOOST_SECRET,
    );
    const createRewardedScoutBoostGrant = vi.fn();

    const result = await grantVerifiedRewardedScoutBoost(
      {
        getUser: vi.fn().mockResolvedValue({
          id: "user-active",
          isPremium: false,
          premiumExpiresAt: null,
        }),
        updateUserPremiumStatus: vi.fn().mockResolvedValue(undefined),
        getActiveRewardedScoutBoostForUser: vi.fn().mockResolvedValue({
          expiresAt: new Date("2026-03-29T18:00:00.000Z"),
          revokedAt: null,
        }),
        createRewardedScoutBoostGrant,
      },
      buildVerifiedCallback(session.customData, "tx-active-1", "user-active"),
      now,
    );

    expect(result.outcome).toBe("already_active");
    expect(createRewardedScoutBoostGrant).not.toHaveBeenCalled();
  });

  it("treats repeated SSV callbacks as duplicates when the grant insert is idempotent", async () => {
    const now = new Date("2026-03-29T12:00:00.000Z");
    const session = createRewardedScoutBoostSessionToken(
      "user-duplicate",
      now,
      process.env.REWARDED_SCOUT_BOOST_SECRET,
    );

    const result = await grantVerifiedRewardedScoutBoost(
      {
        getUser: vi.fn().mockResolvedValue({
          id: "user-duplicate",
          isPremium: false,
          premiumExpiresAt: null,
        }),
        updateUserPremiumStatus: vi.fn().mockResolvedValue(undefined),
        getActiveRewardedScoutBoostForUser: vi.fn().mockResolvedValue(undefined),
        createRewardedScoutBoostGrant: vi.fn().mockResolvedValue(undefined),
      },
      buildVerifiedCallback(session.customData, "tx-duplicate-1", "user-duplicate"),
      now,
    );

    expect(result.outcome).toBe("duplicate");
  });

  it("repairs stale premium flags before granting a rewarded scout boost", async () => {
    const now = new Date("2026-03-29T12:00:00.000Z");
    const session = createRewardedScoutBoostSessionToken(
      "user-stale-premium",
      now,
      process.env.REWARDED_SCOUT_BOOST_SECRET,
    );
    const updateUserPremiumStatus = vi.fn().mockResolvedValue(undefined);
    const createRewardedScoutBoostGrant = vi.fn().mockImplementation(async (grant) => ({
      id: "grant-stale-premium",
      grantedAt: now,
      createdAt: now,
      revokedAt: null,
      metadata: {},
      ...grant,
    }));

    const result = await grantVerifiedRewardedScoutBoost(
      {
        getUser: vi.fn().mockResolvedValue({
          id: "user-stale-premium",
          isPremium: true,
          premiumExpiresAt: new Date("2026-03-28T12:00:00.000Z"),
        }),
        updateUserPremiumStatus,
        getActiveRewardedScoutBoostForUser: vi.fn().mockResolvedValue(undefined),
        createRewardedScoutBoostGrant,
      },
      buildVerifiedCallback(session.customData, "tx-stale-premium-1", "user-stale-premium"),
      now,
    );

    expect(result.outcome).toBe("granted");
    expect(updateUserPremiumStatus).toHaveBeenCalledWith(
      "user-stale-premium",
      false,
      new Date("2026-03-28T12:00:00.000Z"),
    );
    expect(createRewardedScoutBoostGrant).toHaveBeenCalledTimes(1);
  });
});
