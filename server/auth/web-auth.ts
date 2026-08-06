import { randomUUID } from "node:crypto";
import type { Express, Request } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { authContinuations } from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import { BETTER_AUTH_BASE_PATH } from "./better-auth";
import { tryAttachBetterAuthPrincipal } from "./better-auth-session";
import { type AuthRuntimeConfig, assertSafeAuthReturnUrl, getAuthRuntimeConfig } from "./config";
import { getAuthPrincipal } from "./principal";

const requestSchema = z.object({
  email: z.string().trim().email().max(320),
  returnTo: z.string().max(2048).optional(),
});

export function normalizeWebAuthDestination(
  candidate: string | undefined,
  config: AuthRuntimeConfig = getAuthRuntimeConfig(),
): string {
  const absolute = assertSafeAuthReturnUrl(candidate || "/", config);
  const parsed = new URL(absolute);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export async function createWebAuthContinuation(
  destination: string,
  now = new Date(),
): Promise<string> {
  const id = randomUUID();
  await db.insert(authContinuations).values({
    id,
    purpose: "web-magic-link",
    destination,
    stateHash: null,
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
  });
  return id;
}

export async function consumeWebAuthContinuation(
  id: string,
  userId: string,
  now = new Date(),
): Promise<string | null> {
  const rows = await db
    .update(authContinuations)
    .set({ consumedAt: now, userId })
    .where(
      and(
        eq(authContinuations.id, id),
        eq(authContinuations.purpose, "web-magic-link"),
        isNull(authContinuations.consumedAt),
        gt(authContinuations.expiresAt, now),
      ),
    )
    .returning({ destination: authContinuations.destination });
  return rows[0]?.destination ?? null;
}

async function submitMagicLink(email: string, callbackURL: string, config: AuthRuntimeConfig) {
  if (!config.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL_REQUIRED");
  const endpoint = new URL(`${BETTER_AUTH_BASE_PATH}/sign-in/magic-link`, config.BETTER_AUTH_URL);
  const { getBetterAuthServer } = await import("./better-auth");
  return getBetterAuthServer(config).handler(
    new Request(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: config.PUBLIC_SITE_URL,
      },
      body: JSON.stringify({ email, name: "Sportfolio User", callbackURL }),
    }),
  );
}

export function registerWebAuthRoutes(app: Express, config?: AuthRuntimeConfig): boolean {
  const rawProvider = (process.env.AUTH_PROVIDER ?? "SUPABASE").trim().toUpperCase();
  if (!config && rawProvider === "SUPABASE") {
    logger.info("Passwordless web routes remain disabled");
    return false;
  }
  const resolvedConfig = config ?? getAuthRuntimeConfig();
  if (
    resolvedConfig.AUTH_PROVIDER === "SUPABASE" ||
    !resolvedConfig.AUTH_MAGIC_LINK_ENABLED ||
    !resolvedConfig.BETTER_AUTH_URL
  ) {
    logger.info("Passwordless web routes remain disabled");
    return false;
  }

  app.post("/api/auth/web/request", async (req, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ accepted: false, code: "invalid_request" });
    }

    const destination = normalizeWebAuthDestination(parsed.data.returnTo, resolvedConfig);
    const continuation = await createWebAuthContinuation(destination);
    const callback = new URL("/auth/complete", resolvedConfig.PUBLIC_SITE_URL);
    callback.searchParams.set("continuation", continuation);

    try {
      const response = await submitMagicLink(
        parsed.data.email,
        callback.toString(),
        resolvedConfig,
      );
      if (!response.ok) {
        logger.warn({ status: response.status }, "Magic-link provider request was not accepted");
      }
    } catch (error) {
      logger.warn(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "Magic-link request failed",
      );
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(202).json({ accepted: true });
  });

  app.get("/api/auth/web/complete", async (req: Request, res) => {
    const continuation = typeof req.query.continuation === "string" ? req.query.continuation : "";
    if (!continuation) {
      return res.status(400).json({ completed: false, code: "invalid" });
    }

    try {
      const authenticated = await tryAttachBetterAuthPrincipal(req, resolvedConfig);
      const principal = getAuthPrincipal(req);
      if (!authenticated || !principal) {
        return res.status(401).json({ completed: false, code: "session_missing" });
      }
      const destination = await consumeWebAuthContinuation(continuation, principal.userId);
      if (!destination) {
        return res.status(410).json({ completed: false, code: "expired_or_consumed" });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json({ completed: true, destination });
    } catch (error) {
      logger.warn(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "Web auth completion failed",
      );
      return res.status(401).json({ completed: false, code: "identity_rejected" });
    }
  });

  return true;
}
