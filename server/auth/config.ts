import { z } from "zod";

export const authProviderSchema = z.enum(["SUPABASE", "DUAL", "BETTER_AUTH"]);
export const authMigrationModeSchema = z.enum(["off", "dry-run", "execute"]);

const booleanFlag = z.enum(["true", "false"]).transform((value) => value === "true");
const optionalUrl = z.string().url().optional();

export const authEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PUBLIC_SITE_URL: z.string().url(),
    AUTH_PROVIDER: authProviderSchema.default("SUPABASE"),
    AUTH_MAGIC_LINK_ENABLED: booleanFlag.default(false),
    AUTH_SUPABASE_FALLBACK_ENABLED: booleanFlag.default(true),
    AUTH_NEW_REGISTRATIONS_ENABLED: booleanFlag.default(true),
    AUTH_OAUTH_PROVIDER_ENABLED: booleanFlag.default(false),
    AUTH_NATIVE_HANDOFF_ENABLED: booleanFlag.default(false),
    AUTH_MIGRATION_MODE: authMigrationModeSchema.default("off"),
    AUTH_ENVIRONMENT: z.enum(["development", "beta", "production"]).optional(),
    AUTH_DATABASE_ENVIRONMENT: z.enum(["development", "beta", "production"]).optional(),
    AUTH_SHARED_PRODUCTION_DATABASE: booleanFlag.default(false),
    AUTH_MIGRATION_CONFIRM_DATABASE: z.enum(["development", "beta", "production"]).optional(),
    AUTH_MIGRATION_CONFIRM_CANONICAL_HOST: z.string().optional(),
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    BETTER_AUTH_URL: optionalUrl,
    BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    RESEND_WEBHOOK_SECRET: z.string().optional(),
    AUTH_EMAIL_FROM: z.string().optional(),
    AUTH_EMAIL_REPLY_TO: z.string().email().optional(),
    PLUGIN_OAUTH_ISSUER: optionalUrl,
    PLUGIN_MCP_RESOURCE: optionalUrl,
    AUTH_SUPABASE_FALLBACK_EXPIRES_AT: z.string().datetime().optional(),
    RAILWAY_SERVICE_NAME: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const betterAuthEnabled = value.AUTH_PROVIDER !== "SUPABASE";
    const publicHost = new URL(value.PUBLIC_SITE_URL).hostname;
    const sharedProductionDatabase =
      value.AUTH_ENVIRONMENT === "beta" && value.AUTH_DATABASE_ENVIRONMENT === "production";

    if (betterAuthEnabled && !value.BETTER_AUTH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_SECRET"],
        message: "required when Better Auth is active",
      });
    }
    if (betterAuthEnabled && !value.BETTER_AUTH_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_URL"],
        message: "required when Better Auth is active",
      });
    }

    if (value.AUTH_MAGIC_LINK_ENABLED) {
      for (const key of ["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "AUTH_EMAIL_FROM"] as const) {
        if (!value[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: "required when magic links are enabled",
          });
        }
      }
    }

    if (value.AUTH_OAUTH_PROVIDER_ENABLED) {
      for (const key of ["PLUGIN_OAUTH_ISSUER", "PLUGIN_MCP_RESOURCE"] as const) {
        if (!value[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: "required when OAuth provider is enabled",
          });
        }
      }
    }

    if (value.AUTH_PROVIDER === "BETTER_AUTH" && value.AUTH_SUPABASE_FALLBACK_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_SUPABASE_FALLBACK_ENABLED"],
        message: "must be false when provider is BETTER_AUTH",
      });
    }

    if (sharedProductionDatabase && !value.AUTH_SHARED_PRODUCTION_DATABASE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_SHARED_PRODUCTION_DATABASE"],
        message: "must be true when beta intentionally uses the production database",
      });
    }

    if (value.AUTH_SHARED_PRODUCTION_DATABASE && !sharedProductionDatabase) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_SHARED_PRODUCTION_DATABASE"],
        message: "is only valid for a beta runtime using the production database",
      });
    }

    if (
      value.AUTH_ENVIRONMENT === "production" &&
      value.AUTH_DATABASE_ENVIRONMENT !== "production"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_DATABASE_ENVIRONMENT"],
        message: "production runtime must use the production database",
      });
    }

    if (value.AUTH_MIGRATION_MODE === "execute") {
      if (
        value.AUTH_ENVIRONMENT !== "production" ||
        value.AUTH_DATABASE_ENVIRONMENT !== "production"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["AUTH_MIGRATION_MODE"],
          message: "migration execution is only allowed from the production runtime",
        });
      }
      if (value.AUTH_MIGRATION_CONFIRM_DATABASE !== "production") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["AUTH_MIGRATION_CONFIRM_DATABASE"],
          message: "must explicitly confirm the production database",
        });
      }
      if (value.AUTH_MIGRATION_CONFIRM_CANONICAL_HOST !== "www.sportfolio.market") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["AUTH_MIGRATION_CONFIRM_CANONICAL_HOST"],
          message: "must explicitly confirm www.sportfolio.market",
        });
      }
    }

    if (value.AUTH_ENVIRONMENT === "beta" && publicHost !== "beta.sportfolio.market") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PUBLIC_SITE_URL"],
        message: "beta must use beta.sportfolio.market",
      });
    }

    if (value.AUTH_ENVIRONMENT === "production" && publicHost !== "www.sportfolio.market") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PUBLIC_SITE_URL"],
        message: "production must use www.sportfolio.market",
      });
    }
  });

