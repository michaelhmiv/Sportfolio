import type { NextFunction, Request, Response } from "express";
import { buildPluginWwwAuthenticate } from "./plugin-auth-challenge";
import { getPluginOAuthConfig } from "./plugin-oauth-config";
import {
  getPluginTokenClientId,
  PluginTokenError,
  verifyPluginAccessToken,
  type PluginAccessTokenClaims,
} from "./plugin-token-verifier";

const SPORTFOLIO_CANONICAL_USER_CLAIM = "https://sportfolio.market/user_id";

export type PluginAuthContext = {
  userId: string;
  clientId: string;
  scopes: string[];
  claims: PluginAccessTokenClaims;
};

export type PluginAuthenticatedRequest = Request & {
  pluginAuth?: PluginAuthContext;
};

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

function authFailureResponse(error: unknown): {
  status: number;
  code: string;
  description: string;
} {
  if (!(error instanceof PluginTokenError)) {
    return { status: 401, code: "invalid_token", description: "The access token is invalid." };
  }

  if (error.code === "insufficient_scope") {
    return { status: 403, code: "insufficient_scope", description: error.message };
  }

  if (error.code === "jwks_unavailable") {
    return {
      status: 503,
      code: "temporarily_unavailable",
      description: "Authentication is temporarily unavailable.",
    };
  }

  return { status: 401, code: "invalid_token", description: error.message };
}

function canonicalUserId(claims: PluginAccessTokenClaims): string {
  const canonical = claims[SPORTFOLIO_CANONICAL_USER_CLAIM];
  if (typeof canonical === "string" && canonical.trim()) return canonical.trim();
  // Transitional compatibility for already-issued legacy access tokens. Once
  // Supabase is removed, every Better Auth token carries the canonical claim.
  return claims.sub;
}

async function authenticateToken(token: string): Promise<PluginAuthContext> {
  const claims = await verifyPluginAccessToken(token, getPluginOAuthConfig());
  const clientId = getPluginTokenClientId(claims);
  if (!clientId) {
    throw new PluginTokenError("missing_client_id", "The access token has no OAuth client identifier.");
  }
  return {
    userId: canonicalUserId(claims),
    clientId,
    scopes:
      typeof claims.scope === "string"
        ? claims.scope
            .split(/\s+/)
            .map((scope) => scope.trim())
            .filter(Boolean)
        : [],
    claims,
  };
}

function writeAuthFailure(res: Response, error: unknown): void {
  const config = getPluginOAuthConfig();
  const failure = authFailureResponse(error);
  res.setHeader(
    "WWW-Authenticate",
    buildPluginWwwAuthenticate(config, {
      error: failure.code,
      description: failure.description,
    }),
  );
  res.status(failure.status).json({ error: failure.code, message: failure.description });
}

export async function optionalPluginOAuth(
  req: PluginAuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    next();
    return;
  }

  try {
    req.pluginAuth = await authenticateToken(token);
    next();
  } catch (error) {
    writeAuthFailure(res, error);
  }
}

export async function requirePluginOAuth(
  req: PluginAuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const config = getPluginOAuthConfig();
  const token = extractBearerToken(req);
  if (!token) {
    const description = "Connect your Sportfolio account to continue.";
    res.setHeader(
      "WWW-Authenticate",
      buildPluginWwwAuthenticate(config, { error: "invalid_token", description }),
    );
    res.status(401).json({ error: "unauthorized", message: description });
    return;
  }

  try {
    req.pluginAuth = await authenticateToken(token);
    next();
  } catch (error) {
    writeAuthFailure(res, error);
  }
}
