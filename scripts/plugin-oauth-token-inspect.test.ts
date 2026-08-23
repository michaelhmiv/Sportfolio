import { describe, expect, it } from "vitest";
import { inspectPluginOAuthClaims } from "./plugin-oauth-token-inspect";

describe("plugin OAuth token claim inspection", () => {
  it("accepts the expected issuer, audience, client, and lifetime", () => {
    const result = inspectPluginOAuthClaims({
      payload: {
        iss: "https://auth.example.test/api/auth/better",
        aud: "https://www.sportfolio.market/mcp/plugin",
        sub: "user-1",
        client_id: "client-1",
        exp: 2_000,
        nbf: 900,
      },
      expectedIssuer: "https://auth.example.test/api/auth/better",
      expectedAudience: "https://www.sportfolio.market/mcp/plugin",
      expectedClientId: "client-1",
      nowSeconds: 1_000,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects wrong audience, wrong client, and expired tokens", () => {
    const result = inspectPluginOAuthClaims({
      payload: {
        iss: "https://auth.example.test/api/auth/better",
        aud: "authenticated",
        sub: "user-1",
        client_id: "other-client",
        exp: 999,
      },
      expectedIssuer: "https://auth.example.test/api/auth/better",
      expectedAudience: "https://www.sportfolio.market/mcp/plugin",
      expectedClientId: "client-1",
      nowSeconds: 1_000,
    });

    expect(result.ok).toBe(false);
    expect(result.checks.audienceMatches).toBe(false);
    expect(result.checks.clientIdMatches).toBe(false);
    expect(result.checks.notExpired).toBe(false);
  });
});
