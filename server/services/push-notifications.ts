import { readFile } from "node:fs/promises";
import { cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import {
  DEFAULT_PUSH_NOTIFICATION_PREFERENCES,
  getPushNotificationAndroidChannelId,
  isPushNotificationType,
  normalizeInternalNotificationRoute,
  resolvePushNotificationPreferences,
  type PushNotificationType,
} from "@shared/push-notifications";
import { storage, type IStorage } from "../storage";

const INVALID_TOKEN_ERROR_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

const FIREBASE_APP_NAME = "sportfolio-push";
const MAX_MULTICAST_TOKENS = 500;

interface PushMessagingResultItem {
  success: boolean;
  messageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

interface PushMessagingResult {
  successCount: number;
  failureCount: number;
  results: PushMessagingResultItem[];
}

interface PushMessagingProvider {
  sendMulticast(input: {
    tokens: string[];
    title: string;
    body: string;
    data: Record<string, string>;
    channelId?: string;
    ttlSeconds?: number;
    collapseKey?: string;
  }): Promise<PushMessagingResult>;
}

type PushStorage = Pick<
  IStorage,
  | "listActiveUserPushTokens"
  | "markUserPushTokenDeliverySuccess"
  | "markUserPushTokenDeliveryFailure"
  | "getUserNotificationPreferences"
  | "createPushNotificationEvent"
  | "updatePushNotificationEvent"
>;

export interface SendPushNotificationInput {
  userId: string;
  type: PushNotificationType;
  title: string;
  body: string;
  route: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
}

export interface SendPushNotificationResult {
  delivered: boolean;
  status:
    | "sent"
    | "partial"
    | "failed"
    | "skipped_preferences"
    | "skipped_no_tokens"
    | "provider_unavailable"
    | "duplicate";
  successCount: number;
  failureCount: number;
}

export interface PushMulticastPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  channelId?: string;
  ttlSeconds?: number;
  collapseKey?: string;
}

export interface PushMulticastResult {
  providerEnabled: boolean;
  attempted: number;
  sentCount: number;
  failureCount: number;
  invalidTokens: string[];
}

let providerPromise: Promise<PushMessagingProvider | null> | null = null;
let didWarnMissingFirebaseCredentials = false;
const DEFAULT_ANDROID_PUSH_TTL_SECONDS = 60 * 60 * 6;

export function hasFirebasePushCredentialsConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_ADMIN_SDK_JSON?.trim() ||
    process.env.FIREBASE_ADMIN_SDK_FILE?.trim() ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim(),
  );
}

function warnMissingFirebaseCredentials(message: string) {
  if (didWarnMissingFirebaseCredentials) {
    return;
  }

  didWarnMissingFirebaseCredentials = true;
  console.warn(`[PUSH] ${message}`);
}

function parseFirebaseAdminServiceAccount(raw: string): ServiceAccount {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const clientEmail = String(parsed.clientEmail || parsed.client_email || "");
  const privateKey = String(parsed.privateKey || parsed.private_key || "");
  const projectId = String(parsed.projectId || parsed.project_id || "");

  if (!clientEmail || !privateKey) {
    throw new Error("Firebase service account JSON is missing client_email/private_key");
  }

  return {
    projectId: projectId || undefined,
    clientEmail,
    privateKey,
  };
}

async function resolveFirebaseAdminServiceAccount(): Promise<ServiceAccount | null> {
  const inlineValue = process.env.FIREBASE_ADMIN_SDK_JSON?.trim();
  const filePath =
    process.env.FIREBASE_ADMIN_SDK_FILE?.trim() ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();

  if (inlineValue) {
    try {
      return parseFirebaseAdminServiceAccount(inlineValue);
    } catch {
      const decoded = Buffer.from(inlineValue, "base64").toString("utf8");
      return parseFirebaseAdminServiceAccount(decoded);
    }
  }

  if (filePath) {
    const fileContents = await readFile(filePath, "utf8");
    return parseFirebaseAdminServiceAccount(fileContents);
  }

  return null;
}

