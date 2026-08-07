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
import { assertSafeMagicLinkUrl, MAGIC_LINK_GATE_PURPOSE } from "./magic-link-delivery";
import { getAuthPrincipal } from "./principal";

const requestSchema = z.object({
  email: z.string().trim().email().max(320),
  returnTo: z.string().max(2048).optional(),
});
const gateSchema = z.string().uuid();

export const AUTH_CAPABILITIES_PATH = "/api/auth/capabilities";

export function getPublicAuthCapabilities(env: NodeJS.ProcessEnv = process.env) {
  const rawProvider = (env.AUTH_PROVIDER ?? "SUPABASE").trim().toUpperCase();
  const provider =
    rawProvider === "DUAL" || rawProvider === "BETTER_AUTH" ? rawProvider : "SUPABASE";
  const magicLinkEnabled = env.AUTH_MAGIC_LINK_ENABLED === "true";
  return {
    passwordlessWeb: provider !== "SUPABASE" && magicLinkEnabled,
    nativeHandoff:
      provider !== "SUPABASE" && magicLinkEnabled && env.AUTH_NATIVE_HANDOFF_ENABLED === "true",
  };
}

function registerAuthCapabilitiesRoute(app: Express): void {
  app.get(AUTH_CAPABILITIES_PATH, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(getPublicAuthCapabilities());
  });
}

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

export async function consumeMagicLinkGate(id: string, now = new Date()): Promise<string | null> {
  const rows = await db
    .update(authContinuations)
    .set({ consumedAt: now })
    .where(
      and(
        eq(authContinuations.id, id),
        eq(authContinuations.purpose, MAGIC_LINK_GATE_PURPOSE),
        isNull(authContinuations.consumedAt),
        gt(authContinuations.expiresAt, now),
      ),
    )
    .returning({ destination: authContinuations.destination });
  return rows[0]?.destination ?? null;
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

export function renderMagicLinkGatePage(
  gate: string | null,
  options: { expired?: boolean } = {},
): string {
  const validGate = gateSchema.safeParse(gate).success ? gate : null;
  const title = options.expired ? "Sign-in link unavailable" : "Confirm your Sportfolio sign-in";
  const message = options.expired
    ? "This sign-in link has expired or was already used. Request a new link to continue."
    : "To protect one-time sign-in links from email security scanners, confirm below before the link is used.";
  const action = validGate
    ? `<form method="post" action="/api/auth/web/verify" style="margin:28px 0 0"><input type="hidden" name="gate" value="${escapeHtml(validGate)}"><button type="submit" style="border:0;border-radius:10px;background:#111827;color:#fff;font:700 16px Arial,sans-serif;padding:14px 22px;cursor:pointer;width:100%">Continue to Sportfolio</button></form>`
    : `<p style="margin:28px 0 0"><a href="/login" style="display:inline-block;box-sizing:border-box;width:100%;text-align:center;border-radius:10px;background:#111827;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px">Request a new link</a></p>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#f5f7fa;color:#172033;font-family:Arial,sans-serif"><main style="min-height:100vh;display:grid;place-items:center;padding:24px"><section style="box-sizing:border-box;width:100%;max-width:480px;background:#fff;border-radius:16px;padding:32px;box-shadow:0 12px 36px rgba(15,23,42,.08)"><div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#667085;margin-bottom:12px">Sportfolio</div><h1 style="font-size:26px;line-height:1.2;margin:0 0 12px">${escapeHtml(title)}</h1><p style="font-size:16px;line-height:1.6;color:#475467;margin:0">${escapeHtml(message)}</p>${action}</section></main></body></html>`;
}

function setMagicLinkPageHeaders(res: Parameters<Express["get"]>[1] extends never ? never : any) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
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
  registerAuthCapabilitiesRoute(app);
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

  app.get("/auth/magic-link", (req, res) => {
    const gate = typeof req.query.gate === "string" ? req.query.gate : null;
    setMagicLinkPageHeaders(res);
    if (!gateSchema.safeParse(gate).success) {
      return res.status(400).send(renderMagicLinkGatePage(null, { expired: true }));
    }
    return res.status(200).send(renderMagicLinkGatePage(gate));
  });

  app.post("/api/auth/web/verify", async (req, res) => {
    const parsed = gateSchema.safeParse(req.body?.gate);
    if (!parsed.success) {
      setMagicLinkPageHeaders(res);
      return res.status(400).send(renderMagicLinkGatePage(null, { expired: true }));
    }

    try {
      const destination = await consumeMagicLinkGate(parsed.data);
      if (!destination) {
        setMagicLinkPageHeaders(res);
        return res.status(410).send(renderMagicLinkGatePage(null, { expired: true }));
      }
      const safeDestination = assertSafeMagicLinkUrl(destination, resolvedConfig);
      res.setHeader("Cache-Control", "no-store");
      return res.redirect(303, safeDestination);
    } catch (error) {
      logger.warn(
        { errorName: error instanceof Error ? error.name : "unknown" },
        "Magic-link gate verification failed",
      );
      setMagicLinkPageHeaders(res);
      return res.status(410).send(renderMagicLinkGatePage(null, { expired: true }));
    }
  });

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
