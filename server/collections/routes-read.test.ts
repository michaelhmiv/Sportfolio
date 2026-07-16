import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Express } from "express";
import http from "http";
import { registerCollectionRoutes } from "./routes";
import type { CollectionReadService } from "./read-service";
import type { CollectionMutationService } from "./routes";
import { CollectionDomainError } from "./state-engine";
import type { CollectionDetailResponse, CollectionListEntry } from "@shared/collection-api";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeEntry(slug: string): CollectionListEntry {
  return {
    slug,
    definitionId: `def-${slug}`,
    sport: "MLB",
    league: "NL",
    season: "2025",
    family: "sluggers",
    kind: "player_slots",
    lifecycleStatus: "tracking",
    versionId: `ver-${slug}`,
    version: 1,
    title: "Test Collection",
    description: "A test collection",
    artKey: "default-key",
    state: "tracking",
    assemblyState: "unstarted",
    allocatedQuantity: "0.0000",
    requiredQuantity: "1.0000",
    qualifiedSlotCount: 0,
    requiredSlotCount: 5,
    progressBps: 0,
    award: null,
  };
}

function makeDetail(slug: string): CollectionDetailResponse {
  return {
    ...makeEntry(slug),
    qualificationDescription: "Score 5 runs",
    slots: [],
    prerequisites: [],
  };
}

function makeRequest(
  app: Express,
  method: string,
  path: string,
  opts?: { body?: unknown },
): Promise<{ status: number; body: unknown; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        return reject(new Error("Could not get server address"));
      }
      const port = addr.port;
      const bodyStr = opts?.body ? JSON.stringify(opts.body) : undefined;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: bodyStr
            ? {
                "content-type": "application/json",
                "content-length": String(Buffer.byteLength(bodyStr)),
              }
            : {},
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            server.close();
            let body: unknown = data;
            try {
              body = JSON.parse(data);
            } catch {
              // keep as text
            }
            resolve({ status: res.statusCode ?? 500, body, headers: res.headers });
          });
        },
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  });
}

// ── mock isAuthenticated ─────────────────────────────────────────────────────

let authShouldPass = true;

vi.mock("../supabaseAuth", () => ({
  isAuthenticated: vi.fn(async (req: any, res: any, next: any) => {
    if (authShouldPass) {
      req.user = { claims: { sub: "test-user-id" } };
      next();
    } else {
      res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "No token" } });
    }
  }),
}));

// ── minimal mutation service stub ────────────────────────────────────────────

const stubMutationService: CollectionMutationService = {
  setAllocation: async () => ({}),
  releaseAllocation: async () => ({}),
  completeCollection: async () => ({}),
};

// ── tests ────────────────────────────────────────────────────────────────────

describe("collection routes", () => {
  let app: Express;
  let readService: CollectionReadService;
  let server: http.Server | null = null;

  beforeEach(() => {
    authShouldPass = true;
    readService = {
      listCollections: vi.fn(),
      getCollectionBySlug: vi.fn(),
    };
    app = express();
    app.use(express.json());
    registerCollectionRoutes(app, stubMutationService, readService);
  });

  afterEach(() => {
    // cleanup handled per-test via makeRequest
  });

  describe("authenticated GET /api/me/collections", () => {
    it("returns a data array on success", async () => {
      const entries: CollectionListEntry[] = [makeEntry("a"), makeEntry("b")];
      (readService.listCollections as any).mockResolvedValue(entries);

      const { status, body } = await makeRequest(app, "GET", "/api/me/collections");
      expect(status).toBe(200);
      expect(body).toEqual({ data: entries });
    });

    it("returns an empty array when no collections exist", async () => {
      (readService.listCollections as any).mockResolvedValue([]);

      const { status, body } = await makeRequest(app, "GET", "/api/me/collections");
      expect(status).toBe(200);
      expect(body).toEqual({ data: [] });
    });

    it("passes the authenticated userId to the read service", async () => {
      let capturedUserId: string | undefined;
      (readService.listCollections as any).mockImplementation(async (uid: string) => {
        capturedUserId = uid;
        return [];
      });

      await makeRequest(app, "GET", "/api/me/collections");
      expect(capturedUserId).toBe("test-user-id");
    });
  });

  describe("unauthenticated GET /api/me/collections", () => {
    it("returns 401 when auth fails", async () => {
      authShouldPass = false;

      const { status, body } = await makeRequest(app, "GET", "/api/me/collections");
      expect(status).toBe(401);
      expect(body).toEqual({ error: { code: "UNAUTHENTICATED", message: "No token" } });
    });
  });

  describe("authenticated GET /api/me/collections/:slug", () => {
    it("returns detail on success", async () => {
      const detail = makeDetail("hr-king");
      (readService.getCollectionBySlug as any).mockResolvedValue(detail);

      const { status, body } = await makeRequest(app, "GET", "/api/me/collections/hr-king");
      expect(status).toBe(200);
      expect(body).toEqual({ data: detail });
    });

    it("passes the slug and userId to the read service", async () => {
      let capturedUserId: string | undefined;
      let capturedSlug: string | undefined;
      (readService.getCollectionBySlug as any).mockImplementation(
        async (uid: string, slug: string) => {
          capturedUserId = uid;
          capturedSlug = slug;
          return makeDetail(slug);
        },
      );

      await makeRequest(app, "GET", "/api/me/collections/hr-king");
      expect(capturedUserId).toBe("test-user-id");
      expect(capturedSlug).toBe("hr-king");
    });

    it("maps COLLECTION_NOT_FOUND to a 404 response body", async () => {
      (readService.getCollectionBySlug as any).mockRejectedValue(
        new CollectionDomainError("COLLECTION_NOT_FOUND", "Collection was not found", 404, {
          slug: "nope",
        }),
      );

      const { status, body } = await makeRequest(app, "GET", "/api/me/collections/nope");
      expect(status).toBe(404);
      expect(body).toEqual({
        error: {
          code: "COLLECTION_NOT_FOUND",
          message: "Collection was not found",
          details: { slug: "nope" },
        },
      });
    });

    it("returns 400 for an empty slug", async () => {
      // Express will encode /api/me/collections/ as slash, but empty slug
      // is not routable this way — we test the validation by sending a path
      // that Express won't even route.  Instead verify that a whitespace-only
      // slug triggers Zod rejection via req.params.
      (readService.getCollectionBySlug as any).mockRejectedValue(
        new CollectionDomainError("COLLECTION_NOT_FOUND", "not found", 404),
      );

      // Empty string slug can't be routed via Express params; use whitespace.
      const { status, body } = await makeRequest(app, "GET", "/api/me/collections/%20");
      // Zod will trim, so slug is "" and fails min(1).
      expect(status).toBe(400);
      expect(body).toHaveProperty("error");
    });
  });

  describe("unauthenticated GET /api/me/collections/:slug", () => {
    it("returns 401 when auth fails", async () => {
      authShouldPass = false;

      const { status, body } = await makeRequest(app, "GET", "/api/me/collections/hr-king");
      expect(status).toBe(401);
      expect(body).toEqual({ error: { code: "UNAUTHENTICATED", message: "No token" } });
    });
  });

  describe("no readService provided", () => {
    it("does not register read endpoints when readService is undefined", async () => {
      authShouldPass = true;
      const appNoRead = express();
      registerCollectionRoutes(appNoRead, stubMutationService);

      // The GET endpoint was never registered, so Express returns 404.
      const { status } = await makeRequest(appNoRead, "GET", "/api/me/collections");
      expect(status).toBe(404);
    });
  });
});
