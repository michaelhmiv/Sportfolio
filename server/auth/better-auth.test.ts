import express from "express";
import { describe, expect, it } from "vitest";
import { getAuthRuntimeConfig } from "./config";
import {
  BETTER_AUTH_BASE_PATH,
  BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS,
  BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS,
  createBetterAuthServer,
  mountBetterAuthHandler,
} from "./better-auth";

function testConfig() {
  return getAuthRuntimeConfig({
    NODE_ENV: "test",
    PUBLIC_SITE_URL: "https://beta.sportfolio.market",
    AUTH_PROVIDER: "BETTER_AUTH",
    AUTH_MAGIC_LINK_ENABLED: "false",
    AUTH_NEW_REGISTRATIONS_ENABLED: "true",
    AUTH_OAUTH_PROVIDER_ENABLED: "false",
    AUTH_NATIVE_HANDOFF_ENABLED: "false",
    AUTH_MIGRATION_MODE: "off",
    AUTH_ENVIRONMENT: "beta",
    AUTH_DATABASE_ENVIRONMENT: "production",
    AUTH_SHARED_PRODUCTION_DATABASE: "true",
    BETTER_AUTH_SECRET: "test-only-better-auth-secret-at-least-32-characters",
    BETTER_AUTH_URL: "https://beta.sportfolio.market",
    BETTER_AUTH_TRUSTED_ORIGINS: "sportfolio://,capacitor://localhost",
  });
}

describe("Better Auth server foundation", () => {
  it("constructs against the namespaced schema without database access", () => {
    const auth = createBetterAuthServer(testConfig(), async () => undefined);
    expect(typeof auth.handler).toBe("function");
    expect(BETTER_AUTH_BASE_PATH).toBe("/api/auth/better");
    expect(BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS).toBe(60 * 60 * 24 * 30);
    expect(BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS).toBe(60 * 60 * 24);
  });
  it("always mounts the canonical Better Auth handler", () => {
    expect(mountBetterAuthHandler(express(), testConfig())).toBe(true);
  });
  it("keeps password registration unavailable", async () => {
    const auth = createBetterAuthServer(testConfig(), async () => undefined);
    const response = await auth.handler(
      new Request(`https://beta.sportfolio.market${BETTER_AUTH_BASE_PATH}/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "disabled@example.invalid",
          password: "nope",
          name: "Disabled",
        }),
      }),
    );
    expect(response.ok).toBe(false);
    expect([400, 404, 405]).toContain(response.status);
  });
});
