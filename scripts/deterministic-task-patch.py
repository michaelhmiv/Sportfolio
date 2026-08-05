from pathlib import Path
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
package["dependencies"]["@better-auth/drizzle-adapter"] = "1.6.25"
package["scripts"]["auth:foundation:test"] = "vitest run server/auth/principal.test.ts server/auth/better-auth.test.ts"
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

write("server/auth/principal.ts", '''import type { Request } from "express";

export type AuthProvider = "supabase" | "better-auth" | "development";

export type AuthPrincipal = {
  userId: string;
  provider: AuthProvider;
  providerSubject: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  sessionId?: string | null;
  scopes?: readonly string[];
};

type PrincipalRequest = Request & {
  authPrincipal?: AuthPrincipal;
  user?: ReturnType<typeof toLegacyRequestUser>;
};

export function toLegacyRequestUser(principal: AuthPrincipal) {
  return {
    claims: {
      sub: principal.userId,
      email: principal.email ?? undefined,
      first_name: principal.firstName ?? undefined,
      last_name: principal.lastName ?? undefined,
    },
  };
}

export function attachAuthPrincipal(req: Request, principal: AuthPrincipal): void {
  const target = req as PrincipalRequest;
  target.authPrincipal = principal;
  target.user = toLegacyRequestUser(principal);
}

export function getAuthPrincipal(req: Request): AuthPrincipal | null {
  return (req as PrincipalRequest).authPrincipal ?? null;
}

export function requireAuthPrincipal(req: Request): AuthPrincipal {
  const principal = getAuthPrincipal(req);
  if (!principal) throw new Error("AUTH_PRINCIPAL_MISSING");
  return principal;
}
''')

write("server/auth/better-auth.ts", '''import type { Express } from "express";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import { magicLink } from "better-auth/plugins";
import { authAccounts, authSessions, authUsers, authVerifications } from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import { type AuthRuntimeConfig, getAuthRuntimeConfig } from "./config";

export const BETTER_AUTH_BASE_PATH = "/api/auth/better";
export const BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;
export const BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;

export type BetterAuthMagicLinkSender = (input: {
  email: string;
  url: string;
  token: string;
}) => Promise<void>;

function trustedOrigins(config: AuthRuntimeConfig): string[] {
  const configured = (config.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [...new Set([config.PUBLIC_SITE_URL, config.BETTER_AUTH_URL, ...configured].filter(Boolean))] as string[];
}

function disabledMagicLinkSender(): Promise<never> {
  return Promise.reject(new Error("AUTH_MAGIC_LINK_DELIVERY_DISABLED"));
}

export function createBetterAuthServer(
  config: AuthRuntimeConfig = getAuthRuntimeConfig(),
  sendMagicLink: BetterAuthMagicLinkSender = disabledMagicLinkSender,
) {
  if (!config.BETTER_AUTH_SECRET || !config.BETTER_AUTH_URL) {
    throw new Error("Better Auth cannot be created without BETTER_AUTH_SECRET and BETTER_AUTH_URL");
  }

  return betterAuth({
    appName: "Sportfolio",
    baseURL: config.BETTER_AUTH_URL,
    basePath: BETTER_AUTH_BASE_PATH,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(config),
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS,
      updateAge: BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS,
      deferSessionRefresh: true,
    },
    advanced: {
      cookiePrefix: "sportfolio",
      useSecureCookies: config.NODE_ENV === "production",
    },
    plugins: [
      magicLink({
        expiresIn: 300,
        storeToken: "hashed",
        disableSignUp: !config.AUTH_NEW_REGISTRATIONS_ENABLED,
        sendMagicLink: async ({ email, url, token }) => {
          if (!config.AUTH_MAGIC_LINK_ENABLED) throw new Error("AUTH_MAGIC_LINK_DISABLED");
          await sendMagicLink({ email, url, token });
        },
      }),
    ],
  });
}

let runtimeAuth: ReturnType<typeof createBetterAuthServer> | undefined;

export function getBetterAuthServer(config: AuthRuntimeConfig = getAuthRuntimeConfig()) {
  runtimeAuth ??= createBetterAuthServer(config);
  return runtimeAuth;
}

export function mountBetterAuthHandler(
  app: Express,
  config: AuthRuntimeConfig = getAuthRuntimeConfig(),
): boolean {
  if (config.AUTH_PROVIDER === "SUPABASE") {
    logger.info("Better Auth handler remains disabled while AUTH_PROVIDER=SUPABASE");
    return false;
  }

  app.set("trust proxy", 1);
  const auth = getBetterAuthServer(config);
  app.all(`${BETTER_AUTH_BASE_PATH}/sign-up/email`, (_req, res) => {
    res.status(404).json({ error: "Password registration is not available" });
  });
  app.all(`${BETTER_AUTH_BASE_PATH}/sign-in/email`, (_req, res) => {
    res.status(404).json({ error: "Password login is not available" });
  });
  app.all(`${BETTER_AUTH_BASE_PATH}/*`, toNodeHandler(auth));
  logger.info(
    { provider: config.AUTH_PROVIDER, basePath: BETTER_AUTH_BASE_PATH, trustedOriginCount: trustedOrigins(config).length },
    "Mounted Better Auth handler",
  );
  return true;
}
''')

