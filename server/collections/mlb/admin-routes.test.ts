import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../supabaseAuth", () => ({
  isAuthenticated: (req: any, res: any, next: () => void) => {
    const userId = req.header("x-user-id");
    if (!userId) return res.status(401).json({ error: { code: "AUTHENTICATION_REQUIRED" } });
    req.user = { claims: { sub: userId } };
    next();
  },
}));

import { registerMlbCollectionAdminRoutes } from "./admin-routes";

describe("MLB collection admin routes", () => {
  let server: ReturnType<express.Express["listen"]> | null = null;
  let baseUrl = "";
  const service = {
    preview: vi.fn(),
    inspect: vi.fn(),
    participation: vi.fn(),
    publishInitial: vi.fn(),
    refresh: vi.fn(),
    finalize: vi.fn(),
    correct: vi.fn(),
    reconcile: vi.fn(),
    disable: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    service.preview.mockResolvedValue([
      {
        ok: true,
        definition: { slug: "catalog-test" },
        sourceSnapshot: { sha256: "a".repeat(64) },
      },
    ]);
    service.inspect.mockResolvedValue([{ slug: "catalog-test", lifecycle_status: "tracking" }]);
    service.participation.mockResolvedValue({ slug: "catalog-test", participant_count: 2 });
    service.publishInitial.mockResolvedValue({ status: "published", definitionCount: 25 });
    service.refresh.mockResolvedValue({ membershipChanged: true, added: 1 });
    service.finalize.mockResolvedValue({ lifecycleStatus: "final" });
    service.correct.mockResolvedValue({ version: 2, lifecycleStatus: "final" });
    service.reconcile.mockResolvedValue({ scanned: 2, repaired: 1 });
    service.disable.mockResolvedValue({
      slug: "catalog-test",
      lifecycleStatus: "disabled",
      releasedAllocations: 2,
      reconciliation: { scanned: 1, repaired: 1, errors: 0 },
      membershipEvents: 1,
    });

    const app = express();
    app.use(express.json());
    registerMlbCollectionAdminRoutes(app, service, (req, res, next) => {
      if (req.header("x-admin") !== "true") {
        res.status(403).json({ error: { code: "ADMIN_REQUIRED" } });
        return;
      }
      next();
    });
    server = await new Promise((resolve) => {
      const listener = app.listen(0, () => resolve(listener));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
    server = null;
  });

  it("requires authentication and an admin user", async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/admin/collections/mlb/catalog/preview`);
    expect(unauthenticated.status).toBe(401);

    const nonAdmin = await fetch(`${baseUrl}/api/admin/collections/mlb/catalog/preview`, {
      headers: { "x-user-id": "user-1" },
    });
    expect(nonAdmin.status).toBe(403);
    expect(service.preview).not.toHaveBeenCalled();
  });

  it("previews a selected catalog definition without writing", async () => {
    const response = await fetch(
      `${baseUrl}/api/admin/collections/mlb/catalog/preview?slug=catalog-test`,
      { headers: { "x-user-id": "admin-1", "x-admin": "true" } },
    );

    expect(response.status).toBe(200);
    expect(service.preview).toHaveBeenCalledWith("catalog-test");
    expect(service.publishInitial).not.toHaveBeenCalled();
  });

  it("rejects unknown preview query parameters", async () => {
    const response = await fetch(
      `${baseUrl}/api/admin/collections/mlb/catalog/preview?slgu=catalog-test`,
      { headers: { "x-user-id": "admin-1", "x-admin": "true" } },
    );

    expect(response.status).toBe(400);
    expect(service.preview).not.toHaveBeenCalled();
  });

  it("requires an explicit publication confirmation phrase", async () => {
    const rejected = await fetch(`${baseUrl}/api/admin/collections/mlb/catalog/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "admin-1",
        "x-admin": "true",
      },
      body: JSON.stringify({ confirm: true }),
    });
    expect(rejected.status).toBe(400);
    expect(service.publishInitial).not.toHaveBeenCalled();

    const catalogSha256 = "f".repeat(64);
    const accepted = await fetch(`${baseUrl}/api/admin/collections/mlb/catalog/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "admin-1",
        "x-admin": "true",
      },
      body: JSON.stringify({ confirm: "PUBLISH_INITIAL_MLB_CATALOG", catalogSha256 }),
    });
    expect(accepted.status).toBe(201);
    expect(service.publishInitial).toHaveBeenCalledWith("admin-1", catalogSha256);
  });

  it("maps persisted publication manifest drift to a catalog conflict", async () => {
    service.publishInitial.mockRejectedValueOnce(
      new Error(
        "Refusing initial MLB catalog retry; catalog-test does not match the confirmed persisted manifest",
      ),
    );
    const response = await fetch(`${baseUrl}/api/admin/collections/mlb/catalog/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "admin-1",
        "x-admin": "true",
      },
      body: JSON.stringify({
        confirm: "PUBLISH_INITIAL_MLB_CATALOG",
        catalogSha256: "f".repeat(64),
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CATALOG_CONFLICT" },
    });
  });

  it("soft-disables a published definition with an audit reason and explicit confirmation", async () => {
    const rejected = await fetch(`${baseUrl}/api/admin/collections/catalog-test/disable`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "admin-1",
        "x-admin": "true",
      },
      body: JSON.stringify({ reason: "Official source correction pending" }),
    });
    expect(rejected.status).toBe(400);
    expect(service.disable).not.toHaveBeenCalled();

    const response = await fetch(`${baseUrl}/api/admin/collections/catalog-test/disable`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "admin-1",
        "x-admin": "true",
      },
      body: JSON.stringify({
        confirm: "DISABLE_COLLECTION",
        reason: "Malformed source data",
        expectedVersion: 3,
        sourceSha256: "c".repeat(64),
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        slug: "catalog-test",
        lifecycleStatus: "disabled",
        releasedAllocations: 2,
      },
    });
    expect(service.disable).toHaveBeenCalledWith(
      "catalog-test",
      "Malformed source data",
      3,
      "c".repeat(64),
    );
  });

  it("requires source-hash confirmation before finalizing tracking membership", async () => {
    const sourceSha256 = "a".repeat(64);
    const rejected = await fetch(`${baseUrl}/api/admin/collections/catalog-test/finalize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "admin-1",
        "x-admin": "true",
      },
      body: JSON.stringify({ confirm: "FINALIZE_MLB_COLLECTION" }),
    });
    expect(rejected.status).toBe(400);
    expect(service.finalize).not.toHaveBeenCalled();

    const accepted = await fetch(`${baseUrl}/api/admin/collections/catalog-test/finalize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "admin-1",
        "x-admin": "true",
      },
      body: JSON.stringify({ confirm: "FINALIZE_MLB_COLLECTION", sourceSha256 }),
    });
    expect(accepted.status).toBe(200);
    expect(service.finalize).toHaveBeenCalledWith("catalog-test", sourceSha256);
  });

  it("creates immutable correction versions with actor, source hash, and reason", async () => {
    const sourceSha256 = "b".repeat(64);
    const response = await fetch(`${baseUrl}/api/admin/collections/catalog-test/correct`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "admin-1",
        "x-admin": "true",
      },
      body: JSON.stringify({
        confirm: "CREATE_MLB_CORRECTION_VERSION",
        sourceSha256,
        reason: "Official source corrected a player assignment",
      }),
    });

    expect(response.status).toBe(201);
    expect(service.correct).toHaveBeenCalledWith(
      "catalog-test",
      "admin-1",
      sourceSha256,
      "Official source corrected a player assignment",
    );
  });

  it("requires a confirmed source snapshot for tracking refreshes and supports bounded reconciliation", async () => {
    const sourceSha256 = "c".repeat(64);
    const rejectedRefresh = await fetch(`${baseUrl}/api/admin/collections/catalog-test/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "admin-1",
        "x-admin": "true",
      },
      body: JSON.stringify({ confirm: "REFRESH_MLB_COLLECTION" }),
    });
    expect(rejectedRefresh.status).toBe(400);
    expect(service.refresh).not.toHaveBeenCalled();

    const refreshed = await fetch(`${baseUrl}/api/admin/collections/catalog-test/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "admin-1",
        "x-admin": "true",
      },
      body: JSON.stringify({ confirm: "REFRESH_MLB_COLLECTION", sourceSha256 }),
    });
    expect(refreshed.status).toBe(200);
    expect(service.refresh).toHaveBeenCalledWith("catalog-test", sourceSha256);

    const reconciled = await fetch(`${baseUrl}/api/admin/collections/reconcile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "admin-1",
        "x-admin": "true",
      },
      body: JSON.stringify({ confirm: "RECONCILE_COLLECTION_STATES", limit: 250 }),
    });
    expect(reconciled.status).toBe(200);
    expect(service.reconcile).toHaveBeenCalledWith(250);
  });

  it("maps expected catalog conflicts to actionable API responses", async () => {
    service.finalize.mockRejectedValueOnce(
      new Error("Source snapshot changed after preview; refresh and confirm again"),
    );
    const sourceSha256 = "d".repeat(64);
    const response = await fetch(`${baseUrl}/api/admin/collections/catalog-test/finalize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "admin-1",
        "x-admin": "true",
      },
      body: JSON.stringify({ confirm: "FINALIZE_MLB_COLLECTION", sourceSha256 }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "SOURCE_SNAPSHOT_CHANGED",
        message: "Source snapshot changed after preview; refresh and confirm again",
      },
    });
  });

  it("maps missing definitions and failed previews without opaque 500 responses", async () => {
    service.preview.mockRejectedValueOnce(new Error("Unknown MLB catalog definition missing"));
    const missing = await fetch(
      `${baseUrl}/api/admin/collections/mlb/catalog/preview?slug=missing`,
      { headers: { "x-user-id": "admin-1", "x-admin": "true" } },
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: "COLLECTION_NOT_FOUND" },
    });

    service.finalize.mockRejectedValueOnce(
      new Error("Cannot finalize failed preview catalog-test"),
    );
    const failedPreview = await fetch(`${baseUrl}/api/admin/collections/catalog-test/finalize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": "admin-1",
        "x-admin": "true",
      },
      body: JSON.stringify({
        confirm: "FINALIZE_MLB_COLLECTION",
        sourceSha256: "e".repeat(64),
      }),
    });
    expect(failedPreview.status).toBe(422);
    await expect(failedPreview.json()).resolves.toMatchObject({
      error: { code: "CATALOG_VALIDATION_FAILED" },
    });
  });
});
