type JwtPayload = Record<string, unknown>;

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

export function decodeJwtPayload(token: string): JwtPayload {
  const segments = token.split(".");
  if (segments.length !== 3) throw new Error("Expected a three-segment JWT.");

  const payload = JSON.parse(decodeBase64Url(segments[1]));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("JWT payload must be an object.");
  }
  return payload as JwtPayload;
}

function audienceIncludes(value: unknown, expected: string): boolean {
  return value === expected || (Array.isArray(value) && value.includes(expected));
}

export function inspectPluginOAuthClaims(input: {
  payload: JwtPayload;
  expectedIssuer: string;
  expectedAudience: string;
  expectedClientId?: string;
  nowSeconds?: number;
}) {
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const exp = typeof input.payload.exp === "number" ? input.payload.exp : null;
  const nbf = typeof input.payload.nbf === "number" ? input.payload.nbf : null;
  const clientId = typeof input.payload.client_id === "string" ? input.payload.client_id : null;

  const checks = {
    issuerMatches: input.payload.iss === input.expectedIssuer,
    audienceMatches: audienceIncludes(input.payload.aud, input.expectedAudience),
    subjectPresent: typeof input.payload.sub === "string" && input.payload.sub.length > 0,
    clientIdPresent: Boolean(clientId),
    clientIdMatches: input.expectedClientId ? clientId === input.expectedClientId : true,
    expirationPresent: exp !== null,
    notExpired: exp !== null && exp > nowSeconds,
    notBeforeSatisfied: nbf === null || nbf <= nowSeconds,
  };

  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    claims: {
      iss: input.payload.iss ?? null,
      aud: input.payload.aud ?? null,
      subPresent: checks.subjectPresent,
      clientId,
      exp: exp ? new Date(exp * 1000).toISOString() : null,
      nbf: nbf ? new Date(nbf * 1000).toISOString() : null,
      authenticationMethod: input.payload.authentication_method ?? null,
    },
  };
}

async function main() {
  const token = process.env.PLUGIN_OAUTH_ACCESS_TOKEN?.trim() || "";
  const expectedIssuer = process.env.PLUGIN_OAUTH_ISSUER?.trim() || "";
  const expectedAudience = process.env.PLUGIN_OAUTH_AUDIENCE?.trim() || "";
  const expectedClientId = process.env.PLUGIN_OAUTH_CLIENT_ID?.trim() || undefined;

  if (!token || !expectedIssuer || !expectedAudience) {
    throw new Error(
      "Set PLUGIN_OAUTH_ACCESS_TOKEN, PLUGIN_OAUTH_ISSUER, and PLUGIN_OAUTH_AUDIENCE.",
    );
  }

  const payload = decodeJwtPayload(token);
  const result = inspectPluginOAuthClaims({
    payload,
    expectedIssuer,
    expectedAudience,
    expectedClientId,
  });

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
