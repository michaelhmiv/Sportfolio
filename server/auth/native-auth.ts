import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Express, Request } from "express";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  authContinuations,
  authIdentities,
  nativeAuthHandoffs,
  nativeAuthSessions,
} from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import { getBetterAuthServer, BETTER_AUTH_BASE_PATH } from "./better-auth";
import { tryAttachBetterAuthPrincipal } from "./better-auth-session";
import { type AuthRuntimeConfig, getAuthRuntimeConfig } from "./config";
import { FixedWindowRateLimiter } from "./magic-link-delivery";
import { attachAuthPrincipal, getAuthPrincipal } from "./principal";

const NATIVE_CONTINUATION_PURPOSE = "native-magic-link";
const NATIVE_HANDOFF_TTL_MS = 2 * 60 * 1000;
const NATIVE_CONTINUATION_TTL_MS = 10 * 60 * 1000;
const NATIVE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NATIVE_TOKEN_PREFIX = "spn_";
const nativeExchangeLimiter = new FixedWindowRateLimiter(20, 15 * 60 * 1000);

const nativeRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  platform: z.enum(["ios", "android"]),
  binding: z.string().min(32).max(256),
});

const nativeExchangeSchema = z.object({
  code: z.string().min(24).max(256),
  binding: z.string().min(32).max(256),
  platform: z.enum(["ios", "android"]),
});

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function extractNativeBearer(req: Request): string | null {
  const header = req.header("authorization")?.trim() || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.startsWith(NATIVE_TOKEN_PREFIX) ? token : null;
}

async function submitNativeMagicLink(
  email: string,
  callbackURL: string,
  config: AuthRuntimeConfig,
): Promise<globalThis.Response> {
  if (!config.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL_REQUIRED");
  const endpoint = new URL(`${BETTER_AUTH_BASE_PATH}/sign-in/magic-link`, config.BETTER_AUTH_URL);
  return getBetterAuthServer(config).handler(
    new globalThis.Request(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: config.PUBLIC_SITE_URL,
      },
      body: JSON.stringify({ email, name: "Sportfolio User", callbackURL }),
    }),
  ) as unknown as Promise<globalThis.Response>;
}

async function createNativeContinuation(
  platform: "ios" | "android",
  binding: string,
  now = new Date(),
): Promise<string> {
  const id = randomUUID();
  await db.insert(authContinuations).values({
    id,
    purpose: NATIVE_CONTINUATION_PURPOSE,
    destination: platform,
    stateHash: sha256(binding),
    expiresAt: new Date(now.getTime() + NATIVE_CONTINUATION_TTL_MS),
  });
  return id;
}

async function consumeNativeContinuation(
  id: string,
  userId: string,
  now = new Date(),
): Promise<{ platform: "ios" | "android"; bindingHash: string } | null> {
  const rows = await db
    .update(authContinuations)
    .set({ consumedAt: now, userId })
    .where(
      and(
        eq(authContinuations.id, id),
        eq(authContinuations.purpose, NATIVE_CONTINUATION_PURPOSE),
        isNull(authContinuations.consumedAt),
        gt(authContinuations.expiresAt, now),
      ),
    )
    .returning({
      platform: authContinuations.destination,
      bindingHash: authContinuations.stateHash,
    });

  const row = rows[0];
  if (!row?.bindingHash || (row.platform !== "ios" && row.platform !== "android")) return null;
  return { platform: row.platform, bindingHash: row.bindingHash };
}

async function createNativeHandoff(
  authUserId: string,
  platform: "ios" | "android",
  bindingHash: string,
  now = new Date(),
): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  await db.insert(nativeAuthHandoffs).values({
    codeHash: sha256(code),
    authUserId,
    platform,
    requestBindingHash: bindingHash,
    expiresAt: new Date(now.getTime() + NATIVE_HANDOFF_TTL_MS),
  });
  return code;
}

