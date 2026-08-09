import { describe, expect, it } from "vitest";
import { getPluginOAuthConfig } from "./plugin-oauth-config";

describe("plugin OAuth configuration", () => {
  it("parses the default required OAuth scopes as separate scopes", () => {
    const config = getPluginOAuthConfig({
      PLUGIN_MCP_ENABLED: "true",
      BETTER_AUTH_URL: "https://www.sportfolio.market",
    } as NodeJS.ProcessEnv);

    expect(config.requiredScopes).toEqual(["openid", "sportfolio.read"]);
  });

  it("accepts standard space-delimited OAuth scope configuration", () => {
    const config = getPluginOAuthConfig({
      PLUGIN_MCP_ENABLED: "true",
      BETTER_AUTH_URL: "https://www.sportfolio.market",
      PLUGIN_OAUTH_REQUIRED_SCOPES: "openid sportfolio.read sportfolio.trade",
    } as NodeJS.ProcessEnv);

    expect(config.requiredScopes).toEqual(["openid", "sportfolio.read", "sportfolio.trade"]);
  });

  it("accepts comma-delimited and mixed OAuth scope configuration", () => {
    const config = getPluginOAuthConfig({
      PLUGIN_MCP_ENABLED: "true",
      BETTER_AUTH_URL: "https://www.sportfolio.market",
      PLUGIN_OAUTH_REQUIRED_SCOPES: "openid, sportfolio.read sportfolio.scout",
    } as NodeJS.ProcessEnv);

    expect(config.requiredScopes).toEqual(["openid", "sportfolio.read", "sportfolio.scout"]);
  });
});
