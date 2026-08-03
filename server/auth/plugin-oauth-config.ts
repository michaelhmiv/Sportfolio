const DEFAULT_ISSUER = "https://xolfyrbtkmwgllrazcfh.supabase.co/auth/v1";
const DEFAULT_RESOURCE = "https://www.sportfolio.market/mcp/plugin";

function parseCsv(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
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
  const issuer = normalizeUrl(env.PLUGIN_OAUTH_ISSUER || DEFAULT_ISSUER);
  const resource = normalizeUrl(env.PLUGIN_MCP_RESOURCE || DEFAULT_RESOURCE);
  const clockSkewSeconds = Number.parseInt(env.PLUGIN_OAUTH_CLOCK_SKEW_SECONDS || "60", 10);

  return {
    enabled: env.PLUGIN_MCP_ENABLED === "true",
    issuer,
    resource,
    discoveryUrl:
      env.PLUGIN_OAUTH_DISCOVERY_URL ||
      `${issuer.replace(/\/auth\/v1$/, "")}/.well-known/oauth-authorization-server/auth/v1`,
    jwksUrl: env.PLUGIN_OAUTH_JWKS_URL || `${issuer}/.well-known/jwks.json`,
    requiredScopes: parseCsv(env.PLUGIN_OAUTH_REQUIRED_SCOPES || "openid"),
    allowedClientIds: parseCsv(env.PLUGIN_OAUTH_ALLOWED_CLIENT_IDS),
    domainChallengeToken: env.OPENAI_APPS_CHALLENGE_TOKEN?.trim() || null,
    clockSkewSeconds: Number.isFinite(clockSkewSeconds) ? Math.max(0, clockSkewSeconds) : 60,
  };
}