async function exchangeNativeHandoff(
  code: string,
  binding: string,
  platform: "ios" | "android",
  now = new Date(),
): Promise<{ token: string; expiresAt: Date; userId: string } | null> {
  return db.transaction(async (tx) => {
    const handoff = await tx
      .update(nativeAuthHandoffs)
      .set({
        consumedAt: now,
        attemptCount: sql`${nativeAuthHandoffs.attemptCount} + 1`,
      })
      .where(
        and(
          eq(nativeAuthHandoffs.codeHash, sha256(code)),
          eq(nativeAuthHandoffs.platform, platform),
          eq(nativeAuthHandoffs.requestBindingHash, sha256(binding)),
          isNull(nativeAuthHandoffs.consumedAt),
          gt(nativeAuthHandoffs.expiresAt, now),
        ),
      )
      .returning({ authUserId: nativeAuthHandoffs.authUserId });

    if (!handoff[0]) return null;

    const identity = await tx
      .select({ userId: authIdentities.sportfolioUserId })
      .from(authIdentities)
      .where(eq(authIdentities.authUserId, handoff[0].authUserId))
      .limit(1);
    if (!identity[0]) return null;

    const token = `${NATIVE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(now.getTime() + NATIVE_SESSION_TTL_MS);
    await tx.insert(nativeAuthSessions).values({
      tokenHash: sha256(token),
      authUserId: handoff[0].authUserId,
      sportfolioUserId: identity[0].userId,
      platform,
      expiresAt,
    });

    return { token, expiresAt, userId: identity[0].userId };
  });
}

export async function tryAttachNativeAuthPrincipal(req: Request): Promise<boolean> {
  const token = extractNativeBearer(req);
  if (!token) return false;
  const now = new Date();
  const rows = await db
    .select({
      id: nativeAuthSessions.id,
      userId: nativeAuthSessions.sportfolioUserId,
      authUserId: nativeAuthSessions.authUserId,
    })
    .from(nativeAuthSessions)
    .where(
      and(
        eq(nativeAuthSessions.tokenHash, sha256(token)),
        isNull(nativeAuthSessions.revokedAt),
        gt(nativeAuthSessions.expiresAt, now),
      ),
    )
    .limit(1);
  const session = rows[0];
  if (!session) return false;

  await db
    .update(nativeAuthSessions)
    .set({ lastUsedAt: now })
    .where(eq(nativeAuthSessions.id, session.id));
  attachAuthPrincipal(req, {
    userId: session.userId,
    provider: "native-better-auth",
    providerSubject: session.authUserId,
    sessionId: session.id,
  });
  return true;
}

export function registerNativeAuthRoutes(
  app: Express,
  config: AuthRuntimeConfig = getAuthRuntimeConfig(),
): boolean {
  if (
    config.AUTH_PROVIDER === "SUPABASE" ||
    !config.AUTH_MAGIC_LINK_ENABLED ||
    !config.AUTH_NATIVE_HANDOFF_ENABLED ||
    !config.BETTER_AUTH_URL
  ) {
    logger.info("Native passwordless auth routes remain disabled");
    return false;
  }

  app.post("/api/auth/native/request", async (req, res) => {
    const parsed = nativeRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ accepted: false, code: "invalid_request" });

    const continuation = await createNativeContinuation(parsed.data.platform, parsed.data.binding);
    const callback = new URL("/auth/native/complete", config.PUBLIC_SITE_URL);
    callback.searchParams.set("continuation", continuation);

    try {
      const response = await submitNativeMagicLink(parsed.data.email, callback.toString(), config);
      if (!response.ok)
        logger.warn({ status: response.status }, "Native magic-link provider rejected request");
    } catch (error) {
      logger.warn(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "Native magic-link request failed",
      );
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(202).json({ accepted: true });
  });

  app.get("/auth/native/complete", async (req, res) => {
    const continuation = typeof req.query.continuation === "string" ? req.query.continuation : "";
    if (!continuation) return res.status(400).send("Invalid native sign-in continuation.");

    try {
      const authenticated = await tryAttachBetterAuthPrincipal(req, config);
      const principal = getAuthPrincipal(req);
      if (!authenticated || !principal || principal.provider !== "better-auth") {
        return res.status(401).send("The sign-in session could not be verified.");
      }
      const consumed = await consumeNativeContinuation(continuation, principal.userId);
      if (!consumed)
        return res.status(410).send("This native sign-in request has expired or was used.");

      const code = await createNativeHandoff(
        principal.providerSubject,
        consumed.platform,
        consumed.bindingHash,
      );
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Location", `sportfolio://auth/callback?code=${encodeURIComponent(code)}`);
      return res.status(303).send("Returning to Sportfolio…");
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "Native passwordless completion failed",
      );
      return res.status(401).send("The sign-in session could not be completed.");
    }
  });

  app.post("/api/auth/native/exchange", async (req, res) => {
    const ipKey = sha256(req.ip || "unknown");
    if (!nativeExchangeLimiter.consume(ipKey)) {
      return res.status(429).json({ error: "rate_limited" });
    }
    const parsed = nativeExchangeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

    const session = await exchangeNativeHandoff(
      parsed.data.code,
      parsed.data.binding,
      parsed.data.platform,
    );
    if (!session) return res.status(401).json({ error: "invalid_or_expired_handoff" });

    res.setHeader("Cache-Control", "no-store");
    return res.json({
      accessToken: session.token,
      expiresAt: session.expiresAt.toISOString(),
      userId: session.userId,
    });
  });

  app.post("/api/auth/native/logout", async (req, res) => {
    const token = extractNativeBearer(req);
    if (token) {
      await db
        .update(nativeAuthSessions)
        .set({ revokedAt: new Date() })
        .where(eq(nativeAuthSessions.tokenHash, sha256(token)));
    }
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true });
  });

  logger.info("Mounted native passwordless auth routes");
  return true;
}