export type AuthRuntimeConfig = z.infer<typeof authEnvironmentSchema>;

let cached: AuthRuntimeConfig | undefined;

export function getAuthRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AuthRuntimeConfig {
  if (env === process.env && cached) return cached;
  const parsed = authEnvironmentSchema.parse(env);
  if (env === process.env) cached = parsed;
  return parsed;
}

export function getAuthDiagnostics(config = getAuthRuntimeConfig()) {
  return {
    environment: config.AUTH_ENVIRONMENT ?? config.NODE_ENV,
    databaseEnvironment: config.AUTH_DATABASE_ENVIRONMENT ?? "unclassified",
    sharedProductionDatabase: config.AUTH_SHARED_PRODUCTION_DATABASE,
    publicSiteUrl: config.PUBLIC_SITE_URL,
    provider: config.AUTH_PROVIDER,
    capabilities: {
      magicLink: config.AUTH_MAGIC_LINK_ENABLED,
      supabaseFallback: config.AUTH_SUPABASE_FALLBACK_ENABLED,
      newRegistrations: config.AUTH_NEW_REGISTRATIONS_ENABLED,
      oauthProvider: config.AUTH_OAUTH_PROVIDER_ENABLED,
      nativeHandoff: config.AUTH_NATIVE_HANDOFF_ENABLED,
    },
    migrationMode: config.AUTH_MIGRATION_MODE,
    betterAuthConfigured: Boolean(config.BETTER_AUTH_SECRET && config.BETTER_AUTH_URL),
    resendConfigured: Boolean(
      config.RESEND_API_KEY && config.RESEND_WEBHOOK_SECRET && config.AUTH_EMAIL_FROM,
    ),
    oauthIssuer: config.PLUGIN_OAUTH_ISSUER ?? null,
    mcpResource: config.PLUGIN_MCP_RESOURCE ?? null,
    fallbackExpiresAt: config.AUTH_SUPABASE_FALLBACK_EXPIRES_AT ?? null,
    service: config.RAILWAY_SERVICE_NAME ?? null,
  };
}

export function assertSafeAuthReturnUrl(
  candidate: string,
  config = getAuthRuntimeConfig(),
): string {
  const base = new URL(config.PUBLIC_SITE_URL);
  const resolved = new URL(candidate, base);
  if (resolved.origin !== base.origin) throw new Error("AUTH_RETURN_ORIGIN_REJECTED");
  return resolved.toString();
}
