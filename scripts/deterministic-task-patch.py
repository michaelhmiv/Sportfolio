from pathlib import Path
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")

package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
resend_version = subprocess.check_output(["npm", "view", "resend", "version"], text=True).strip()
package["dependencies"]["resend"] = resend_version
package["scripts"]["auth:email:test"] = "vitest run server/auth/magic-link-delivery.test.ts server/auth/resend-webhook.test.ts"
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

write("server/auth/magic-link-delivery.ts", '''import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { Resend } from "resend";
import { emailSuppressions } from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import { type AuthRuntimeConfig, assertSafeAuthReturnUrl, getAuthRuntimeConfig } from "./config";
import { hashAuthEmailIdentity, normalizeAuthEmail } from "./identity-policy";

const WINDOW_MS = 15 * 60 * 1000;
const EMAIL_LIMIT = 3;
const IP_LIMIT = 10;
const GLOBAL_LIMIT = 300;

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  consume(key: string, now = Date.now()): boolean {
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }
}

const emailLimiter = new FixedWindowRateLimiter(EMAIL_LIMIT, WINDOW_MS);
const ipLimiter = new FixedWindowRateLimiter(IP_LIMIT, WINDOW_MS);
const globalLimiter = new FixedWindowRateLimiter(GLOBAL_LIMIT, WINDOW_MS);

export function consumeMagicLinkRequestQuota(ipAddress: string | undefined): boolean {
  const ipHash = createHash("sha256").update(ipAddress || "unknown").digest("hex");
  return globalLimiter.consume("global") && ipLimiter.consume(ipHash);
}

export function assertSafeMagicLinkUrl(url: string, config = getAuthRuntimeConfig()): string {
  if (!config.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL_REQUIRED");
  const parsed = new URL(url);
  if (parsed.origin !== new URL(config.BETTER_AUTH_URL).origin) {
    throw new Error("AUTH_MAGIC_LINK_ORIGIN_REJECTED");
  }
  for (const key of ["callbackURL", "callbackUrl", "redirectTo"]) {
    const callback = parsed.searchParams.get(key);
    if (callback) assertSafeAuthReturnUrl(callback, config);
  }
  return parsed.toString();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\\\"": "&quot;",
    "'": "&#039;",
  })[character] || character);
}

export function renderMagicLinkEmail(url: string) {
  const safeUrl = escapeHtml(url);
  return {
    subject: "Sign in to Sportfolio",
    text: `Use this secure link to sign in to Sportfolio:\n\n${url}\n\nThis link expires in 5 minutes and can only be used once. If you did not request it, ignore this email.`,
    html: `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Arial,sans-serif;color:#172033"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px"><tr><td><h1 style="margin:0 0 12px;font-size:26px">Sign in to Sportfolio</h1><p style="line-height:1.6">Use the secure button below to continue. The link expires in 5 minutes and can only be used once.</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700">Sign in securely</a></p><p style="font-size:13px;color:#667085;line-height:1.5">If you did not request this email, you can ignore it.</p></td></tr></table></td></tr></table></body></html>`,
  };
}

export type MagicLinkDeliveryDependencies = {
  send?: (input: {
    from: string;
    to: string[];
    replyTo?: string;
    subject: string;
    text: string;
    html: string;
    idempotencyKey: string;
  }) => Promise<{ id?: string; error?: { name?: string; message?: string } | null }>;
  isSuppressed?: (emailHash: string) => Promise<boolean>;
};

async function defaultSuppressionLookup(emailHash: string): Promise<boolean> {
  const rows = await db
    .select({ id: emailSuppressions.id })
    .from(emailSuppressions)
    .where(and(eq(emailSuppressions.emailIdentityHash, emailHash), isNull(emailSuppressions.liftedAt)))
    .limit(1);
  return rows.length > 0;
}

function createDefaultSender(config: AuthRuntimeConfig) {
  if (!config.RESEND_API_KEY) throw new Error("RESEND_API_KEY_REQUIRED");
  const resend = new Resend(config.RESEND_API_KEY);
  return async (input: Parameters<NonNullable<MagicLinkDeliveryDependencies["send"]>>[0]) => {
    const { data, error } = await resend.emails.send(
      {
        from: input.from,
        to: input.to,
        replyTo: input.replyTo,
        subject: input.subject,
        text: input.text,
        html: input.html,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { id: data?.id, error };
  };
}

export function createResendMagicLinkSender(
  config: AuthRuntimeConfig = getAuthRuntimeConfig(),
  dependencies: MagicLinkDeliveryDependencies = {},
) {
  const send = dependencies.send ?? createDefaultSender(config);
  const isSuppressed = dependencies.isSuppressed ?? defaultSuppressionLookup;

  return async ({ email, url, token }: { email: string; url: string; token: string }) => {
    if (!config.AUTH_MAGIC_LINK_ENABLED) throw new Error("AUTH_MAGIC_LINK_DISABLED");
    if (!config.AUTH_EMAIL_FROM) throw new Error("AUTH_EMAIL_FROM_REQUIRED");

    const normalizedEmail = normalizeAuthEmail(email);
    const emailHash = hashAuthEmailIdentity(normalizedEmail);
    if (!emailLimiter.consume(emailHash) || (await isSuppressed(emailHash))) {
      logger.info({ emailHash: emailHash.slice(0, 12), outcome: "accepted_without_send" }, "Magic-link request accepted");
      return;
    }

    const safeUrl = assertSafeMagicLinkUrl(url, config);
    const content = renderMagicLinkEmail(safeUrl);
    const idempotencyKey = `magic-link/${createHash("sha256").update(token).digest("hex")}`;
    const result = await send({
      from: config.AUTH_EMAIL_FROM,
      to: [normalizedEmail],
      replyTo: config.AUTH_EMAIL_REPLY_TO,
      ...content,
      idempotencyKey,
    });
    if (result.error) {
      logger.error(
        { emailHash: emailHash.slice(0, 12), providerError: result.error.name || "unknown" },
        "Magic-link delivery failed",
      );
      throw new Error("AUTH_EMAIL_DELIVERY_FAILED");
    }
    logger.info({ emailHash: emailHash.slice(0, 12), providerMessageId: result.id }, "Magic-link email submitted");
  };
}
''')

