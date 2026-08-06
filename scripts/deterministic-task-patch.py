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
package["scripts"]["auth:web:test"] = "vitest run server/auth/better-auth-session.test.ts server/auth/web-auth.test.ts client/src/lib/passwordless-auth.contract.test.ts"
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

write("server/auth/better-auth-session.ts", '''import type { Request } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { authIdentities, users } from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import { type AuthRuntimeConfig, getAuthRuntimeConfig } from "./config";
import { getBetterAuthServer } from "./better-auth";
import { assertIdentityIsNotTombstoned, hashAuthEmailIdentity, normalizeAuthEmail } from "./identity-policy";
import { attachAuthPrincipal, type AuthPrincipal } from "./principal";

export type BetterAuthSessionUser = {
  id: string;
  email: string;
  emailVerified?: boolean;
  name?: string | null;
};

export type BetterAuthSessionData = {
  user: BetterAuthSessionUser;
  session: { id: string };
};

export class BetterAuthIdentityError extends Error {
  constructor(
    message: string,
    public readonly code: "IDENTITY_DELETED" | "REGISTRATION_DISABLED" | "IDENTITY_CONFLICT",
  ) {
    super(message);
    this.name = "BetterAuthIdentityError";
  }
}

export type BetterAuthSessionDependencies = {
  getSession?: (req: Request) => Promise<BetterAuthSessionData | null>;
  resolveIdentity?: (
    user: BetterAuthSessionUser,
    config: AuthRuntimeConfig,
  ) => Promise<{ userId: string }>;
};

async function defaultGetSession(req: Request): Promise<BetterAuthSessionData | null> {
  const result = await getBetterAuthServer().api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!result?.user || !result.session) return null;
  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      emailVerified: result.user.emailVerified,
      name: result.user.name,
    },
    session: { id: result.session.id },
  };
}

export async function resolveCanonicalBetterAuthIdentity(
  authUser: BetterAuthSessionUser,
  config: AuthRuntimeConfig = getAuthRuntimeConfig(),
): Promise<{ userId: string }> {
  const normalizedEmail = normalizeAuthEmail(authUser.email);
  const emailHash = hashAuthEmailIdentity(normalizedEmail);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${normalizedEmail}))`);

    const linked = await tx
      .select({
        userId: users.id,
        deletedAt: users.deletedAt,
        authProviderSubject: users.authProviderSubject,
        authProviderSubjects: users.authProviderSubjects,
        authEmailIdentityHash: users.authEmailIdentityHash,
      })
      .from(authIdentities)
      .innerJoin(users, eq(authIdentities.sportfolioUserId, users.id))
      .where(eq(authIdentities.authUserId, authUser.id))
      .limit(1);

    if (linked[0]) {
      try {
        assertIdentityIsNotTombstoned(linked[0], {
          providerSubject: authUser.id,
          email: normalizedEmail,
        });
      } catch {
        throw new BetterAuthIdentityError("Identity belongs to a deleted account", "IDENTITY_DELETED");
      }
      return { userId: linked[0].userId };
    }

    const candidates = await tx
      .select()
      .from(users)
      .where(or(eq(users.email, normalizedEmail), eq(users.authEmailIdentityHash, emailHash)))
      .limit(2);

    if (candidates.length > 1) {
      throw new BetterAuthIdentityError("Multiple canonical identities match", "IDENTITY_CONFLICT");
    }

    const existing = candidates[0];
    if (existing) {
      try {
        assertIdentityIsNotTombstoned(existing, {
          providerSubject: authUser.id,
          email: normalizedEmail,
        });
      } catch {
        throw new BetterAuthIdentityError("Identity belongs to a deleted account", "IDENTITY_DELETED");
      }
    }

    if (!existing && !config.AUTH_NEW_REGISTRATIONS_ENABLED) {
      throw new BetterAuthIdentityError("New registrations are disabled", "REGISTRATION_DISABLED");
    }

    const nameParts = (authUser.name || "").trim().split(/\s+/).filter(Boolean);
    const canonicalUser = existing
      ? existing
      : (
          await tx
            .insert(users)
            .values({
              email: normalizedEmail,
              firstName: nameParts[0] || null,
              lastName: nameParts.slice(1).join(" ") || null,
            })
            .returning()
        )[0];

    if (!canonicalUser) {
      throw new BetterAuthIdentityError("Canonical identity could not be created", "IDENTITY_CONFLICT");
    }

    await tx.insert(authIdentities).values({
      authUserId: authUser.id,
      sportfolioUserId: canonicalUser.id,
      provider: "better-auth",
      providerSubject: authUser.id,
      normalizedEmail,
      originalEmail: authUser.email,
      verifiedAt: authUser.emailVerified ? new Date() : null,
      metadata: { source: "web-magic-link" },
    });

    return { userId: canonicalUser.id };
  });
}

export async function tryAttachBetterAuthPrincipal(
  req: Request,
  config: AuthRuntimeConfig = getAuthRuntimeConfig(),
  dependencies: BetterAuthSessionDependencies = {},
): Promise<boolean> {
  if (config.AUTH_PROVIDER === "SUPABASE") return false;
  const getSession = dependencies.getSession ?? defaultGetSession;
  const resolveIdentity = dependencies.resolveIdentity ?? resolveCanonicalBetterAuthIdentity;
  const session = await getSession(req);
  if (!session) return false;

  const identity = await resolveIdentity(session.user, config);
  const names = (session.user.name || "").trim().split(/\s+/).filter(Boolean);
  const principal: AuthPrincipal = {
    userId: identity.userId,
    provider: "better-auth",
    providerSubject: session.user.id,
    email: session.user.email,
    firstName: names[0] || null,
    lastName: names.slice(1).join(" ") || null,
    sessionId: session.session.id,
  };
  attachAuthPrincipal(req, principal);
  logger.debug({ userId: identity.userId, provider: principal.provider }, "Resolved Better Auth session");
  return true;
}
''')

