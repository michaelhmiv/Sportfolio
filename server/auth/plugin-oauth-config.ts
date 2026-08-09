const DEFAULT_PUBLIC_ORIGIN = "https://www.sportfolio.market";
const DEFAULT_AUTH_PATH = "/api/auth/better";
const DEFAULT_RESOURCE = "https://www.sportfolio.market/mcp/plugin";

function parseCsv(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseScopes(value: string | undefined): string[] {
  return (value || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildAuthorizationServerDiscoveryUrl(issuer: string): string {
  const parsed = new URL(normalizeUrl(issuer));
  const issuerPath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
  return `${parsed.origin}/.well-known/oauth-authorization-server${issuerPath}`;
}

export type PluginOAuthConfig = {
  enabled: boolean;
  issuer: string;
  resource: string;
  discoveryUrl: string;
  jwksUrl: string;
  requiredScopes: string[];
  allowedClientIds: string[];
  domainChallengeToken: string | null;
  clockSkewSeconds: number;
};

export function getPluginOAuthConfig(env: NodeJS.ProcessEnv = process.env): PluginOAuthConfig {
  const authOrigin = normalizeUrl(
    env.BETTER_AUTH_URL || env.PUBLIC_SITE_URL || DEFAULT_PUBLIC_ORIGIN,
  );
  const issuer = normalizeUrl(env.PLUGIN_OAUTH_ISSUER || `${authOrigin}${DEFAULT_AUTH_PATH}`);
  const resource = normalizeUrl(env.PLUGIN_MCP_RESOURCE || DEFAULT_RESOURCE);
  const clockSkewSeconds = Number.parseInt(env.PLUGIN_OAUTH_CLOCK_SKEW_SECONDS || "60", 10);

  return {
    enabled: env.PLUGIN_MCP_ENABLED === "true",
    issuer,
    resource,
    discoveryUrl: env.PLUGIN_OAUTH_DISCOVERY_URL || buildAuthorizationServerDiscoveryUrl(issuer),
    jwksUrl: env.PLUGIN_OAUTH_JWKS_URL || `${issuer}/jwks`,
    requiredScopes: parseScopes(env.PLUGIN_OAUTH_REQUIRED_SCOPES || "openid sportfolio.read"),
    allowedClientIds: parseCsv(env.PLUGIN_OAUTH_ALLOWED_CLIENT_IDS),
    domainChallengeToken: env.OPENAI_APPS_CHALLENGE_TOKEN?.trim() || null,
    clockSkewSeconds: Number.isFinite(clockSkewSeconds) ? Math.max(0, clockSkewSeconds) : 60,
  };
}