async function createFirebasePushProvider(): Promise<PushMessagingProvider | null> {
  let credentials: ServiceAccount | null = null;

  try {
    credentials = await resolveFirebaseAdminServiceAccount();
  } catch (error: any) {
    warnMissingFirebaseCredentials(
      `Could not parse Firebase credentials. Push delivery disabled: ${error?.message || error}`,
    );
    return null;
  }

  if (!credentials) {
    warnMissingFirebaseCredentials(
      "Firebase credentials are missing (set FIREBASE_ADMIN_SDK_JSON or FIREBASE_ADMIN_SDK_FILE). Push delivery will be a no-op.",
    );
    return null;
  }

  const existing = getApps().find((app) => app.name === FIREBASE_APP_NAME);
  const app =
    existing ||
    initializeApp(
      {
        credential: cert(credentials),
        projectId: credentials.projectId,
      },
      FIREBASE_APP_NAME,
    );
  const messaging = getMessaging(app);

  return {
    async sendMulticast(input) {
      const response = await messaging.sendEachForMulticast({
        tokens: input.tokens,
        notification: {
          title: input.title,
          body: input.body,
        },
        data: input.data,
        android: {
          priority: "high",
          ttl: (input.ttlSeconds ?? DEFAULT_ANDROID_PUSH_TTL_SECONDS) * 1000,
          collapseKey: input.collapseKey,
          notification: {
            channelId: input.channelId,
          },
        },
      });

      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        results: response.responses.map((item) => ({
          success: item.success,
          messageId: item.messageId,
          errorCode: (item.error as any)?.code,
          errorMessage: item.error?.message,
        })),
      };
    },
  };
}

