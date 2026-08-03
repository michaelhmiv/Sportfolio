import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Express, Response } from "express";
import {
  optionalPluginOAuth,
  type PluginAuthenticatedRequest,
} from "../auth/plugin-oauth";
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

export function registerPluginMcpRoutes(app: Express, deps?: PublicMcpDependencies): void {
  app.get("/health/plugin", (_req, res) => {
    const config = getPluginOAuthConfig();
    const state = getPluginRuntimeState();
    const ready = config.enabled && config.issuer.startsWith("https://") && config.resource.startsWith("https://");
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "disabled",
      endpoint: "/mcp/plugin",
      oauthIssuerConfigured: config.issuer.startsWith("https://"),
      resourceConfigured: config.resource.startsWith("https://"),
      ...state,
    });
  });

  app.post(
    "/mcp/plugin",
    optionalPluginOAuth,
    pluginRateLimit,
    pluginConcurrencyLimit,
    async (req: PluginAuthenticatedRequest, res: Response) => {
      if (!pluginEnabled(res)) return;
      res.once("finish", () => {
        observePluginMcpRequest({
          status: String(res.statusCode),
          authenticated: Boolean(req.pluginAuth),
        });
      });

      if (req.header("mcp-session-id")) {
        writeJsonRpcError(res, 400, -32000, "The marketplace endpoint is stateless and does not accept session IDs.");
        return;
      }

      if (!req.body || typeof req.body !== "object") {
        writeJsonRpcError(res, 400, -32700, "A JSON-RPC request body is required.");
        return;
      }

      const requestId = req.header("x-request-id")?.trim() || randomUUID();
      res.setHeader("x-request-id", requestId);
      res.setHeader("Cache-Control", "no-store");

      const server = await createPluginMcpServer(
        {
          auth: req.pluginAuth ?? null,
          requestId,
        },
        deps,
      );
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
        sessionIdGenerator: undefined,
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error("[PLUGIN_MCP] Request failed", {
          requestId,
          errorCode: error instanceof Error ? error.name : "unknown_error",
        });
        if (!res.headersSent) {
          writeJsonRpcError(res, 500, -32603, "Internal server error");
        }
      } finally {
        try {
          await transport.close();
        } catch {
          // The client may close the response before transport cleanup completes.
        }
      }
    },
  );

  app.get("/mcp/plugin", (_req, res) => {
    if (!pluginEnabled(res)) return;
    writeJsonRpcError(res, 405, -32000, "Method not allowed. Use POST for stateless MCP requests.");
  });

  app.delete("/mcp/plugin", (_req, res) => {
    if (!pluginEnabled(res)) return;
    writeJsonRpcError(res, 405, -32000, "Method not allowed. This endpoint has no persistent sessions.");
  });
}
