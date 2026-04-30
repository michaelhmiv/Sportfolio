import { createHmac, randomUUID, timingSafeEqual, verify } from "node:crypto";
import type { InsertRewardedScoutBoostGrant } from "@shared/schema";
import type { IStorage } from "../storage";
import { resolveUserEntitlements } from "./user-entitlements";

const SESSION_TOKEN_VERSION = 1;
const ADMOB_KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const REWARDED_SCOUT_BOOST_DURATION_MS = 12 * 60 * 60 * 1000;
export const REWARDED_SCOUT_BOOST_SESSION_TTL_MS = 15 * 60 * 1000;
export const ADMOB_REWARDED_TEST_AD_UNIT_ID = "ca-app-pub-3940256099942544/5224354917";
export const ADMOB_VERIFIER_KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";
export const REWARDED_SCOUT_BOOST_CALLBACK_PATH = "/api/mobile/rewarded-scout-boost/admob/ssv";
export const REWARDED_SCOUT_BOOST_SSV_MISSING_AFTER_MS = 5 * 60 * 1000;

type RewardedScoutBoostStorage = Pick<
  IStorage,
  | "getUser"
  | "updateUserPremiumStatus"
  | "getLatestRewardedScoutBoostGrantBySessionId"
  | "createStackedRewardedScoutBoostGrant"
  | "updateRewardedScoutBoostGrantMetadata"
>;

export interface RewardedScoutBoostSessionToken {
  rewardSessionId: string;
  customData: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface RewardedScoutBoostSessionPayload {
  v: number;
  uid: string;
  sid: string;
  iat: number;
  exp: number;
}

export interface VerifiedAdMobSsvCallback {
  callbackUrl: string;
  queryString: string;
  transactionId: string;
  adNetwork: string | null;
  adUnitId: string | null;
  rewardItem: string | null;
  rewardAmount: number | null;
  rewardUserId: string | null;
  customData: string | null;
  rewardedAt: Date;
  signature: string;
  keyId: string;
}

type AdMobKeyFetcher = () => Promise<Map<string, string>>;

let cachedAdMobKeys: { expiresAt: number; keys: Map<string, string> } | null = null;

function toBase64Url(input: string | Buffer) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return buffer.toString("base64url");
}

function createSessionSignature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function requireRewardedScoutBoostSecret() {
  const secret = process.env.REWARDED_SCOUT_BOOST_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV !== "production") {
      return "dev-rewarded-scout-boost-secret";
    }
    throw new Error("REWARDED_SCOUT_BOOST_SECRET is not configured");
  }
  return secret;
}

export function getRewardedScoutBoostAdUnitId() {
  const adUnitId = process.env.ADMOB_REWARDED_SCOUT_AD_UNIT_ID?.trim();
  if (adUnitId) {
    return adUnitId;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("ADMOB_REWARDED_SCOUT_AD_UNIT_ID is not configured");
  }

  return ADMOB_REWARDED_TEST_AD_UNIT_ID;
}

export function getRewardedScoutBoostCallbackUrl() {
  const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.SITE_URL)?.trim();
  if (!siteUrl) {
    return REWARDED_SCOUT_BOOST_CALLBACK_PATH;
  }

  const url = new URL(siteUrl);
  url.pathname = REWARDED_SCOUT_BOOST_CALLBACK_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function getGrantMetadata(grant: { metadata?: unknown }) {
  return grant.metadata && typeof grant.metadata === "object" && !Array.isArray(grant.metadata)
    ? (grant.metadata as Record<string, unknown>)
    : {};
}

