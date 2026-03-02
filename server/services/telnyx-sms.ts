import { createHmac, createPublicKey, randomBytes, verify } from "node:crypto";

const TELNYX_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const ED25519_SPKI_DER_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type VerifiedTelnyxWebhook = {
  eventId: string | null;
  eventType: string;
  occurredAt: string | null;
  payload: Record<string, any>;
  raw: Record<string, any>;
};

export type TelnyxInboundMessage = {
  providerEventId: string | null;
  providerMessageId: string | null;
  from: string;
  to: string | null;
  text: string;
  receivedAt: string;
  raw: Record<string, any>;
};

export type TelnyxDeliveryEvent = {
  providerEventId: string | null;
  providerMessageId: string | null;
  to: string | null;
  from: string | null;
  status: string;
  occurredAt: string;
  raw: Record<string, any>;
};

export function isTelnyxInboundMessageEventType(eventType: string): boolean {
  return eventType.trim().toLowerCase() === "message.received";
}

export function isTelnyxDeliveryEventType(eventType: string): boolean {
  const normalized = eventType.trim().toLowerCase();
  return normalized.startsWith("message.") && normalized !== "message.received";
}

function requireTelnyxPublicKey(): string {
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim() || "";
  if (!publicKey) {
    throw new Error("TELNYX_PUBLIC_KEY is not configured");
  }
  return publicKey;
}

function createTelnyxVerificationKey() {
  const configuredKey = requireTelnyxPublicKey();

  if (configuredKey.includes("BEGIN PUBLIC KEY")) {
    return createPublicKey(configuredKey);
  }

  const normalizedBase64 = configuredKey.replace(/\s+/g, "");
  const rawKey = Buffer.from(normalizedBase64, "base64");

  if (rawKey.length !== 32) {
    throw new Error("TELNYX_PUBLIC_KEY must be a PEM public key or a 32-byte base64 key");
  }

  const spkiDer = Buffer.concat([ED25519_SPKI_DER_PREFIX, rawKey]);
  return createPublicKey({
    key: spkiDer,
    format: "der",
    type: "spki",
  });
}

function getWebhookBuffer(rawBody: unknown): Buffer {
  if (Buffer.isBuffer(rawBody)) {
    return rawBody;
  }
  if (typeof rawBody === "string") {
    return Buffer.from(rawBody);
  }
  if (rawBody instanceof Uint8Array) {
    return Buffer.from(rawBody);
  }
  return Buffer.from("");
}

function toPhoneValue(input: any): string | null {
  if (!input) {
    return null;
  }
  if (typeof input === "string") {
    return input.trim() || null;
  }
  if (typeof input?.phone_number === "string") {
    return input.phone_number.trim() || null;
  }
  if (Array.isArray(input) && input.length > 0) {
    return toPhoneValue(input[0]);
  }
  return null;
}

export function createSmsLinkTokenHash(token: string): string {
  const secret =
    process.env.SMS_LINK_SECRET?.trim() || process.env.USER_AGENT_SECRET_KEY?.trim() || "";

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMS_LINK_SECRET or USER_AGENT_SECRET_KEY must be configured");
    }
    return createHmac("sha256", "development-only-sms-link-secret").update(token).digest("hex");
  }

  return createHmac("sha256", secret).update(token).digest("hex");
}

export function createSmsLinkTokenMaterial(): {
  plaintextToken: string;
  tokenHash: string;
} {
  const plaintextToken = randomBytes(24).toString("hex");
  return {
    plaintextToken,
    tokenHash: createSmsLinkTokenHash(plaintextToken),
  };
}

export function verifyTelnyxWebhookSignature(input: {
  headers: Record<string, string | string[] | undefined>;
  rawBody: unknown;
}): boolean {
  const signatureHeader = input.headers["telnyx-signature-ed25519"];
  const timestampHeader = input.headers["telnyx-timestamp"];
  const signature =
    typeof signatureHeader === "string"
      ? signatureHeader
      : Array.isArray(signatureHeader)
        ? signatureHeader[0]
        : "";
  const timestamp =
    typeof timestampHeader === "string"
      ? timestampHeader
      : Array.isArray(timestampHeader)
        ? timestampHeader[0]
        : "";

  if (!signature || !timestamp) {
    return false;
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > TELNYX_WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }

  const rawBody = getWebhookBuffer(input.rawBody);
  const message = Buffer.concat([Buffer.from(timestamp), Buffer.from("|"), rawBody]);

  try {
    const publicKey = createTelnyxVerificationKey();
    return verify(null, message, publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export function parseVerifiedTelnyxWebhook(payload: unknown): VerifiedTelnyxWebhook {
  const data = (payload as any)?.data || {};
  const eventType = String(data.event_type || "").trim();
  if (!eventType) {
    throw new Error("Telnyx webhook payload is missing event_type");
  }

  return {
    eventId: typeof data.id === "string" ? data.id : null,
    eventType,
    occurredAt: typeof data.occurred_at === "string" ? data.occurred_at : null,
    payload: typeof data.payload === "object" && data.payload ? data.payload : {},
    raw: typeof payload === "object" && payload ? (payload as Record<string, any>) : {},
  };
}

export function parseTelnyxInboundMessage(webhook: VerifiedTelnyxWebhook): TelnyxInboundMessage {
  const payload = webhook.payload || {};
  const from = toPhoneValue(payload.from);
  const to = toPhoneValue(payload.to);
  const text = String(payload.text || payload.body || "").trim();

  if (!from) {
    throw new Error("Inbound Telnyx message is missing a sender phone number");
  }

  return {
    providerEventId: webhook.eventId,
    providerMessageId: typeof payload.id === "string" ? payload.id : null,
    from,
    to,
    text,
    receivedAt: webhook.occurredAt || new Date().toISOString(),
    raw: webhook.raw,
  };
}

export function parseTelnyxDeliveryEvent(webhook: VerifiedTelnyxWebhook): TelnyxDeliveryEvent {
  const payload = webhook.payload || {};

  return {
    providerEventId: webhook.eventId,
    providerMessageId: typeof payload.id === "string" ? payload.id : null,
    to: toPhoneValue(payload.to),
    from: toPhoneValue(payload.from),
    status: String(payload.delivery_status || payload.status || webhook.eventType),
    occurredAt: webhook.occurredAt || new Date().toISOString(),
    raw: webhook.raw,
  };
}

export async function sendTelnyxSms(input: {
  to: string;
  text: string;
}): Promise<{ id: string | null; accepted: boolean }> {
  const apiKey = process.env.TELNYX_API_KEY?.trim() || "";
  if (!apiKey) {
    throw new Error("TELNYX_API_KEY is not configured");
  }

  const from = process.env.TELNYX_FROM_NUMBER?.trim() || "";
  const messagingProfileId = process.env.TELNYX_MESSAGING_PROFILE_ID?.trim() || "";
  if (!from && !messagingProfileId) {
    throw new Error("TELNYX_FROM_NUMBER or TELNYX_MESSAGING_PROFILE_ID must be configured");
  }

  const response = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: input.to,
      text: input.text,
      ...(from ? { from } : {}),
      ...(messagingProfileId ? { messaging_profile_id: messagingProfileId } : {}),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      String(payload?.errors?.[0]?.detail || payload?.error || "Telnyx SMS send failed"),
    );
  }

  return {
    id: typeof payload?.data?.id === "string" ? payload.data.id : null,
    accepted: true,
  };
}
