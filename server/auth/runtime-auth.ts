import type { Express, NextFunction, Request, Response } from "express";
import { storage } from "../storage";
import { observeAuthTelemetryEvent } from "../observability/metrics";
import { tryAttachBetterAuthPrincipal } from "./better-auth-session";
import { getAuthRuntimeConfig } from "./config";
import { registerNativeAuthRoutes, tryAttachNativeAuthPrincipal } from "./native-auth";
import { attachAuthPrincipal } from "./principal";
import { registerWebAuthRoutes } from "./web-auth";

const allowedTelemetryEvents = new Set([
  "magic_link_requested",
  "magic_link_request_failure",
  "login_success",
  "login_failure",
  "logout_success",
]);
const allowedTelemetryCodes = new Set([
  "invalid_email",
  "rate_limited",
  "service_unavailable",
  "signup_disabled",
  "unknown",
  "none",
]);

async function attachDevelopmentPrincipal(req: Request): Promise<void> {
  const userId = "dev-user-12345678";
  attachAuthPrincipal(req, {
    userId,
    provider: "development",
    providerSubject: userId,
    email: "dev@example.com",
    firstName: "Dev",
    lastName: "User",
  });
  if (!(await storage.getUser(userId))) {
    await storage.upsertUser({
      id: userId,
      email: "dev@example.com",
      firstName: "Dev",
      lastName: "User",
      username: "dev_user",
    });
  }
}

async function attachRuntimePrincipal(req: Request): Promise<boolean> {
  const config = getAuthRuntimeConfig();
  if (await tryAttachBetterAuthPrincipal(req, config)) return true;
  if (await tryAttachNativeAuthPrincipal(req)) return true;
  return false;
}

export async function isAuthenticated(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (process.env.NODE_ENV === "development" && process.env.DEV_BYPASS_AUTH === "true") {
    try {
      await attachDevelopmentPrincipal(req);
      next();
    } catch (error) {
      console.error("[AUTH] Development identity setup failed", error);
      res.status(503).json({ message: "Authentication temporarily unavailable" });
    }
    return;
  }

  try {
    if (await attachRuntimePrincipal(req)) {
      next();
      return;
    }
  } catch (error) {
    console.error("[AUTH] Session resolution failed", error);
    res.status(503).json({ message: "Authentication temporarily unavailable" });
    return;
  }

  res.status(401).json({ message: "Unauthorized" });
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  if (process.env.NODE_ENV === "development" && process.env.DEV_BYPASS_AUTH === "true") {
    try {
      await attachDevelopmentPrincipal(req);
    } catch (error) {
      console.error("[AUTH] Development optional identity setup failed", error);
    }
    next();
    return;
  }

  try {
    await attachRuntimePrincipal(req);
  } catch (error) {
    console.error("[AUTH] Optional session resolution failed", error);
  }
  next();
}

export async function setupAuth(app: Express): Promise<void> {
  app.set("trust proxy", 1);
  registerWebAuthRoutes(app);
  registerNativeAuthRoutes(app);

  app.post("/api/auth/logout", (_req, res) => {
    res.json({ success: true, message: "Logged out successfully" });
  });

  app.post("/api/auth/telemetry", (req, res) => {
    const event = typeof req.body?.event === "string" ? req.body.event.trim().toLowerCase() : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim().toLowerCase() : "none";
    if (!allowedTelemetryEvents.has(event)) {
      return res.status(202).json({ success: true, ignored: true });
    }
    observeAuthTelemetryEvent({ event, code: allowedTelemetryCodes.has(code) ? code : "none" });
    return res.json({ success: true });
  });
}