write("server/auth/web-auth.ts", '''import { randomUUID } from "node:crypto";
import type { Express, Request } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { authContinuations } from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import { BETTER_AUTH_BASE_PATH, getBetterAuthServer } from "./better-auth";
import { tryAttachBetterAuthPrincipal } from "./better-auth-session";
import { type AuthRuntimeConfig, assertSafeAuthReturnUrl, getAuthRuntimeConfig } from "./config";
import { getAuthPrincipal } from "./principal";

const requestSchema = z.object({
  email: z.string().trim().email().max(320),
  returnTo: z.string().max(2048).optional(),
});

export function normalizeWebAuthDestination(
  candidate: string | undefined,
  config: AuthRuntimeConfig = getAuthRuntimeConfig(),
): string {
  const absolute = assertSafeAuthReturnUrl(candidate || "/", config);
  const parsed = new URL(absolute);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export async function createWebAuthContinuation(
  destination: string,
  now = new Date(),
): Promise<string> {
  const id = randomUUID();
  await db.insert(authContinuations).values({
    id,
    purpose: "web-magic-link",
    destination,
    stateHash: null,
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
  });
  return id;
}

export async function consumeWebAuthContinuation(
  id: string,
  userId: string,
  now = new Date(),
): Promise<string | null> {
  const rows = await db
    .update(authContinuations)
    .set({ consumedAt: now, userId })
    .where(
      and(
        eq(authContinuations.id, id),
        eq(authContinuations.purpose, "web-magic-link"),
        isNull(authContinuations.consumedAt),
        gt(authContinuations.expiresAt, now),
      ),
    )
    .returning({ destination: authContinuations.destination });
  return rows[0]?.destination ?? null;
}

async function submitMagicLink(email: string, callbackURL: string, config: AuthRuntimeConfig) {
  if (!config.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL_REQUIRED");
  const endpoint = new URL(`${BETTER_AUTH_BASE_PATH}/sign-in/magic-link`, config.BETTER_AUTH_URL);
  return getBetterAuthServer(config).handler(
    new Request(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: config.PUBLIC_SITE_URL,
      },
      body: JSON.stringify({ email, name: "Sportfolio User", callbackURL }),
    }),
  );
}

export function registerWebAuthRoutes(
  app: Express,
  config: AuthRuntimeConfig = getAuthRuntimeConfig(),
): boolean {
  if (
    config.AUTH_PROVIDER === "SUPABASE" ||
    !config.AUTH_MAGIC_LINK_ENABLED ||
    !config.BETTER_AUTH_URL
  ) {
    logger.info("Passwordless web routes remain disabled");
    return false;
  }

  app.post("/api/auth/web/request", async (req, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ accepted: false, code: "invalid_request" });
    }

    const destination = normalizeWebAuthDestination(parsed.data.returnTo, config);
    const continuation = await createWebAuthContinuation(destination);
    const callback = new URL("/auth/complete", config.PUBLIC_SITE_URL);
    callback.searchParams.set("continuation", continuation);

    try {
      const response = await submitMagicLink(parsed.data.email, callback.toString(), config);
      if (!response.ok) {
        logger.warn({ status: response.status }, "Magic-link provider request was not accepted");
      }
    } catch (error) {
      logger.warn({ errorName: error instanceof Error ? error.name : "unknown" }, "Magic-link request failed");
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(202).json({ accepted: true });
  });

  app.get("/api/auth/web/complete", async (req: Request, res) => {
    const continuation = typeof req.query.continuation === "string" ? req.query.continuation : "";
    if (!continuation) {
      return res.status(400).json({ completed: false, code: "invalid" });
    }

    try {
      const authenticated = await tryAttachBetterAuthPrincipal(req, config);
      const principal = getAuthPrincipal(req);
      if (!authenticated || !principal) {
        return res.status(401).json({ completed: false, code: "session_missing" });
      }
      const destination = await consumeWebAuthContinuation(continuation, principal.userId);
      if (!destination) {
        return res.status(410).json({ completed: false, code: "expired_or_consumed" });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json({ completed: true, destination });
    } catch (error) {
      logger.warn({ errorName: error instanceof Error ? error.name : "unknown" }, "Web auth completion failed");
      return res.status(401).json({ completed: false, code: "identity_rejected" });
    }
  });

  return true;
}
''')