write("server/auth/principal.test.ts", '''import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { attachAuthPrincipal, getAuthPrincipal, requireAuthPrincipal, toLegacyRequestUser } from "./principal";

describe("provider-neutral authentication principal", () => {
  it("keeps canonical Sportfolio user id as the request subject", () => {
    const principal = {
      userId: "canonical-user",
      provider: "better-auth" as const,
      providerSubject: "auth-user",
      email: "user@example.com",
    };
    expect(toLegacyRequestUser(principal).claims.sub).toBe("canonical-user");
  });

  it("attaches both principal and temporary legacy claim shape", () => {
    const req = {} as Request;
    attachAuthPrincipal(req, {
      userId: "canonical-user",
      provider: "supabase",
      providerSubject: "supabase-subject",
    });
    expect(getAuthPrincipal(req)?.providerSubject).toBe("supabase-subject");
    expect((req as Request & { user?: { claims: { sub: string } } }).user?.claims.sub).toBe("canonical-user");
    expect(requireAuthPrincipal(req).userId).toBe("canonical-user");
  });

  it("rejects requests without a resolved principal", () => {
    expect(() => requireAuthPrincipal({} as Request)).toThrow("AUTH_PRINCIPAL_MISSING");
  });
});
''')

write("server/auth/better-auth.test.ts", '''import express from "express";
import { describe, expect, it } from "vitest";
import { getAuthRuntimeConfig } from "./config";
import {
  BETTER_AUTH_BASE_PATH,
  BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS,
  BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS,
  createBetterAuthServer,
  mountBetterAuthHandler,
} from "./better-auth";

function testConfig(provider: "SUPABASE" | "DUAL" = "DUAL") {
  return getAuthRuntimeConfig({
    NODE_ENV: "test",
    PUBLIC_SITE_URL: "https://beta.sportfolio.market",
    AUTH_PROVIDER: provider,
    AUTH_MAGIC_LINK_ENABLED: "false",
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
    BETTER_AUTH_TRUSTED_ORIGINS: "sportfolio://,capacitor://localhost",
  });
}

describe("Better Auth server foundation", () => {
  it("constructs against the namespaced Drizzle schema without database access", () => {
    const auth = createBetterAuthServer(testConfig(), async () => undefined);
    expect(typeof auth.handler).toBe("function");
    expect(BETTER_AUTH_BASE_PATH).toBe("/api/auth/better");
    expect(BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS).toBe(60 * 60 * 24 * 30);
    expect(BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS).toBe(60 * 60 * 24);
  });

  it("does not mount while Supabase is selected", () => {
    expect(mountBetterAuthHandler(express(), testConfig("SUPABASE"))).toBe(false);
  });

  it("keeps password registration unavailable", async () => {
    const auth = createBetterAuthServer(testConfig(), async () => undefined);
    const response = await auth.handler(
      new Request(`https://auth.sportfolio.market${BETTER_AUTH_BASE_PATH}/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "disabled@example.invalid", password: "nope", name: "Disabled" }),
      }),
    );
    expect(response.ok).toBe(false);
    expect([400, 404, 405]).toContain(response.status);
  });
});
''')

