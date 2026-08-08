import { describe, expect, it } from "vitest";
import { registerPluginOAuthMetadataRoutes } from "./plugin-oauth-metadata";

type Handler = (req: unknown, res: unknown) => void;

function collectRoutes() {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, handler: Handler) {
      routes.set(path, handler);
      return app;
    },
  };
  registerPluginOAuthMetadataRoutes(app as never);
  return routes;
}

describe("plugin OAuth protected-resource metadata", () => {
  it("serves every ChatGPT path-based metadata probe from the same handler", () => {
    const routes = collectRoutes();
    expect(routes.has("/.well-known/oauth-protected-resource")).toBe(true);
    expect(routes.has("/.well-known/oauth-protected-resource/mcp")).toBe(true);
    expect(routes.has("/mcp/.well-known/oauth-protected-resource")).toBe(true);
  });

  it("advertises Better Auth as the authorization server for every alias", () => {
    const routes = collectRoutes();
    const aliases = [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/mcp/.well-known/oauth-protected-resource",
    ];

    for (const alias of aliases) {
      const headers = new Map<string, string>();
      let body: Record<string, unknown> | undefined;
      const res = {
        setHeader(name: string, value: string) {
          headers.set(name.toLowerCase(), value);
        },
        json(value: Record<string, unknown>) {
          body = value;
        },
      };

      routes.get(alias)?.({}, res);

      expect(headers.get("cache-control")).toBe("public, max-age=300");
      expect(body?.resource).toBe("https://www.sportfolio.market/mcp/plugin");
      expect(body?.authorization_servers).toEqual([
        "https://www.sportfolio.market/api/auth/better",
      ]);
    }
  });
});
