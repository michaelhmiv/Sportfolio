import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { Resend } from "resend";
import { authContinuations, emailSuppressions } from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import { type AuthRuntimeConfig, assertSafeAuthReturnUrl, getAuthRuntimeConfig } from "./config";
import { hashAuthEmailIdentity, normalizeAuthEmail } from "./identity-policy";

const WINDOW_MS = 15 * 60 * 1000;
const EMAIL_LIMIT = 3;
const IP_LIMIT = 10;
const GLOBAL_LIMIT = 300;
const MAGIC_LINK_GATE_TTL_MS = 5 * 60 * 1000;
export const MAGIC_LINK_GATE_PURPOSE = "email-magic-link-gate";

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

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
  const ipHash = createHash("sha256")
    .update(ipAddress || "unknown")
    .digest("hex");
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

export async function createMagicLinkGate(
  safeVerificationUrl: string,
  config: AuthRuntimeConfig = getAuthRuntimeConfig(),
  now = new Date(),
): Promise<string> {
  const verificationUrl = assertSafeMagicLinkUrl(safeVerificationUrl, config);
  const gateId = randomUUID();

  await db.transaction(async (tx) => {
    await tx
      .delete(authContinuations)
      .where(
        and(
          eq(authContinuations.purpose, MAGIC_LINK_GATE_PURPOSE),
          lt(authContinuations.expiresAt, now),
        ),
      );
    await tx.insert(authContinuations).values({
      id: gateId,
      purpose: MAGIC_LINK_GATE_PURPOSE,
      destination: verificationUrl,
      stateHash: null,
      expiresAt: new Date(now.getTime() + MAGIC_LINK_GATE_TTL_MS),
    });
  });

  const gateUrl = new URL("/auth/magic-link", config.PUBLIC_SITE_URL);
  gateUrl.searchParams.set("gate", gateId);
  return gateUrl.toString();
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] || character,
  );
}

export function renderMagicLinkEmail(url: string) {
  const safeUrl = escapeHtml(url);
  return {
    subject: "Sign in to Sportfolio",
    text: `Use this secure link to sign in to Sportfolio:\n\n${url}\n\nAfter opening the link, confirm that you want to continue. This link expires in 5 minutes and can only be used once. If you did not request it, ignore this email.`,
    html: `<!doctype html><html><body style="margin:0;background:#f5f7fa;font-family:Arial,sans-serif;color:#172033"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px"><tr><td><h1 style="margin:0 0 12px;font-size:26px">Sign in to Sportfolio</h1><p style="line-height:1.6">Open the secure confirmation page below, then confirm that you want to continue. The link expires in 5 minutes and can only be used once.</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700">Continue to Sportfolio</a></p><p style="font-size:13px;color:#667085;line-height:1.5">If you did not request this email, you can ignore it.</p></td></tr></table></td></tr></table></body></html>`,
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
  createGate?: (safeVerificationUrl: string) => Promise<string>;
};

async function defaultSuppressionLookup(emailHash: string): Promise<boolean> {
  const rows = await db
    .select({ id: emailSuppressions.id })
    .from(emailSuppressions)
    .where(
      and(eq(emailSuppressions.emailIdentityHash, emailHash), isNull(emailSuppressions.liftedAt)),
    )
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
  const createGate = dependencies.createGate ?? ((url: string) => createMagicLinkGate(url, config));

  return async ({ email, url, token }: { email: string; url: string; token: string }) => {
    if (!config.AUTH_MAGIC_LINK_ENABLED) throw new Error("AUTH_MAGIC_LINK_DISABLED");
    if (!config.AUTH_EMAIL_FROM) throw new Error("AUTH_EMAIL_FROM_REQUIRED");

    const normalizedEmail = normalizeAuthEmail(email);
    const emailHash = hashAuthEmailIdentity(normalizedEmail);
    if (!emailLimiter.consume(emailHash) || (await isSuppressed(emailHash))) {
      logger.info(
        { emailHash: emailHash.slice(0, 12), outcome: "accepted_without_send" },
        "Magic-link request accepted",
      );
      return;
    }

    const safeUrl = assertSafeMagicLinkUrl(url, config);
    const gatedUrl = await createGate(safeUrl);
    const content = renderMagicLinkEmail(gatedUrl);
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
    logger.info(
      { emailHash: emailHash.slice(0, 12), providerMessageId: result.id },
      "Magic-link email submitted",
    );
  };
}
