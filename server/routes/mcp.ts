import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Express, Request, Response } from "express";
import { requireUserApiToken } from "../api-token-auth";
import {
  assertPublicMcpSurfaceIntegrity,
  createDefaultPublicMcpDependencies,
  type PublicMcpDependencies,
  registerPublicMcpSurface,
} from "../mcp/public-tool-registry";

const MCP_SERVER_INFO = {
  name: "sportfolio-gameplay-mcp",
  version: "1.0.0",
} as const;

function getUserId(req: Request): string {
  return req.user?.claims?.sub || "";
}

function writeJsonRpcError(
  res: Response,
  status: number,
  code: number,
  message: string,
  id: string | number | null = null,
) {
  res.status(status).json({
    jsonrpc: "2.0",
    error: {
      code,
      message,
    },
    id,
  });
}

function writeMethodNotAllowed(res: Response) {
  writeJsonRpcError(res, 405, -32000, "Method not allowed.");
}

export async function createSportfolioMcpServer(
  userId: string,
  deps: PublicMcpDependencies = createDefaultPublicMcpDependencies(),
) {
  assertPublicMcpSurfaceIntegrity();

  const server = new McpServer(MCP_SERVER_INFO, {
    capabilities: {
      logging: {},
    },
  });

  await registerPublicMcpSurface(server, {
    userId,
    deps,
  });

  return server;
}

export function registerMcpRoutes(
  app: Express,
  deps: PublicMcpDependencies = createDefaultPublicMcpDependencies(),
) {
  app.post("/mcp", requireUserApiToken, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      writeJsonRpcError(res, 401, -32001, "A valid Sportfolio API token is required");
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    let server: McpServer | null = null;

    try {
      server = await createSportfolioMcpServer(userId, deps);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[MCP] Route error:", error);
      if (!res.headersSent) {
        writeJsonRpcError(res, 500, -32603, "Internal server error");
      }
    } finally {
      res.on("close", () => {
        void transport.close();
        if (server) {
          void server.close();
        }
      });
    }
  });

  app.get("/mcp", requireUserApiToken, async (_req: Request, res: Response) => {
    writeMethodNotAllowed(res);
  });

  app.delete("/mcp", requireUserApiToken, async (_req: Request, res: Response) => {
    writeMethodNotAllowed(res);
  });
}
