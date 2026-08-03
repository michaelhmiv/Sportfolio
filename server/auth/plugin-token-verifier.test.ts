import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "crypto";
import {
  PluginTokenError,
  resetPluginJwksCacheForTests,
  verifyPluginAccessToken,
} from "./plugin-token-verifier";
import type { PluginOAuthConfig } from "./plugin-oauth-config";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicJwk = publicKey.export({ format: "jwk" });
const kid = "plugin-test-key";

const config: PluginOAuthConfig = {
  enabled: true,
  issuer: "https://auth.example.test/auth/v1",
  resource: "https://api.example.test/mcp/plugin",
  discoveryUrl: "https://auth.example.test/.well-known/oauth-authorization-server/auth/v1",
  jwksUrl: "https://auth.example.test/auth/v1/.well-known/jwks.json",
  requiredScopes: ["openid"],
  allowedClientIds: [],
  domainChallengeToken: null,
  clockSkewSeconds: 0,
};

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createToken(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "ES256", kid, typ: "JWT" });
  const payload = encode({
    iss: config.issuer,
    sub: "user-123",
    aud: config.resource,
    client_id: "chatgpt-client",
    scope: "openid",
    iat: now,
    exp: now + 3600,
    ...overrides,
  });
  const input = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(input), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${input}.${signature.toString("base64url")}`;
}

beforeEach(() => {
  resetPluginJwksCacheForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({ keys: [{ ...publicJwk, kid, alg: "ES256", use: "sig" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyPluginAccessToken", () => {
  it("accepts a valid ES256 Supabase-style OAuth token", async () => {
    const claims = await verifyPluginAccessToken(createToken(), config);
    expect(claims.sub).toBe("user-123");
    expect(claims.client_id).toBe("chatgpt-client");
  });

  it("rejects a token issued by another issuer", async () => {
    await expect(verifyPluginAccessToken(createToken({ iss: "https://evil.test" }), config)).rejects.toMatchObject<Partial<PluginTokenError>>({
      code: "invalid_issuer",
    });
  });

  it("rejects a token issued for another audience", async () => {
    await expect(verifyPluginAccessToken(createToken({ aud: "https://other.test" }), config)).rejects.toMatchObject<Partial<PluginTokenError>>({
      code: "invalid_audience",
    });
  });

  it("rejects an expired token", async () => {
    await expect(
      verifyPluginAccessToken(createToken({ exp: Math.floor(Date.now() / 1000) - 1 }), config),
    ).rejects.toMatchObject<Partial<PluginTokenError>>({ code: "expired_token" });
  });

  it("rejects a token without the required scope", async () => {
    await expect(verifyPluginAccessToken(createToken({ scope: "profile" }), config)).rejects.toMatchObject<Partial<PluginTokenError>>({
      code: "insufficient_scope",
    });
  });

  it("supports an explicit OAuth client allowlist", async () => {
    await expect(
      verifyPluginAccessToken(createToken(), { ...config, allowedClientIds: ["different-client"] }),
    ).rejects.toMatchObject<Partial<PluginTokenError>>({ code: "unapproved_client" });
  });
});
