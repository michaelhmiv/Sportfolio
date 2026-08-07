import { createAuthClient } from "better-auth/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

function authBaseUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}/api/auth/better`;
}

export const betterAuthClient = createAuthClient({
  baseURL: authBaseUrl(),
  plugins: [oauthProviderClient()],
});
