import { createPublicKey, verify as verifySignature, type JsonWebKey } from "crypto";
import { getPluginOAuthConfig, type PluginOAuthConfig } from "./plugin-oauth-config";

type JwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

export type PluginAccessTokenClaims = {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  iat?: number;
  client_id?: string;
  azp?: string;
  scope?: string;
  role?: string;
  [key: string]: unknown;
};

type JwkSet = {
  keys: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }>;
};

type CachedJwks = {
  expiresAt: number;
  value: JwkSet;
};

let cachedJwks: CachedJwks | null = null;
const JWKS_CACHE_MS = 10 * 60 * 1000;

export class PluginTokenError extends Error {
  constructor(
    public readonly code:
      | "missing_token"
      | "malformed_token"
      | "unsupported_algorithm"
      | "unknown_key"
      | "invalid_signature"
      | "invalid_issuer"
      | "invalid_audience"
      | "expired_token"
      | "inactive_token"
      | "missing_subject"
      | "missing_client_id"
      | "unapproved_client"
      | "insufficient_scope"
      | "jwks_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "PluginTokenError";
  }
}

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function parseJsonPart<T>(value: string): T {
  try {
    return JSON.parse(decodeBase64Url(value).toString("utf8")) as T;
  } catch {
    throw new PluginTokenError("malformed_token", "The access token is malformed.");
  }
}

function tokenAudienceIncludes(audience: string | string[], expected: string): boolean {
  return Array.isArray(audience) ? audience.includes(expected) : audience === expected;
}

function parseScopes(scope: unknown): Set<string> {
  return new Set(
    typeof scope === "string"
      ? scope
          .split(/\s+/)
          .map((item) => item.trim())
          .filter(Boolean)
      : [],
  );
}

export function getPluginTokenClientId(claims: PluginAccessTokenClaims): string | null {
  const candidate = claims.client_id ?? claims.azp;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

async function loadJwks(config: PluginOAuthConfig, forceRefresh = false): Promise<JwkSet> {
  if (!forceRefresh && cachedJwks && cachedJwks.expiresAt > Date.now()) {
    return cachedJwks.value;
  }

  let response: Response;
  try {
    response = await fetch(config.jwksUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new PluginTokenError(
      "jwks_unavailable",
      "The authorization server keys are unavailable.",
    );
  }

  if (!response.ok) {
    throw new PluginTokenError(
      "jwks_unavailable",
      "The authorization server keys are unavailable.",
    );
  }

  const value = (await response.json()) as JwkSet;
  if (!Array.isArray(value.keys) || value.keys.length === 0) {
    throw new PluginTokenError(
      "jwks_unavailable",
      "The authorization server returned no signing keys.",
    );
  }

  cachedJwks = { value, expiresAt: Date.now() + JWKS_CACHE_MS };
  return value;
}

function verifyJwtSignature(
  algorithm: string,
  signingInput: string,
  signature: Buffer,
  jwk: JsonWebKey,
): boolean {
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const data = Buffer.from(signingInput, "utf8");

  if (algorithm === "RS256") {
    return verifySignature("RSA-SHA256", data, key, signature);
  }

  if (algorithm === "ES256") {
    return verifySignature("sha256", data, { key, dsaEncoding: "ieee-p1363" }, signature);
  }

  throw new PluginTokenError(
    "unsupported_algorithm",
    "The access token uses an unsupported algorithm.",
  );
}

function validateClaims(claims: PluginAccessTokenClaims, config: PluginOAuthConfig): void {
  const now = Math.floor(Date.now() / 1000);
  const skew = config.clockSkewSeconds;

  if (claims.iss !== config.issuer) {
    throw new PluginTokenError("invalid_issuer", "The access token issuer is invalid.");
  }

  if (!tokenAudienceIncludes(claims.aud, config.resource)) {
    throw new PluginTokenError(
      "invalid_audience",
      "The access token was not issued for this resource.",
    );
  }

  if (!Number.isFinite(claims.exp) || claims.exp <= now - skew) {
    throw new PluginTokenError("expired_token", "The access token has expired.");
  }

  if (claims.nbf !== undefined && claims.nbf > now + skew) {
    throw new PluginTokenError("inactive_token", "The access token is not active yet.");
  }

  if (typeof claims.sub !== "string" || !claims.sub.trim()) {
    throw new PluginTokenError("missing_subject", "The access token has no user subject.");
  }

  const clientId = getPluginTokenClientId(claims);
  if (!clientId) {
    throw new PluginTokenError(
      "missing_client_id",
      "The access token has no OAuth client identifier.",
    );
  }

  if (config.allowedClientIds.length > 0 && !config.allowedClientIds.includes(clientId)) {
    throw new PluginTokenError(
      "unapproved_client",
      "This OAuth client is not approved for Sportfolio.",
    );
  }

  const tokenScopes = parseScopes(claims.scope);
  const missingScopes = config.requiredScopes.filter((scope) => !tokenScopes.has(scope));
  if (missingScopes.length > 0) {
    throw new PluginTokenError(
      "insufficient_scope",
      `Missing required scope: ${missingScopes.join(", ")}`,
    );
  }
}

export async function verifyPluginAccessToken(
  token: string,
  config: PluginOAuthConfig = getPluginOAuthConfig(),
): Promise<PluginAccessTokenClaims> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new PluginTokenError("malformed_token", "The access token is malformed.");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJsonPart<JwtHeader>(encodedHeader);
  const claims = parseJsonPart<PluginAccessTokenClaims>(encodedPayload);

  if (!header.alg || !["ES256", "RS256"].includes(header.alg)) {
    throw new PluginTokenError(
      "unsupported_algorithm",
      "The access token uses an unsupported algorithm.",
    );
  }
  if (!header.kid) {
    throw new PluginTokenError("unknown_key", "The access token does not identify a signing key.");
  }

  let jwks = await loadJwks(config);
  let jwk = jwks.keys.find((key) => key.kid === header.kid && (!key.alg || key.alg === header.alg));
  if (!jwk) {
    jwks = await loadJwks(config, true);
    jwk = jwks.keys.find((key) => key.kid === header.kid && (!key.alg || key.alg === header.alg));
  }
  if (!jwk) {
    throw new PluginTokenError("unknown_key", "The access token signing key is unknown.");
  }

  const valid = verifyJwtSignature(
    header.alg,
    `${encodedHeader}.${encodedPayload}`,
    decodeBase64Url(encodedSignature),
    jwk,
  );
  if (!valid) {
    throw new PluginTokenError("invalid_signature", "The access token signature is invalid.");
  }

  validateClaims(claims, config);
  return claims;
}

export function resetPluginJwksCacheForTests(): void {
  cachedJwks = null;
}
