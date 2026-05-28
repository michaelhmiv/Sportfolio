import type { AccountDeletionRequest } from "@shared/schema";
import express, { type RequestHandler } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAccountDeletionRoutes } from "./account-deletion";

function createTestServer() {
  const app = express();
  app.use(express.json());
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test server");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    app,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

function buildDeletionRequest(
  overrides: Partial<AccountDeletionRequest> = {},
): AccountDeletionRequest {
  return {
    id: "deletion-request-1",
    userId: "user-account-delete",
    status: "pending",
    reason: "privacy",
    details: "Delete my account and profile history.",
    requestedAt: new Date("2026-05-28T12:00:00.000Z"),
    effectiveAt: new Date("2026-05-29T12:00:00.000Z"),
    cancelledAt: null,
    processedAt: null,
    retainedRecordsNote: "Ledger records may be retained for legal compliance.",
    metadata: {},
    ...overrides,
  };
}

const authMiddleware: RequestHandler = (req: any, _res, next) => {
  req.user = { claims: { sub: "user-account-delete" } };
  next();
};

describe("registerAccountDeletionRoutes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty status when no account deletion request exists", async () => {
    const { app, baseUrl, close } = createTestServer();
    const services = {
      ensureSchema: vi.fn().mockResolvedValue(undefined),
      getLatestRequest: vi.fn().mockResolvedValue(undefined),
      createRequest: vi.fn(),
      cancelRequest: vi.fn(),
    };

    registerAccountDeletionRoutes(app, { authMiddleware, services });

    try {
      const response = await fetch(`${baseUrl}/api/account/deletion/status`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        hasRequest: false,
        status: "none",
        request: null,
      });
    } finally {
      await close();
    }
  });

  it("requires DELETE confirmation text before creating a deletion request", async () => {
    const { app, baseUrl, close } = createTestServer();
    const services = {
      ensureSchema: vi.fn().mockResolvedValue(undefined),
      getLatestRequest: vi.fn().mockResolvedValue(undefined),
      createRequest: vi.fn(),
      cancelRequest: vi.fn(),
    };

    registerAccountDeletionRoutes(app, { authMiddleware, services });

    try {
      const response = await fetch(`${baseUrl}/api/account/deletion/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationText: "remove" }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining("Type DELETE"),
      });
      expect(services.createRequest).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("creates a new account deletion request with in-app metadata", async () => {
    const { app, baseUrl, close } = createTestServer();
    const createdRequest = buildDeletionRequest();
    const services = {
      ensureSchema: vi.fn().mockResolvedValue(undefined),
      getLatestRequest: vi.fn().mockResolvedValue(undefined),
      createRequest: vi.fn().mockResolvedValue({
        request: createdRequest,
        alreadyPending: false,
      }),
      cancelRequest: vi.fn(),
    };

    registerAccountDeletionRoutes(app, { authMiddleware, services });

    try {
      const response = await fetch(`${baseUrl}/api/account/deletion/request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sportfolio-client-platform": "ios",
        },
        body: JSON.stringify({
          confirmationText: "DELETE",
          reason: "privacy",
          details: "Please remove my account from active systems.",
        }),
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        success: true,
        alreadyPending: false,
        hasRequest: true,
        status: "pending",
        canCancel: true,
      });
      expect(services.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-account-delete",
          reason: "privacy",
          details: "Please remove my account from active systems.",
          metadata: expect.objectContaining({
            requestedFrom: "in_app",
            clientPlatform: "ios",
            userAgent: expect.any(String),
          }),
        }),
      );
    } finally {
      await close();
    }
  });

  it("returns 404 when attempting to cancel with no pending request", async () => {
    const { app, baseUrl, close } = createTestServer();
    const services = {
      ensureSchema: vi.fn().mockResolvedValue(undefined),
      getLatestRequest: vi.fn().mockResolvedValue(undefined),
      createRequest: vi.fn(),
      cancelRequest: vi.fn().mockResolvedValue(undefined),
    };

    registerAccountDeletionRoutes(app, { authMiddleware, services });

    try {
      const response = await fetch(`${baseUrl}/api/account/deletion/cancel`, {
        method: "POST",
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({
        error: "No pending account deletion request found.",
      });
    } finally {
      await close();
    }
  });

  it("cancels an existing pending account deletion request", async () => {
    const { app, baseUrl, close } = createTestServer();
    const cancelledRequest = buildDeletionRequest({
      status: "cancelled",
      cancelledAt: new Date("2026-05-28T14:00:00.000Z"),
    });
    const services = {
      ensureSchema: vi.fn().mockResolvedValue(undefined),
      getLatestRequest: vi.fn().mockResolvedValue(undefined),
      createRequest: vi.fn(),
      cancelRequest: vi.fn().mockResolvedValue(cancelledRequest),
    };

    registerAccountDeletionRoutes(app, { authMiddleware, services });

    try {
      const response = await fetch(`${baseUrl}/api/account/deletion/cancel`, {
        method: "POST",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        success: true,
        hasRequest: true,
        status: "cancelled",
        canCancel: false,
      });
      expect(services.cancelRequest).toHaveBeenCalledWith("user-account-delete");
    } finally {
      await close();
    }
  });
});
