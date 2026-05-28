import type { AccountDeletionRequest } from "@shared/schema";
import type { Express, RequestHandler } from "express";
import { isAuthenticated } from "../supabaseAuth";
import {
  ACCOUNT_DELETION_CONFIRMATION_TEXT,
  cancelPendingAccountDeletionRequest,
  createAccountDeletionRequest,
  ensureAccountDeletionSchema,
  getLatestAccountDeletionRequest,
} from "../services/account-deletion";

const SUPPORT_EMAIL = "sportfolioholdings@gmail.com";
const MAX_REASON_LENGTH = 200;
const MAX_DETAILS_LENGTH = 1000;

interface AccountDeletionRouteServices {
  ensureSchema: () => Promise<void>;
  getLatestRequest: (userId: string) => Promise<AccountDeletionRequest | undefined>;
  createRequest: (input: {
    userId: string;
    reason?: string | null;
    details?: string | null;
    metadata?: Record<string, unknown>;
  }) => Promise<{ request: AccountDeletionRequest; alreadyPending: boolean }>;
  cancelRequest: (userId: string) => Promise<AccountDeletionRequest | undefined>;
}

interface RegisterAccountDeletionRoutesOptions {
  authMiddleware?: RequestHandler;
  services?: AccountDeletionRouteServices;
}

function getUserId(req: any): string {
  if (!req.user?.claims?.sub) {
    throw new Error("User not authenticated");
  }

  return req.user.claims.sub;
}

function toOptionalTrimmedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, maxLength);
}

function toRequestView(request: AccountDeletionRequest | undefined) {
  if (!request) {
    return {
      hasRequest: false,
      status: "none",
      request: null,
      canCancel: false,
    } as const;
  }

  const canCancel = request.status === "pending";
  return {
    hasRequest: true,
    status: request.status,
    canCancel,
    request: {
      id: request.id,
      status: request.status,
      reason: request.reason,
      details: request.details,
      requestedAt: request.requestedAt,
      effectiveAt: request.effectiveAt,
      cancelledAt: request.cancelledAt,
      processedAt: request.processedAt,
      retainedRecordsNote: request.retainedRecordsNote,
    },
  } as const;
}

function toRouteErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();

  if (normalized.includes("already deleted")) {
    return { status: 409, message: "This account has already been deleted." };
  }

  if (normalized.includes("user not found")) {
    return { status: 404, message: "Account not found." };
  }

  return { status: 500, message: "Could not process account deletion request." };
}

export function registerAccountDeletionRoutes(
  app: Express,
  options: RegisterAccountDeletionRoutesOptions = {},
) {
  const services: AccountDeletionRouteServices = options.services ?? {
    ensureSchema: ensureAccountDeletionSchema,
    getLatestRequest: getLatestAccountDeletionRequest,
    createRequest: createAccountDeletionRequest,
    cancelRequest: cancelPendingAccountDeletionRequest,
  };

  void services.ensureSchema().catch((error) => {
    console.warn("[ACCOUNT_DELETION] Route bootstrap schema ensure failed:", error);
  });

  const authMiddleware = options.authMiddleware ?? isAuthenticated;

  app.get("/api/account/deletion/status", authMiddleware, async (req, res) => {
    try {
      const userId = getUserId(req);
      const latestRequest = await services.getLatestRequest(userId);

      return res.json({
        ...toRequestView(latestRequest),
        confirmationText: ACCOUNT_DELETION_CONFIRMATION_TEXT,
        supportEmail: SUPPORT_EMAIL,
      });
    } catch (error) {
      console.error("[ACCOUNT_DELETION] Failed to load request status:", error);
      return res.status(500).json({ error: "Could not load account deletion status." });
    }
  });

  app.post("/api/account/deletion/request", authMiddleware, async (req, res) => {
    const confirmationText = String(req.body?.confirmationText || "")
      .trim()
      .toUpperCase();
    if (confirmationText !== ACCOUNT_DELETION_CONFIRMATION_TEXT) {
      return res.status(400).json({
        error: `Type ${ACCOUNT_DELETION_CONFIRMATION_TEXT} to confirm account deletion.`,
      });
    }

    try {
      const userId = getUserId(req);
      const reason = toOptionalTrimmedText(req.body?.reason, MAX_REASON_LENGTH) ?? null;
      const details = toOptionalTrimmedText(req.body?.details, MAX_DETAILS_LENGTH) ?? null;
      const metadata: Record<string, unknown> = {
        requestedFrom: "in_app",
        clientPlatform:
          typeof req.header("x-sportfolio-client-platform") === "string"
            ? req.header("x-sportfolio-client-platform")
            : "unknown",
        userAgent: typeof req.header("user-agent") === "string" ? req.header("user-agent") : null,
        ip: req.ip ?? null,
      };

      const { request, alreadyPending } = await services.createRequest({
        userId,
        reason,
        details,
        metadata,
      });

      return res.status(alreadyPending ? 200 : 201).json({
        success: true,
        alreadyPending,
        ...toRequestView(request),
        confirmationText: ACCOUNT_DELETION_CONFIRMATION_TEXT,
        supportEmail: SUPPORT_EMAIL,
      });
    } catch (error) {
      const routeError = toRouteErrorStatus(error);
      console.error("[ACCOUNT_DELETION] Failed to create request:", error);
      return res.status(routeError.status).json({ error: routeError.message });
    }
  });

  app.post("/api/account/deletion/cancel", authMiddleware, async (req, res) => {
    try {
      const userId = getUserId(req);
      const cancelled = await services.cancelRequest(userId);
      if (!cancelled) {
        return res.status(404).json({ error: "No pending account deletion request found." });
      }

      return res.json({
        success: true,
        ...toRequestView(cancelled),
      });
    } catch (error) {
      console.error("[ACCOUNT_DELETION] Failed to cancel request:", error);
      return res.status(500).json({ error: "Could not cancel account deletion request." });
    }
  });
}