write("server/auth/resend-webhook.ts", '''import { createHash } from "node:crypto";
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
        set: { reason: event.type, sourceEventId: eventId, suppressedAt: new Date(), liftedAt: null },
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
        webhookSecret: config.RESEND_WEBHOOK_SECRET,
      })) as ResendWebhookEvent;
      await persistResendWebhookEvent(eventId, event);
      res.status(200).json({ received: true });
    } catch (error) {
      logger.warn({ errorName: error instanceof Error ? error.name : "unknown" }, "Rejected Resend webhook");
      res.status(400).json({ received: false });
    }
  });
  return true;
}
''')

write("server/auth/magic-link-delivery.test.ts", '''import { describe, expect, it, vi } from "vitest";
import { getAuthRuntimeConfig } from "./config";
import { assertSafeMagicLinkUrl, createResendMagicLinkSender, FixedWindowRateLimiter, renderMagicLinkEmail } from "./magic-link-delivery";

function config() {
  return getAuthRuntimeConfig({
    NODE_ENV: "test",
    PUBLIC_SITE_URL: "https://beta.sportfolio.market",
    AUTH_PROVIDER: "DUAL",
    AUTH_MAGIC_LINK_ENABLED: "true",
    AUTH_SUPABASE_FALLBACK_ENABLED: "true",
    AUTH_NEW_REGISTRATIONS_ENABLED: "true",
    AUTH_OAUTH_PROVIDER_ENABLED: "false",
    AUTH_NATIVE_HANDOFF_ENABLED: "false",
    AUTH_MIGRATION_MODE: "off",
    AUTH_ENVIRONMENT: "beta",
    AUTH_DATABASE_ENVIRONMENT: "production",
    AUTH_SHARED_PRODUCTION_DATABASE: "true",
    BETTER_AUTH_SECRET: "test-only-better-auth-secret-at-least-32-characters",
    BETTER_AUTH_URL: "https://auth.sportfolio.market",
    RESEND_API_KEY: "re_test",
    RESEND_WEBHOOK_SECRET: "whsec_test",
    AUTH_EMAIL_FROM: "Sportfolio <login@auth.sportfolio.market>",
  });
}

describe("magic-link delivery", () => {
  it("enforces fixed-window limits", () => {
    const limiter = new FixedWindowRateLimiter(2, 1000);
    expect(limiter.consume("a", 0)).toBe(true);
    expect(limiter.consume("a", 1)).toBe(true);
    expect(limiter.consume("a", 2)).toBe(false);
    expect(limiter.consume("a", 1001)).toBe(true);
  });
  it("rejects an off-domain generated link or callback", () => {
    expect(() => assertSafeMagicLinkUrl("https://evil.example/token", config())).toThrow("ORIGIN_REJECTED");
    expect(() => assertSafeMagicLinkUrl("https://auth.sportfolio.market/token?callbackURL=https://evil.example", config())).toThrow("RETURN_ORIGIN_REJECTED");
  });
  it("renders escaped branded content", () => {
    const rendered = renderMagicLinkEmail("https://auth.sportfolio.market/callback?a=1&b=2");
    expect(rendered.html).toContain("Sign in securely");
    expect(rendered.html).toContain("&amp;");
    expect(rendered.text).toContain("expires in 5 minutes");
  });
  it("sends with a token-derived idempotency key without exposing the token", async () => {
    const send = vi.fn().mockResolvedValue({ id: "email-id", error: null });
    const sender = createResendMagicLinkSender(config(), { send, isSuppressed: async () => false });
    await sender({ email: "USER@example.com", url: "https://auth.sportfolio.market/callback?callbackURL=https%3A%2F%2Fbeta.sportfolio.market%2Fportfolio", token: "secret-token" });
    const call = send.mock.calls[0][0];
    expect(call.to).toEqual(["user@example.com"]);
    expect(call.idempotencyKey).toMatch(/^magic-link\/[a-f0-9]{64}$/);
    expect(call.idempotencyKey).not.toContain("secret-token");
  });
  it("silently accepts suppressed recipients", async () => {
    const send = vi.fn();
    const sender = createResendMagicLinkSender(config(), { send, isSuppressed: async () => true });
    await sender({ email: "blocked@example.com", url: "https://auth.sportfolio.market/callback", token: "token" });
    expect(send).not.toHaveBeenCalled();
  });
});
''')

