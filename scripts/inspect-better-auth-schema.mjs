import { oauthProvider } from "@better-auth/oauth-provider";
import { jwt } from "better-auth/plugins";

const provider = oauthProvider({
  loginPage: "/login",
  consentPage: "/oauth/consent",
  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true,
  scopes: [
    "openid",
    "profile",
    "email",
    "offline_access",
    "sportfolio.read",
    "sportfolio.trade",
    "sportfolio.scout",
    "sportfolio.manage",
  ],
});
const jwtPlugin = jwt({ disableSettingJwtHeader: true });

function summarize(plugin) {
  const schema = plugin.schema ?? {};
  return Object.fromEntries(
    Object.entries(schema).map(([model, value]) => [
      model,
      {
        modelName: value.modelName,
        fields: Object.fromEntries(
          Object.entries(value.fields ?? {}).map(([field, spec]) => [field, spec]),
        ),
      },
    ]),
  );
}

console.log("OAUTH_SCHEMA=" + JSON.stringify(summarize(provider), null, 2));
console.log("JWT_SCHEMA=" + JSON.stringify(summarize(jwtPlugin), null, 2));
