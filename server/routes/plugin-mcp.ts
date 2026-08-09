import { randomUUID } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { Express, NextFunction, Request, Response } from "express";
import { optionalPluginOAuth, type PluginAuthenticatedRequest } from "../auth/plugin-oauth";
import { getPluginOAuthConfig } from "../auth/plugin-oauth-config";
import { createPluginMcpServer } from "../mcp/plugin/server";
import {
  getPluginRuntimeState,
  pluginConcurrencyLimit,
  pluginRateLimit,
} from "../mcp/plugin/runtime-guard";
import type { PublicMcpDependencies } from "../mcp/public-tool-registry";
import { observePluginMcpRequest } from "../observability/metrics";

function writeJsonRpcError(
  res: Response,
  status: number,
  code: number,
  message: string,
  id: string | number | null = null,
): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id,
  });
}

function pluginEnabled(res: Response): boolean {
  if (getPluginOAuthConfig().enabled) return true;
  res.status(404).json({ error: "not_found" });
  return false;
}

function isPersonalApiToken(req: Request): boolean {
  const authorization = req.header("authorization")?.trim() || "";
  return /^Bearer\s+spt_/i.test(authorization);
}

/**
 * `/mcp` historically belongs to the sessionful personal API-token MCP server.
 * ChatGPT's current MCP client also discovers `/mcp`, but presents a Better Auth
 * OAuth bearer token instead. Let `spt_...` credentials fall through to the
 * legacy route registered later while routing every other request to the
 * stateless ChatGPT/plugin surface.
 */
function passPersonalApiTokenToLegacyRoute(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (isPersonalApiToken(req)) {
    next("route");
    return;
  }
  next();
}

async function handlePluginRequest(
  req: PluginAuthenticatedRequest,
  res: Response,
  deps?: PublicMcpDependencies,
): Promise<void> {
  if (!pluginEnabled(res)) return;

  res.once("finish", () => {
    observePluginMcpRequest({
      status: String(res.statusCode),
      authenticated: Boolean(req.pluginAuth),
    });
  });

  const requestId = req.header("x-request-id")?.trim() || randomUUID();
  res.setHeader("x-request-id", requestId);
  res.setHeader("Cache-Control", "no-store");

  try {
    // createMcpHandler is the MCP v2 HTTP entry point. It serves the finalized
    // 2026-07-28 stateless protocol (`server/discover`) and, by default, the
    // legacy stateless 2025-era protocol on the same endpoint.
    const server = await createPluginMcpServer(
      {
        auth: req.pluginAuth ?? null,
        requestId,
      },
      deps,
    );
    const handler = createMcpHandler(() => server);
    const nodeHandler = toNodeHandler(handler);

    try {
      await nodeHandler(req, res, req.body);
    } finally {
      await handler.close();
    }
  } catch (error) {
    console.error("[PLUGIN_MCP] Request failed", {
      requestId,
      method: req.header("mcp-method") || (req.body as { method?: unknown } | undefined)?.method,
      protocolVersion: req.header("mcp-protocol-version") || null,
      authenticated: Boolean(req.pluginAuth),
      errorCode: error instanceof Error ? error.name : "unknown_error",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    if (!res.headersSent) {
      writeJsonRpcError(res, 500, -32603, "Internal server error");
    }
  }
}

export function registerPluginMcpRoutes(app: Express, deps?: PublicMcpDependencies): void {
  app.get("/health/plugin", (_req, res) => {
    const config = getPluginOAuthConfig();
    const state = getPluginRuntimeState();
    const ready =
      config.enabled &&
      config.issuer.startsWith("https://") &&
      config.resource.startsWith("https://");
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "disabled",
      endpoint: "/mcp/plugin",
      compatibilityEndpoint: "/mcp",
      protocol: "2026-07-28",
      oauthIssuerConfigured: config.issuer.startsWith("https://"),
      resourceConfigured: config.resource.startsWith("https://"),
      ...state,
    });
  });

  // Canonical plugin endpoint retained for existing connector configuration.
  app.all(
    "/mcp/plugin",
    optionalPluginOAuth,
    pluginRateLimit,
    pluginConcurrencyLimit,
    (req: PluginAuthenticatedRequest, res: Response) => void handlePluginRequest(req, res, deps),
  );

  // ChatGPT 2026-07-28 clients normalize discovery to `/mcp`. This route is
  // intentionally registered before the legacy /mcp API-token route.
  app.all(
    "/mcp",
    passPersonalApiTokenToLegacyRoute,
    optionalPluginOAuth,
    pluginRateLimit,
    pluginConcurrencyLimit,
    (req: PluginAuthenticatedRequest, res: Response) => void handlePluginRequest(req, res, deps),
  );
}
