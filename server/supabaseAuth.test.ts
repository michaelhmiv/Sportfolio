import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseUserMock = vi.fn();
const storageMock = {
  getUser: vi.fn(),
  getUserByEmail: vi.fn(),
  upsertUser: vi.fn(),
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: getSupabaseUserMock,
    },
  })),
}));

vi.mock("./storage", () => ({
  storage: storageMock,
}));

describe("supabase auth middleware", () => {
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_KEY: process.env.SUPABASE_KEY,
    AUTH_PROVIDER: process.env.AUTH_PROVIDER,
  };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    getSupabaseUserMock.mockReset();
    storageMock.getUser.mockReset();
    storageMock.getUserByEmail.mockReset();
    storageMock.upsertUser.mockReset();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.AUTH_PROVIDER = "SUPABASE";
  });

  afterEach(() => {
    process.env.SUPABASE_URL = originalEnv.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_KEY = originalEnv.SUPABASE_KEY;
    if (originalEnv.AUTH_PROVIDER === undefined) delete process.env.AUTH_PROVIDER;
    else process.env.AUTH_PROVIDER = originalEnv.AUTH_PROVIDER;
  });

  function makeRequest() {
    return {
      headers: {
        authorization: "Bearer test-token",
      },
      cookies: {},
    } as any;
  }

  function makeResponse() {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;
  }

  function makeSupabaseUser() {
    return {
      id: "user_123",
      email: "user@example.com",
      user_metadata: {
        first_name: "Test",
        last_name: "User",
        avatar_url: "https://example.com/avatar.png",
      },
    };
  }

  it("returns 503 instead of crashing when user sync storage is unavailable", async () => {
    const supabaseUser = {
      id: "user_123",
      email: "user@example.com",
      user_metadata: {
        first_name: "Test",
        last_name: "User",
      },
    };

    getSupabaseUserMock.mockResolvedValue({
      data: { user: supabaseUser },
      error: null,
    });

    const { isAuthenticated } = await import("./supabaseAuth");
    storageMock.getUser.mockRejectedValue(new Error("timeout exceeded when trying to connect"));

    const req: any = {
      headers: {
        authorization: "Bearer test-token",
      },
      cookies: {},
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await isAuthenticated(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      message: "Authentication temporarily unavailable",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("authorizes with the canonical internal id when the auth provider id changed", async () => {
    getSupabaseUserMock.mockResolvedValue({
      data: { user: makeSupabaseUser() },
      error: null,
    });
    storageMock.getUser.mockResolvedValue(undefined);
    storageMock.getUserByEmail.mockResolvedValue({ id: "canonical-user", username: "owner" });
    storageMock.upsertUser.mockResolvedValue({ id: "canonical-user", username: "owner" });

    const { isAuthenticated } = await import("./supabaseAuth");
    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await isAuthenticated(req, res, next);

    expect(req.user?.claims.sub).toBe("canonical-user");
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects required authentication when identity sync reports a deleted user", async () => {
    getSupabaseUserMock.mockResolvedValue({
      data: { user: makeSupabaseUser() },
      error: null,
    });
    storageMock.getUser.mockResolvedValue({ id: "user_123", deletedAt: new Date() });
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    storageMock.upsertUser.mockRejectedValue(
      Object.assign(new Error("User account has been deleted"), { code: "USER_DELETED" }),
    );

    const { isAuthenticated } = await import("./supabaseAuth");
    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await isAuthenticated(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized - Account deleted" });
    expect(req.user).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });

  it("does not attach a deleted identity during optional authentication", async () => {
    getSupabaseUserMock.mockResolvedValue({
      data: { user: makeSupabaseUser() },
      error: null,
    });
    storageMock.getUser.mockResolvedValue({ id: "user_123", deletedAt: new Date() });
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    storageMock.upsertUser.mockRejectedValue(
      Object.assign(new Error("User account has been deleted"), { code: "USER_DELETED" }),
    );

    const { optionalAuth } = await import("./supabaseAuth");
    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await optionalAuth(req, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });
});
