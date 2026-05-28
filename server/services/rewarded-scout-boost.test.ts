import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRewardedScoutBoostSessionToken,
  grantClientCompletedRewardedScoutBoost,
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
  function buildSignedCallbackUrl(
    customData?: string,
    signatureEncoding: "base64url" | "escapedBase64" = "base64url",
    rewardItem = "scout_boost",
  ) {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const signedParams = [
      ["ad_network", "5450213213286189855"],
      ["ad_unit", "ca-app-pub-3940256099942544/5224354917"],
      ["reward_amount", "1"],
      ["reward_item", rewardItem],
      ["timestamp", "1774785600000"],
      ["transaction_id", "tx-signed-1"],
    ];
    if (customData) {
      signedParams.push(["custom_data", customData]);
    }
    const signedContent = signedParams.map(([key, value]) => `${key}=${value}`).join("&");
    const queryWithoutSignature = signedParams
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");
    const signatureBytes = sign("sha256", Buffer.from(signedContent, "utf8"), privateKey);
    const signature =
      signatureEncoding === "escapedBase64"
        ? encodeURIComponent(signatureBytes.toString("base64"))
        : signatureBytes.toString("base64url");

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

  it("accepts a valid signed AdMob setup probe without custom data", async () => {
    const { callbackUrl, keyMap } = buildSignedCallbackUrl();
    const verified = await verifyAdMobSsvCallbackUrl(callbackUrl, async () => keyMap);

    expect(verified.transactionId).toBe("tx-signed-1");
    expect(verified.customData).toBeNull();
  });

  it("accepts a valid signed AdMob callback with a percent-escaped base64 signature", async () => {
    const { callbackUrl, keyMap } = buildSignedCallbackUrl(undefined, "escapedBase64");
    const verified = await verifyAdMobSsvCallbackUrl(callbackUrl, async () => keyMap);

    expect(verified.transactionId).toBe("tx-signed-1");
    expect(verified.customData).toBeNull();
  });

  it("accepts a valid signed AdMob setup probe with percent-escaped reward text", async () => {
    const { callbackUrl, keyMap } = buildSignedCallbackUrl(undefined, "base64url", "Scout Boost");
    const verified = await verifyAdMobSsvCallbackUrl(callbackUrl, async () => keyMap);

    expect(callbackUrl).toContain("reward_item=Scout%20Boost");
    expect(verified.rewardItem).toBe("Scout Boost");
    expect(verified.customData).toBeNull();
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

  const noExistingGrant = vi.fn().mockResolvedValue(undefined);
  const updateRewardedScoutBoostGrantMetadata = vi.fn();

  it("creates a new rewarded scout boost grant when the user is eligible", async () => {
    const now = new Date("2026-03-29T12:00:00.000Z");
    const session = createRewardedScoutBoostSessionToken(
      "user-grant",
      now,
      process.env.REWARDED_SCOUT_BOOST_SECRET,
    );

    const createStackedRewardedScoutBoostGrant = vi
      .fn()
      .mockImplementation(async (grant, durationMs, grantNow) => ({
        id: "grant-1",
        grantedAt: now,
        createdAt: now,
        revokedAt: null,
        metadata: {},
        ...grant,
        expiresAt: new Date(grantNow.getTime() + durationMs),
      }));

    const result = await grantVerifiedRewardedScoutBoost(
      {
        getUser: vi.fn().mockResolvedValue({
          id: "user-grant",
          isPremium: false,
          premiumExpiresAt: null,
        }),
        updateUserPremiumStatus: vi.fn().mockResolvedValue(undefined),
        getLatestRewardedScoutBoostGrantBySessionId: noExistingGrant,
        createStackedRewardedScoutBoostGrant,
        updateRewardedScoutBoostGrantMetadata,
      },
      buildVerifiedCallback(session.customData),
      now,
    );

    expect(result.outcome).toBe("granted");
    expect(result.expiresAt).toEqual(new Date("2026-03-30T00:00:00.000Z"));
    expect(createStackedRewardedScoutBoostGrant).toHaveBeenCalledTimes(1);
  });

  it("extends from the existing expiration when a rewarded boost is already active", async () => {
    const now = new Date("2026-03-29T12:00:00.000Z");
    const session = createRewardedScoutBoostSessionToken(
      "user-active",
      now,
      process.env.REWARDED_SCOUT_BOOST_SECRET,
    );
    const existingExpiresAt = new Date("2026-03-29T18:00:00.000Z");
    const createStackedRewardedScoutBoostGrant = vi
      .fn()
      .mockImplementation(async (grant, durationMs) => ({
        id: "grant-active",
        grantedAt: now,
        createdAt: now,
        revokedAt: null,
        metadata: {},
        ...grant,
        expiresAt: new Date(existingExpiresAt.getTime() + durationMs),
      }));

    const result = await grantVerifiedRewardedScoutBoost(
      {
        getUser: vi.fn().mockResolvedValue({
          id: "user-active",
          isPremium: false,
          premiumExpiresAt: null,
        }),
        updateUserPremiumStatus: vi.fn().mockResolvedValue(undefined),
        getLatestRewardedScoutBoostGrantBySessionId: noExistingGrant,
        createStackedRewardedScoutBoostGrant,
        updateRewardedScoutBoostGrantMetadata,
      },
      buildVerifiedCallback(session.customData, "tx-active-1", "user-active"),
      now,
    );

    expect(result.outcome).toBe("granted");
    expect(result.expiresAt).toEqual(new Date("2026-03-30T06:00:00.000Z"));
    expect(createStackedRewardedScoutBoostGrant).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: "tx-active-1" }),
      12 * 60 * 60 * 1000,
      now,
    );
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
        getLatestRewardedScoutBoostGrantBySessionId: noExistingGrant,
        createStackedRewardedScoutBoostGrant: vi.fn().mockResolvedValue(undefined),
        updateRewardedScoutBoostGrantMetadata,
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
    const createStackedRewardedScoutBoostGrant = vi.fn().mockImplementation(async (grant) => ({
      id: "grant-stale-premium",
      grantedAt: now,
      createdAt: now,
      revokedAt: null,
      metadata: {},
      ...grant,
      expiresAt: new Date("2026-03-30T00:00:00.000Z"),
    }));

    const result = await grantVerifiedRewardedScoutBoost(
      {
        getUser: vi.fn().mockResolvedValue({
          id: "user-stale-premium",
          isPremium: true,
          premiumExpiresAt: new Date("2026-03-28T12:00:00.000Z"),
        }),
        updateUserPremiumStatus,
        getLatestRewardedScoutBoostGrantBySessionId: noExistingGrant,
        createStackedRewardedScoutBoostGrant,
        updateRewardedScoutBoostGrantMetadata,
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
    expect(createStackedRewardedScoutBoostGrant).toHaveBeenCalledTimes(1);
  });

  it("does not bank rewarded scout boost time for active premium users", async () => {
    const now = new Date("2026-03-29T12:00:00.000Z");
    const session = createRewardedScoutBoostSessionToken(
      "user-premium",
      now,
      process.env.REWARDED_SCOUT_BOOST_SECRET,
    );
    const createStackedRewardedScoutBoostGrant = vi.fn();

    const result = await grantVerifiedRewardedScoutBoost(
      {
        getUser: vi.fn().mockResolvedValue({
          id: "user-premium",
          isPremium: true,
          premiumExpiresAt: new Date("2026-03-30T12:00:00.000Z"),
        }),
        updateUserPremiumStatus: vi.fn().mockResolvedValue(undefined),
        getLatestRewardedScoutBoostGrantBySessionId: noExistingGrant,
        createStackedRewardedScoutBoostGrant,
        updateRewardedScoutBoostGrantMetadata,
      },
      buildVerifiedCallback(session.customData, "tx-premium-1", "user-premium"),
      now,
    );

    expect(result.outcome).toBe("premium_active");
    expect(createStackedRewardedScoutBoostGrant).not.toHaveBeenCalled();
  });

  it("stacks two unique verified callbacks into 24 hours of boost time", async () => {
    const now = new Date("2026-03-29T12:00:00.000Z");
    const firstSession = createRewardedScoutBoostSessionToken(
      "user-stack",
      now,
      process.env.REWARDED_SCOUT_BOOST_SECRET,
    );
    const secondSession = createRewardedScoutBoostSessionToken(
      "user-stack",
      new Date("2026-03-29T12:01:00.000Z"),
      process.env.REWARDED_SCOUT_BOOST_SECRET,
    );
    let currentExpiresAt: Date | null = null;
    const createStackedRewardedScoutBoostGrant = vi
      .fn()
      .mockImplementation(async (grant, durationMs, grantNow) => {
        const baseTime =
          currentExpiresAt && currentExpiresAt > grantNow ? currentExpiresAt : grantNow;
        currentExpiresAt = new Date(baseTime.getTime() + durationMs);
        return {
          id: `grant-${grant.transactionId}`,
          grantedAt: grantNow,
          createdAt: grantNow,
          revokedAt: null,
          metadata: {},
          ...grant,
          expiresAt: currentExpiresAt,
        };
      });

    const storage = {
      getUser: vi.fn().mockResolvedValue({
        id: "user-stack",
        isPremium: false,
        premiumExpiresAt: null,
      }),
      updateUserPremiumStatus: vi.fn().mockResolvedValue(undefined),
      getLatestRewardedScoutBoostGrantBySessionId: noExistingGrant,
      createStackedRewardedScoutBoostGrant,
      updateRewardedScoutBoostGrantMetadata,
    };

    const first = await grantVerifiedRewardedScoutBoost(
      storage,
      buildVerifiedCallback(firstSession.customData, "tx-stack-1", "user-stack"),
      now,
    );
    const second = await grantVerifiedRewardedScoutBoost(
      storage,
      buildVerifiedCallback(secondSession.customData, "tx-stack-2", "user-stack"),
      now,
    );

    expect(first.outcome).toBe("granted");
    expect(second.outcome).toBe("granted");
    expect(second.expiresAt).toEqual(new Date("2026-03-30T12:00:00.000Z"));
    expect(createStackedRewardedScoutBoostGrant).toHaveBeenCalledTimes(2);
  });

  it("grants provisional boost time from a completed Android reward callback", async () => {
    const now = new Date("2026-03-29T12:00:00.000Z");
    const session = createRewardedScoutBoostSessionToken(
      "user-client",
      now,
      process.env.REWARDED_SCOUT_BOOST_SECRET,
    );
    const createStackedRewardedScoutBoostGrant = vi.fn().mockImplementation(async (grant) => ({
      id: "grant-client",
      grantedAt: now,
      createdAt: now,
      revokedAt: null,
      ...grant,
      expiresAt: new Date("2026-03-30T00:00:00.000Z"),
    }));

    const result = await grantClientCompletedRewardedScoutBoost(
      {
        getUser: vi.fn().mockResolvedValue({
          id: "user-client",
          isPremium: false,
          premiumExpiresAt: null,
        }),
        updateUserPremiumStatus: vi.fn().mockResolvedValue(undefined),
        getLatestRewardedScoutBoostGrantBySessionId: vi.fn().mockResolvedValue(undefined),
        createStackedRewardedScoutBoostGrant,
        updateRewardedScoutBoostGrantMetadata: vi.fn(),
      },
      {
        authenticatedUserId: "user-client",
        rewardSessionId: session.rewardSessionId,
        customData: session.customData,
        adResponseId: "response-123",
        mediationAdapterClassName: "com.google.ads.mediation.admob.AdMobAdapter",
        ssvOptionsAttached: true,
        ssvCustomDataAttached: true,
        ssvUserIdAttached: true,
        ssvCustomDataLength: session.customData.length,
        rewardAmount: 1,
        rewardType: "scout_boost",
      },
      now,
    );

    expect(result.outcome).toBe("granted");
    expect(createStackedRewardedScoutBoostGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: `client:${session.rewardSessionId}`,
        metadata: expect.objectContaining({
          verificationStatus: "pending_ssv",
          androidAdDiagnostics: {
            adResponseId: "response-123",
            mediationAdapterClassName: "com.google.ads.mediation.admob.AdMobAdapter",
            ssvOptionsAttached: true,
            ssvCustomDataAttached: true,
            ssvUserIdAttached: true,
            ssvCustomDataLength: session.customData.length,
            nonPersonalizedOnly: null,
          },
        }),
      }),
      12 * 60 * 60 * 1000,
      now,
    );
  });

  it("marks a provisional grant verified when SSV arrives without double-extending", async () => {
    const now = new Date("2026-03-29T12:00:00.000Z");
    const session = createRewardedScoutBoostSessionToken(
      "user-existing",
      now,
      process.env.REWARDED_SCOUT_BOOST_SECRET,
    );
    const existingGrant = {
      id: "grant-existing",
      userId: "user-existing",
      rewardSessionId: session.rewardSessionId,
      transactionId: `client:${session.rewardSessionId}`,
      expiresAt: new Date("2026-03-30T00:00:00.000Z"),
      grantedAt: now,
      createdAt: now,
      rewardedAt: now,
      revokedAt: null,
      metadata: { verificationStatus: "pending_ssv" },
    };
    const createStackedRewardedScoutBoostGrant = vi.fn();
    const updateRewardedScoutBoostGrantMetadata = vi.fn().mockResolvedValue({
      ...existingGrant,
      metadata: { verificationStatus: "verified", ssvTransactionId: "tx-existing-1" },
    });

    const result = await grantVerifiedRewardedScoutBoost(
      {
        getUser: vi.fn().mockResolvedValue({
          id: "user-existing",
          isPremium: false,
          premiumExpiresAt: null,
        }),
        updateUserPremiumStatus: vi.fn().mockResolvedValue(undefined),
        getLatestRewardedScoutBoostGrantBySessionId: vi.fn().mockResolvedValue(existingGrant),
        createStackedRewardedScoutBoostGrant,
        updateRewardedScoutBoostGrantMetadata,
      },
      buildVerifiedCallback(session.customData, "tx-existing-1", "user-existing"),
      now,
    );

    expect(result.outcome).toBe("verified_existing");
    expect(createStackedRewardedScoutBoostGrant).not.toHaveBeenCalled();
    expect(updateRewardedScoutBoostGrantMetadata).toHaveBeenCalledWith(
      "grant-existing",
      expect.objectContaining({
        verificationStatus: "verified",
        ssvTransactionId: "tx-existing-1",
      }),
    );
  });
});
