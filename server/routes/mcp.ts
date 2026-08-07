import { randomUUID } from "node:crypto";
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

type McpSession = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  userId: string;
};

function getUserId(req: Request): string {
  return req.user?.claims?.sub || "";
}

function getSessionId(req: Request): string | null {
  const sessionId = req.header("mcp-session-id");
  return sessionId?.trim() || null;
}

function isInitializeBody(body: unknown): boolean {
  return (
    !!body &&
    !Array.isArray(body) &&
    typeof body === "object" &&
    (body as { method?: unknown }).method === "initialize"
  );
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
  const server = new McpServer(MCP_SERVER_INFO, { capabilities: { logging: {} } });
  await registerPublicMcpSurface(server, { userId, deps });
  return server;
}

export function registerMcpRoutes(
  app: Express,
  deps: PublicMcpDependencies = createDefaultPublicMcpDependencies(),
) {
  const sessions = new Map<string, McpSession>();

  function getSessionForRequest(req: Request, userId: string): McpSession | null {
    const sessionId = getSessionId(req);
    if (!sessionId) {
      return null;
    }

    const session = sessions.get(sessionId);
    if (!session || session.userId !== userId) {
      return null;
    }

    return session;
  }

  async function createSession(userId: string) {
    const server = await createSportfolioMcpServer(userId, deps);
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, {
          server,
          transport,
          userId,
        });
      },
    });

    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId) {
        sessions.delete(sessionId);
      }
    };

    await server.connect(transport);
    return {
      server,
      transport,
      userId,
    } satisfies McpSession;
  }

  app.post("/mcp", requireUserApiToken, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      writeJsonRpcError(res, 401, -32001, "A valid Sportfolio API token is required");
      return;
    }

    const session = getSessionForRequest(req, userId);
    const existingSessionId = getSessionId(req);
    if (existingSessionId && !session) {
      writeJsonRpcError(res, 404, -32001, "Session not found");
      return;
    }

    if (!session && !isInitializeBody(req.body)) {
      writeJsonRpcError(res, 400, -32000, "Bad Request: No valid session ID provided");
      return;
    }

    try {
      const activeSession = session ?? (await createSession(userId));
      await activeSession.transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[MCP] Route error:", error);
      if (!res.headersSent) {
        writeJsonRpcError(res, 500, -32603, "Internal server error");
      }
    }
  });

  app.get("/mcp", requireUserApiToken, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      writeJsonRpcError(res, 401, -32001, "A valid Sportfolio API token is required");
      return;
    }

    const session = getSessionForRequest(req, userId);
    const sessionId = getSessionId(req);
    if (!sessionId) {
      writeMethodNotAllowed(res);
      return;
    }
    if (!session) {
      writeJsonRpcError(res, 404, -32001, "Session not found");
      return;
    }

    try {
      await session.transport.handleRequest(req, res);
    } catch (error) {
      console.error("[MCP] Route error:", error);
      if (!res.headersSent) {
        writeJsonRpcError(res, 500, -32603, "Internal server error");
      }
    }
  });

  app.delete("/mcp", requireUserApiToken, async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
      writeJsonRpcError(res, 401, -32001, "A valid Sportfolio API token is required");
      return;
    }

    const session = getSessionForRequest(req, userId);
    const sessionId = getSessionId(req);
    if (!sessionId) {
      writeMethodNotAllowed(res);
      return;
    }
    if (!session) {
      writeJsonRpcError(res, 404, -32001, "Session not found");
      return;
    }

    try {
      await session.transport.handleRequest(req, res);
    } catch (error) {
      console.error("[MCP] Route error:", error);
      if (!res.headersSent) {
        writeJsonRpcError(res, 500, -32603, "Internal server error");
      }
    }
  });
}