write("server/auth/better-auth-session.test.ts", '''import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import { getAuthRuntimeConfig } from "./config";
import { tryAttachBetterAuthPrincipal } from "./better-auth-session";
import { getAuthPrincipal } from "./principal";

function config(provider: "SUPABASE" | "DUAL" = "DUAL") {
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
  });
}

describe("Better Auth session priority", () => {
  it("does not inspect Better Auth while Supabase is selected", async () => {
    const getSession = vi.fn();
    expect(await tryAttachBetterAuthPrincipal({ headers: {} } as Request, config("SUPABASE"), { getSession })).toBe(false);
    expect(getSession).not.toHaveBeenCalled();
  });
  it("attaches a canonical principal from a Better Auth session", async () => {
    const req = { headers: {} } as Request;
    const attached = await tryAttachBetterAuthPrincipal(req, config(), {
      getSession: async () => ({
        user: { id: "auth-user", email: "user@example.com", emailVerified: true, name: "Test User" },
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
    expect(await tryAttachBetterAuthPrincipal(req, config(), { getSession: async () => null })).toBe(false);
    expect(getAuthPrincipal(req)).toBeNull();
  });
});
''')

write("server/auth/web-auth.test.ts", '''import { describe, expect, it } from "vitest";
import { getAuthRuntimeConfig } from "./config";
import { normalizeWebAuthDestination } from "./web-auth";

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
    RESEND_API_KEY: "re_test",
    RESEND_WEBHOOK_SECRET: "whsec_test",
    AUTH_EMAIL_FROM: "Sportfolio <login@auth.sportfolio.market>",
  });
}

describe("passwordless web continuation policy", () => {
  it("preserves internal destinations", () => {
    expect(normalizeWebAuthDestination("/portfolio?tab=players", config())).toBe("/portfolio?tab=players");
  });
  it("rejects external and protocol-relative destinations", () => {
    expect(() => normalizeWebAuthDestination("https://evil.example", config())).toThrow("AUTH_RETURN_ORIGIN_REJECTED");
    expect(() => normalizeWebAuthDestination("//evil.example", config())).toThrow("AUTH_RETURN_ORIGIN_REJECTED");
  });
  it("defaults to the application root", () => {
    expect(normalizeWebAuthDestination(undefined, config())).toBe("/");
  });
});
''')

