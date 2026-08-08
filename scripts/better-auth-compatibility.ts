import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { jwt, magicLink } from "better-auth/plugins";

export const BETTER_AUTH_VERSION = "1.6.25";
export const OAUTH_PROVIDER_VERSION = "1.6.25";
export const ZOD_VERSION = "4.4.3";
export const DRIZZLE_ZOD_VERSION = "0.8.3";
export const SPORTFOLIO_AUTH_BASE_URL = "https://www.sportfolio.market";
export const SPORTFOLIO_MCP_RESOURCE = "https://www.sportfolio.market/mcp/plugin";
export const SPORTFOLIO_OAUTH_SCOPES = [
  "openid",
  "profile",
  "offline_access",
  "sportfolio.read",
  "sportfolio.trade",
  "sportfolio.scout",
  "sportfolio.manage",
] as const;

export function createCompatibilityAuth() {
  return betterAuth({
    appName: "Sportfolio Auth Compatibility",
    baseURL: SPORTFOLIO_AUTH_BASE_URL,
    secret: "compatibility-only-secret-at-least-32-characters",
    emailAndPassword: { enabled: false },
    plugins: [
      magicLink({
        expiresIn: 300,
        storeToken: "hashed",
        sendMagicLink: async () => undefined,
      }),
      jwt(),
      oauthProvider({
        loginPage: "/login",
        consentPage: "/oauth/consent",
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        scopes: [...SPORTFOLIO_OAUTH_SCOPES],
      }),
    ],
  });
}

export const compatibilityAuth = createCompatibilityAuth();
