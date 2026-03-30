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
  });

  afterEach(() => {
    process.env.SUPABASE_URL = originalEnv.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_KEY = originalEnv.SUPABASE_KEY;
  });

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
});
