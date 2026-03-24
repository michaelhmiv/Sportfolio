import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { listUserMcpSources } from "./mcp-sources";
import type { UserMcpSource } from "@shared/schema";

const MCP_CLIENT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_LENGTH = 8_000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const POOL_TTL_MS = 60_000;

interface McpToolResult {
  sourceName: string;
  toolName: string;
  content: unknown;
  isError: boolean;
}

// ---------------------------------------------------------------------------
// Connection pool — reuses clients for the same source within a TTL window.
// Ported from NousResearch/hermes-agent's MCP reconnection pattern.
// ---------------------------------------------------------------------------

interface PoolEntry {
  client: Client;
  createdAt: number;
  sourceUrl: string;
}

const connectionPool = new Map<string, PoolEntry>();

function poolKey(source: UserMcpSource): string {
  return `${source.userId}::${source.url}`;
}

function stripCredentials(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/X-API-Key:\s*\S+/gi, "X-API-Key: [REDACTED]")
    .replace(/token=\S+/gi, "token=[REDACTED]");
}

async function getOrCreateClient(source: UserMcpSource): Promise<Client> {
  const key = poolKey(source);
  const existing = connectionPool.get(key);

  if (existing && Date.now() - existing.createdAt < POOL_TTL_MS) {
    return existing.client;
  }

  if (existing) {
    await existing.client.close().catch(() => {});
    connectionPool.delete(key);
  }

  const client = await createFreshClient(source);
  connectionPool.set(key, {
    client,
    createdAt: Date.now(),
    sourceUrl: source.url,
  });

  return client;
}

async function evictPoolEntry(source: UserMcpSource): Promise<void> {
  const key = poolKey(source);
  const existing = connectionPool.get(key);
  if (existing) {
    await existing.client.close().catch(() => {});
    connectionPool.delete(key);
  }
}

async function createFreshClient(source: UserMcpSource): Promise<Client> {
  const headers: Record<string, string> = {};
  if (source.authType === "bearer" && source.authToken) {
    headers["Authorization"] = `Bearer ${source.authToken}`;
  } else if (source.authType === "api_key" && source.authToken) {
    headers["X-API-Key"] = source.authToken;
  }

  const transport = new StreamableHTTPClientTransport(new URL(source.url), {
    requestInit: { headers },
  });

  const client = new Client(
    { name: "sportfolio-agent", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
  return client;
}

async function withRetry<T>(
  source: UserMcpSource,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const client = await getOrCreateClient(source);
      return await Promise.race([
        operation(client),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("MCP operation timed out")), MCP_CLIENT_TIMEOUT_MS),
        ),
      ]);
    } catch (err: any) {
      lastError = err;
      await evictPoolEntry(source);

      if (attempt < MAX_RETRIES - 1) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  throw new Error(stripCredentials(lastError?.message || "MCP operation failed after retries"));
}

export async function discoverMcpTools(
  source: UserMcpSource,
): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
  const result = await withRetry(source, (client) => client.listTools());
  return (result.tools || []).map((tool) => ({
    name: tool.name,
    description: tool.description || "",
    inputSchema: tool.inputSchema,
  }));
}

export async function callMcpTool(
  source: UserMcpSource,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const result = await withRetry(source, (client) =>
    client.callTool({ name: toolName, arguments: args }),
  );

  let content = result.content;
  const serialized = JSON.stringify(content);
  if (serialized.length > MAX_RESPONSE_LENGTH) {
    content = [
      {
        type: "text",
        text: `Response truncated (${serialized.length} chars). ${serialized.slice(0, MAX_RESPONSE_LENGTH)}...`,
      },
    ];
  }

  return {
    sourceName: source.name,
    toolName,
    content,
    isError: result.isError === true,
  };
}

export async function queryExternalSource(input: {
  userId: string;
  sourceName?: string;
  toolName: string;
  args?: Record<string, unknown>;
}): Promise<{
  results: McpToolResult[];
  errors: string[];
}> {
  const sources = await listUserMcpSources(input.userId);
  const enabledSources = sources.filter((s) => s.enabled);

  if (enabledSources.length === 0) {
    return {
      results: [],
      errors: ["No enabled MCP sources configured. Add one via Settings > Data Sources."],
    };
  }

  const targetSources = input.sourceName
    ? enabledSources.filter(
        (s) => s.name.toLowerCase() === input.sourceName!.toLowerCase(),
      )
    : enabledSources;

  if (targetSources.length === 0) {
    return {
      results: [],
      errors: [
        `No MCP source named "${input.sourceName}" found. Available: ${enabledSources.map((s) => s.name).join(", ")}`,
      ],
    };
  }

  const results: McpToolResult[] = [];
  const errors: string[] = [];

  for (const source of targetSources) {
    try {
      const result = await callMcpTool(source, input.toolName, input.args || {});
      results.push(result);
    } catch (err: any) {
      errors.push(`${source.name}: ${err.message || "Unknown error"}`);
    }
  }

  return { results, errors };
}
