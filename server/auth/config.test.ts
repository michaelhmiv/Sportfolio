import { describe, expect, it } from "vitest";
import { assertSafeAuthReturnUrl, authEnvironmentSchema, getAuthDiagnostics } from "./config";

const base = {
  NODE_ENV: "production",
  PUBLIC_SITE_URL: "https://www.sportfolio.market",
  AUTH_PROVIDER: "SUPABASE",
  AUTH_MAGIC_LINK_ENABLED: "false",
  AUTH_SUPABASE_FALLBACK_ENABLED: "true",
  AUTH_NEW_REGISTRATIONS_ENABLED: "true",
  AUTH_OAUTH_PROVIDER_ENABLED: "false",
  AUTH_NATIVE_HANDOFF_ENABLED: "false",
  AUTH_MIGRATION_MODE: "off",
  AUTH_ENVIRONMENT: "production",
  AUTH_DATABASE_ENVIRONMENT: "production",
};

describe("auth environment safety", () => {
  it("preserves the legacy production baseline without Better Auth secrets", () => {
    const config = authEnvironmentSchema.parse(base);
    expect(config.AUTH_PROVIDER).toBe("SUPABASE");
    expect(getAuthDiagnostics(config).betterAuthConfigured).toBe(false);
  });

  it("requires Better Auth secrets when Better Auth is active", () => {
    expect(() => authEnvironmentSchema.parse({ ...base, AUTH_PROVIDER: "DUAL" })).toThrow();
  });

  it("requires Resend configuration when magic links are enabled", () => {
    expect(() =>
      authEnvironmentSchema.parse({ ...base, AUTH_MAGIC_LINK_ENABLED: "true" }),
    ).toThrow();
  });

  it("requires explicit matching environments for migration execution", () => {
    expect(() =>
      authEnvironmentSchema.parse({
        ...base,
        AUTH_MIGRATION_MODE: "execute",
        AUTH_DATABASE_ENVIRONMENT: "beta",
      }),
    ).toThrow();
  });

  it("rejects cross-environment public hosts", () => {
    expect(() => authEnvironmentSchema.parse({ ...base, AUTH_ENVIRONMENT: "beta" })).toThrow();
  });

  it("rejects external continuation origins", () => {
    const config = authEnvironmentSchema.parse(base);
    expect(() => assertSafeAuthReturnUrl("https://example.com/steal", config)).toThrow(
      "AUTH_RETURN_ORIGIN_REJECTED",
    );
    expect(assertSafeAuthReturnUrl("/portfolio", config)).toBe(
      "https://www.sportfolio.market/portfolio",
    );
  });
});