write("client/src/lib/passwordless-auth.ts", '''export const WEB_AUTH_CHANNEL = "sportfolio-web-auth";

export function normalizePasswordlessReturnTo(candidate: string | null | undefined): string {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return "/";
  return candidate;
}

export async function requestPasswordlessEmail(email: string, returnTo: string) {
  const response = await fetch("/api/auth/web/request", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, returnTo: normalizePasswordlessReturnTo(returnTo) }),
  });
  if (response.status === 400) throw new Error("Please enter a valid email address.");
  if (!response.ok) throw new Error("Authentication is temporarily unavailable.");
  return { accepted: true as const };
}

export function broadcastWebAuthChange(type: "signed-in" | "signed-out") {
  if (typeof window === "undefined") return;
  try {
    const channel = new BroadcastChannel(WEB_AUTH_CHANNEL);
    channel.postMessage({ type });
    channel.close();
  } catch {
    window.localStorage.setItem(WEB_AUTH_CHANNEL, `${type}:${Date.now()}`);
  }
}
''')

write("client/src/pages/passwordless-web-login.tsx", '''import { useMemo, useState } from "react";
import { Loader2, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidEmail, normalizeEmail } from "@/lib/auth-input";
import { normalizePasswordlessReturnTo, requestPasswordlessEmail } from "@/lib/passwordless-auth";

export default function PasswordlessWebLogin() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const normalizedEmail = useMemo(() => normalizeEmail(email), [email]);
  const returnTo = useMemo(() => {
    if (typeof window === "undefined") return "/";
    return normalizePasswordlessReturnTo(new URLSearchParams(window.location.search).get("redirect"));
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValidEmail(normalizedEmail)) {
      setError("Please enter a valid email address.");
      setStatus("error");
      return;
    }
    setStatus("submitting");
    setError(null);
    try {
      await requestPasswordlessEmail(normalizedEmail, returnTo);
      setStatus("sent");
    } catch (requestError) {
      setStatus("error");
      setError(requestError instanceof Error ? requestError.message : "Authentication is temporarily unavailable.");
    }
  };

  return (
    <div className="terminal-page flex min-h-screen items-center justify-center p-4" data-testid="passwordless-login-page">
      <Card variant="terminal" className="terminal-shell w-full max-w-md">
        <CardHeader className="space-y-3 border-b border-border pb-4 text-left">
          <div className="terminal-strip">Secure Account Access</div>
          <CardTitle className="terminal-heading text-2xl">Sign in to Sportfolio</CardTitle>
          <CardDescription className="terminal-subtle">
            Enter your email and we will send a secure, single-use sign-in link. No password required.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          {status === "sent" ? (
            <div className="space-y-4" role="status" aria-live="polite">
              <div className="flex items-start gap-3 rounded-compact border border-primary/25 bg-primary/5 p-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="terminal-label text-primary">Check your email</p>
                  <p className="terminal-subtle mt-1">
                    If the address can receive a Sportfolio sign-in link, it will arrive shortly. The link expires in five minutes.
                  </p>
                </div>
              </div>
              <Button type="button" variant="terminalOutline" className="w-full" onClick={() => setStatus("idle")}>
                Use another email
              </Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="passwordless-email" className="terminal-label">Email</Label>
                <Input
                  id="passwordless-email"
                  type="email"
                  variant="terminal"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                  data-testid="input-passwordless-email"
                />
              </div>
              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
              <Button type="submit" variant="terminal" className="w-full" disabled={status === "submitting"} data-testid="button-passwordless-submit">
                {status === "submitting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Mail className="mr-2 h-4 w-4" />Email me a sign-in link</>}
              </Button>
              <p className="text-center text-xs text-muted-foreground">Single-use link · 5-minute expiry · Secure HttpOnly session</p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
''')

