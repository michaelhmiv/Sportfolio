import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getMessaging, type MulticastMessage } from "firebase-admin/messaging";

const MAX_MULTICAST_TOKENS = 500;
let hasWarnedMissingCredentials = false;
let hasWarnedInitializationFailure = false;
let hasInitializedPushApp = false;

function parsePossiblyBase64Json(raw: string): Record<string, unknown> | null {
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  const value = raw.trim();
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    // Continue into base64 decode path.
  }

  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function loadServiceAccountFromEnvironment(): ServiceAccount | null {
  const fromInline =
    parsePossiblyBase64Json(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "") ||
    parsePossiblyBase64Json(process.env.FIREBASE_ADMIN_CREDENTIALS || "");

  if (fromInline) {
    return fromInline as ServiceAccount;
  }

  const configuredPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_FILE || process.env.FIREBASE_ADMIN_CREDENTIALS_FILE;

  const candidates = [configuredPath, ".env.firebase-admin.json"]
    .map((entry) => (entry || "").trim())
    .filter(Boolean)
    .map((entry) => resolve(entry));

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    try {
      const raw = readFileSync(candidate, "utf8");
      return JSON.parse(raw) as ServiceAccount;
    } catch (error) {
      console.error(`[Push] Failed to parse Firebase service account file ${candidate}:`, error);
    }
  }

  return null;
}

function ensurePushAppInitialized(): boolean {
  if (hasInitializedPushApp) {
    return true;
  }

  const serviceAccount = loadServiceAccountFromEnvironment();
  if (!serviceAccount) {
    if (!hasWarnedMissingCredentials) {
      hasWarnedMissingCredentials = true;
      console.warn(
        "[Push] Firebase credentials are missing. Push notifications are disabled until credentials are configured.",
      );
    }
    return false;
  }

  try {
    const existing = getApps().find((app) => app.name === "push-notifications");
    if (!existing) {
      initializeApp(
        {
          credential: cert(serviceAccount),
        },
        "push-notifications",
      );
    }
    hasInitializedPushApp = true;
    return true;
  } catch (error) {
    if (!hasWarnedInitializationFailure) {
      hasWarnedInitializationFailure = true;
      console.error("[Push] Failed to initialize Firebase Admin app:", error);
    }
    return false;
  }
}

function getPushMessaging() {
  if (!ensurePushAppInitialized()) {
    return null;
  }
  return getMessaging(getApps().find((app) => app.name === "push-notifications"));
}

function isInvalidTokenError(code?: string): boolean {
  return (
    code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token"
  );
}

export interface PushMulticastPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushMulticastResult {
  providerEnabled: boolean;
  attempted: number;
  sentCount: number;
  failureCount: number;
  invalidTokens: string[];
}

export async function sendPushMulticast(
  tokens: string[],
  payload: PushMulticastPayload,
): Promise<PushMulticastResult> {
  if (tokens.length === 0) {
    return {
      providerEnabled: true,
      attempted: 0,
      sentCount: 0,
      failureCount: 0,
      invalidTokens: [],
    };
  }

  const messaging = getPushMessaging();
  if (!messaging) {
    return {
      providerEnabled: false,
      attempted: tokens.length,
      sentCount: 0,
      failureCount: 0,
      invalidTokens: [],
    };
  }

  let sentCount = 0;
  let failureCount = 0;
  const invalidTokens = new Set<string>();

  for (let index = 0; index < tokens.length; index += MAX_MULTICAST_TOKENS) {
    const chunk = tokens.slice(index, index + MAX_MULTICAST_TOKENS);

    const message: MulticastMessage = {
      tokens: chunk,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      android: {
        priority: "high",
      },
      data: payload.data,
    };

    const response = await messaging.sendEachForMulticast(message);
    sentCount += response.successCount;
    failureCount += response.failureCount;

    response.responses.forEach((result, chunkIndex) => {
      if (result.success) {
        return;
      }
      if (isInvalidTokenError(result.error?.code)) {
        invalidTokens.add(chunk[chunkIndex]);
      }
    });
  }

  return {
    providerEnabled: true,
    attempted: tokens.length,
    sentCount,
    failureCount,
    invalidTokens: Array.from(invalidTokens),
  };
}
