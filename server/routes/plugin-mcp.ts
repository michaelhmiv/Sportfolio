import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Express, Response } from "express";
import {
  optionalPluginOAuth,
  type PluginAuthenticatedRequest,
} from "../auth/plugin-oauth";
import { getPluginOAuthConfig } from "../auth/plugin-oauth-config";
import { createPluginMcpServer } from "../mcp/plugin/server";
import type { PublicMcpDependencies } from "../mcp/public-tool-registry";

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
  app.post(
    "/mcp/plugin",
    optionalPluginOAuth,
    async (req: PluginAuthenticatedRequest, res: Response) => {
      if (!pluginEnabled(res)) return;

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
          error: error instanceof Error ? error.message : "unknown_error",
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