function getPushProvider(): Promise<PushMessagingProvider | null> {
  if (!providerPromise) {
    providerPromise = createFirebasePushProvider();
  }

  return providerPromise;
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

  const provider = await getPushProvider();
  if (!provider) {
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
    const result = await provider.sendMulticast({
      tokens: chunk,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      channelId: payload.channelId,
      ttlSeconds: payload.ttlSeconds,
      collapseKey: payload.collapseKey,
    });

    sentCount += result.successCount;
    failureCount += result.failureCount;

    result.results.forEach((item, itemIndex) => {
      if (item.success) return;
      const errorCode = item.errorCode || "";
      if (INVALID_TOKEN_ERROR_CODES.has(errorCode) && chunk[itemIndex]) {
        invalidTokens.add(chunk[itemIndex]);
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

function serializeMetadata(metadata?: Record<string, unknown>): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "";
  }

  const raw = JSON.stringify(metadata);
  if (raw.length <= 1800) {
    return raw;
  }

  return raw.slice(0, 1800);
}

function normalizePreferenceOverrides(
  rows: Array<{ notificationType: string; enabled: boolean }>,
): Partial<Record<PushNotificationType, boolean>> {
  const result: Partial<Record<PushNotificationType, boolean>> = {};
  for (const row of rows) {
    if (isPushNotificationType(row.notificationType)) {
      result[row.notificationType] = row.enabled;
    }
  }
  return result;
}

export class PushNotificationService {
  constructor(
    private readonly deps: {
      storageLayer?: PushStorage;
      providerFactory?: () => Promise<PushMessagingProvider | null>;
    } = {},
  ) {}

  private get storageLayer(): PushStorage {
    return this.deps.storageLayer ?? storage;
  }

  private async getProvider(): Promise<PushMessagingProvider | null> {
    if (this.deps.providerFactory) {
      return this.deps.providerFactory();
    }
    return getPushProvider();
  }

  async send(input: SendPushNotificationInput): Promise<SendPushNotificationResult> {
    const safeRoute = normalizeInternalNotificationRoute(input.route) || "/";
    const rows = await this.storageLayer.getUserNotificationPreferences(input.userId);
    const preferenceMap = resolvePushNotificationPreferences(normalizePreferenceOverrides(rows));
    const isEnabled =
      preferenceMap[input.type] ?? DEFAULT_PUSH_NOTIFICATION_PREFERENCES[input.type];

    const createdEvent = await this.storageLayer.createPushNotificationEvent({
      userId: input.userId,
      notificationType: input.type,
      title: input.title,
      body: input.body,
      route: safeRoute,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? {},
      deliveryStatus: isEnabled ? "pending" : "skipped_preferences",
      provider: "firebase",
      dedupeKey: input.dedupeKey ?? null,
    });

    if (!createdEvent && input.dedupeKey) {
      return {
        delivered: false,
        status: "duplicate",
        successCount: 0,
        failureCount: 0,
      };
    }

    if (!isEnabled) {
      return {
        delivered: false,
        status: "skipped_preferences",
        successCount: 0,
        failureCount: 0,
      };
    }

    const tokens = await this.storageLayer.listActiveUserPushTokens(input.userId, "android");
    if (tokens.length === 0) {
      if (createdEvent) {
        await this.storageLayer.updatePushNotificationEvent(createdEvent.id, {
          deliveryStatus: "skipped_no_tokens",
        });
      }
      return {
        delivered: false,
        status: "skipped_no_tokens",
        successCount: 0,
        failureCount: 0,
      };
    }

    const provider = await this.getProvider();
    if (!provider) {
      if (createdEvent) {
        await this.storageLayer.updatePushNotificationEvent(createdEvent.id, {
          deliveryStatus: "provider_unavailable",
        });
      }
      return {
        delivered: false,
        status: "provider_unavailable",
        successCount: 0,
        failureCount: tokens.length,
      };
    }

    const dataPayload: Record<string, string> = {
      route: safeRoute,
      notificationType: input.type,
      entityType: input.entityType ?? "",
      entityId: input.entityId ?? "",
      metadata: serializeMetadata(input.metadata),
    };
    if (createdEvent?.id) {
      dataPayload.eventId = createdEvent.id;
    }
    const channelId = getPushNotificationAndroidChannelId(input.type);
    const collapseKey = input.dedupeKey ?? `${input.type}:${input.userId}`;

    const providerResult = await provider.sendMulticast({
      tokens: tokens.map((token) => token.token),
      title: input.title,
      body: input.body,
      data: dataPayload,
      channelId,
      ttlSeconds: DEFAULT_ANDROID_PUSH_TTL_SECONDS,
      collapseKey,
    });

    let firstMessageId: string | null = null;

    for (let index = 0; index < providerResult.results.length; index += 1) {
      const token = tokens[index];
      const result = providerResult.results[index];
      if (!token || !result) continue;

      if (result.success) {
        if (!firstMessageId && result.messageId) {
          firstMessageId = result.messageId;
        }
        await this.storageLayer.markUserPushTokenDeliverySuccess(token.id);
        continue;
      }

      const errorCode = result.errorCode || "unknown";
      const errorMessage = result.errorMessage || "Push delivery failed";
      const deactivate = INVALID_TOKEN_ERROR_CODES.has(errorCode);

      await this.storageLayer.markUserPushTokenDeliveryFailure(
        token.id,
        `${errorCode}: ${errorMessage}`,
        { deactivate },
      );
    }

    const status =
      providerResult.successCount > 0 && providerResult.failureCount === 0
        ? "sent"
        : providerResult.successCount > 0
          ? "partial"
          : "failed";

    if (createdEvent) {
      await this.storageLayer.updatePushNotificationEvent(createdEvent.id, {
        deliveryStatus: status,
        providerMessageId: firstMessageId,
        sentAt: new Date(),
        metadata: {
          ...(input.metadata ?? {}),
          delivery: {
            successCount: providerResult.successCount,
            failureCount: providerResult.failureCount,
            channelId,
            collapseKey,
          },
        },
      });
    }

    return {
      delivered: providerResult.successCount > 0,
      status,
      successCount: providerResult.successCount,
      failureCount: providerResult.failureCount,
    };
  }
}

export const pushNotificationService = new PushNotificationService();

export async function sendPushNotificationBestEffort(input: SendPushNotificationInput) {
  try {
    return await pushNotificationService.send(input);
  } catch (error: any) {
    console.error("[PUSH] Notification send failed:", error?.message || error);
    return {
      delivered: false,
      status: "failed" as const,
      successCount: 0,
      failureCount: 0,
    };
  }
}
