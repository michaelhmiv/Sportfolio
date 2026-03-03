import type { Express, Request, Response } from "express";
import { isAuthenticated } from "../supabaseAuth";
import {
  completeSmsPhoneLink,
  getSmsSettings,
  handleVerifiedInboundSmsWebhook,
  parseTelnyxWebhookPayload,
  recordVerifiedSmsStatusWebhook,
  startSmsPhoneLink,
  updateSmsSettings,
} from "../sms-service";
import {
  isTelnyxDeliveryEventType,
  isTelnyxInboundMessageEventType,
  verifyTelnyxWebhookSignature,
} from "../services/telnyx-sms";

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

function getUserId(req: Request): string {
  return req.user?.claims?.sub || "";
}

function toSmsLinkView(link: Awaited<ReturnType<typeof getSmsSettings>>) {
  if (!link) {
    return null;
  }

  return {
    id: link.id,
    phoneE164: link.phoneE164,
    verifiedAt: link.verifiedAt,
    linkedAt: link.linkedAt,
    lastInboundAt: link.lastInboundAt,
    lastOutboundAt: link.lastOutboundAt,
    smsEnabled: link.smsEnabled,
    smsOptInStatus: link.smsOptInStatus,
    smsOptInSource: link.smsOptInSource,
  };
}

function hasValidTelnyxSignature(req: RawBodyRequest): boolean {
  return verifyTelnyxWebhookSignature({
    headers: req.headers as Record<string, string | string[] | undefined>,
    rawBody: req.rawBody,
  });
}

function handleSmsRouteError(res: Response, error: unknown, fallbackMessage: string) {
  console.error("[SMS] Route error:", error);
  const errorDetail =
    process.env.NODE_ENV !== "production"
      ? error instanceof Error
        ? error.message
        : String(error)
      : undefined;

  res.status(500).json({
    message: fallbackMessage,
    ...(errorDetail ? { error: errorDetail } : {}),
  });
}

function runInBackground(task: () => Promise<void>) {
  setImmediate(() => {
    void task().catch((error) => {
      console.error("[SMS] Background task error:", error);
    });
  });
}

export function registerSmsRoutes(app: Express): void {
  app.get("/api/account/sms", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const link = await getSmsSettings(getUserId(req));
      res.json({
        link: toSmsLinkView(link),
      });
    } catch (error) {
      handleSmsRouteError(res, error, "Could not load SMS settings");
    }
  });

  app.put("/api/account/sms", isAuthenticated, async (req: Request, res: Response) => {
    try {
      if (typeof req.body?.smsEnabled !== "boolean") {
        res.status(400).json({ message: "smsEnabled must be a boolean" });
        return;
      }

      const link = await updateSmsSettings(getUserId(req), req.body.smsEnabled);
      if (!link) {
        res.status(404).json({ message: "No linked phone found for this account" });
        return;
      }

      res.json({
        link: toSmsLinkView(link),
      });
    } catch (error) {
      handleSmsRouteError(res, error, "Could not update SMS settings");
    }
  });

  app.post("/api/sms/link/start", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
      if (!phone) {
        res.status(400).json({ message: "Phone number is required" });
        return;
      }

      const result = await startSmsPhoneLink(getUserId(req), phone);
      res.status(201).json({
        phoneE164: result.phoneE164,
        expiresAt: result.expiresAt,
      });
    } catch (error: any) {
      const message = error?.message || "Could not start SMS phone link";
      const status = /already linked|valid/i.test(message) ? 400 : 500;
      res.status(status).json({
        message: status === 400 ? message : "Could not start SMS phone link",
        ...(status === 500 && process.env.NODE_ENV !== "production" ? { error: message } : {}),
      });
    }
  });

  app.post("/api/sms/link/complete", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
      if (!token) {
        res.status(400).json({ message: "Token is required" });
        return;
      }

      const link = await completeSmsPhoneLink(getUserId(req), token);
      res.json({
        link: toSmsLinkView(link),
      });
    } catch (error: any) {
      const message = error?.message || "Could not complete SMS phone link";
      const status = /expired|invalid|already linked/i.test(message) ? 400 : 500;
      res.status(status).json({
        message: status === 400 ? message : "Could not complete SMS phone link",
        ...(status === 500 && process.env.NODE_ENV !== "production" ? { error: message } : {}),
      });
    }
  });

  app.post("/api/webhooks/telnyx/sms", async (req: Request, res: Response) => {
    const rawRequest = req as RawBodyRequest;

    if (!hasValidTelnyxSignature(rawRequest)) {
      res.status(401).json({ message: "Invalid Telnyx signature" });
      return;
    }

    let webhook: ReturnType<typeof parseTelnyxWebhookPayload>;
    try {
      webhook = parseTelnyxWebhookPayload(req.body);
    } catch {
      res.status(400).json({ message: "Invalid Telnyx payload" });
      return;
    }

    res.json({ received: true });

    runInBackground(async () => {
      if (isTelnyxInboundMessageEventType(webhook.eventType)) {
        await handleVerifiedInboundSmsWebhook(webhook);
        return;
      }

      if (isTelnyxDeliveryEventType(webhook.eventType)) {
        await recordVerifiedSmsStatusWebhook(webhook);
      }
    });
  });

  app.post("/api/webhooks/telnyx/sms/status", async (req: Request, res: Response) => {
    const rawRequest = req as RawBodyRequest;

    if (!hasValidTelnyxSignature(rawRequest)) {
      res.status(401).json({ message: "Invalid Telnyx signature" });
      return;
    }

    let webhook: ReturnType<typeof parseTelnyxWebhookPayload>;
    try {
      webhook = parseTelnyxWebhookPayload(req.body);
    } catch {
      res.status(400).json({ message: "Invalid Telnyx payload" });
      return;
    }

    if (!isTelnyxDeliveryEventType(webhook.eventType)) {
      res.json({ received: true, ignored: true });
      return;
    }

    res.json({ received: true });

    runInBackground(async () => {
      await recordVerifiedSmsStatusWebhook(webhook);
    });
  });
}