write("client/src/pages/auth-complete.tsx", '''import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { broadcastWebAuthChange, normalizePasswordlessReturnTo } from "@/lib/passwordless-auth";

export default function AuthComplete() {
  const [, navigate] = useLocation();
  const [state, setState] = useState<"working" | "complete" | "invalid" | "expired">("working");

  useEffect(() => {
    const continuation = new URLSearchParams(window.location.search).get("continuation");
    if (!continuation) {
      setState("invalid");
      return;
    }
    void fetch(`/api/auth/web/complete?continuation=${encodeURIComponent(continuation)}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.completed) {
        setState(response.status === 410 ? "expired" : "invalid");
        return;
      }
      setState("complete");
      broadcastWebAuthChange("signed-in");
      window.setTimeout(() => navigate(normalizePasswordlessReturnTo(payload.destination), { replace: true }), 250);
    }).catch(() => setState("invalid"));
  }, [navigate]);

  const copy = state === "expired"
    ? { title: "This link is no longer valid", detail: "Magic links expire after five minutes and can only be used once." }
    : state === "invalid"
      ? { title: "Sign-in could not be completed", detail: "Request a new link and try again." }
      : state === "complete"
        ? { title: "Signed in", detail: "Returning you to Sportfolio." }
        : { title: "Completing sign-in", detail: "Verifying your secure session." };

  return (
    <div className="terminal-page flex min-h-screen items-center justify-center p-4">
      <Card variant="terminal" className="terminal-shell w-full max-w-md">
        <CardHeader><CardTitle className="flex items-center gap-2">{state === "working" ? <Loader2 className="h-5 w-5 animate-spin" /> : state === "complete" ? <CheckCircle2 className="h-5 w-5 text-primary" /> : <AlertTriangle className="h-5 w-5 text-destructive" />}{copy.title}</CardTitle></CardHeader>
        <CardContent className="space-y-4"><p className="terminal-subtle">{copy.detail}</p>{(state === "invalid" || state === "expired") && <Button variant="terminal" className="w-full" onClick={() => navigate("/login", { replace: true })}>Request a new link</Button>}</CardContent>
      </Card>
    </div>
  );
}
''')

write("client/src/lib/passwordless-auth.contract.test.ts", '''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizePasswordlessReturnTo } from "./passwordless-auth";

describe("passwordless web surface contract", () => {
  it("rejects external return paths", () => {
    expect(normalizePasswordlessReturnTo("https://evil.example")).toBe("/");
    expect(normalizePasswordlessReturnTo("//evil.example")).toBe("/");
    expect(normalizePasswordlessReturnTo("/portfolio?tab=players")).toBe("/portfolio?tab=players");
  });
  it("routes web login through a passwordless component and completion page", () => {
    const login = readFileSync("client/src/pages/Login.tsx", "utf8");
    const app = readFileSync("client/src/App.tsx", "utf8");
    expect(login).toContain("PasswordlessWebLogin");
    expect(app).toContain('path="/auth/complete"');
  });
  it("allows cookie-authenticated web user fetches without a Supabase token", () => {
    const auth = readFileSync("client/src/hooks/useAuth.tsx", "utf8");
    expect(auth).toContain('credentials: "include"');
    expect(auth).toContain("requestMagicLink");
    expect(auth).toContain("broadcastWebAuthChange");
  });
});
''')

# Wire Better Auth priority into the existing middleware.
supabase_path = ROOT / "server/supabaseAuth.ts"
supabase = supabase_path.read_text(encoding="utf-8")
principal_import = 'import { attachAuthPrincipal, type AuthPrincipal } from "./auth/principal";'
if 'from "./auth/better-auth-session"' not in supabase:
    supabase = supabase.replace(principal_import, principal_import + '\nimport { tryAttachBetterAuthPrincipal } from "./auth/better-auth-session";\nimport { getAuthRuntimeConfig } from "./auth/config";', 1)
required_anchor = '  const token = extractToken(req);\n\n  if (!token) {'
required_block = '''  const authConfig = getAuthRuntimeConfig();
  if (authConfig.AUTH_PROVIDER !== "SUPABASE") {
    try {
      if (await tryAttachBetterAuthPrincipal(req, authConfig)) {
        next();
        return;
      }
    } catch (error) {
      console.error("[AUTH] Better Auth session resolution failed", error);
      res.status(503).json({ message: "Authentication temporarily unavailable" });
      return;
    }
    if (!authConfig.AUTH_SUPABASE_FALLBACK_ENABLED) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
  }

  const token = extractToken(req);

  if (!token) {'''
if "Better Auth session resolution failed" not in supabase:
    supabase = supabase.replace(required_anchor, required_block, 1)
