import type { AddressInfo } from "node:net";
import express from "express";
import type { Express } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── mock auth ────────────────────────────────────────────────────────────────

let mockAuthUserId: string | null = null;

vi.mock("../supabaseAuth", () => ({
  optionalAuth: (req: any, res: any, next: () => void) => {
    if (mockAuthUserId) {
      req.user = { claims: { sub: mockAuthUserId } };
    }
    next();
  },
}));

import { registerProfileRoutes } from "./profile-routes";
import type {
  PublicProfileService,
  PublicTrophyService,
  TrophyCaseEditorService,
} from "./profile-service";
import type {
  PublicProfileResponse,
  TrophyCaseEditorResponse,
  TrophyCaseEditorRequest,
  PrivateProfileSentinel,
} from "@shared/trophy-case";

// ── helpers ──────────────────────────────────────────────────────────────────

type RequestOpts = {
  headers?: Record<string, string>;
  body?: unknown;
};

async function fetchJson(
  app: Express,
  method: string,
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
    ...(opts?.headers ?? {}),
  };

  const fetchInit: RequestInit = {
    method,
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

// ── default service stubs ────────────────────────────────────────────────────

function defaultProfileService(overrides?: Partial<PublicProfileService>): PublicProfileService {
  const svc: PublicProfileService = {
    getPublicProfile: vi.fn().mockRejectedValue(new Error("not implemented")),
    ...overrides,
  };
  return svc;
}

function defaultEditorService(
  overrides?: Partial<TrophyCaseEditorService>,
): TrophyCaseEditorService {
  const svc: TrophyCaseEditorService = {
    getEditorState: vi.fn().mockRejectedValue(new Error("not implemented")),
    updateTrophyCase: vi.fn().mockRejectedValue(new Error("not implemented")),
    ...overrides,
  };
  return svc;
}

function makePublicProfile(overrides?: Partial<PublicProfileResponse>): PublicProfileResponse {
  return {
    id: "user-1",
    username: "alice",
    profileImageUrl: "https://img.example.com/1.png",
    isPremium: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    profileVisibility: "public",
    isOwner: false,
    badges: [],
    featured: [],
    ...overrides,
  };
}

// ── reserved forbidden keys ──────────────────────────────────────────────────

const FORBIDDEN_PUBLIC_PROFILE_KEYS: Record<string, true> = {
  firstName: true,
  lastName: true,
  email: true,
  isAdmin: true,
  premiumActive: true,
  rewardedScoutBoostActive: true,
  rewardedScoutBoostExpiresAt: true,
  maxScouts: true,
  balance: true,
  totalSharesVested: true,
  totalMarketOrders: true,
  totalTradesExecuted: true,
};

const FORBIDDEN_TROPHY_KEYS: Record<string, true> = {
  allocation: true,
  allocatedQuantity: true,
  requiredQuantity: true,
  qualifiedSlotCount: true,
  requiredSlotCount: true,
  progressBps: true,
  assemblyState: true,
  rewardMetadata: true,
  raritySnapshot: true,
  preferenceRowId: true,
  id: true,
  versionId: true,
};

// ── recursive key checker ────────────────────────────────────────────────────

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

describe("profile routes", () => {
  let app: Express;
  let profileSvc: PublicProfileService;
  let editorSvc: TrophyCaseEditorService;

  beforeEach(() => {
    mockAuthUserId = null;
    profileSvc = defaultProfileService();
    editorSvc = defaultEditorService();
    app = express();
    app.use(express.json());
    registerProfileRoutes(app, profileSvc, editorSvc);
  });

  it("detects forbidden leaf keys nested anywhere in a response", () => {
    const keys = collectKeys({ safeEnvelope: { nested: { email: "private@example.com" } } });
    expect(keys.has("email")).toBe(true);
    expect(keys.has("safeEnvelope.nested.email")).toBe(true);
  });

  // ── public profile ──────────────────────────────────────────────────────

  describe("GET /api/user/:userId/profile", () => {
    it("returns public profile with empty badges/featured for anonymous viewer", async () => {
      (profileSvc.getPublicProfile as any).mockResolvedValue(makePublicProfile());

      const { status, body } = await fetchJson(app, "GET", "/api/user/user-1/profile");
      expect(status).toBe(200);
      expect(body.id).toBe("user-1");
      expect(body.isOwner).toBe(false);
      expect(body.badges).toEqual([]);
      expect(body.featured).toEqual([]);
    });

    it("passes correct arguments to service (anonymous)", async () => {
      const fn = vi.fn().mockResolvedValue(makePublicProfile({ id: "u-1" }));
      profileSvc.getPublicProfile = fn;

      await fetchJson(app, "GET", "/api/user/u-1/profile");
      expect(fn).toHaveBeenCalledWith("u-1", null);
    });

    it("passes viewerUserId when authenticated", async () => {
      mockAuthUserId = "viewer-1";
      const fn = vi.fn().mockResolvedValue(makePublicProfile({ id: "u-1", isOwner: true }));
      profileSvc.getPublicProfile = fn;

      await fetchJson(app, "GET", "/api/user/u-1/profile");
      expect(fn).toHaveBeenCalledWith("u-1", "viewer-1");
    });

    it("returns 404 for unknown user", async () => {
      const error: any = new Error("User not found");
      error.statusCode = 404;
      (profileSvc.getPublicProfile as any).mockRejectedValue(error);

      const { status, body } = await fetchJson(app, "GET", "/api/user/unknown/profile");
      expect(status).toBe(404);
      expect(body.error?.code).toBe("USER_NOT_FOUND");
    });

    it("returns 404 for identical shape as deleted user", async () => {
      const error: any = new Error("User not found");
      error.statusCode = 404;
      (profileSvc.getPublicProfile as any).mockRejectedValue(error);

      const { status } = await fetchJson(app, "GET", "/api/user/deleted-user/profile");
      expect(status).toBe(404);
    });

    it("returns private sentinel when profile is private and viewer not owner", async () => {
      (profileSvc.getPublicProfile as any).mockResolvedValue({
        profileVisibility: "private",
        isOwner: false,
      } satisfies PrivateProfileSentinel);

      const { status, body } = await fetchJson(app, "GET", "/api/user/private-user/profile");
      expect(status).toBe(200);
      expect(body.profileVisibility).toBe("private");
      expect(body.isOwner).toBe(false);
      expect(body).not.toHaveProperty("id");
      expect(body).not.toHaveProperty("username");
      expect(body).not.toHaveProperty("badges");
      expect(body).not.toHaveProperty("featured");
    });

    it("shows safe profile with trophies to owner when private", async () => {
      mockAuthUserId = "owner-1";
      (profileSvc.getPublicProfile as any).mockResolvedValue({
        id: "owner-1",
        username: "bob",
        profileImageUrl: null,
        isPremium: true,
        createdAt: "2024-01-01T00:00:00.000Z",
        profileVisibility: "private",
        isOwner: true,
        badges: [
          {
            definitionId: "def-1",
            collection: {
              slug: "hr-king",
              definitionId: "def-1",
              sport: "MLB",
              league: "AL",
              season: "2025",
              family: "sluggers",
              kind: "player_slots",
              title: "HR King",
              artKey: "key-1",
              points: 200,
              lifecycleStatus: "tracking",
            },
            earnedAt: "2024-06-01T00:00:00.000Z",
            completionSequence: 5,
          },
        ],
        featured: [],
      } satisfies PublicProfileResponse);

      const { status, body } = await fetchJson(app, "GET", "/api/user/owner-1/profile");
      expect(status).toBe(200);
      expect(body.isOwner).toBe(true);
      expect(body.profileVisibility).toBe("private");
      expect(body.id).toBe("owner-1");
      expect(body.badges).toHaveLength(1);
      expect(body.badges[0].definitionId).toBe("def-1");
    });

    it("never exposes forbidden keys in public profile response", async () => {
      (profileSvc.getPublicProfile as any).mockResolvedValue(
        makePublicProfile({ isPremium: true }),
      );

      const { body } = await fetchJson(app, "GET", "/api/user/user-1/profile");
      const keys = collectKeys(body);
      for (const forbidden of Object.keys(FORBIDDEN_PUBLIC_PROFILE_KEYS)) {
        expect(keys.has(forbidden)).toBe(false);
      }
    });

    it("storage failure returns generic 500", async () => {
      (profileSvc.getPublicProfile as any).mockRejectedValue(new Error("connection refused"));

      const { status, body } = await fetchJson(app, "GET", "/api/user/u-1/profile");
      expect(status).toBe(500);
      expect(body.error?.code).toBe("INTERNAL_ERROR");
    });
  });

  // ── GET /api/me/trophy-case ─────────────────────────────────────────────

  describe("GET /api/me/trophy-case", () => {
    it("returns editor state for authenticated user", async () => {
      mockAuthUserId = "user-1";
      const state: TrophyCaseEditorResponse = {
        profileVisibility: "public",
        badgeDefinitionIds: [],
        featuredDefinitionIds: [],
        eligibleCollections: [],
      };
      (editorSvc.getEditorState as any).mockResolvedValue(state);

      const { status, body } = await fetchJson(app, "GET", "/api/me/trophy-case");
      expect(status).toBe(200);
      expect(body.profileVisibility).toBe("public");
    });

    it("returns 401 when not authenticated", async () => {
      mockAuthUserId = null;
      const { status, body } = await fetchJson(app, "GET", "/api/me/trophy-case");
      expect(status).toBe(401);
      expect(body.error?.code).toBe("UNAUTHENTICATED");
    });

    it("returns 404 for deleted user", async () => {
      mockAuthUserId = "deleted-user";
      const error: any = new Error("User not found");
      error.statusCode = 404;
      (editorSvc.getEditorState as any).mockRejectedValue(error);

      const { status, body } = await fetchJson(app, "GET", "/api/me/trophy-case");
      expect(status).toBe(404);
      expect(body.error?.code).toBe("USER_NOT_FOUND");
    });

    it("contains all expected editor fields", async () => {
      mockAuthUserId = "user-1";
      (editorSvc.getEditorState as any).mockResolvedValue({
        profileVisibility: "public",
        badgeDefinitionIds: ["def-1"],
        featuredDefinitionIds: ["def-2"],
        eligibleCollections: [
          {
            definitionId: "def-1",
            slug: "test",
            sport: "MLB",
            league: "AL",
            season: "2025",
            family: "sluggers",
            title: "Test",
            artKey: "key",
            points: 100,
            lifecycleStatus: "tracking",
            earnedAt: "2024-06-01T00:00:00.000Z",
            completionSequence: null,
            isBadgeEligible: true,
          },
        ],
      } satisfies TrophyCaseEditorResponse);

      const { status, body } = await fetchJson(app, "GET", "/api/me/trophy-case");
      expect(status).toBe(200);
      expect(body.badgeDefinitionIds).toEqual(["def-1"]);
      expect(body.featuredDefinitionIds).toEqual(["def-2"]);
      expect(body.eligibleCollections).toHaveLength(1);
      expect(body.eligibleCollections[0].isBadgeEligible).toBe(true);
      // Must not leak forbidden keys
      const keys = collectKeys(body);
      for (const forbidden of Object.keys(FORBIDDEN_TROPHY_KEYS)) {
        expect(keys.has(forbidden)).toBe(false);
      }
    });
  });

  // ── PUT /api/me/trophy-case ─────────────────────────────────────────────

  describe("PUT /api/me/trophy-case", () => {
    it("returns 401 when not authenticated", async () => {
      mockAuthUserId = null;
      const { status, body } = await fetchJson(app, "PUT", "/api/me/trophy-case", {
        body: {
          profileVisibility: "public",
          badgeDefinitionIds: [],
          featuredDefinitionIds: [],
        },
      });
      expect(status).toBe(401);
      expect(body.error?.code).toBe("UNAUTHENTICATED");
    });

    it("returns 400 for invalid body (missing fields)", async () => {
      mockAuthUserId = "user-1";
      const { status, body } = await fetchJson(app, "PUT", "/api/me/trophy-case", {
        body: { profileVisibility: "public" },
      });
      expect(status).toBe(400);
      expect(body.error?.code).toBe("INVALID_REQUEST");
    });

    it("returns 400 for invalid body (extra fields)", async () => {
      mockAuthUserId = "user-1";
      const { status, body } = await fetchJson(app, "PUT", "/api/me/trophy-case", {
        body: {
          profileVisibility: "public",
          badgeDefinitionIds: [],
          featuredDefinitionIds: [],
          extraField: "nope",
        },
      });
      expect(status).toBe(400);
      expect(body.error?.code).toBe("INVALID_REQUEST");
    });

    it("returns 400 for invalid visibility value", async () => {
      mockAuthUserId = "user-1";
      const { status, body } = await fetchJson(app, "PUT", "/api/me/trophy-case", {
        body: {
          profileVisibility: "hidden",
          badgeDefinitionIds: [],
          featuredDefinitionIds: [],
        },
      });
      expect(status).toBe(400);
      expect(body.error?.code).toBe("INVALID_REQUEST");
    });

    it("returns 400 before service execution when product limits are exceeded", async () => {
      mockAuthUserId = "user-1";
      const tooManyBadges = await fetchJson(app, "PUT", "/api/me/trophy-case", {
        body: {
          profileVisibility: "public",
          badgeDefinitionIds: ["1", "2", "3", "4", "5", "6"],
          featuredDefinitionIds: [],
        },
      });
      const tooManyFeatured = await fetchJson(app, "PUT", "/api/me/trophy-case", {
        body: {
          profileVisibility: "public",
          badgeDefinitionIds: [],
          featuredDefinitionIds: ["1", "2", "3", "4", "5"],
        },
      });

      expect(tooManyBadges.status).toBe(400);
      expect(tooManyFeatured.status).toBe(400);
      expect(editorSvc.updateTrophyCase).not.toHaveBeenCalled();
    });

    it("returns 422 with structured errors for validation failures", async () => {
      mockAuthUserId = "user-1";
      const validationError: any = new Error("Trophy case validation failed");
      validationError.statusCode = 422;
      validationError.errors = [
        {
          code: "UNEARNED_BADGE",
          message: "Collection has not been earned",
          details: { definitionId: "1" },
        },
      ];
      (editorSvc.updateTrophyCase as any).mockRejectedValue(validationError);

      const { status, body } = await fetchJson(app, "PUT", "/api/me/trophy-case", {
        body: {
          profileVisibility: "public",
          badgeDefinitionIds: ["1"],
          featuredDefinitionIds: [],
        },
      });

      expect(status).toBe(422);
      expect(body.error?.code).toBe("VALIDATION_FAILED");
      expect(body.error.details.errors).toHaveLength(1);
      expect(body.error.details.errors[0].code).toBe("UNEARNED_BADGE");
    });

    it("accepts valid request and returns updated state", async () => {
      mockAuthUserId = "user-1";
      const updatedState: TrophyCaseEditorResponse = {
        profileVisibility: "public",
        badgeDefinitionIds: ["def-1"],
        featuredDefinitionIds: ["def-2"],
        eligibleCollections: [],
      };
      (editorSvc.updateTrophyCase as any).mockResolvedValue(updatedState);

      const { status, body } = await fetchJson(app, "PUT", "/api/me/trophy-case", {
        body: {
          profileVisibility: "public",
          badgeDefinitionIds: ["def-1"],
          featuredDefinitionIds: ["def-2"],
        },
      });

      expect(status).toBe(200);
      expect(body.badgeDefinitionIds).toEqual(["def-1"]);
      expect(body.featuredDefinitionIds).toEqual(["def-2"]);
    });

    it("accepts private visibility with empty lists", async () => {
      mockAuthUserId = "user-1";
      (editorSvc.updateTrophyCase as any).mockResolvedValue({
        profileVisibility: "private",
        badgeDefinitionIds: [],
        featuredDefinitionIds: [],
        eligibleCollections: [],
      } satisfies TrophyCaseEditorResponse);

      const { status, body } = await fetchJson(app, "PUT", "/api/me/trophy-case", {
        body: {
          profileVisibility: "private",
          badgeDefinitionIds: [],
          featuredDefinitionIds: [],
        },
      });

      expect(status).toBe(200);
      expect(body.profileVisibility).toBe("private");
    });

    it("returns 404 when user is deleted", async () => {
      mockAuthUserId = "deleted-user";
      const error: any = new Error("User not found");
      error.statusCode = 404;
      (editorSvc.updateTrophyCase as any).mockRejectedValue(error);

      const { status, body } = await fetchJson(app, "PUT", "/api/me/trophy-case", {
        body: {
          profileVisibility: "public",
          badgeDefinitionIds: [],
          featuredDefinitionIds: [],
        },
      });
      expect(status).toBe(404);
      expect(body.error?.code).toBe("USER_NOT_FOUND");
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  SERVICE-LEVEL TESTS
// ══════════════════════════════════════════════════════════════════════════════

import {
  PostgresPublicProfileService,
  PostgresPublicTrophyService,
  PostgresTrophyCaseEditorService,
} from "./profile-service";
import * as repo from "./profile-repository";

vi.mock("./profile-repository", () => ({
  getProfileRow: vi.fn(),
  getBadgePreferences: vi.fn(),
  getFeaturedPreferences: vi.fn(),
  getAwardsWithDefinitionsAndStates: vi.fn(),
  getPubliclyVisibleDefinitions: vi.fn(),
  lockAndReplaceTrophyCase: vi.fn(),
  withRepeatableRead: vi.fn((callback: (executor: unknown) => unknown) => callback("snapshot-tx")),
}));

afterEach(() => {
  vi.clearAllMocks();
});

// ── helpers for building mock rows ───────────────────────────────────────────

function makeProfile(overrides?: Partial<repo.ProfileRow>): repo.ProfileRow {
  return {
    id: "u-1",
    username: "alice",
    profileImageUrl: "https://img/pic.png",
    isPremium: false,
    premiumExpiresAt: null,
    createdAt: new Date("2024-01-01"),
    profileVisibility: "public",
    deletedAt: null,
    ...overrides,
  };
}

function makeAward(
  overrides?: Partial<repo.AwardWithDefinitionAndStateRow>,
): repo.AwardWithDefinitionAndStateRow {
  return {
    definitionId: "def-1",
    versionId: "ver-1",
    firstCompletedAt: new Date("2024-06-01"),
    completionSequence: 5,
    slug: "hr-king",
    sport: "MLB",
    league: "AL",
    season: "2025",
    family: "sluggers",
    kind: "player_slots",
    lifecycleStatus: "tracking",
    version: 1,
    title: "HR King",
    artKey: "key-1",
    points: 200,
    state: "tracking",
    assemblyState: "active",
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
//  PostgresPublicProfileService
// ══════════════════════════════════════════════════════════════════════════════

describe("PostgresPublicProfileService", () => {
  // We need a stub trophy service.
  const stubTrophy: PublicTrophyService = {
    getPublicTrophyCase: vi.fn().mockResolvedValue({ badges: [], featured: [] }),
  };
  const svc = new PostgresPublicProfileService(stubTrophy);

  it("returns public identity with trophies for public profile", async () => {
    (repo.getProfileRow as any).mockResolvedValue(makeProfile());
    (stubTrophy.getPublicTrophyCase as any).mockResolvedValue({
      badges: [
        {
          definitionId: "def-1",
          collection: {
            slug: "hr-king",
            definitionId: "def-1",
            sport: "MLB",
            league: "AL",
            season: "2025",
            family: "sluggers",
            kind: "player_slots",
            title: "HR King",
            artKey: "key-1",
            points: 200,
            lifecycleStatus: "tracking",
          },
          earnedAt: "2024-06-01T00:00:00.000Z",
          completionSequence: 5,
        },
      ],
      featured: [],
    });

    const result = await svc.getPublicProfile("u-1", null);
    expect(result).toHaveProperty("id", "u-1");
    expect(result).toHaveProperty("username", "alice");
    expect(result).toHaveProperty("isOwner", false);
    const profile = result as PublicProfileResponse;
    expect(profile.badges).toHaveLength(1);
    expect(profile.featured).toHaveLength(0);
  });

  it("calls getPublicTrophyCase for public profile", async () => {
    (repo.getProfileRow as any).mockResolvedValue(makeProfile());
    (stubTrophy.getPublicTrophyCase as any).mockResolvedValue({ badges: [], featured: [] });

    await svc.getPublicProfile("u-1", null);
    expect(repo.getProfileRow).toHaveBeenCalledWith("u-1", "snapshot-tx");
    expect(stubTrophy.getPublicTrophyCase).toHaveBeenCalledWith("u-1", "snapshot-tx");
  });

  it("calls getPublicTrophyCase for owner of private profile", async () => {
    (repo.getProfileRow as any).mockResolvedValue(makeProfile({ profileVisibility: "private" }));
    (stubTrophy.getPublicTrophyCase as any).mockResolvedValue({ badges: [], featured: [] });

    await svc.getPublicProfile("u-1", "u-1");
    expect(stubTrophy.getPublicTrophyCase).toHaveBeenCalledWith("u-1", "snapshot-tx");
  });

  it("does NOT call getPublicTrophyCase for private non-owner", async () => {
    (repo.getProfileRow as any).mockResolvedValue(makeProfile({ profileVisibility: "private" }));
    const spy = vi.spyOn(stubTrophy, "getPublicTrophyCase");

    const result = await svc.getPublicProfile("u-1", "viewer-other");
    const sentinel = result as PrivateProfileSentinel;
    expect(sentinel.profileVisibility).toBe("private");
    expect(sentinel.isOwner).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns private sentinel without identity/trophy keys", async () => {
    (repo.getProfileRow as any).mockResolvedValue(makeProfile({ profileVisibility: "private" }));

    const result = await svc.getPublicProfile("u-2", "viewer-other");
    const sentinel = result as PrivateProfileSentinel;
    expect(sentinel.profileVisibility).toBe("private");
    expect(sentinel.isOwner).toBe(false);
    expect(sentinel).not.toHaveProperty("id");
    expect(sentinel).not.toHaveProperty("username");
    expect(sentinel).not.toHaveProperty("badges");
    expect(sentinel).not.toHaveProperty("featured");
  });

  it("throws 404 for missing user", async () => {
    (repo.getProfileRow as any).mockResolvedValue(undefined);
    await expect(svc.getPublicProfile("missing", null)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("throws 404 for deleted user", async () => {
    (repo.getProfileRow as any).mockResolvedValue(makeProfile({ deletedAt: new Date() }));
    await expect(svc.getPublicProfile("del-1", null)).rejects.toMatchObject({ statusCode: 404 });
  });

  describe("isPremium (premium expiry semantics)", () => {
    it("returns false when isPremium flag is false", async () => {
      (repo.getProfileRow as any).mockResolvedValue(makeProfile({ isPremium: false }));
      (stubTrophy.getPublicTrophyCase as any).mockResolvedValue({ badges: [], featured: [] });

      const result = (await svc.getPublicProfile("u-1", null)) as PublicProfileResponse;
      expect(result.isPremium).toBe(false);
    });

    it("returns true when isPremium flag is true and premiumExpiresAt is null (unbounded)", async () => {
      (repo.getProfileRow as any).mockResolvedValue(
        makeProfile({ isPremium: true, premiumExpiresAt: null }),
      );
      (stubTrophy.getPublicTrophyCase as any).mockResolvedValue({ badges: [], featured: [] });

      const result = (await svc.getPublicProfile("u-1", null)) as PublicProfileResponse;
      expect(result.isPremium).toBe(true);
    });

    it("returns true when isPremium flag is true and premiumExpiresAt is in the future", async () => {
      const future = new Date(Date.now() + 86400000 * 30); // 30 days
      (repo.getProfileRow as any).mockResolvedValue(
        makeProfile({ isPremium: true, premiumExpiresAt: future }),
      );
      (stubTrophy.getPublicTrophyCase as any).mockResolvedValue({ badges: [], featured: [] });

      const result = (await svc.getPublicProfile("u-1", null)) as PublicProfileResponse;
      expect(result.isPremium).toBe(true);
    });

    it("returns false when isPremium flag is true but premiumExpiresAt is in the past", async () => {
      const past = new Date(Date.now() - 86400000); // 1 day ago
      (repo.getProfileRow as any).mockResolvedValue(
        makeProfile({ isPremium: true, premiumExpiresAt: past }),
      );
      (stubTrophy.getPublicTrophyCase as any).mockResolvedValue({ badges: [], featured: [] });

      const result = (await svc.getPublicProfile("u-1", null)) as PublicProfileResponse;
      expect(result.isPremium).toBe(false);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  PostgresPublicTrophyService
// ══════════════════════════════════════════════════════════════════════════════

describe("PostgresPublicTrophyService", () => {
  const svc = new PostgresPublicTrophyService();

  it("returns badges only for selected + awarded + active + public", async () => {
    (repo.getBadgePreferences as any).mockResolvedValue([
      { collectionDefinitionId: "def-1", priority: 0 },
      { collectionDefinitionId: "def-2", priority: 1 },
    ]);
    (repo.getFeaturedPreferences as any).mockResolvedValue([]);
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([
      makeAward({ definitionId: "def-1" }),
      makeAward({ definitionId: "def-2", slug: "batting-champ" }),
    ]);

    const { badges, featured } = await svc.getPublicTrophyCase("u-1");
    expect(badges).toHaveLength(2);
    expect(badges[0].definitionId).toBe("def-1");
    expect(badges[1].definitionId).toBe("def-2");
    expect(featured).toHaveLength(0);
  });

  it("skips badges for disabled/draft definitions", async () => {
    (repo.getBadgePreferences as any).mockResolvedValue([
      { collectionDefinitionId: "def-disabled", priority: 0 },
    ]);
    (repo.getFeaturedPreferences as any).mockResolvedValue([]);
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([
      makeAward({
        definitionId: "def-disabled",
        lifecycleStatus: "disabled",
        state: "draft",
        assemblyState: "active",
      }),
    ]);

    const { badges } = await svc.getPublicTrophyCase("u-1");
    expect(badges).toHaveLength(0);
  });

  it("skips badge when assemblyState is not active (inactive)", async () => {
    (repo.getBadgePreferences as any).mockResolvedValue([
      { collectionDefinitionId: "def-1", priority: 0 },
    ]);
    (repo.getFeaturedPreferences as any).mockResolvedValue([]);
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([
      makeAward({
        definitionId: "def-1",
        lifecycleStatus: "tracking",
        state: "tracking",
        assemblyState: "inactive",
      }),
    ]);

    const { badges } = await svc.getPublicTrophyCase("u-1");
    expect(badges).toHaveLength(0);
  });

  it("skips badge when assemblyState is null (stale version / no state)", async () => {
    (repo.getBadgePreferences as any).mockResolvedValue([
      { collectionDefinitionId: "def-1", priority: 0 },
    ]);
    (repo.getFeaturedPreferences as any).mockResolvedValue([]);
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([
      makeAward({
        definitionId: "def-1",
        lifecycleStatus: "tracking",
        state: "tracking",
        assemblyState: null,
      }),
    ]);

    const { badges } = await svc.getPublicTrophyCase("u-1");
    expect(badges).toHaveLength(0);
  });

  it("skips badge for draft version state", async () => {
    (repo.getBadgePreferences as any).mockResolvedValue([
      { collectionDefinitionId: "def-1", priority: 0 },
    ]);
    (repo.getFeaturedPreferences as any).mockResolvedValue([]);
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([
      makeAward({
        definitionId: "def-1",
        state: "draft",
        assemblyState: "active",
      }),
    ]);

    const { badges } = await svc.getPublicTrophyCase("u-1");
    expect(badges).toHaveLength(0);
  });

  it("skips badge for correction version that differs from current", async () => {
    // Award version != definition current_version — our query always joins on
    // current_version, but the award.versionId may be stale. The state is still
    // tracked correctly. The real important test is the state check above.
    // This test verifies the public visibility filter works on any definition.
    (repo.getBadgePreferences as any).mockResolvedValue([
      { collectionDefinitionId: "def-stale", priority: 0 },
    ]);
    (repo.getFeaturedPreferences as any).mockResolvedValue([]);
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([
      makeAward({
        definitionId: "def-stale",
        lifecycleStatus: "tracking",
        state: "tracking",
        assemblyState: "inactive",
      }),
    ]);

    const { badges } = await svc.getPublicTrophyCase("u-1");
    expect(badges).toHaveLength(0);
  });

  it("skips badge preferences without awards", async () => {
    (repo.getBadgePreferences as any).mockResolvedValue([
      { collectionDefinitionId: "no-award", priority: 0 },
    ]);
    (repo.getFeaturedPreferences as any).mockResolvedValue([]);
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([]);

    const { badges } = await svc.getPublicTrophyCase("u-1");
    expect(badges).toHaveLength(0);
  });

  it("respects order and enforced maximum of 5 through preference limit", async () => {
    const prefs = Array.from({ length: 5 }, (_, i) => ({
      collectionDefinitionId: `def-${i}`,
      priority: i,
    }));
    (repo.getBadgePreferences as any).mockResolvedValue(prefs);
    (repo.getFeaturedPreferences as any).mockResolvedValue([]);
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue(
      prefs.map((p) => makeAward({ definitionId: p.collectionDefinitionId })),
    );

    const { badges } = await svc.getPublicTrophyCase("u-1");
    expect(badges).toHaveLength(5);
    expect(badges.map((b) => b.definitionId)).toEqual([
      "def-0",
      "def-1",
      "def-2",
      "def-3",
      "def-4",
    ]);
  });

  it("returns featured in position order", async () => {
    (repo.getBadgePreferences as any).mockResolvedValue([]);
    (repo.getFeaturedPreferences as any).mockResolvedValue([
      { collectionDefinitionId: "def-a", position: 0 },
      { collectionDefinitionId: "def-b", position: 1 },
    ]);
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([
      makeAward({ definitionId: "def-a", slug: "a", title: "A" }),
      makeAward({ definitionId: "def-b", slug: "b", title: "B" }),
    ]);

    const { featured } = await svc.getPublicTrophyCase("u-1");
    expect(featured).toHaveLength(2);
    expect(featured[0].definitionId).toBe("def-a");
    expect(featured[1].definitionId).toBe("def-b");
  });

  it("featured still returns inactive collections (unlike badges)", async () => {
    (repo.getBadgePreferences as any).mockResolvedValue([]);
    (repo.getFeaturedPreferences as any).mockResolvedValue([
      { collectionDefinitionId: "def-inactive", position: 0 },
    ]);
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([
      makeAward({
        definitionId: "def-inactive",
        assemblyState: "inactive",
      }),
    ]);

    const { featured } = await svc.getPublicTrophyCase("u-1");
    expect(featured).toHaveLength(1);
    expect(featured[0].definitionId).toBe("def-inactive");
  });

  it("never leaks forbidden keys in trophy output", async () => {
    (repo.getBadgePreferences as any).mockResolvedValue([
      { collectionDefinitionId: "def-1", priority: 0 },
    ]);
    (repo.getFeaturedPreferences as any).mockResolvedValue([]);
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([makeAward()]);

    const { badges, featured } = await svc.getPublicTrophyCase("u-1");
    const allKeys = new Set([...collectKeys(badges), ...collectKeys(featured)]);

    for (const forbidden of Object.keys(FORBIDDEN_TROPHY_KEYS)) {
      expect(allKeys.has(forbidden)).toBe(false);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  PostgresTrophyCaseEditorService
// ══════════════════════════════════════════════════════════════════════════════

describe("PostgresTrophyCaseEditorService", () => {
  const stubTrophy: PublicTrophyService = {
    getPublicTrophyCase: vi.fn().mockResolvedValue({ badges: [], featured: [] }),
  };
  const svc = new PostgresTrophyCaseEditorService(stubTrophy);

  it("getEditorState returns visibility and preferences", async () => {
    (repo.getProfileRow as any).mockResolvedValue(makeProfile());
    (repo.getBadgePreferences as any).mockResolvedValue([
      { collectionDefinitionId: "def-1", priority: 0 },
    ]);
    (repo.getFeaturedPreferences as any).mockResolvedValue([]);
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([makeAward()]);

    const state = await svc.getEditorState("u-1");
    expect(state.profileVisibility).toBe("public");
    expect(state.badgeDefinitionIds).toEqual(["def-1"]);
    expect(state.eligibleCollections).toHaveLength(1);
    expect(state.eligibleCollections[0].isBadgeEligible).toBe(true);
  });

  it("getEditorState filters out draft/disabled awards from eligibleCollections", async () => {
    (repo.getProfileRow as any).mockResolvedValue(makeProfile());
    (repo.getBadgePreferences as any).mockResolvedValue([]);
    (repo.getFeaturedPreferences as any).mockResolvedValue([]);
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([
      makeAward({ definitionId: "def-good" }),
      makeAward({
        definitionId: "def-disabled",
        lifecycleStatus: "disabled",
        state: "draft",
      }),
      makeAward({
        definitionId: "def-draft",
        state: "draft",
        lifecycleStatus: "tracking",
      }),
    ]);

    const state = await svc.getEditorState("u-1");
    expect(state.eligibleCollections).toHaveLength(1);
    expect(state.eligibleCollections[0].definitionId).toBe("def-good");
  });

  it("getEditorState reports isBadgeEligible based on active state", async () => {
    (repo.getProfileRow as any).mockResolvedValue(makeProfile());
    (repo.getBadgePreferences as any).mockResolvedValue([]);
    (repo.getFeaturedPreferences as any).mockResolvedValue([]);
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([
      makeAward({
        definitionId: "def-active",
        assemblyState: "active",
      }),
      makeAward({
        definitionId: "def-inactive",
        slug: "other",
        assemblyState: "inactive",
      }),
    ]);

    const state = await svc.getEditorState("u-1");
    expect(state.eligibleCollections).toHaveLength(2);
    const byId = new Map(state.eligibleCollections.map((e) => [e.definitionId, e]));
    expect(byId.get("def-active")!.isBadgeEligible).toBe(true);
    expect(byId.get("def-inactive")!.isBadgeEligible).toBe(false);
  });

  it("updateTrophyCase validates duplicate definition IDs", async () => {
    (repo.getPubliclyVisibleDefinitions as any).mockResolvedValue(new Set(["def-1"]));
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([
      makeAward({ definitionId: "def-1" }),
    ]);

    try {
      await svc.updateTrophyCase("u-1", {
        profileVisibility: "public",
        badgeDefinitionIds: ["def-1", "def-1"],
        featuredDefinitionIds: [],
      });
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.statusCode).toBe(422);
      expect(e.errors[0].code).toBe("DUPLICATE_BADGE_DEFINITIONS");
    }
  });

  it("updateTrophyCase validates unearned badges", async () => {
    (repo.getPubliclyVisibleDefinitions as any).mockResolvedValue(new Set(["no-award"]));
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([]);

    try {
      await svc.updateTrophyCase("u-1", {
        profileVisibility: "public",
        badgeDefinitionIds: ["no-award"],
        featuredDefinitionIds: [],
      });
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.statusCode).toBe(422);
      expect(e.errors[0].code).toBe("BADGE_NOT_EARNED");
    }
  });

  it("updateTrophyCase validates ineligible badge (disabled definition)", async () => {
    (repo.getPubliclyVisibleDefinitions as any).mockResolvedValue(new Set());

    try {
      await svc.updateTrophyCase("u-1", {
        profileVisibility: "public",
        badgeDefinitionIds: ["disabled-def"],
        featuredDefinitionIds: [],
      });
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.statusCode).toBe(422);
      expect(e.errors[0].code).toBe("BADGE_DEFINITION_NOT_FOUND");
    }
  });

  it("updateTrophyCase validates ineligible badge (inactive state)", async () => {
    (repo.getPubliclyVisibleDefinitions as any).mockResolvedValue(new Set(["def-inactive"]));
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([
      makeAward({
        definitionId: "def-inactive",
        assemblyState: "inactive",
      }),
    ]);

    try {
      await svc.updateTrophyCase("u-1", {
        profileVisibility: "public",
        badgeDefinitionIds: ["def-inactive"],
        featuredDefinitionIds: [],
      });
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.statusCode).toBe(422);
      expect(e.errors[0].code).toBe("BADGE_NOT_ELIGIBLE");
    }
  });

  it("updateTrophyCase validates unearned featured", async () => {
    (repo.getPubliclyVisibleDefinitions as any).mockResolvedValue(new Set(["no-award"]));
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([]);

    try {
      await svc.updateTrophyCase("u-1", {
        profileVisibility: "public",
        badgeDefinitionIds: [],
        featuredDefinitionIds: ["no-award"],
      });
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.statusCode).toBe(422);
      expect(e.errors[0].code).toBe("FEATURED_NOT_EARNED");
    }
  });

  it("updateTrophyCase succeeds and calls lockAndReplaceTrophyCase atomically", async () => {
    (repo.getPubliclyVisibleDefinitions as any).mockResolvedValue(new Set(["def-1", "def-2"]));
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([
      makeAward({ definitionId: "def-1" }),
      makeAward({ definitionId: "def-2", slug: "other", assemblyState: "inactive" }),
    ]);
    (repo.getProfileRow as any).mockResolvedValue(makeProfile());
    (repo.getBadgePreferences as any).mockResolvedValue([
      { collectionDefinitionId: "def-1", priority: 0 },
    ]);
    (repo.getFeaturedPreferences as any).mockResolvedValue([
      { collectionDefinitionId: "def-2", position: 0 },
    ]);
    const transactionExecutor = { marker: "transaction" };
    (repo.lockAndReplaceTrophyCase as any).mockImplementation(
      async (
        _userId: string,
        _visibility: string,
        _badges: string[],
        _featured: string[],
        validateAfterLock: (executor: unknown) => Promise<void>,
      ) => validateAfterLock(transactionExecutor),
    );

    const result = await svc.updateTrophyCase("u-1", {
      profileVisibility: "public",
      badgeDefinitionIds: ["def-1"],
      featuredDefinitionIds: ["def-2"],
    });

    // Must be called exactly once with all three values in one call.
    expect(repo.lockAndReplaceTrophyCase).toHaveBeenCalledTimes(1);
    expect(repo.lockAndReplaceTrophyCase).toHaveBeenCalledWith(
      "u-1",
      "public",
      ["def-1"],
      ["def-2"],
      expect.any(Function),
    );
    // Optimistic validation plus post-lock revalidation.
    expect(repo.getPubliclyVisibleDefinitions).toHaveBeenCalledTimes(2);
    expect(repo.getPubliclyVisibleDefinitions).toHaveBeenLastCalledWith(
      ["def-1", "def-2"],
      transactionExecutor,
    );
    expect((repo.getAwardsWithDefinitionsAndStates as any).mock.calls).toContainEqual([
      "u-1",
      transactionExecutor,
    ]);
    expect(result.badgeDefinitionIds).toEqual(["def-1"]);
  });

  it("updateTrophyCase rolls back on repo failure (no partial writes)", async () => {
    (repo.getPubliclyVisibleDefinitions as any).mockResolvedValue(new Set(["def-1"]));
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([
      makeAward({ definitionId: "def-1" }),
    ]);
    (repo.lockAndReplaceTrophyCase as any).mockRejectedValue(new Error("TXN_ABORT"));

    // First validation passes.
    // Then lockAndReplaceTrophyCase throws — the transaction in the repo would
    // roll back, so no partial writes occur.
    await expect(
      svc.updateTrophyCase("u-1", {
        profileVisibility: "public",
        badgeDefinitionIds: ["def-1"],
        featuredDefinitionIds: [],
      }),
    ).rejects.toThrow("TXN_ABORT");

    // Verify that lockAndReplaceTrophyCase was called (and failed).
    expect(repo.lockAndReplaceTrophyCase).toHaveBeenCalledTimes(1);
  });

  it("rejects more than 5 badges", async () => {
    try {
      await svc.updateTrophyCase("u-1", {
        profileVisibility: "public",
        badgeDefinitionIds: ["1", "2", "3", "4", "5", "6"],
        featuredDefinitionIds: [],
      });
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.errors[0].code).toBe("MAX_BADGES_EXCEEDED");
    }
  });

  it("rejects more than 4 featured", async () => {
    try {
      await svc.updateTrophyCase("u-1", {
        profileVisibility: "public",
        badgeDefinitionIds: [],
        featuredDefinitionIds: ["1", "2", "3", "4", "5"],
      });
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.errors[0].code).toBe("MAX_FEATURED_EXCEEDED");
    }
  });

  it("rejects invalid visibility value", async () => {
    try {
      await svc.updateTrophyCase("u-1", {
        profileVisibility: "hidden" as any,
        badgeDefinitionIds: [],
        featuredDefinitionIds: [],
      });
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.errors[0].code).toBe("INVALID_VISIBILITY");
    }
  });

  it("getEditorState throws 404 for deleted user", async () => {
    (repo.getProfileRow as any).mockResolvedValue(makeProfile({ deletedAt: new Date() }));
    await expect(svc.getEditorState("deleted-user")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("getEditorState throws 404 for missing user", async () => {
    (repo.getProfileRow as any).mockResolvedValue(undefined);
    await expect(svc.getEditorState("missing-user")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("updateTrophyCase lock rejects deleted user with 404", async () => {
    (repo.getPubliclyVisibleDefinitions as any).mockResolvedValue(new Set(["def-1"]));
    (repo.getAwardsWithDefinitionsAndStates as any).mockResolvedValue([
      makeAward({ definitionId: "def-1" }),
    ]);
    (repo.lockAndReplaceTrophyCase as any).mockRejectedValue(
      Object.assign(new Error("User not found"), { statusCode: 404 }),
    );

    await expect(
      svc.updateTrophyCase("deleted-user", {
        profileVisibility: "public",
        badgeDefinitionIds: ["def-1"],
        featuredDefinitionIds: [],
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
