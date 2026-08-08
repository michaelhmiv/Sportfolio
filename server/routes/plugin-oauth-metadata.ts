import type { Express, Request, Response } from "express";
import { getPluginOAuthConfig } from "../auth/plugin-oauth-config";

function sendProtectedResourceMetadata(_req: Request, res: Response): void {
  const config = getPluginOAuthConfig();
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: config.requiredScopes,
    bearer_methods_supported: ["header"],
    resource_documentation: "https://www.sportfolio.market/plugin-support/",
  });
}

export function registerPluginOAuthMetadataRoutes(app: Express): void {
  // ChatGPT probes all RFC 9728-compatible protected-resource metadata locations
  // for path-based MCP resources. Keep every supported location on the same
  // Better Auth issuer so an older/fallback probe can never fall through to SPA HTML.
  app.get("/.well-known/oauth-protected-resource", sendProtectedResourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", sendProtectedResourceMetadata);
  app.get("/mcp/.well-known/oauth-protected-resource", sendProtectedResourceMetadata);

  app.get("/.well-known/openai-apps-challenge", (_req: Request, res: Response) => {
    const config = getPluginOAuthConfig();
    if (!config.domainChallengeToken) {
      res.status(404).type("text/plain").send("Not configured");
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.type("text/plain").send(config.domainChallengeToken);
  });
}
