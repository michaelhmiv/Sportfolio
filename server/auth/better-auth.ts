import type { Express } from "express";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import { jwt, magicLink } from "better-auth/plugins";
import {
  authAccounts,
  authJwks,
  authOauthAccessTokens,
  authOauthClients,
  authOauthConsents,
  authOauthRefreshTokens,
  authSessions,
  authUsers,
  authVerifications,
} from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";
import { resolveCanonicalBetterAuthIdentity } from "./better-auth-session";
import { type AuthRuntimeConfig, getAuthRuntimeConfig } from "./config";
import { consumeMagicLinkRequestQuota, createResendMagicLinkSender } from "./magic-link-delivery";

export const BETTER_AUTH_BASE_PATH = "/api/auth/better";
export const BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;
export const BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;
export const SPORTFOLIO_CANONICAL_USER_CLAIM = "https://sportfolio.market/user_id";
export const SPORTFOLIO_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "sportfolio.read",
  "sportfolio.trade",
  "sportfolio.scout",
  "sportfolio.manage",
] as const;

export type BetterAuthMagicLinkSender = (input: {
  email: string;
  url: string;
  token: string;
}) => Promise<void>;

function trustedOrigins(config: AuthRuntimeConfig): string[] {
  const configured = (config.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [
    ...new Set([config.PUBLIC_SITE_URL, config.BETTER_AUTH_URL, ...configured].filter(Boolean)),
  ] as string[];
}

function disabledMagicLinkSender(): Promise<never> {
  return Promise.reject(new Error("AUTH_MAGIC_LINK_DELIVERY_DISABLED"));
}

export function createBetterAuthServer(
  config: AuthRuntimeConfig = getAuthRuntimeConfig(),
  sendMagicLink: BetterAuthMagicLinkSender = config.AUTH_MAGIC_LINK_ENABLED
    ? createResendMagicLinkSender(config)
    : disabledMagicLinkSender,
) {
  if (!config.BETTER_AUTH_SECRET || !config.BETTER_AUTH_URL) {
    throw new Error("Better Auth cannot be created without BETTER_AUTH_SECRET and BETTER_AUTH_URL");
  }

  const oauthPlugins = config.AUTH_OAUTH_PROVIDER_ENABLED
    ? [
        jwt({
          disableSettingJwtHeader: true,
          jwks: {
            jwksPath: "/jwks",
            keyPairConfig: { alg: "ES256" },
            rotationInterval: 60 * 60 * 24 * 30,
            gracePeriod: 60 * 60 * 24 * 30,
          },
        }),
        oauthProvider({
          loginPage: "/login",
          consentPage: "/oauth/consent",
          allowDynamicClientRegistration: true,
          allowUnauthenticatedClientRegistration: true,
          scopes: [...SPORTFOLIO_OAUTH_SCOPES],
          validAudiences: config.PLUGIN_MCP_RESOURCE ? [config.PLUGIN_MCP_RESOURCE] : [],
          prefix: {
            opaqueAccessToken: "spat_",
            refreshToken: "sprt_",
            clientSecret: "spcs_",
          },
          customAccessTokenClaims: async ({ user }) => {
            if (!user) return {};
            const identity = await resolveCanonicalBetterAuthIdentity(
              {
                id: user.id,
                email: user.email,
                emailVerified: user.emailVerified,
                name: user.name,
              },
              config,
            );
            return { [SPORTFOLIO_CANONICAL_USER_CLAIM]: identity.userId };
          },
        }),
      ]
    : [];

  return betterAuth({
    appName: "Sportfolio",
    baseURL: config.BETTER_AUTH_URL,
    basePath: BETTER_AUTH_BASE_PATH,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(config),
    disabledPaths: config.AUTH_OAUTH_PROVIDER_ENABLED ? ["/token"] : [],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
        oauthClient: authOauthClients,
        oauthRefreshToken: authOauthRefreshTokens,
        oauthAccessToken: authOauthAccessTokens,
        oauthConsent: authOauthConsents,
        jwks: authJwks,
      },
    }),
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: BETTER_AUTH_SESSION_EXPIRES_IN_SECONDS,
      updateAge: BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS,
      deferSessionRefresh: true,
    },
    advanced: {
      cookiePrefix: "sportfolio",
      useSecureCookies: config.NODE_ENV === "production",
      ...(config.BETTER_AUTH_COOKIE_DOMAIN
        ? {
            crossSubDomainCookies: {
              enabled: true,
              domain: config.BETTER_AUTH_COOKIE_DOMAIN,
            },
          }
        : {}),
    },
    plugins: [
      magicLink({
        expiresIn: 300,
        storeToken: "hashed",
        disableSignUp: !config.AUTH_NEW_REGISTRATIONS_ENABLED,
        sendMagicLink: async ({ email, url, token }) => {
          if (!config.AUTH_MAGIC_LINK_ENABLED) throw new Error("AUTH_MAGIC_LINK_DISABLED");
          await sendMagicLink({ email, url, token });
        },
      }),
      ...oauthPlugins,
    ],
  });
}

let runtimeAuth: ReturnType<typeof createBetterAuthServer> | undefined;
export function getBetterAuthServer(config: AuthRuntimeConfig = getAuthRuntimeConfig()) {
  runtimeAuth ??= createBetterAuthServer(config);
  return runtimeAuth;
}

export function mountBetterAuthHandler(
  app: Express,
  config: AuthRuntimeConfig = getAuthRuntimeConfig(),
): boolean {
  if (config.AUTH_PROVIDER === "SUPABASE") {
    logger.info("Better Auth handler remains disabled while AUTH_PROVIDER=SUPABASE");
    return false;
  }
  app.set("trust proxy", 1);
  const auth = getBetterAuthServer(config);
  app.use(`${BETTER_AUTH_BASE_PATH}/sign-in/magic-link`, (req, res, next) => {
    if (!consumeMagicLinkRequestQuota(req.ip)) return res.status(202).json({ accepted: true });
    next();
  });
  app.all(`${BETTER_AUTH_BASE_PATH}/sign-up/email`, (_req, res) =>
    res.status(404).json({ error: "Password registration is not available" }),
  );
  app.all(`${BETTER_AUTH_BASE_PATH}/sign-in/email`, (_req, res) =>
    res.status(404).json({ error: "Password login is not available" }),
  );
  if (config.AUTH_OAUTH_PROVIDER_ENABLED) {
    app.all("/.well-known/oauth-authorization-server/*", toNodeHandler(auth));
  }
  app.all(`${BETTER_AUTH_BASE_PATH}/*`, toNodeHandler(auth));
  logger.info(
    {
      provider: config.AUTH_PROVIDER,
      basePath: BETTER_AUTH_BASE_PATH,
      oauthProvider: config.AUTH_OAUTH_PROVIDER_ENABLED,
      trustedOriginCount: trustedOrigins(config).length,
    },
    "Mounted Better Auth handler",
  );
  return true;
}
