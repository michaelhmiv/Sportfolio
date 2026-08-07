import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionDomainError } from "./state-engine";

vi.mock("../auth/runtime-auth", () => ({
  isAuthenticated: (req: any, res: any, next: () => void) => {
    const userId = req.header("x-user-id");
    if (!userId) {
      res.status(401).json({ error: { code: "AUTHENTICATION_REQUIRED" } });
      return;
    }
    req.user = { claims: { sub: userId } };
    next();
  },
}));

import { registerCollectionRoutes } from "./routes";

describe("collection mutation routes", () => {
  let server: ReturnType<express.Express["listen"]> | null = null;
  let baseUrl = "";
  const service = {
    setAllocation: vi.fn(),
    releaseAllocation: vi.fn(),
    completeCollection: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    service.setAllocation.mockResolvedValue({
      allocation: { allocationId: "allocation-1", allocatedQuantity: "1.0000" },
      state: { assemblyState: "in_progress", progressBps: 5000 },
    });
    service.releaseAllocation.mockResolvedValue({
      allocation: { allocationId: "allocation-1", status: "released" },
      state: { assemblyState: "unstarted", progressBps: 0 },
    });
    service.completeCollection.mockResolvedValue({
      state: { assemblyState: "active", progressBps: 10000 },
      award: { awardId: "award-1" },
      eventType: "completed",
    });

    const app = express();
    app.use(express.json());
    registerCollectionRoutes(app, service);
    server = await new Promise((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
      server = null;
    }
  });

  it("requires authentication", async () => {
    const response = await fetch(`${baseUrl}/api/me/collections/test/slots/slot-1/allocation`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: "1.0000" }),
    });

    expect(response.status).toBe(401);
    expect(service.setAllocation).not.toHaveBeenCalled();
  });

  it("sets an absolute allocation with the authenticated user identity", async () => {
    const response = await fetch(
      `${baseUrl}/api/me/collections/mlb-2026-test/slots/slot-1/allocation`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-user-id": "user-1" },
        body: JSON.stringify({ quantity: "1.0000" }),
      },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(service.setAllocation).toHaveBeenCalledWith({
      userId: "user-1",
      slug: "mlb-2026-test",
      slotId: "slot-1",
      quantity: "1.0000",
    });
    expect(payload.data.state.progressBps).toBe(5000);
  });

  it("rejects numeric quantities so callers cannot introduce floating-point ambiguity", async () => {
    const response = await fetch(`${baseUrl}/api/me/collections/test/slots/slot-1/allocation`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({ quantity: 1 }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_REQUEST");
    expect(service.setAllocation).not.toHaveBeenCalled();
  });

  it("releases an allocation idempotently", async () => {
    const response = await fetch(`${baseUrl}/api/me/collections/test/slots/slot-1/allocation`, {
      method: "DELETE",
      headers: { "x-user-id": "user-1" },
    });

    expect(response.status).toBe(200);
    expect(service.releaseAllocation).toHaveBeenCalledWith({
      userId: "user-1",
      slug: "test",
      slotId: "slot-1",
    });
  });

  it("deliberately completes a ready collection", async () => {
    const response = await fetch(`${baseUrl}/api/me/collections/test/complete`, {
      method: "POST",
      headers: { "x-user-id": "user-1" },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(service.completeCollection).toHaveBeenCalledWith({ userId: "user-1", slug: "test" });
    expect(payload.data.eventType).toBe("completed");
  });

  it("preserves machine-readable domain errors", async () => {
    service.setAllocation.mockRejectedValueOnce(
      new CollectionDomainError(
        "INSUFFICIENT_AVAILABLE_SHARES",
        "Insufficient available shares",
        409,
        { availableQuantity: "0.5000" },
      ),
    );

    const response = await fetch(`${baseUrl}/api/me/collections/test/slots/slot-1/allocation`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({ quantity: "1.0000" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toEqual({
      code: "INSUFFICIENT_AVAILABLE_SHARES",
      message: "Insufficient available shares",
      details: { availableQuantity: "0.5000" },
    });
  });
});
