import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const write = (file, content) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
};

const update = (file, transform) => {
  const target = path.join(root, file);
  const before = fs.readFileSync(target, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`No change produced for ${file}`);
  fs.writeFileSync(target, after, "utf8");
};

write("server/auth/config.ts", `import { z } from "zod";

export const authProviderSchema = z.enum(["SUPABASE", "DUAL", "BETTER_AUTH"]);
export const authMigrationModeSchema = z.enum(["off", "dry-run", "execute"]);

const booleanFlag = z.enum(["true", "false"]).transform((value) => value === "true");

const optionalUrl = z.string().url().optional();

export const authEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PUBLIC_SITE_URL: z.string().url(),
    AUTH_PROVIDER: authProviderSchema.default("SUPABASE"),
    AUTH_MAGIC_LINK_ENABLED: booleanFlag.default("false"),
    AUTH_SUPABASE_FALLBACK_ENABLED: booleanFlag.default("true"),
    AUTH_NEW_REGISTRATIONS_ENABLED: booleanFlag.default("true"),
    AUTH_OAUTH_PROVIDER_ENABLED: booleanFlag.default("false"),
    AUTH_NATIVE_HANDOFF_ENABLED: booleanFlag.default("false"),
    AUTH_MIGRATION_MODE: authMigrationModeSchema.default("off"),
    AUTH_ENVIRONMENT: z.enum(["development", "beta", "production"]).optional(),
    AUTH_DATABASE_ENVIRONMENT: z.enum(["development", "beta", "production"]).optional(),
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
    if (betterAuthEnabled && !value.BETTER_AUTH_SECRET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["BETTER_AUTH_SECRET"], message: "required when Better Auth is active" });
    }
    if (betterAuthEnabled && !value.BETTER_AUTH_URL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["BETTER_AUTH_URL"], message: "required when Better Auth is active" });
    }
    if (value.AUTH_MAGIC_LINK_ENABLED) {
      for (const key of ["RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "AUTH_EMAIL_FROM"] as const) {
        if (!value[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "required when magic links are enabled" });
      }
    }
    if (value.AUTH_OAUTH_PROVIDER_ENABLED) {
      for (const key of ["PLUGIN_OAUTH_ISSUER", "PLUGIN_MCP_RESOURCE"] as const) {
        if (!value[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "required when OAuth provider is enabled" });
      }
    }
    if (value.AUTH_PROVIDER === "BETTER_AUTH" && value.AUTH_SUPABASE_FALLBACK_ENABLED) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["AUTH_SUPABASE_FALLBACK_ENABLED"], message: "must be false when provider is BETTER_AUTH" });
    }
    if (value.AUTH_MIGRATION_MODE === "execute") {
      if (!value.AUTH_ENVIRONMENT || !value.AUTH_DATABASE_ENVIRONMENT || value.AUTH_ENVIRONMENT !== value.AUTH_DATABASE_ENVIRONMENT) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["AUTH_DATABASE_ENVIRONMENT"], message: "migration execution requires matching explicit app and database environments" });
      }
    }
    if (value.AUTH_ENVIRONMENT === "beta" && new URL(value.PUBLIC_SITE_URL).hostname !== "beta.sportfolio.market") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["PUBLIC_SITE_URL"], message: "beta must use beta.sportfolio.market" });
    }
    if (value.AUTH_ENVIRONMENT === "production" && new URL(value.PUBLIC_SITE_URL).hostname !== "www.sportfolio.market") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["PUBLIC_SITE_URL"], message: "production must use www.sportfolio.market" });
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
    resendConfigured: Boolean(config.RESEND_API_KEY && config.RESEND_WEBHOOK_SECRET && config.AUTH_EMAIL_FROM),
    oauthIssuer: config.PLUGIN_OAUTH_ISSUER ?? null,
    mcpResource: config.PLUGIN_MCP_RESOURCE ?? null,
    service: config.RAILWAY_SERVICE_NAME ?? null,
  };
}

export function assertSafeAuthReturnUrl(candidate: string, config = getAuthRuntimeConfig()): string {
  const base = new URL(config.PUBLIC_SITE_URL);
  const resolved = new URL(candidate, base);
  if (resolved.origin !== base.origin) throw new Error("AUTH_RETURN_ORIGIN_REJECTED");
  return resolved.toString();
}
`);

