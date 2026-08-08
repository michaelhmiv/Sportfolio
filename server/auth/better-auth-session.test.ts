import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { getAuthRuntimeConfig } from "./config";
import { tryAttachBetterAuthPrincipal } from "./better-auth-session";
import { getAuthPrincipal } from "./principal";

function config() {
  return getAuthRuntimeConfig({
    NODE_ENV: "test",
    PUBLIC_SITE_URL: "https://beta.sportfolio.market",
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
  });
}

describe("Better Auth session priority", () => {
  it("attaches a canonical principal from a Better Auth session", async () => {
    const req = { headers: {} } as Request;
    const attached = await tryAttachBetterAuthPrincipal(req, config(), {
      getSession: async () => ({
        user: {
          id: "auth-user",
          email: "user@example.com",
          emailVerified: true,
          name: "Test User",
        },
        session: { id: "session-id" },
      }),
      resolveIdentity: async () => ({ userId: "canonical-user" }),
    });
    expect(attached).toBe(true);
    expect(getAuthPrincipal(req)).toMatchObject({
      userId: "canonical-user",
      provider: "better-auth",
      providerSubject: "auth-user",
      sessionId: "session-id",
    });
  });
  it("does not attach when no Better Auth session exists", async () => {
    const req = { headers: {} } as Request;
    expect(
      await tryAttachBetterAuthPrincipal(req, config(), { getSession: async () => null }),
    ).toBe(false);
    expect(getAuthPrincipal(req)).toBeNull();
  });
});
