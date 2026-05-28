import type { Express, Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { createClient, User as SupabaseUser } from "@supabase/supabase-js";
import { storage } from "./storage";
import { observeAuthTelemetryEvent } from "./observability/metrics";

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

async function upsertSupabaseUser(supabaseUser: SupabaseUser): Promise<void> {
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

    // Log migration detection for debugging
    console.log(`[SUPABASE_AUTH] Auth check for ${supabaseUser.email}:`);
    console.log(`  - Supabase ID: ${supabaseUser.id}`);
    console.log(
      `  - Existing by ID: ${existingUserById?.id || "none"} (admin: ${existingUserById?.isAdmin})`,
    );
    console.log(
      `  - Existing by email: ${existingUserByEmail?.id || "none"} (admin: ${existingUserByEmail?.isAdmin})`,
    );

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
    console.log(
      `[SUPABASE_AUTH] Upserted user: ${supabaseUser.email} (id: ${upsertedUser.id}, admin: ${upsertedUser.isAdmin}, preserved: ${!!existingUser?.username})`,
    );
  } catch (error: any) {
    console.error("[SUPABASE_AUTH] Error upserting user:", error.message);
    throw error;
  }
}

function buildRequestUser(supabaseUser: SupabaseUser) {
  const fullName = supabaseUser.user_metadata?.full_name || "";
  const nameParts = fullName.split(" ");

  return {
    claims: {
      sub: supabaseUser.id,
      email: supabaseUser.email,
      first_name: supabaseUser.user_metadata?.first_name || nameParts[0],
      last_name: supabaseUser.user_metadata?.last_name || nameParts.slice(1).join(" "),
    },
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
  const bypassAuth = process.env.DEV_BYPASS_AUTH !== "false";

  if (isDev && bypassAuth) {
    if (!(req as any).user) {
      const mockUserId = "dev-user-12345678";
      (req as any).user = {
        claims: {
          sub: mockUserId,
          email: "dev@example.com",
          first_name: "Dev",
          last_name: "User",
        },
      };

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

  try {
    await upsertSupabaseUser(supabaseUser);
  } catch (error: any) {
    console.error("[SUPABASE_AUTH] Failed to sync authenticated user:", error?.message || error);
    res.status(503).json({ message: "Authentication temporarily unavailable" });
    return;
  }

  (req as any).user = buildRequestUser(supabaseUser);

  next();
}

export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const isDev = process.env.NODE_ENV === "development";
  const bypassAuth = process.env.DEV_BYPASS_AUTH !== "false";

  if (isDev && bypassAuth && !(req as any).user) {
    const mockUserId = "dev-user-12345678";
    (req as any).user = {
      claims: {
        sub: mockUserId,
        email: "dev@example.com",
        first_name: "Dev",
        last_name: "User",
      },
    };

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

  const token = extractToken(req);

  if (token) {
    const supabaseUser = await verifySupabaseToken(token);

    if (supabaseUser) {
      try {
        await upsertSupabaseUser(supabaseUser);
        (req as any).user = buildRequestUser(supabaseUser);
      } catch (error) {
        console.error("[SUPABASE_AUTH] Error in optionalAuth:", error);
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