index_path = ROOT / "server/index.ts"
index = index_path.read_text(encoding="utf-8")
config_import = 'import { getAuthDiagnostics, getAuthRuntimeConfig } from "./auth/config";'
if 'from "./auth/better-auth"' not in index:
    index = index.replace(config_import, config_import + '\nimport { mountBetterAuthHandler } from "./auth/better-auth";', 1)
anchor = 'app.use(maintenanceWriteGuard());\n\ndeclare module "http"'
if "mountBetterAuthHandler(app, authRuntimeConfig);" not in index:
    index = index.replace(anchor, 'app.use(maintenanceWriteGuard());\n\n// Better Auth must be mounted before Express body parsing. It remains a no-op\n// while AUTH_PROVIDER=SUPABASE.\nmountBetterAuthHandler(app, authRuntimeConfig);\n\ndeclare module "http"', 1)
index_path.write_text(index, encoding="utf-8")

supabase_path = ROOT / "server/supabaseAuth.ts"
supabase = supabase_path.read_text(encoding="utf-8")
telemetry_import = 'import { observeAuthTelemetryEvent } from "./observability/metrics";'
if 'from "./auth/principal"' not in supabase:
    supabase = supabase.replace(telemetry_import, telemetry_import + '\nimport { attachAuthPrincipal, type AuthPrincipal } from "./auth/principal";', 1)
existing_anchor = '    const existingUser = existingUserById || existingUserByEmail;\n\n    // Only generate a new username'
if "if (existingUser) return existingUser.id;" not in supabase:
    supabase = supabase.replace(existing_anchor, '    const existingUser = existingUserById || existingUserByEmail;\n\n    // Existing identities are resolved without a provider-driven write on every request.\n    if (existingUser) return existingUser.id;\n\n    // Only generate a new username', 1)
supabase = supabase.replace('    const username =\n      existingUser?.username ||\n      supabaseUser.email?.split("@")[0] ||\n      `user_${supabaseUser.id.substring(0, 8)}`;', '    const username =\n      supabaseUser.email?.split("@")[0] || `user_${supabaseUser.id.substring(0, 8)}`;')
start = supabase.find('function buildRequestUser(supabaseUser: SupabaseUser, canonicalUserId = supabaseUser.id) {')
end = supabase.find('\n}\n\nfunction extractToken', start)
if start != -1 and end != -1:
    replacement = '''function buildSupabasePrincipal(
  supabaseUser: SupabaseUser,
  canonicalUserId = supabaseUser.id,
): AuthPrincipal {
  const fullName = supabaseUser.user_metadata?.full_name || "";
  const nameParts = fullName.split(" ");
  return {
    userId: canonicalUserId,
    provider: "supabase",
    providerSubject: supabaseUser.id,
    email: supabaseUser.email,
    firstName: supabaseUser.user_metadata?.first_name || nameParts[0] || null,
    lastName: supabaseUser.user_metadata?.last_name || nameParts.slice(1).join(" ") || null,
  };
}
'''
    supabase = supabase[:start] + replacement + supabase[end + 2:]
supabase = supabase.replace('(req as any).user = buildRequestUser(supabaseUser, canonicalUserId);', 'attachAuthPrincipal(req, buildSupabasePrincipal(supabaseUser, canonicalUserId));')
legacy_dev = '''(req as any).user = {
        claims: {
          sub: mockUserId,
          email: "dev@example.com",
          first_name: "Dev",
          last_name: "User",
        },
      };'''
principal_dev = '''attachAuthPrincipal(req, {
        userId: mockUserId,
        provider: "development",
        providerSubject: mockUserId,
        email: "dev@example.com",
        firstName: "Dev",
        lastName: "User",
      });'''
supabase = supabase.replace(legacy_dev, principal_dev)
legacy_optional = '''(req as any).user = {
      claims: {
        sub: mockUserId,
        email: "dev@example.com",
        first_name: "Dev",
        last_name: "User",
      },
    };'''
principal_optional = '''attachAuthPrincipal(req, {
      userId: mockUserId,
      provider: "development",
      providerSubject: mockUserId,
      email: "dev@example.com",
      firstName: "Dev",
      lastName: "User",
    });'''
supabase = supabase.replace(legacy_optional, principal_optional)
supabase_path.write_text(supabase, encoding="utf-8")

subprocess.run(["npm", "install", "--package-lock-only", "--ignore-scripts"], cwd=ROOT, check=True)
