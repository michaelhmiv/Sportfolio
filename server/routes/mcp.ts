import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireUserApiToken } from "../api-token-auth";
import {
  assertPublicMcpSurfaceIntegrity,
  createDefaultPublicMcpDependencies,
  resolveDynamicMlbPublicTools,
  type PublicMcpDependencies,
  registerPublicMcpSurface,
} from "../mcp/public-tool-registry";
import type { AgentToolDefinition } from "../agent/types";

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

function toJsonSchemaRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function withJsonSchemaDecorators(
  schema: Record<string, unknown>,
  zodSchema: z.ZodTypeAny,
): z.ZodTypeAny {
  let decorated = zodSchema;
  const description =
    typeof schema.description === "string" && schema.description.trim()
      ? schema.description.trim()
      : null;

  if (description) {
    decorated = decorated.describe(description);
  }

  if ("default" in schema && schema.default !== undefined) {
    decorated = decorated.default(schema.default);
  }

  return decorated;
}

function toZodSchemaFromJsonSchema(value: unknown): z.ZodTypeAny {
  const schema = toJsonSchemaRecord(value);
  if (!schema) {
    return z.any();
  }

  const enumValues = Array.isArray(schema.enum) ? schema.enum : null;
  if (
    enumValues &&
    enumValues.length > 0 &&
    enumValues.every((entry) => typeof entry === "string")
  ) {
    return withJsonSchemaDecorators(schema, z.enum(enumValues as [string, ...string[]]));
  }

  const rawType = schema.type;
  const normalizedType = Array.isArray(rawType)
    ? rawType.find((entry) => entry !== "null")
    : rawType;
  const nullable = schema.nullable === true || (Array.isArray(rawType) && rawType.includes("null"));

  let resolved: z.ZodTypeAny;
  switch (normalizedType) {
    case "string": {
      let stringSchema = z.string();
      if (typeof schema.minLength === "number") {
        stringSchema = stringSchema.min(schema.minLength);
      }
      if (typeof schema.maxLength === "number") {
        stringSchema = stringSchema.max(schema.maxLength);
      }
      if (typeof schema.pattern === "string" && schema.pattern) {
        try {
          stringSchema = stringSchema.regex(new RegExp(schema.pattern));
        } catch {
          // Ignore invalid upstream patterns rather than breaking tool discovery.
        }
      }
      resolved = stringSchema;
      break;
    }
    case "number": {
      let numberSchema = z.number();
      if (typeof schema.minimum === "number") {
        numberSchema = numberSchema.min(schema.minimum);
      }
      if (typeof schema.maximum === "number") {
        numberSchema = numberSchema.max(schema.maximum);
      }
      resolved = numberSchema;
      break;
    }
    case "integer": {
      let integerSchema = z.number().int();
      if (typeof schema.minimum === "number") {
        integerSchema = integerSchema.min(schema.minimum);
      }
      if (typeof schema.maximum === "number") {
        integerSchema = integerSchema.max(schema.maximum);
      }
      resolved = integerSchema;
      break;
    }
    case "boolean":
      resolved = z.boolean();
      break;
    case "array": {
      let arraySchema = z.array(toZodSchemaFromJsonSchema(schema.items));
      if (typeof schema.minItems === "number") {
        arraySchema = arraySchema.min(schema.minItems);
      }
      if (typeof schema.maxItems === "number") {
        arraySchema = arraySchema.max(schema.maxItems);
      }
      resolved = arraySchema;
      break;
    }
    case "object": {
      const properties = toJsonSchemaRecord(schema.properties);
      if (properties) {
        const required = new Set(
          Array.isArray(schema.required)
            ? schema.required.filter((entry): entry is string => typeof entry === "string")
            : [],
        );
        const shape = Object.fromEntries(
          Object.entries(properties).map(([key, propertySchema]) => {
            const propertyZod = toZodSchemaFromJsonSchema(propertySchema);
            return [key, required.has(key) ? propertyZod : propertyZod.optional()];
          }),
        );
        resolved = z.object(shape);
      } else {
        resolved = z.record(z.string(), z.any());
      }
      break;
    }
    default:
      resolved = z.any();
      break;
  }

  const decorated = withJsonSchemaDecorators(schema, resolved);
  return nullable ? decorated.nullable() : decorated;
}

