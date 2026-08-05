import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BETTER_AUTH_VERSION,
  OAUTH_PROVIDER_VERSION,
  ZOD_VERSION,
  DRIZZLE_ZOD_VERSION,
  SPORTFOLIO_AUTH_BASE_URL,
  SPORTFOLIO_MCP_RESOURCE,
  SPORTFOLIO_OAUTH_SCOPES,
  compatibilityAuth,
} from "./better-auth-compatibility";

describe("Better Auth package compatibility", () => {
  it("pins matching stable package versions", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    expect(packageJson.dependencies["better-auth"]).toBe(BETTER_AUTH_VERSION);
    expect(packageJson.dependencies["@better-auth/oauth-provider"]).toBe(
      OAUTH_PROVIDER_VERSION,
    );
    expect(packageJson.dependencies.zod).toBe(ZOD_VERSION);
    expect(packageJson.dependencies["drizzle-zod"]).toBe(DRIZZLE_ZOD_VERSION);
  });

  it("constructs a passwordless OAuth provider without Railway access", () => {
    expect(compatibilityAuth).toBeDefined();
    expect(typeof compatibilityAuth.handler).toBe("function");
    expect(SPORTFOLIO_AUTH_BASE_URL).toBe("https://auth.sportfolio.market");
    expect(SPORTFOLIO_MCP_RESOURCE).toBe("https://www.sportfolio.market/mcp");
    expect(SPORTFOLIO_OAUTH_SCOPES).toContain("offline_access");
    expect(SPORTFOLIO_OAUTH_SCOPES).toContain("sportfolio.read");
  });

  it("keeps password endpoints disabled", async () => {
    const response = await compatibilityAuth.handler(
      new Request(`${SPORTFOLIO_AUTH_BASE_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "auth-compatibility@example.invalid",
          password: "not-supported",
          name: "Compatibility",
        }),
      }),
    );
    expect([404, 405]).toContain(response.status);
  });
});
