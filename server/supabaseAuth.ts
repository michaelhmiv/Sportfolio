import type { Express, Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { createClient, User as SupabaseUser } from "@supabase/supabase-js";
import { storage } from "./storage";
import { observeAuthTelemetryEvent } from "./observability/metrics";
import { attachAuthPrincipal, type AuthPrincipal } from "./auth/principal";
import { tryAttachBetterAuthPrincipal } from "./auth/better-auth-session";
import { getAuthRuntimeConfig } from "./auth/config";
import { registerWebAuthRoutes } from "./auth/web-auth";
import { registerNativeAuthRoutes, tryAttachNativeAuthPrincipal } from "./auth/native-auth";

// Fallback to SUPABASE_KEY if specific keys are missing
// This handles cases where only the generic SUPABASE_KEY (usually anon) is provided
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const supabaseConfigVersion = supabaseUrl
  ? createHash("sha256").update(supabaseUrl).digest("hex").slice(0, 12)
  : "unconfigured";

const allowedTelemetryEvents = new Set([
  "login_submit",
  "login_success",
  "login_failure",
  "signup_submit",
  "signup_success",
  "signup_failure",
  "signup_resend_clicked",
  "signup_resend_success",
  "signup_resend_failure",
  "google_oauth_started",
  "google_oauth_failure",
  "apple_oauth_started",
  "apple_oauth_failure",
]);

const allowedTelemetryCodes = new Set([
  "invalid_email",
  "email_exists",
  "invalid_credentials",
  "email_unconfirmed",
  "rate_limited",
  "service_unavailable",
  "signup_disabled",
  "unknown",
  "none",
]);

const supabaseConfigured = Boolean(supabaseUrl && supabaseServiceRoleKey);

if (!supabaseConfigured) {
  console.warn("[SUPABASE_AUTH] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY");
  console.warn("[SUPABASE_AUTH] Auth endpoints will return 503 until configured");
}

// Only create the Supabase client when credentials are available.
// Passing an empty string crashes newer @supabase/supabase-js versions.
const supabaseAdmin = supabaseConfigured
  ? createClient(supabaseUrl!, supabaseServiceRoleKey!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

async function verifySupabaseToken(token: string): Promise<SupabaseUser | null> {
  if (!supabaseAdmin) return null;
  try {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);

    if (error) {
      console.log("[SUPABASE_AUTH] Token verification failed:", error.message);
      return null;
    }

    return user;
  } catch (error: any) {
    console.error("[SUPABASE_AUTH] Error verifying token:", error.message);
    return null;
  }
}

async function upsertSupabaseUser(supabaseUser: SupabaseUser): Promise<string> {
  try {
    const fullName = supabaseUser.user_metadata?.full_name || "";
    const nameParts = fullName.split(" ");
    const firstName = supabaseUser.user_metadata?.first_name || nameParts[0] || null;
    const lastName = supabaseUser.user_metadata?.last_name || nameParts.slice(1).join(" ") || null;

    // Check for existing user by ID or email to preserve their username
    const existingUserById = await storage.getUser(supabaseUser.id);
    const existingUserByEmail = supabaseUser.email
      ? await storage.getUserByEmail(supabaseUser.email)
      : null;
    const existingUser = existingUserById || existingUserByEmail;

    // Avoid a write only when this exact provider subject is already linked to an
    // active canonical user. Deleted users and newly observed replacement subjects
    // continue through storage.upsertUser so tombstone and identity-link rules run.
    const knownProviderSubjects = new Set(
      [existingUser?.authProviderSubject, ...(existingUser?.authProviderSubjects ?? [])].filter(
        (value): value is string => Boolean(value),
      ),
    );
    const providerSubjectAlreadyLinked =
      existingUser?.id === supabaseUser.id || knownProviderSubjects.has(supabaseUser.id);
    if (existingUser && !existingUser.deletedAt && providerSubjectAlreadyLinked) {
      return existingUser.id;
    }

    // Only generate a new username for truly new users - preserve existing usernames
    const username =
      existingUser?.username ||
      supabaseUser.email?.split("@")[0] ||
      `user_${supabaseUser.id.substring(0, 8)}`;

    const upsertedUser = await storage.upsertUser({
      id: supabaseUser.id,
      email: supabaseUser.email || null,
      firstName,
      lastName,
      profileImageUrl: supabaseUser.user_metadata?.avatar_url || null,
      username,
    });
    return upsertedUser.id;
  } catch (error: any) {
    console.error("[SUPABASE_AUTH] Error upserting user:", error.message);
    throw error;
  }
}

function isDeletedUserSyncError(error: unknown): error is Error & { code: "USER_DELETED" } {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: string }).code === "USER_DELETED"
  );
}

