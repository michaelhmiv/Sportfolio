import type { NextFunction, Request, Response } from "express";
import { buildPluginWwwAuthenticate } from "./plugin-auth-challenge";
import { getPluginOAuthConfig } from "./plugin-oauth-config";
import {
  PluginTokenError,
  verifyPluginAccessToken,
  type PluginAccessTokenClaims,
} from "./plugin-token-verifier";

export type PluginAuthenticatedRequest = Request & {
  pluginAuth?: {
    userId: string;
    clientId: string;
    scopes: string[];
    claims: PluginAccessTokenClaims;
  };
};

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

function authFailureResponse(error: unknown): { status: number; code: string; description: string } {
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
    const claims = await verifyPluginAccessToken(token, config);
    req.pluginAuth = {
      userId: claims.sub,
      clientId: claims.client_id,
      scopes:
        typeof claims.scope === "string"
          ? claims.scope.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
          : [],
      claims,
    };
    next();
  } catch (error) {
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
}