optional_anchor = '  const token = extractToken(req);\n\n  if (token) {'
optional_block = '''  const authConfig = getAuthRuntimeConfig();
  if (authConfig.AUTH_PROVIDER !== "SUPABASE") {
    try {
      if (await tryAttachBetterAuthPrincipal(req, authConfig)) {
        next();
        return;
      }
    } catch (error) {
      console.error("[AUTH] Optional Better Auth resolution failed", error);
    }
    if (!authConfig.AUTH_SUPABASE_FALLBACK_ENABLED) {
      next();
      return;
    }
  }

  const token = extractToken(req);

  if (token) {'''
if "Optional Better Auth resolution failed" not in supabase:
    supabase = supabase.replace(optional_anchor, optional_block, 1)
setup_import_anchor = 'import { getAuthRuntimeConfig } from "./auth/config";'
if 'from "./auth/web-auth"' not in supabase:
    supabase = supabase.replace(setup_import_anchor, setup_import_anchor + '\nimport { registerWebAuthRoutes } from "./auth/web-auth";', 1)
logout_anchor = '  app.post("/api/auth/logout", (_req: Request, res: Response) => {\n    res.json({ success: true, message: "Logged out successfully" });\n  });\n'
if 'registerWebAuthRoutes(app, getAuthRuntimeConfig());' not in supabase:
    supabase = supabase.replace(logout_anchor, logout_anchor + '\n  registerWebAuthRoutes(app, getAuthRuntimeConfig());\n', 1)
supabase_path.write_text(supabase, encoding="utf-8")

# Add cookie-session support and passwordless request method to the client auth hook.
hook_path = ROOT / "client/src/hooks/useAuth.tsx"
hook = hook_path.read_text(encoding="utf-8")
native_import = 'import { resolveApiUrl, resolvePublicAppUrl } from "@/lib/native-runtime";'
if 'from "@/lib/passwordless-auth"' not in hook:
    hook = hook.replace(native_import, native_import + '\nimport { broadcastWebAuthChange, requestPasswordlessEmail, WEB_AUTH_CHANNEL } from "@/lib/passwordless-auth";', 1)
hook = hook.replace('    if (!session?.access_token && !DEV_BYPASS_ENABLED) {', '    const isWebRuntime = !Capacitor.isNativePlatform();\n    if (!session?.access_token && !DEV_BYPASS_ENABLED && !isWebRuntime) {', 1)
hook = hook.replace('          headers,\n          signal: controller.signal,', '          headers,\n          credentials: "include",\n          signal: controller.signal,', 1)
hook = hook.replace('    enabled: DEV_BYPASS_ENABLED || (isInitialized && !!supabaseClient && !!session),', '    enabled:\n      DEV_BYPASS_ENABLED ||\n      (isInitialized && (!Capacitor.isNativePlatform() || (!!supabaseClient && !!session))),', 1)
login_anchor = '  const login = useCallback('
request_method = '''  const requestMagicLink = useCallback(
    async (email: string, returnTo = "/"): Promise<AuthResult> => {
      const normalizedEmail = normalizeEmail(email);
      if (!isValidEmail(normalizedEmail)) {
        return { success: false, code: "invalid_email", error: "Please enter a valid email address." };
      }
      try {
        await requestPasswordlessEmail(normalizedEmail, returnTo);
        trackAuthEvent("magic_link_requested");
        return { success: true };
      } catch (error) {
        const mapped = mapAuthError(error, "login");
        trackAuthEvent("magic_link_request_failure", { code: mapped.code });
        return mapped;
      }
    },
    [],
  );

'''
if "const requestMagicLink" not in hook:
    hook = hook.replace(login_anchor, request_method + login_anchor, 1)
logout_old = '''      await unregisterPushTokenOnLogout();
      await supabaseClient.auth.signOut();'''
logout_new = '''      await unregisterPushTokenOnLogout();
      if (!Capacitor.isNativePlatform()) {
        await fetch("/api/auth/better/sign-out", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: "{}",
        }).catch(() => undefined);
      }
      if (supabaseClient) await supabaseClient.auth.signOut();
      broadcastWebAuthChange("signed-out");'''