function buildSupabasePrincipal(
  supabaseUser: SupabaseUser,
  canonicalUserId = supabaseUser.id,
): AuthPrincipal {
  const fullName = supabaseUser.user_metadata?.full_name || "";
  const nameParts = fullName.split(" ");
  return {
    userId: canonicalUserId,
    provider: "supabase",
    providerSubject: supabaseUser.id,
    email: supabaseUser.email,
    firstName: supabaseUser.user_metadata?.first_name || nameParts[0] || null,
    lastName: supabaseUser.user_metadata?.last_name || nameParts.slice(1).join(" ") || null,
  };
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  const cookieToken = (req as any).cookies?.["sb-access-token"];
  if (cookieToken) {
    return cookieToken;
  }

  return null;
}

export async function isAuthenticated(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const isDev = process.env.NODE_ENV === "development";
  const bypassAuth = process.env.DEV_BYPASS_AUTH === "true";

  if (isDev && bypassAuth) {
    if (!(req as any).user) {
      const mockUserId = "dev-user-12345678";
      attachAuthPrincipal(req, {
        userId: mockUserId,
        provider: "development",
        providerSubject: mockUserId,
        email: "dev@example.com",
        firstName: "Dev",
        lastName: "User",
      });

      try {
        const existingUser = await storage.getUser(mockUserId);
        if (!existingUser) {
          await storage.upsertUser({
            id: mockUserId,
            email: "dev@example.com",
            firstName: "Dev",
            lastName: "User",
            username: "dev_user",
          });
        }
        console.log("[DEV_BYPASS] Dev mode auth bypass active - using mock user");
      } catch (error: any) {
        console.error("[DEV_BYPASS] Failed to create dev user:", error.message);
      }
    }
    return next();
  }

  const rawAuthProvider = (process.env.AUTH_PROVIDER ?? "SUPABASE").trim().toUpperCase();
  if (rawAuthProvider !== "SUPABASE") {
    const authConfig = getAuthRuntimeConfig();
    try {
      if (await tryAttachBetterAuthPrincipal(req, authConfig)) {
        next();
        return;
      }
      if (await tryAttachNativeAuthPrincipal(req)) {
        next();
        return;
      }
    } catch (error) {
      console.error("[AUTH] Better Auth session resolution failed", error);
      res.status(503).json({ message: "Authentication temporarily unavailable" });
      return;
    }
    if (!authConfig.AUTH_SUPABASE_FALLBACK_ENABLED) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
  }

  const token = extractToken(req);

  if (!token) {
    console.log("[SUPABASE_AUTH] No token provided");
    res.status(401).json({ message: "Unauthorized - No token provided" });
    return;
  }

  const supabaseUser = await verifySupabaseToken(token);

  if (!supabaseUser) {
    console.log("[SUPABASE_AUTH] Invalid or expired token");
    res.status(401).json({ message: "Unauthorized - Invalid token" });
    return;
  }

  let canonicalUserId: string;
  try {
    canonicalUserId = await upsertSupabaseUser(supabaseUser);
  } catch (error: any) {
    if (isDeletedUserSyncError(error)) {
      console.warn(`[SUPABASE_AUTH] Rejected deleted user identity: ${supabaseUser.id}`);
      res.status(401).json({ message: "Unauthorized - Account deleted" });
      return;
    }
    console.error("[SUPABASE_AUTH] Failed to sync authenticated user:", error?.message || error);
    res.status(503).json({ message: "Authentication temporarily unavailable" });
    return;
  }

  attachAuthPrincipal(req, buildSupabasePrincipal(supabaseUser, canonicalUserId));

  next();
}

