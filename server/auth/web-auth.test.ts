import { describe, expect, it } from "vitest";
import { getAuthRuntimeConfig } from "./config";
import {
  getPublicAuthCapabilities,
  normalizeWebAuthDestination,
  renderMagicLinkGatePage,
} from "./web-auth";

function config() {
  return getAuthRuntimeConfig({
    NODE_ENV: "test",
    PUBLIC_SITE_URL: "https://beta.sportfolio.market",
    AUTH_PROVIDER: "DUAL",
    AUTH_MAGIC_LINK_ENABLED: "true",
    AUTH_SUPABASE_FALLBACK_ENABLED: "true",
    AUTH_NEW_REGISTRATIONS_ENABLED: "true",
    AUTH_OAUTH_PROVIDER_ENABLED: "false",
    AUTH_NATIVE_HANDOFF_ENABLED: "false",
    AUTH_MIGRATION_MODE: "off",
    AUTH_ENVIRONMENT: "beta",
    AUTH_DATABASE_ENVIRONMENT: "production",
    AUTH_SHARED_PRODUCTION_DATABASE: "true",
    BETTER_AUTH_SECRET: "test-only-better-auth-secret-at-least-32-characters",
    BETTER_AUTH_URL: "https://auth.sportfolio.market",
    BETTER_AUTH_COOKIE_DOMAIN: ".sportfolio.market",
    RESEND_API_KEY: "re_test",
    RESEND_WEBHOOK_SECRET: "whsec_test",
    AUTH_EMAIL_FROM: "Sportfolio <login@auth.sportfolio.market>",
  });
}

describe("passwordless web continuation policy", () => {
  it("keeps passwordless UI disabled until both provider and feature flag are active", () => {
    expect(
      getPublicAuthCapabilities({ AUTH_PROVIDER: "SUPABASE", AUTH_MAGIC_LINK_ENABLED: "true" })
        .passwordlessWeb,
    ).toBe(false);
    expect(
      getPublicAuthCapabilities({ AUTH_PROVIDER: "DUAL", AUTH_MAGIC_LINK_ENABLED: "false" })
        .passwordlessWeb,
    ).toBe(false);
    expect(
      getPublicAuthCapabilities({ AUTH_PROVIDER: "DUAL", AUTH_MAGIC_LINK_ENABLED: "true" })
        .passwordlessWeb,
    ).toBe(true);
  });

  it("preserves internal destinations", () => {
    expect(normalizeWebAuthDestination("/portfolio?tab=players", config())).toBe(
      "/portfolio?tab=players",
    );
  });
  it("rejects external and protocol-relative destinations", () => {
    expect(() => normalizeWebAuthDestination("https://evil.example", config())).toThrow(
      "AUTH_RETURN_ORIGIN_REJECTED",
    );
    expect(() => normalizeWebAuthDestination("//evil.example", config())).toThrow(
      "AUTH_RETURN_ORIGIN_REJECTED",
    );
  });
  it("defaults to the application root", () => {
    expect(normalizeWebAuthDestination(undefined, config())).toBe("/");
  });
  it("renders a POST-only confirmation form for a valid gate", () => {
    const gate = "15f78149-0da4-4d79-9333-933ad24d9ab0";
    const page = renderMagicLinkGatePage(gate);
    expect(page).toContain('method="post"');
    expect(page).toContain('action="/api/auth/web/verify"');
    expect(page).toContain(`value="${gate}"`);
    expect(page).not.toContain("magic-link/verify");
  });
  it("renders a retry path instead of a form for an invalid or expired gate", () => {
    const page = renderMagicLinkGatePage("not-a-uuid", { expired: true });
    expect(page).toContain("Sign-in link unavailable");
    expect(page).toContain('href="/login"');
    expect(page).not.toContain('action="/api/auth/web/verify"');
  });
});
