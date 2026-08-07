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
  AUTH_SHARED_PRODUCTION_DATABASE: "false",
};

const sharedBeta = {
  ...base,
  PUBLIC_SITE_URL: "https://beta.sportfolio.market",
  AUTH_ENVIRONMENT: "beta",
  AUTH_DATABASE_ENVIRONMENT: "production",
  AUTH_SHARED_PRODUCTION_DATABASE: "true",
};

describe("auth environment safety", () => {
  it("preserves the legacy production baseline without Better Auth secrets", () => {
    const config = authEnvironmentSchema.parse(base);
    expect(config.AUTH_PROVIDER).toBe("SUPABASE");
    expect(getAuthDiagnostics(config).betterAuthConfigured).toBe(false);
  });

  it("defaults the retired Supabase fallback off when the variable is absent", () => {
    const config = authEnvironmentSchema.parse({
      ...base,
      AUTH_PROVIDER: "BETTER_AUTH",
      AUTH_SUPABASE_FALLBACK_ENABLED: undefined,
      BETTER_AUTH_SECRET: "test-only-better-auth-secret-at-least-32-characters",
      BETTER_AUTH_URL: "https://www.sportfolio.market",
    });
    expect(config.AUTH_SUPABASE_FALLBACK_ENABLED).toBe(false);
  });

  it("normalizes blank optional Railway variables to undefined", () => {
    const config = authEnvironmentSchema.parse({
      ...base,
      BETTER_AUTH_COOKIE_DOMAIN: "",
      BETTER_AUTH_URL: "   ",
      BETTER_AUTH_TRUSTED_ORIGINS: "",
      AUTH_EMAIL_REPLY_TO: "",
      AUTH_SUPABASE_FALLBACK_EXPIRES_AT: "",
    });
    expect(config.BETTER_AUTH_COOKIE_DOMAIN).toBeUndefined();
    expect(config.BETTER_AUTH_URL).toBeUndefined();
    expect(config.BETTER_AUTH_TRUSTED_ORIGINS).toBeUndefined();
    expect(config.AUTH_EMAIL_REPLY_TO).toBeUndefined();
    expect(config.AUTH_SUPABASE_FALLBACK_EXPIRES_AT).toBeUndefined();
  });

  it("accepts a blank optional cookie domain in a same-origin Better Auth production runtime", () => {
    const config = authEnvironmentSchema.parse({
      ...base,
      AUTH_PROVIDER: "BETTER_AUTH",
      AUTH_SUPABASE_FALLBACK_ENABLED: "false",
      AUTH_MAGIC_LINK_ENABLED: "true",
      AUTH_OAUTH_PROVIDER_ENABLED: "true",
      BETTER_AUTH_SECRET: "test-only-better-auth-secret-at-least-32-characters",
      BETTER_AUTH_URL: "https://www.sportfolio.market",
      BETTER_AUTH_COOKIE_DOMAIN: "",
      RESEND_API_KEY: "re_test",
      RESEND_WEBHOOK_SECRET: "whsec_test",
      AUTH_EMAIL_FROM: "Sportfolio <login@sportfolio.market>",
      PLUGIN_OAUTH_ISSUER: "https://www.sportfolio.market/api/auth/better",
      PLUGIN_MCP_RESOURCE: "https://www.sportfolio.market/mcp/plugin",
    });
    expect(config.AUTH_PROVIDER).toBe("BETTER_AUTH");
    expect(config.BETTER_AUTH_COOKIE_DOMAIN).toBeUndefined();
  });

  it("allows beta to intentionally share the production database", () => {
    const config = authEnvironmentSchema.parse(sharedBeta);
    expect(config.AUTH_ENVIRONMENT).toBe("beta");
    expect(config.AUTH_DATABASE_ENVIRONMENT).toBe("production");
    expect(getAuthDiagnostics(config).sharedProductionDatabase).toBe(true);
  });

  it("requires an explicit flag when beta uses the production database", () => {
    expect(() =>
      authEnvironmentSchema.parse({
        ...sharedBeta,
        AUTH_SHARED_PRODUCTION_DATABASE: "false",
      }),
    ).toThrow("must be true when beta intentionally uses the production database");
  });

  it("rejects the shared-database flag for any other environment pairing", () => {
    expect(() =>
      authEnvironmentSchema.parse({
        ...base,
        AUTH_SHARED_PRODUCTION_DATABASE: "true",
      }),
    ).toThrow("is only valid for a beta runtime using the production database");
  });

  it("requires Better Auth secrets when Better Auth is active", () => {
    expect(() => authEnvironmentSchema.parse({ ...base, AUTH_PROVIDER: "DUAL" })).toThrow();
  });

  it("requires and validates a shared cookie domain for the dedicated auth host", () => {
    const dual = {
      ...base,
      AUTH_PROVIDER: "DUAL",
      BETTER_AUTH_SECRET: "test-only-better-auth-secret-at-least-32-characters",
      BETTER_AUTH_URL: "https://auth.sportfolio.market",
    };
    expect(() => authEnvironmentSchema.parse(dual)).toThrow(
      "required when Better Auth and the application use separate subdomains",
    );
    expect(() =>
      authEnvironmentSchema.parse({
        ...dual,
        BETTER_AUTH_COOKIE_DOMAIN: ".sportfolio.market",
      }),
    ).not.toThrow();
    expect(() =>
      authEnvironmentSchema.parse({
        ...dual,
        BETTER_AUTH_COOKIE_DOMAIN: ".example.com",
      }),
    ).toThrow("must be a shared parent domain");
  });

  it("requires Resend configuration when magic links are enabled", () => {
    expect(() =>
      authEnvironmentSchema.parse({ ...base, AUTH_MAGIC_LINK_ENABLED: "true" }),
    ).toThrow();
  });

  it("rejects migration execution from beta even when the database is shared", () => {
    expect(() =>
      authEnvironmentSchema.parse({
        ...sharedBeta,
        AUTH_MIGRATION_MODE: "execute",
        AUTH_MIGRATION_CONFIRM_DATABASE: "production",
        AUTH_MIGRATION_CONFIRM_CANONICAL_HOST: "www.sportfolio.market",
      }),
    ).toThrow("migration execution is only allowed from the production runtime");
  });

  it("requires explicit production confirmations for migration execution", () => {
    expect(() =>
      authEnvironmentSchema.parse({
        ...base,
        AUTH_MIGRATION_MODE: "execute",
      }),
    ).toThrow();

    expect(() =>
      authEnvironmentSchema.parse({
        ...base,
        AUTH_MIGRATION_MODE: "execute",
        AUTH_MIGRATION_CONFIRM_DATABASE: "production",
        AUTH_MIGRATION_CONFIRM_CANONICAL_HOST: "www.sportfolio.market",
      }),
    ).not.toThrow();
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