write("server/auth/resend-webhook.test.ts", '''import { describe, expect, it } from "vitest";
import { sanitizeResendWebhookPayload, shouldSuppressForEvent } from "./resend-webhook";

describe("Resend webhook policy", () => {
  it("suppresses permanent bounces, complaints, and provider suppressions", () => {
    expect(shouldSuppressForEvent({ type: "email.bounced", created_at: new Date().toISOString(), data: { bounce: { type: "Permanent" } } })).toBe(true);
    expect(shouldSuppressForEvent({ type: "email.complained", created_at: new Date().toISOString() })).toBe(true);
    expect(shouldSuppressForEvent({ type: "email.suppressed", created_at: new Date().toISOString() })).toBe(true);
    expect(shouldSuppressForEvent({ type: "email.delivery_delayed", created_at: new Date().toISOString() })).toBe(false);
  });
  it("stores only secret-safe delivery metadata", () => {
    const payload = sanitizeResendWebhookPayload({
      type: "email.bounced",
      created_at: new Date().toISOString(),
      data: { to: ["private@example.com"], bounce: { type: "Permanent", subType: "MessageRejected", message: "private details" } },
    });
    expect(payload).toEqual({ bounceType: "Permanent", bounceSubType: "MessageRejected" });
    expect(JSON.stringify(payload)).not.toContain("private@example.com");
    expect(JSON.stringify(payload)).not.toContain("private details");
  });
});
''')

better_path = ROOT / "server/auth/better-auth.ts"
better = better_path.read_text(encoding="utf-8")
config_import = 'import { type AuthRuntimeConfig, getAuthRuntimeConfig } from "./config";'
if 'from "./magic-link-delivery"' not in better:
    better = better.replace(config_import, config_import + '\nimport { consumeMagicLinkRequestQuota, createResendMagicLinkSender } from "./magic-link-delivery";', 1)
better = better.replace('  sendMagicLink: BetterAuthMagicLinkSender = disabledMagicLinkSender,', '  sendMagicLink: BetterAuthMagicLinkSender = config.AUTH_MAGIC_LINK_ENABLED\n    ? createResendMagicLinkSender(config)\n    : disabledMagicLinkSender,')
mount_anchor = '  const auth = getBetterAuthServer(config);\n'
if "consumeMagicLinkRequestQuota" in better and 'accepted: true' not in better:
    better = better.replace(mount_anchor, mount_anchor + '  app.use(`${BETTER_AUTH_BASE_PATH}/sign-in/magic-link`, (req, res, next) => {\n    if (!consumeMagicLinkRequestQuota(req.ip)) return res.status(202).json({ accepted: true });\n    next();\n  });\n', 1)
better_path.write_text(better, encoding="utf-8")

index_path = ROOT / "server/index.ts"
index = index_path.read_text(encoding="utf-8")
import_anchor = 'import { mountBetterAuthHandler } from "./auth/better-auth";'
if 'from "./auth/resend-webhook"' not in index:
    index = index.replace(import_anchor, import_anchor + '\nimport { registerResendWebhookRoute } from "./auth/resend-webhook";', 1)
parser_anchor = 'app.use(express.urlencoded({ extended: false }));\n'
if 'registerResendWebhookRoute(app, authRuntimeConfig);' not in index:
    index = index.replace(parser_anchor, parser_anchor + '\nregisterResendWebhookRoute(app, authRuntimeConfig);\n', 1)
index_path.write_text(index, encoding="utf-8")

write("docs/auth/resend-magic-links.md", '''# Resend magic-link delivery

Sportfolio sends only transactional authentication email through Resend. Delivery remains disabled until `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `AUTH_EMAIL_FROM`, and `AUTH_MAGIC_LINK_ENABLED=true` are configured in Railway.

Security properties:

- Better Auth stores hashed, single-use tokens with a five-minute expiry.
- Generated links and callback URLs are restricted to the configured Sportfolio origins.
- Email sends use a token-derived idempotency key; the raw token is never logged.
- Per-email, per-IP, and global fixed-window limits protect the request path.
- Suppressed recipients receive an enumeration-resistant accepted response without another delivery attempt.
- The webhook verifies the raw payload and Svix headers before processing.
- Webhook events are idempotent by `svix-id`; routine email addresses are stored only as SHA-256 identity hashes.
- Permanent bounces, spam complaints, and provider suppressions create local suppression records.

The webhook endpoint is `/api/webhooks/resend`. Configure it for `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, and `email.suppressed` after the sending domain is verified.''')

subprocess.run(["npm", "install", "--package-lock-only", "--ignore-scripts"], cwd=ROOT, check=True)