hook = hook.replace(logout_old, logout_new, 1)
hook = hook.replace('      if (!supabaseClient) {\n        throw new Error("Auth not initialized");\n      }\n\n      await unregisterPushTokenOnLogout();', '      await unregisterPushTokenOnLogout();', 1)
# Insert multi-tab listener before loading calculation.
loading_anchor = '  // In dev mode, we\'re never loading and always authenticated\n'
listener = '''  useEffect(() => {
    if (typeof window === "undefined" || Capacitor.isNativePlatform()) return;
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    };
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(WEB_AUTH_CHANNEL);
      channel.onmessage = refresh;
    } catch {
      channel = null;
    }
    const storageListener = (event: StorageEvent) => {
      if (event.key === WEB_AUTH_CHANNEL) refresh();
    };
    window.addEventListener("storage", storageListener);
    return () => {
      channel?.close();
      window.removeEventListener("storage", storageListener);
    };
  }, [queryClient]);

'''
if "channel.onmessage = refresh" not in hook:
    hook = hook.replace(loading_anchor, listener + loading_anchor, 1)
hook = hook.replace('    isAuthenticated: DEV_BYPASS_ENABLED ? !!user : !!session && !!user,', '    isAuthenticated:\n      DEV_BYPASS_ENABLED || !Capacitor.isNativePlatform() ? !!user : !!session && !!user,', 1)
hook = hook.replace('    login,\n    signup,', '    requestMagicLink,\n    login,\n    signup,', 1)
hook_path.write_text(hook, encoding="utf-8")

# Route web users to the passwordless page while preserving the current native UI.
login_path = ROOT / "client/src/pages/Login.tsx"
login = login_path.read_text(encoding="utf-8")
last_import = 'import { hapticMedium, hapticError } from "@/lib/haptics";'
if 'passwordless-web-login' not in login:
    login = login.replace(last_import, last_import + '\nimport PasswordlessWebLogin from "@/pages/passwordless-web-login";', 1)
web_anchor = '  if (authLoading) {'
if 'return <PasswordlessWebLogin />;' not in login:
    login = login.replace(web_anchor, '  if (!isNative) {\n    return <PasswordlessWebLogin />;\n  }\n\n' + web_anchor, 1)
login_path.write_text(login, encoding="utf-8")

# Register completion route.
app_path = ROOT / "client/src/App.tsx"
app = app_path.read_text(encoding="utf-8")
loader_anchor = 'const loadAuthCallbackPage = () => import("@/pages/AuthCallback");'
if 'loadAuthCompletePage' not in app:
    app = app.replace(loader_anchor, loader_anchor + '\nconst loadAuthCompletePage = () => import("@/pages/auth-complete");', 1)
const_anchor = 'const AuthCallback = lazy(loadAuthCallbackPage);'
if 'const AuthComplete' not in app:
    app = app.replace(const_anchor, const_anchor + '\nconst AuthComplete = lazy(loadAuthCompletePage);', 1)
route_anchor = '              <Route path="/auth/callback" component={AuthCallback} />'
if 'path="/auth/complete"' not in app:
    app = app.replace(route_anchor, route_anchor + '\n              <Route path="/auth/complete" component={AuthComplete} />', 1)
app_path.write_text(app, encoding="utf-8")

write("docs/auth/passwordless-web-dual-auth.md", '''# Passwordless web login and dual-auth transition

Web authentication uses one email field and an opaque, single-use continuation. Better Auth cookie sessions resolve before temporary Supabase bearer fallback, so a Supabase token cannot override an established Better Auth session. Existing and new Better Auth identities map to the canonical Sportfolio `users.id` through `auth_identities`.

The implementation remains dormant while Railway uses `AUTH_PROVIDER=SUPABASE`. To test it, the production database migration must first be applied through the guarded production workflow, then beta may use `AUTH_PROVIDER=DUAL` with magic links enabled and Supabase fallback retained.

Completion states distinguish missing, invalid, expired, and consumed links without disclosing whether an email address already existed. Logout revokes the Better Auth server session, signs out the temporary Supabase session when present, clears user-scoped queries, and broadcasts the state change to other tabs.''')

subprocess.run(["npm", "install", "--package-lock-only", "--ignore-scripts"], cwd=ROOT, check=True)