function getDynamicMlbToolInputSchema(tool: AgentToolDefinition): Record<string, z.ZodTypeAny> {
  const schema = toJsonSchemaRecord(tool.inputSchema);
  if (!schema) {
    return {};
  }

  const properties = toJsonSchemaRecord(schema.properties);
  if (!properties) {
    return {};
  }

  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === "string")
      : [],
  );

  return Object.fromEntries(
    Object.entries(properties).map(([key, propertySchema]) => {
      const propertyZod = toZodSchemaFromJsonSchema(propertySchema);
      return [key, required.has(key) ? propertyZod : propertyZod.optional()];
    }),
  );
}

function toDynamicMlbToolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
    structuredContent: {
      code: "tool_execution_failed",
      message,
    },
    isError: true,
  };
}

async function registerDynamicMlbTools(
  server: McpServer,
  deps: PublicMcpDependencies,
  dynamicMlb: Awaited<ReturnType<typeof resolveDynamicMlbPublicTools>>,
) {
  if (!dynamicMlb.sourceStatus.available) {
    console.warn("[MCP] Failed to load dynamic MLB MCP tools:", dynamicMlb.sourceStatus.error);
    return;
  }

  for (const tool of dynamicMlb.tools) {
    const description = [
      tool.description,
      tool.whenToUse[0] ? `Use when: ${tool.whenToUse[0]}` : null,
    ]
      .filter(Boolean)
      .join(" ");

    server.registerTool(
      tool.toolName,
      {
        title: tool.toolName,
        description,
        inputSchema: getDynamicMlbToolInputSchema(tool),
        annotations: {
          title: tool.toolName,
          readOnlyHint: true,
          openWorldHint: false,
        },
        _meta: {
          domain: "mlb",
          provider: "internal_mlb_mcp",
          source: "dynamic:internal_mlb_mcp",
          category: tool.category,
          riskLevel: tool.riskLevel,
          whenToUse: tool.whenToUse,
          whenNotToUse: tool.whenNotToUse,
          examplePrompts: tool.examplePrompts,
          resultShapeHint: tool.resultShapeHint || null,
          presentationProfile: tool.presentationProfile || null,
          primaryEntityType: tool.primaryEntityType || null,
          preferredColumns: [...(tool.preferredColumns || [])],
          inputFieldNames:
            tool.inputSchema &&
            typeof tool.inputSchema === "object" &&
            !Array.isArray(tool.inputSchema) &&
            typeof (tool.inputSchema as Record<string, unknown>).properties === "object" &&
            (tool.inputSchema as Record<string, unknown>).properties
              ? Object.keys(
                  (tool.inputSchema as Record<string, { properties?: Record<string, unknown> }>)
                    .properties || {},
                )
              : [],
          fixtureArgs: {},
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await deps.runInternalMlbMcpToolBounded({
            toolName: tool.toolName,
            args: (args || {}) as Record<string, unknown>,
          });

          return {
            content:
              Array.isArray(result.content) && result.content.length > 0
                ? (result.content as any)
                : [
                    {
                      type: "text" as const,
                      text: result.replyText || `Loaded MLB data via ${result.remoteToolName}.`,
                    },
                  ],
            structuredContent: result.structuredContent as any,
          } as any;
        } catch (error) {
          return toDynamicMlbToolError(error) as any;
        }
      },
    );
  }
}

export async function createSportfolioMcpServer(
  userId: string,
  deps: PublicMcpDependencies = createDefaultPublicMcpDependencies(),
) {
  assertPublicMcpSurfaceIntegrity();
  const dynamicMlb = await resolveDynamicMlbPublicTools(deps);

  const server = new McpServer(MCP_SERVER_INFO, {
    capabilities: {
      logging: {},
    },
  });

  await registerPublicMcpSurface(server, {
    userId,
    deps,
    dynamicMlb,
  });
  await registerDynamicMlbTools(server, deps, dynamicMlb);

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
