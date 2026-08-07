import type { AddressInfo } from "node:net";
import express from "express";
import type { Express } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerPublicIdentityRoutes } from "./public-identity-routes";
import type { PublicIdentityService } from "./public-identity-service";
import type { PublicUserIdentity } from "@shared/public-user-identity";

// ── helpers ──────────────────────────────────────────────────────────────────

type RequestOpts = {
  body?: unknown;
};

async function fetchJson(
  app: Express,
  path: string,
  opts?: RequestOpts,
): Promise<{ status: number; body: any }> {
  const server = await new Promise<ReturnType<Express["listen"]>>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  const addr = server!.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}${path}`;

  const headers: Record<string, string> = {
    ...(opts?.body ? { "Content-Type": "application/json" } : {}),
  };

  const fetchInit: RequestInit = {
    method: "POST",
    headers,
  };
  if (opts?.body) {
    fetchInit.body = JSON.stringify(opts.body);
  }

  let response: Response;
  try {
    response = await fetch(url, fetchInit);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
  }

  let body: any;
  const text = await response.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return { status: response.status, body };
}

function makeIdentity(overrides?: Partial<PublicUserIdentity>): PublicUserIdentity {
  return {
    userId: "user-1",
    username: "alice",
    avatarUrl: null,
    premiumActive: false,
    activeBadge: null,
    ...overrides,
  };
}

// ── forbidden key allowlist ──────────────────────────────────────────────────

const ALLOWED_PUBLIC_IDENTITY_KEYS = new Set([
  "userId",
  "username",
  "avatarUrl",
  "premiumActive",
  "activeBadge",
]);

const ALLOWED_BADGE_KEYS = new Set([
  "definitionId",
  "versionId",
  "slug",
  "title",
  "artKey",
  "sport",
  "league",
  "season",
  "family",
  "firstCompletedAt",
]);

const FORBIDDEN_LEAK_KEYS = [
  "email",
  "firstName",
  "lastName",
  "isAdmin",
  "isPremium",
  "premiumExpiresAt",
  "balance",
  "deletedAt",
  "authProviderSubject",
  "allocatedQuantity",
  "requiredQuantity",
  "assemblyState",
  "progressBps",
  "rewardMetadata",
  "raritySnapshot",
  "lockReferenceId",
  "profileVisibility",
  "profileImageUrl",
];

function collectKeys(obj: unknown, prefix: string = ""): Set<string> {
  const keys = new Set<string>();
  if (!obj || typeof obj !== "object") return keys;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      for (const k of collectKeys(item, prefix)) {
        keys.add(k);
      }
    }
    return keys;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${key}` : key;
    keys.add(key);
    keys.add(full);
    if (value && typeof value === "object") {
      for (const sub of collectKeys(value, full)) {
        keys.add(sub);
      }
    }
  }
  return keys;
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("public identity routes", () => {
  let app: Express;
  let service: PublicIdentityService;

  beforeEach(() => {
    service = {
      resolveBatch: vi.fn().mockRejectedValue(new Error("not implemented")),
    };
    app = express();
    app.use(express.json({ limit: "100kb" }));
    registerPublicIdentityRoutes(app, service);
  });

  // ── validation ──────────────────────────────────────────────────────────

  describe("POST /api/public-identities/resolve", () => {
    it("returns 400 for non-array userIds", async () => {
      const { status, body } = await fetchJson(app, "/api/public-identities/resolve", {
        body: { userIds: "not-an-array" },
      });
      expect(status).toBe(400);
      expect(body.error?.code).toBe("INVALID_REQUEST");
    });

    it("returns 400 for empty userIds array", async () => {
      const { status, body } = await fetchJson(app, "/api/public-identities/resolve", {
        body: { userIds: [] },
      });
      expect(status).toBe(400);
    });

    it("returns 400 for too many raw IDs", async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `user-${i}`);
      const { status } = await fetchJson(app, "/api/public-identities/resolve", {
        body: { userIds: ids },
      });
      expect(status).toBe(400);
    });

    it("returns 400 for extra fields", async () => {
      const { status, body } = await fetchJson(app, "/api/public-identities/resolve", {
        body: { userIds: ["ok"], extra: "nope" },
      });
      expect(status).toBe(400);
      expect(body.error?.code).toBe("INVALID_REQUEST");
    });

    it("returns 400 for blank IDs", async () => {
      const { status } = await fetchJson(app, "/api/public-identities/resolve", {
        body: { userIds: ["  ", ""] },
      });
      expect(status).toBe(400);
    });

    it("returns 400 for non-string IDs", async () => {
      const { status } = await fetchJson(app, "/api/public-identities/resolve", {
        body: { userIds: [123] },
      });
      expect(status).toBe(400);
    });

    it("returns 400 for oversized IDs", async () => {
      const longId = "a".repeat(201);
      const { status } = await fetchJson(app, "/api/public-identities/resolve", {
        body: { userIds: [longId] },
      });
      expect(status).toBe(400);
    });

    it("returns 200 for valid request with 100 IDs and passes deduplicated IDs to service", async () => {
      const ids = Array.from({ length: 100 }, (_, i) => `user-${i}`);
      (service.resolveBatch as any).mockResolvedValue(
        ids.map((userId) => makeIdentity({ userId })),
      );

      const { status, body } = await fetchJson(app, "/api/public-identities/resolve", {
        body: { userIds: ids },
      });
      expect(status).toBe(200);
      expect(body.identities).toHaveLength(100);
      expect(service.resolveBatch).toHaveBeenCalledWith(expect.objectContaining({ userIds: ids }));
    });

    // ── response contract ──────────────────────────────────────────────────

    it("returns null for missing users", async () => {
      (service.resolveBatch as any).mockResolvedValue([null]);

      const { status, body } = await fetchJson(app, "/api/public-identities/resolve", {
        body: { userIds: ["missing-user"] },
      });
      expect(status).toBe(200);
      expect(body.identities).toEqual([null]);
    });

    it("returns identity with userId, username, avatarUrl, premiumActive, activeBadge", async () => {
      (service.resolveBatch as any).mockResolvedValue([
        makeIdentity({ username: "bob", premiumActive: true }),
      ]);

      const { status, body } = await fetchJson(app, "/api/public-identities/resolve", {
        body: { userIds: ["user-1"] },
      });
      expect(status).toBe(200);
      const identity = body.identities[0];
      expect(identity).toHaveProperty("userId");
      expect(identity).toHaveProperty("username");
      expect(identity).toHaveProperty("avatarUrl");
      expect(identity).toHaveProperty("premiumActive");
      expect(identity).toHaveProperty("activeBadge");
    });

    it("never leaks forbidden keys in response", async () => {
      (service.resolveBatch as any).mockResolvedValue([
        makeIdentity({
          username: "alice",
          activeBadge: {
            definitionId: "def-1",
            versionId: "ver-1",
            slug: "hr-king",
            title: "HR King",
            artKey: "key-1",
            sport: "MLB",
            league: "AL",
            season: "2025",
            family: "sluggers",
            firstCompletedAt: "2024-06-01T00:00:00.000Z",
          },
        }),
      ]);

      const { body } = await fetchJson(app, "/api/public-identities/resolve", {
        body: { userIds: ["user-1"] },
      });

      const keys = collectKeys(body);
      for (const forbidden of FORBIDDEN_LEAK_KEYS) {
        expect(keys.has(forbidden)).toBe(false);
      }
    });

    it("activeBadge includes all required fields", async () => {
      (service.resolveBatch as any).mockResolvedValue([
        makeIdentity({
          activeBadge: {
            definitionId: "def-1",
            versionId: "ver-1",
            slug: "hr-king",
            title: "HR King",
            artKey: "key-1",
            sport: "MLB",
            league: "AL",
            season: "2025",
            family: "sluggers",
            firstCompletedAt: "2024-06-01T00:00:00.000Z",
          },
        }),
      ]);

      const { body } = await fetchJson(app, "/api/public-identities/resolve", {
        body: { userIds: ["user-1"] },
      });

      const badge = body.identities[0].activeBadge;
      for (const key of ALLOWED_BADGE_KEYS) {
        expect(badge).toHaveProperty(key);
      }
    });

    it("service error returns 500", async () => {
      (service.resolveBatch as any).mockRejectedValue(new Error("db down"));

      const { status, body } = await fetchJson(app, "/api/public-identities/resolve", {
        body: { userIds: ["user-1"] },
      });
      expect(status).toBe(500);
      expect(body.error?.code).toBe("INTERNAL_ERROR");
    });
  });
});