export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const isDev = process.env.NODE_ENV === "development";
  const bypassAuth = process.env.DEV_BYPASS_AUTH === "true";

  if (isDev && bypassAuth && !(req as any).user) {
    const mockUserId = "dev-user-12345678";
    attachAuthPrincipal(req, {
      userId: mockUserId,
      provider: "development",
      providerSubject: mockUserId,
      email: "dev@example.com",
      firstName: "Dev",
      lastName: "User",
    });

    try {
      const existingUser = await storage.getUser(mockUserId);
      if (!existingUser) {
        await storage.upsertUser({
          id: mockUserId,
          email: "dev@example.com",
          firstName: "Dev",
          lastName: "User",
          username: "dev_user",
        });
      }
    } catch (error: any) {
      console.error("[DEV_BYPASS] Failed to create dev user:", error.message);
    }
    return next();
  }

  const rawAuthProvider = (process.env.AUTH_PROVIDER ?? "SUPABASE").trim().toUpperCase();
  if (rawAuthProvider !== "SUPABASE") {
    const authConfig = getAuthRuntimeConfig();
    try {
      if (await tryAttachBetterAuthPrincipal(req, authConfig)) {
        next();
        return;
      }
      if (await tryAttachNativeAuthPrincipal(req)) {
        next();
        return;
      }
    } catch (error) {
      console.error("[AUTH] Optional Better Auth resolution failed", error);
    }
    if (!authConfig.AUTH_SUPABASE_FALLBACK_ENABLED) {
      next();
      return;
    }
  }

  const token = extractToken(req);

  if (token) {
    const supabaseUser = await verifySupabaseToken(token);

    if (supabaseUser) {
      try {
        const canonicalUserId = await upsertSupabaseUser(supabaseUser);
        attachAuthPrincipal(req, buildSupabasePrincipal(supabaseUser, canonicalUserId));
      } catch (error) {
        if (isDeletedUserSyncError(error)) {
          console.warn(`[SUPABASE_AUTH] Ignored deleted optional identity: ${supabaseUser.id}`);
        } else {
          console.error("[SUPABASE_AUTH] Error in optionalAuth:", error);
        }
      }
    }
  }

  next();
}

export async function setupAuth(app: Express): Promise<void> {
  console.log("[SUPABASE_AUTH] Setting up Supabase authentication");

  app.set("trust proxy", 1);

  app.get("/api/auth/config", (_req: Request, res: Response) => {
    if (!supabaseUrl || !supabaseAnonKey) {
      res.status(500).json({ error: "Supabase not configured" });
      return;
    }

    console.log("[SUPABASE_AUTH] Serving auth config", {
      configVersion: supabaseConfigVersion,
      hasSupabaseUrl: !!supabaseUrl,
      hasAnonKey: !!supabaseAnonKey,
    });

    res.json({
      url: supabaseUrl,
      anonKey: supabaseAnonKey,
      configVersion: supabaseConfigVersion,
    });
  });

  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    res.json({ success: true, message: "Logged out successfully" });
  });

  registerWebAuthRoutes(app);
  registerNativeAuthRoutes(app);

  app.post("/api/auth/telemetry", (req: Request, res: Response) => {
    const event = typeof req.body?.event === "string" ? req.body.event.trim() : "";
    const eventCode = typeof req.body?.code === "string" ? req.body.code.trim() : "none";
    const normalizedEvent = event.toLowerCase();
    const normalizedCode = eventCode.toLowerCase();

    if (!normalizedEvent || !allowedTelemetryEvents.has(normalizedEvent)) {
      return res.status(202).json({ success: true, ignored: true });
    }

    const metricCode = allowedTelemetryCodes.has(normalizedCode) ? normalizedCode : "none";
    observeAuthTelemetryEvent({
      event: normalizedEvent,
      code: metricCode,
    });

    console.log("[SUPABASE_AUTH] Auth telemetry", {
      event: normalizedEvent,
      code: metricCode,
    });

    return res.json({ success: true });
  });

  console.log("[SUPABASE_AUTH] Authentication setup completed");
}