export function createRewardedScoutBoostSessionToken(
  userId: string,
  now: Date = new Date(),
  secret: string = requireRewardedScoutBoostSecret(),
) {
  const issuedAt = now;
  const expiresAt = new Date(now.getTime() + REWARDED_SCOUT_BOOST_SESSION_TTL_MS);
  const payload: RewardedScoutBoostSessionPayload = {
    v: SESSION_TOKEN_VERSION,
    uid: userId,
    sid: randomUUID(),
    iat: issuedAt.getTime(),
    exp: expiresAt.getTime(),
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = createSessionSignature(encodedPayload, secret);

  return {
    rewardSessionId: payload.sid,
    customData: `ssb.${encodedPayload}.${signature}`,
    issuedAt,
    expiresAt,
  } satisfies RewardedScoutBoostSessionToken;
}

export function verifyRewardedScoutBoostCustomData(
  customData: string,
  now: Date = new Date(),
  secret: string = requireRewardedScoutBoostSecret(),
) {
  const [prefix, encodedPayload, signature] = customData.split(".");
  if (prefix !== "ssb" || !encodedPayload || !signature) {
    throw new Error("Invalid rewarded scout boost custom data format");
  }

  const expectedSignature = createSessionSignature(encodedPayload, secret);
  const provided = Buffer.from(signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new Error("Invalid rewarded scout boost custom data signature");
  }

  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8"),
  ) as RewardedScoutBoostSessionPayload;

  if (payload.v !== SESSION_TOKEN_VERSION) {
    throw new Error("Unsupported rewarded scout boost token version");
  }

  if (payload.exp <= now.getTime()) {
    throw new Error("Rewarded scout boost session token expired");
  }

  return payload;
}

function extractQueryString(callbackUrl: string) {
  const queryIndex = callbackUrl.indexOf("?");
  if (queryIndex < 0 || queryIndex === callbackUrl.length - 1) {
    throw new Error("Reward callback is missing query parameters");
  }
  return callbackUrl.slice(queryIndex + 1);
}

