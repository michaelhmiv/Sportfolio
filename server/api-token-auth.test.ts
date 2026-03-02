import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createUserApiTokenMaterial,
  hashUserApiToken,
  requireUserApiToken,
} from "./api-token-auth";
import { storage } from "./storage";

describe("API token auth", () => {
  const originalSecret = process.env.USER_API_TOKEN_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.USER_API_TOKEN_SECRET = "test-cli-secret";
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.USER_API_TOKEN_SECRET = originalSecret;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("creates namespaced HMAC-backed token material", () => {
    const material = createUserApiTokenMaterial();

    expect(material.plaintextToken).toMatch(/^spt_[a-f0-9]{12}_[a-f0-9]{48}$/);
    expect(material.tokenHash).toBe(hashUserApiToken(material.plaintextToken));
    expect(material.tokenPrefix).toMatch(/^spt_[a-f0-9]{12}$/);
    expect(material.tokenLast4).toHaveLength(4);
  });

  it("accepts a valid token and attaches the owning user", async () => {
    const material = createUserApiTokenMaterial();
    const getTokenSpy = vi.spyOn(storage, "getUserApiTokenByHash").mockResolvedValue({
      id: "token_1",
      userId: "user_1",
    } as any);
    const markUsedSpy = vi.spyOn(storage, "markUserApiTokenUsed").mockResolvedValue();

    const req: any = {
      header: (name: string) =>
        name === "authorization" ? `Bearer ${material.plaintextToken}` : undefined,
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await requireUserApiToken(req, res, next);

    expect(getTokenSpy).toHaveBeenCalledWith(material.tokenHash);
    expect(markUsedSpy).toHaveBeenCalledWith("token_1");
    expect(req.user.claims.sub).toBe("user_1");
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects malformed bearer tokens", async () => {
    const req: any = {
      header: (name: string) => (name === "authorization" ? "Bearer not-a-real-token" : undefined),
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await requireUserApiToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
