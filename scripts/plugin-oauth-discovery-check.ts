type OAuthAuthorizationServerMetadata = {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  jwks_uri?: unknown;
  registration_endpoint?: unknown;
  grant_types_supported?: unknown;
  response_types_supported?: unknown;
  code_challenge_methods_supported?: unknown;
  token_endpoint_auth_methods_supported?: unknown;
};

type JsonWebKeySet = {
  keys?: unknown;
};

export type OAuthDiscoveryCheck = {
  ok: boolean;
  issuer: string;
  discoveryUrl: string;
  jwksUrl: string | null;
  checks: Record<string, boolean>;
  failures: string[];
};

function normalizeIssuer(value: string): string {
  return value.trim().replace(/\/$/, "");
}

export function buildAuthorizationServerDiscoveryUrl(issuer: string): string {
  const parsed = new URL(normalizeIssuer(issuer));
  const issuerPath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
  return `${parsed.origin}/.well-known/oauth-authorization-server${issuerPath}`;
}

function hasString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasStringMember(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.some((entry) => entry === expected);
}

function isHttpsUrl(value: unknown): value is string {
  if (!hasString(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function validateAuthorizationServerMetadata(
  expectedIssuer: string,
  metadata: OAuthAuthorizationServerMetadata,
): Pick<OAuthDiscoveryCheck, "checks" | "failures" | "jwksUrl"> {
  const issuer = normalizeIssuer(expectedIssuer);
  const checks = {
    issuerMatches: hasString(metadata.issuer) && normalizeIssuer(metadata.issuer) === issuer,
    authorizationEndpointHttps: isHttpsUrl(metadata.authorization_endpoint),
    tokenEndpointHttps: isHttpsUrl(metadata.token_endpoint),
    jwksEndpointHttps: isHttpsUrl(metadata.jwks_uri),
    dynamicClientRegistrationAdvertised: isHttpsUrl(metadata.registration_endpoint),
    authorizationCodeSupported: hasStringMember(
      metadata.grant_types_supported,
      "authorization_code",
    ),
    refreshTokenSupported: hasStringMember(metadata.grant_types_supported, "refresh_token"),
    codeResponseSupported: hasStringMember(metadata.response_types_supported, "code"),
    pkceS256Supported: hasStringMember(metadata.code_challenge_methods_supported, "S256"),
    publicClientAuthSupported: hasStringMember(
      metadata.token_endpoint_auth_methods_supported,
      "none",
    ),
  };

  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    checks,
    failures,
    jwksUrl: isHttpsUrl(metadata.jwks_uri) ? metadata.jwks_uri : null,
  };
}

export function validateAsymmetricJwks(jwks: JsonWebKeySet): boolean {
  if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) return false;
  return jwks.keys.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const key = entry as Record<string, unknown>;
    return key.kty === "RSA" || key.kty === "EC" || key.kty === "OKP";
  });
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }

  return response.json();
}

export async function runOAuthDiscoveryCheck(issuer: string): Promise<OAuthDiscoveryCheck> {
  const normalizedIssuer = normalizeIssuer(issuer);
  const discoveryUrl = buildAuthorizationServerDiscoveryUrl(normalizedIssuer);
  const metadata = (await fetchJson(discoveryUrl)) as OAuthAuthorizationServerMetadata;
  const result = validateAuthorizationServerMetadata(normalizedIssuer, metadata);
  const checks = { ...result.checks, asymmetricJwksAvailable: false };
  const failures = [...result.failures];

  if (result.jwksUrl) {
    const jwks = (await fetchJson(result.jwksUrl)) as JsonWebKeySet;
    checks.asymmetricJwksAvailable = validateAsymmetricJwks(jwks);
    if (!checks.asymmetricJwksAvailable) failures.push("asymmetricJwksAvailable");
  } else {
    failures.push("asymmetricJwksAvailable");
  }

  return {
    ok: failures.length === 0,
    issuer: normalizedIssuer,
    discoveryUrl,
    jwksUrl: result.jwksUrl,
    checks,
    failures: [...new Set(failures)],
  };
}

async function main() {
  const issuer =
    process.env.PLUGIN_OAUTH_ISSUER?.trim() || process.env.BETTER_AUTH_URL?.trim() || "";

  if (!issuer) {
    throw new Error("Set PLUGIN_OAUTH_ISSUER or BETTER_AUTH_URL before running the OAuth probe.");
  }

  const result = await runOAuthDiscoveryCheck(issuer);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  });
}