export async function fetchAdMobVerifierPublicKeys() {
  const now = Date.now();
  if (cachedAdMobKeys && cachedAdMobKeys.expiresAt > now) {
    return cachedAdMobKeys.keys;
  }

  const response = await fetch(ADMOB_VERIFIER_KEYS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch AdMob verifier keys (${response.status})`);
  }

  const data = (await response.json()) as {
    keys?: Array<{ keyId?: string | number; key_id?: string | number; pem?: string }>;
  };

  const keys = new Map<string, string>();
  for (const entry of data.keys || []) {
    const keyId = entry?.keyId ?? entry?.key_id;
    if (keyId === undefined || !entry.pem) {
      continue;
    }
    keys.set(String(keyId), entry.pem);
  }

  if (keys.size === 0) {
    throw new Error("AdMob verifier key response did not include any public keys");
  }

  cachedAdMobKeys = {
    keys,
    expiresAt: now + ADMOB_KEY_CACHE_TTL_MS,
  };

  return keys;
}

export async function verifyAdMobSsvCallbackUrl(
  callbackUrl: string,
  fetchKeys: AdMobKeyFetcher = fetchAdMobVerifierPublicKeys,
) {
  const queryString = extractQueryString(callbackUrl);
  const signatureMarker = "&signature=";
  const signatureIndex = queryString.indexOf(signatureMarker);
  if (signatureIndex < 0) {
    throw new Error("Reward callback is missing signature");
  }

  const keyMarker = "&key_id=";
  const dataToVerify = queryString.slice(0, signatureIndex);
  const signatureAndKey = queryString.slice(signatureIndex + 1);
  const keyIndex = signatureAndKey.indexOf(keyMarker);
  if (keyIndex < 0) {
    throw new Error("Reward callback is missing key_id");
  }

  const signature = signatureAndKey.slice("signature=".length, keyIndex);
  const keyId = signatureAndKey.slice(keyIndex + keyMarker.length);
  const keys = await fetchKeys();
  const publicKey = keys.get(keyId);

  if (!publicKey) {
    throw new Error(`No AdMob verifier key found for key_id ${keyId}`);
  }

  const isValid = verify(
    "sha256",
    Buffer.from(dataToVerify, "utf8"),
    publicKey,
    Buffer.from(signature, "base64url"),
  );

  if (!isValid) {
    throw new Error("Invalid AdMob reward callback signature");
  }

  const url = new URL(callbackUrl);
  const rewardAmountValue = url.searchParams.get("reward_amount");
  const timestampValue = url.searchParams.get("timestamp");

  return {
    callbackUrl,
    queryString,
    transactionId: url.searchParams.get("transaction_id") || "",
    adNetwork: url.searchParams.get("ad_network"),
    adUnitId: url.searchParams.get("ad_unit"),
    rewardItem: url.searchParams.get("reward_item"),
    rewardAmount:
      rewardAmountValue && Number.isFinite(Number(rewardAmountValue))
        ? Number(rewardAmountValue)
        : null,
    rewardUserId: url.searchParams.get("user_id"),
    customData: url.searchParams.get("custom_data"),
    rewardedAt: timestampValue ? new Date(Number(timestampValue)) : new Date(),
    signature,
    keyId,
  } satisfies VerifiedAdMobSsvCallback;
}

export async function grantVerifiedRewardedScoutBoost(
  storage: RewardedScoutBoostStorage,
  verifiedCallback: VerifiedAdMobSsvCallback,
  now: Date = new Date(),
) {
  if (!verifiedCallback.transactionId) {
    throw new Error("Reward callback is missing transaction_id");
  }

  if (!verifiedCallback.customData) {
    throw new Error("Reward callback is missing custom_data");
  }

  const session = verifyRewardedScoutBoostCustomData(verifiedCallback.customData, now);
  if (verifiedCallback.rewardUserId && verifiedCallback.rewardUserId !== session.uid) {
    throw new Error("Reward callback user mismatch");
  }

  const user = await storage.getUser(session.uid);

  if (!user) {
    return {
      outcome: "user_not_found" as const,
      rewardSessionId: session.sid,
      transactionId: verifiedCallback.transactionId,
    };
  }

  let effectiveUser = user;
  let entitlements = resolveUserEntitlements(effectiveUser, null, now);
  if (entitlements.hasExpiredPremiumFlag) {
    await storage.updateUserPremiumStatus(user.id, false, user.premiumExpiresAt ?? null);
    effectiveUser = { ...user, isPremium: false };
    entitlements = resolveUserEntitlements(effectiveUser, null, now);
  }

  if (entitlements.premiumActive) {
    return {
      outcome: "premium_active" as const,
      rewardSessionId: session.sid,
      transactionId: verifiedCallback.transactionId,
      expiresAt: entitlements.premiumExpiresAt,
    };
  }

  const existingGrant = await storage.getLatestRewardedScoutBoostGrantBySessionId(
    user.id,
    session.sid,
  );
  if (existingGrant) {
    const updatedGrant = await storage.updateRewardedScoutBoostGrantMetadata(existingGrant.id, {
      ...getGrantMetadata(existingGrant),
      verificationStatus: "verified",
      ssvVerifiedAt: now.toISOString(),
      ssvTransactionId: verifiedCallback.transactionId,
      ssvRewardedAt: verifiedCallback.rewardedAt.toISOString(),
      keyId: verifiedCallback.keyId,
      adNetwork: verifiedCallback.adNetwork,
      rewardUserId: verifiedCallback.rewardUserId,
    });

    return {
      outcome: "verified_existing" as const,
      rewardSessionId: session.sid,
      transactionId: verifiedCallback.transactionId,
      expiresAt: (updatedGrant ?? existingGrant).expiresAt,
      grant: updatedGrant ?? existingGrant,
    };
  }

  const expiresAt = new Date(now.getTime() + REWARDED_SCOUT_BOOST_DURATION_MS);
  const grantPayload: InsertRewardedScoutBoostGrant = {
    userId: user.id,
    platform: "android",
    adNetwork: "admob",
    adUnitId: verifiedCallback.adUnitId,
    rewardItem: verifiedCallback.rewardItem,
    rewardAmount: verifiedCallback.rewardAmount ?? undefined,
    rewardSessionId: session.sid,
    transactionId: verifiedCallback.transactionId,
    customData: verifiedCallback.customData,
    rewardedAt: verifiedCallback.rewardedAt,
    expiresAt,
    metadata: {
      verificationStatus: "verified",
      source: "admob_ssv",
      ssvVerifiedAt: now.toISOString(),
      keyId: verifiedCallback.keyId,
      adNetwork: verifiedCallback.adNetwork,
      rewardUserId: verifiedCallback.rewardUserId,
    },
  };

  const createdGrant = await storage.createStackedRewardedScoutBoostGrant(
    grantPayload,
    REWARDED_SCOUT_BOOST_DURATION_MS,
    now,
  );
  if (!createdGrant) {
    return {
      outcome: "duplicate" as const,
      rewardSessionId: session.sid,
      transactionId: verifiedCallback.transactionId,
    };
  }

  return {
    outcome: "granted" as const,
    rewardSessionId: session.sid,
    transactionId: verifiedCallback.transactionId,
    expiresAt: createdGrant.expiresAt,
    grant: createdGrant,
  };
}

export async function grantClientCompletedRewardedScoutBoost(
  storage: RewardedScoutBoostStorage,
  input: {
    authenticatedUserId: string;
    rewardSessionId: string;
    customData: string;
    adUnitId?: string | null;
    rewardAmount?: number | null;
    rewardType?: string | null;
  },
  now: Date = new Date(),
) {
  const session = verifyRewardedScoutBoostCustomData(input.customData, now);
  if (session.uid !== input.authenticatedUserId) {
    throw new Error("Reward session user mismatch");
  }

  if (session.sid !== input.rewardSessionId) {
    throw new Error("Reward session id mismatch");
  }

  const user = await storage.getUser(session.uid);

  if (!user) {
    return {
      outcome: "user_not_found" as const,
      rewardSessionId: session.sid,
      transactionId: `client:${session.sid}`,
    };
  }

  let effectiveUser = user;
  let entitlements = resolveUserEntitlements(effectiveUser, null, now);
  if (entitlements.hasExpiredPremiumFlag) {
    await storage.updateUserPremiumStatus(user.id, false, user.premiumExpiresAt ?? null);
    effectiveUser = { ...user, isPremium: false };
    entitlements = resolveUserEntitlements(effectiveUser, null, now);
  }

  if (entitlements.premiumActive) {
    return {
      outcome: "premium_active" as const,
      rewardSessionId: session.sid,
      transactionId: `client:${session.sid}`,
      expiresAt: entitlements.premiumExpiresAt,
    };
  }

  const existingGrant = await storage.getLatestRewardedScoutBoostGrantBySessionId(
    user.id,
    session.sid,
  );
  if (existingGrant) {
    return {
      outcome: "duplicate" as const,
      rewardSessionId: session.sid,
      transactionId: `client:${session.sid}`,
      expiresAt: existingGrant.expiresAt,
      grant: existingGrant,
    };
  }

  const expiresAt = new Date(now.getTime() + REWARDED_SCOUT_BOOST_DURATION_MS);
  const grantPayload: InsertRewardedScoutBoostGrant = {
    userId: user.id,
    platform: "android",
    adNetwork: "admob",
    adUnitId: input.adUnitId ?? getRewardedScoutBoostAdUnitId(),
    rewardItem: input.rewardType ?? "scout_boost",
    rewardAmount: input.rewardAmount ?? undefined,
    rewardSessionId: session.sid,
    transactionId: `client:${session.sid}`,
    customData: input.customData,
    rewardedAt: now,
    expiresAt,
    metadata: {
      verificationStatus: "pending_ssv",
      source: "client_reward_callback",
      clientCompletedAt: now.toISOString(),
      ssvMissingAfter: new Date(
        now.getTime() + REWARDED_SCOUT_BOOST_SSV_MISSING_AFTER_MS,
      ).toISOString(),
    },
  };

  const createdGrant = await storage.createStackedRewardedScoutBoostGrant(
    grantPayload,
    REWARDED_SCOUT_BOOST_DURATION_MS,
    now,
  );

  if (!createdGrant) {
    const duplicateGrant = await storage.getLatestRewardedScoutBoostGrantBySessionId(
      user.id,
      session.sid,
    );
    return {
      outcome: "duplicate" as const,
      rewardSessionId: session.sid,
      transactionId: `client:${session.sid}`,
      expiresAt: duplicateGrant?.expiresAt ?? expiresAt,
      grant: duplicateGrant,
    };
  }

  return {
    outcome: "granted" as const,
    rewardSessionId: session.sid,
    transactionId: `client:${session.sid}`,
    expiresAt: createdGrant.expiresAt,
    grant: createdGrant,
  };
}
