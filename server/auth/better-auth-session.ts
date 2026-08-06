import type { Request } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { authIdentities, users } from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import { type AuthRuntimeConfig, getAuthRuntimeConfig } from "./config";
import {
  assertIdentityIsNotTombstoned,
  hashAuthEmailIdentity,
  normalizeAuthEmail,
} from "./identity-policy";
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
  const { getBetterAuthServer } = await import("./better-auth");
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
        throw new BetterAuthIdentityError(
          "Identity belongs to a deleted account",
          "IDENTITY_DELETED",
        );
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
        throw new BetterAuthIdentityError(
          "Identity belongs to a deleted account",
          "IDENTITY_DELETED",
        );
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
      throw new BetterAuthIdentityError(
        "Canonical identity could not be created",
        "IDENTITY_CONFLICT",
      );
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
  logger.debug(
    { userId: identity.userId, provider: principal.provider },
    "Resolved Better Auth session",
  );
  return true;
}