write("server/auth/config.test.ts", `import { describe, expect, it } from "vitest";
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
    expect(() => authEnvironmentSchema.parse({ ...base, AUTH_MAGIC_LINK_ENABLED: "true" })).toThrow();
  });

  it("requires explicit matching environments for migration execution", () => {
    expect(() => authEnvironmentSchema.parse({ ...base, AUTH_MIGRATION_MODE: "execute", AUTH_DATABASE_ENVIRONMENT: "beta" })).toThrow();
  });

  it("rejects cross-environment public hosts", () => {
    expect(() => authEnvironmentSchema.parse({ ...base, AUTH_ENVIRONMENT: "beta" })).toThrow();
  });

  it("rejects external continuation origins", () => {
    const config = authEnvironmentSchema.parse(base);
    expect(() => assertSafeAuthReturnUrl("https://example.com/steal", config)).toThrow("AUTH_RETURN_ORIGIN_REJECTED");
    expect(assertSafeAuthReturnUrl("/portfolio", config)).toBe("https://www.sportfolio.market/portfolio");
  });
});
`);

write("docs/auth/railway-environments.md", `# Sportfolio authentication environments

## Runtime model

Sportfolio deploys the same reviewed \\`main\\` commit to two Railway application services. Authentication behavior is selected by validated environment variables rather than branch-specific code.

| Service | Public URL | Database | Purpose |
| --- | --- | --- | --- |
| Sportfolio-Replit | https://www.sportfolio.market | production Railway Postgres | production |
| Sportfolio-Beta | https://beta.sportfolio.market | isolated beta Railway Postgres | authentication certification |

## Required safety invariants

- Beta and production must not share a database for migration rehearsals or synthetic authentication tests.
- \\`AUTH_ENVIRONMENT\\` and \\`AUTH_DATABASE_ENVIRONMENT\\` must match before \\`AUTH_MIGRATION_MODE=execute\\` is accepted.
- Beta must use \\`https://beta.sportfolio.market\\` as \\`PUBLIC_SITE_URL\\`.
- Production must use \\`https://www.sportfolio.market\\` as \\`PUBLIC_SITE_URL\\`.
- Callback and continuation URLs must remain on the configured application origin.
- \\`RUN_SCHEDULED_JOBS=false\\` is mandatory for the beta application.
- Production remains on Supabase until the explicit cutover PR and configuration change.

## Initial production authentication settings

\\`\\`\\`text
AUTH_PROVIDER=SUPABASE
AUTH_MAGIC_LINK_ENABLED=false
AUTH_SUPABASE_FALLBACK_ENABLED=true
AUTH_NEW_REGISTRATIONS_ENABLED=true
AUTH_OAUTH_PROVIDER_ENABLED=false
AUTH_NATIVE_HANDOFF_ENABLED=false
AUTH_MIGRATION_MODE=off
AUTH_ENVIRONMENT=production
AUTH_DATABASE_ENVIRONMENT=production
\\`\\`\\`

## Initial beta authentication settings

The beta service begins on the same legacy provider baseline. Better Auth, Resend, native handoff and OAuth capabilities are enabled only after their implementation PR passes automated and live beta certification.
`);

write("docs/auth/migration-program.md", `# Passwordless authentication migration program

Tracking issue: #369

The migration is delivered as additive, reviewable PRs. Sportfolio's existing \\`users.id\\` remains the permanent application identity. Better Auth identities will map through an explicit \\`auth_identities\\` boundary. Production remains on Supabase until passwordless web, native, OAuth/MCP, migration, deletion and rollback paths pass certification.

## PR sequence

1. Mainline beta infrastructure and safety controls (#370)
2. ADR, Supabase exit inventory and compatibility spike (#371)
3. Better Auth schema and canonical identity boundary (#372)
4. Better Auth server foundation (#373)
5. Resend magic links and webhooks (#374)
6. Passwordless web login and dual auth (#375)
7. Native handoff (#376)
8. Identity migration and reconciliation (#377)
9. OAuth Provider and MCP authentication (#378)
10. Lifecycle, observability and certification (#379)
11. Production cutover (#380)
12. Permanent Supabase removal (#381)
`);

update("server/index.ts", (source) => {
  if (source.includes('from "./auth/config"')) return source;
  const importAnchor = source.indexOf("\n", source.indexOf("import "));
  const withImport = source.slice(0, importAnchor + 1) + 'import { getAuthDiagnostics, getAuthRuntimeConfig } from "./auth/config";\n' + source.slice(importAnchor + 1);
  const marker = "async function startServer";
  const position = withImport.indexOf(marker);
  if (position < 0) throw new Error("startServer anchor not found");
  const brace = withImport.indexOf("{", position);
  return withImport.slice(0, brace + 1) + "\n  const authConfig = getAuthRuntimeConfig();\n  console.info(\"auth_runtime_config\", getAuthDiagnostics(authConfig));" + withImport.slice(brace + 1);
});

update("package.json", (source) => {
  const pkg = JSON.parse(source);
  pkg.scripts["auth:config:test"] = "vitest run server/auth/config.test.ts";
  return `${JSON.stringify(pkg, null, 2)}\n`;
});

fs.unlinkSync(import.meta.filename);
