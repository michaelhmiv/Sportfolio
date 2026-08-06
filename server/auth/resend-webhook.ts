import { createHash } from "node:crypto";
import type { Express, Request } from "express";
import { Resend } from "resend";
import { authEmailEvents, emailSuppressions } from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import { type AuthRuntimeConfig, getAuthRuntimeConfig } from "./config";
import { hashAuthEmailIdentity, normalizeAuthEmail } from "./identity-policy";

export const RESEND_WEBHOOK_PATH = "/api/webhooks/resend";
const SUPPRESSION_EVENTS = new Set(["email.complained", "email.suppressed"]);

export type ResendWebhookEvent = {
  type: string;
  created_at: string;
  data?: {
    email_id?: string;
    to?: string[];
    bounce?: { type?: string; subType?: string; message?: string };
  };
};

function firstRecipientHash(event: ResendWebhookEvent, eventId: string): string {
  const recipient = event.data?.to?.[0];
  if (!recipient) return createHash("sha256").update(`unknown:${eventId}`).digest("hex");
  return hashAuthEmailIdentity(normalizeAuthEmail(recipient));
}

export function shouldSuppressForEvent(event: ResendWebhookEvent): boolean {
  if (SUPPRESSION_EVENTS.has(event.type)) return true;
  if (event.type !== "email.bounced") return false;
  const bounceType = event.data?.bounce?.type?.toLowerCase();
  return !bounceType || bounceType === "permanent";
}

export function sanitizeResendWebhookPayload(event: ResendWebhookEvent) {
  return {
    bounceType: event.data?.bounce?.type ?? null,
    bounceSubType: event.data?.bounce?.subType ?? null,
  };
}

export async function persistResendWebhookEvent(eventId: string, event: ResendWebhookEvent) {
  const recipientHash = firstRecipientHash(event, eventId);
  const occurredAt = new Date(event.created_at);
  await db
    .insert(authEmailEvents)
    .values({
      providerEventId: eventId,
      eventType: event.type,
      recipientHash,
      providerMessageId: event.data?.email_id ?? null,
      occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
      payload: sanitizeResendWebhookPayload(event),
    })
    .onConflictDoNothing({ target: authEmailEvents.providerEventId });

  if (shouldSuppressForEvent(event)) {
    await db
      .insert(emailSuppressions)
      .values({
        emailIdentityHash: recipientHash,
        reason: event.type,
        sourceEventId: eventId,
      })
      .onConflictDoUpdate({
        target: emailSuppressions.emailIdentityHash,
        set: {
          reason: event.type,
          sourceEventId: eventId,
          suppressedAt: new Date(),
          liftedAt: null,
        },
      });
  }
}

function headerValue(req: Request, name: string): string {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

export function registerResendWebhookRoute(
  app: Express,
  config: AuthRuntimeConfig = getAuthRuntimeConfig(),
): boolean {
  if (!config.RESEND_API_KEY || !config.RESEND_WEBHOOK_SECRET) {
    logger.info("Resend webhook remains disabled until credentials are configured");
    return false;
  }
  const webhookSecret = config.RESEND_WEBHOOK_SECRET;
  const resend = new Resend(config.RESEND_API_KEY);
  app.post(RESEND_WEBHOOK_PATH, async (req, res) => {
    const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody.toString("utf8") : "";
    try {
      const eventId = headerValue(req, "svix-id");
      if (!rawBody || !eventId) throw new Error("INVALID_RESEND_WEBHOOK");
      const event = (await resend.webhooks.verify({
        payload: rawBody,
        headers: {
          id: eventId,
          timestamp: headerValue(req, "svix-timestamp"),
          signature: headerValue(req, "svix-signature"),
        },
        webhookSecret,
      })) as ResendWebhookEvent;
      await persistResendWebhookEvent(eventId, event);
      res.status(200).json({ received: true });
    } catch (error) {
      logger.warn(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "Rejected Resend webhook",
      );
      res.status(400).json({ received: false });
    }
  });
  return true;
}
