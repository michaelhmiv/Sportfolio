import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgentToolDefinition } from "../../agent/types";
import { getPluginOAuthConfig } from "../../auth/plugin-oauth-config";
import { pluginMcpAuthError } from "../../auth/plugin-auth-challenge";
import { observePluginMcpTool } from "../../observability/metrics";
import {
  assertPublicMcpSurfaceIntegrity,
  buildPublicPromptRegistry,
  buildPublicResourceRegistry,
  buildPublicToolRegistry,
  createDefaultPublicMcpDependencies,
  executePublicTool,
  resolveDynamicMlbPublicTools,
  type PublicMcpDependencies,
  type PublicToolDefinition,
} from "../public-tool-registry";
import type { PluginMcpContext } from "./context";
import { PluginDeadlineError, withPluginDeadline } from "./runtime-guard";
import { assertNoRestrictedPluginFields, sanitizePluginValue } from "./sanitizer";

type RawSchema = Record<string, z.ZodTypeAny>;
type PluginAccess = "public" | "oauth";
type ExecutionModel = "read" | "immediate_write" | "staged_write" | "finalizer";
type ConfirmationModel = "immediate" | "staged_confirmation" | "finalizer";
type RiskLevel = "low" | "medium" | "high";

export type PluginMarketplaceCatalogEntry = {
  name: string;
  title: string;
  description: string;
  source: "public_registry:tool" | "dynamic:internal_mlb_mcp";
  domain: string;
  access: PluginAccess;
  readOnly: boolean;
  destructive: boolean;
  openWorld: boolean;
  executionModel: ExecutionModel;
  confirmationModel: ConfirmationModel;
  requiresConfirmation: boolean;
  riskLevel: RiskLevel;
  securitySchemes: Array<{ type: "noauth" } | { type: "oauth2"; scopes: string[] }>;
};

const PUBLIC_NOAUTH_TOOL_NAMES = new Set([
  "search_docs",
  "get_doc_article",
  "search_players",
  "get_player_detail",
  "get_player_recent_games",
  "get_games_today",
]);

const DESTRUCTIVE_TOOL_NAMES = new Set([
  "delete_watchlist",
  "remove_watchlist_player",
  "delete_schedule",
  "revoke_api_token",
  "clear_agent_byok",
  "redeem_premium",
  "confirm_pending_action",
]);

const envelopeOutputSchema: RawSchema = {
  summary: z.string().max(1000),
  data: z.unknown(),
  warnings: z.array(z.string().max(500)).max(20),
};

function humanizeToolName(name: string): string {
  return name
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function executionModelFor(tool: Pick<PublicToolDefinition, "name" | "readOnly">): ExecutionModel {
  if (tool.readOnly) return "read";
  if (tool.name === "confirm_pending_action" || tool.name === "cancel_pending_action") {
    return "finalizer";
  }
  if (tool.name.startsWith("stage_")) return "staged_write";
  return "immediate_write";
}

function confirmationModelFor(executionModel: ExecutionModel): ConfirmationModel {
  if (executionModel === "staged_write") return "staged_confirmation";
  if (executionModel === "finalizer") return "finalizer";
  return "immediate";
}

function accessForStaticTool(tool: Pick<PublicToolDefinition, "name">): PluginAccess {
  return PUBLIC_NOAUTH_TOOL_NAMES.has(tool.name) ? "public" : "oauth";
}

function destructiveForTool(tool: Pick<PublicToolDefinition, "name" | "readOnly">): boolean {
  if (tool.readOnly || tool.name.startsWith("stage_")) return false;
  return DESTRUCTIVE_TOOL_NAMES.has(tool.name);
}

function riskLevelFor(readOnly: boolean, destructive: boolean): RiskLevel {
  if (readOnly) return "low";
  return destructive ? "high" : "medium";
}

function securitySchemesFor(access: PluginAccess) {
  return access === "public"
    ? [{ type: "noauth" as const }]
    : [{ type: "oauth2" as const, scopes: ["openid"] }];
}

function buildStaticCatalogEntry(tool: PublicToolDefinition): PluginMarketplaceCatalogEntry {
  const access = accessForStaticTool(tool);
  const executionModel = executionModelFor(tool);
  const destructive = destructiveForTool(tool);
  return {
    name: tool.name,
    title: tool.title || humanizeToolName(tool.name),
    description: tool.description,
    source: "public_registry:tool",
    domain: tool.domain,
    access,
    readOnly: tool.readOnly,
    destructive,
    openWorld: false,
    executionModel,
    confirmationModel: confirmationModelFor(executionModel),
    requiresConfirmation: executionModel === "staged_write" || tool.name === "confirm_pending_action",
    riskLevel: riskLevelFor(tool.readOnly, destructive),
    securitySchemes: securitySchemesFor(access),
  };
}

function buildDynamicCatalogEntry(tool: AgentToolDefinition): PluginMarketplaceCatalogEntry {
  const readOnly = !tool.requiresConfirmation;
  const executionModel: ExecutionModel = tool.requiresConfirmation ? "staged_write" : "read";
  const destructive = false;
  return {
    name: tool.toolName,
    title: humanizeToolName(tool.toolName),
    description: tool.description,
    source: "dynamic:internal_mlb_mcp",
    domain: "mlb",
    access: "oauth",
    readOnly,
    destructive,
    openWorld: false,
    executionModel,
    confirmationModel: confirmationModelFor(executionModel),
    requiresConfirmation: tool.requiresConfirmation,
    riskLevel: tool.riskLevel || riskLevelFor(readOnly, destructive),
    securitySchemes: securitySchemesFor("oauth"),
  };
}

export function buildPluginStaticCatalog(): PluginMarketplaceCatalogEntry[] {
  return buildPublicToolRegistry().map(buildStaticCatalogEntry);
}

function summaryFromResult(result: unknown, fallback: string): string {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const candidate = result as Record<string, unknown>;
    for (const key of ["summary", "message", "replyText", "status"]) {
      if (typeof candidate[key] === "string" && candidate[key].trim()) {
        return candidate[key].slice(0, 1000);
      }
    }
  }
  return fallback;
}

function toPluginToolResult(raw: unknown, fallback: string) {
  const data = sanitizePluginValue(raw);
  assertNoRestrictedPluginFields(data);
  const structuredContent = {
    summary: summaryFromResult(data, fallback),
    data,
    warnings: [],
  };
  return {
    content: [{ type: "text" as const, text: structuredContent.summary }],
    structuredContent,
  };
}

function outputSize(value: unknown): number | undefined {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return undefined;
  }
}

function toJsonSchemaRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
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
  if (description) decorated = decorated.describe(description);
  if ("default" in schema && schema.default !== undefined) {
    decorated = decorated.default(schema.default);
  }
  return decorated;
}

function toZodSchemaFromJsonSchema(value: unknown): z.ZodTypeAny {
  const schema = toJsonSchemaRecord(value);
  if (!schema) return z.any();

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
      if (typeof schema.minLength === "number") stringSchema = stringSchema.min(schema.minLength);
      if (typeof schema.maxLength === "number") stringSchema = stringSchema.max(schema.maxLength);
      if (typeof schema.pattern === "string" && schema.pattern) {
        try {
          stringSchema = stringSchema.regex(new RegExp(schema.pattern));
        } catch {
          // Ignore invalid upstream patterns rather than breaking discovery.
        }
      }
      resolved = stringSchema;
      break;
    }
    case "number": {
      let numberSchema = z.number();
      if (typeof schema.minimum === "number") numberSchema = numberSchema.min(schema.minimum);
      if (typeof schema.maximum === "number") numberSchema = numberSchema.max(schema.maximum);
      resolved = numberSchema;
      break;
    }
    case "integer": {
      let integerSchema = z.number().int();
      if (typeof schema.minimum === "number") integerSchema = integerSchema.min(schema.minimum);
      if (typeof schema.maximum === "number") integerSchema = integerSchema.max(schema.maximum);
      resolved = integerSchema;
      break;
    }
    case "boolean":
      resolved = z.boolean();
      break;
    case "array": {
      let arraySchema = z.array(toZodSchemaFromJsonSchema(schema.items));
      if (typeof schema.minItems === "number") arraySchema = arraySchema.min(schema.minItems);
      if (typeof schema.maxItems === "number") arraySchema = arraySchema.max(schema.maxItems);
      resolved = arraySchema;
      break;
    }
    case "object": {
      const properties = toJsonSchemaRecord(schema.properties);
      if (!properties) {
        resolved = z.record(z.string(), z.any());
        break;
      }
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
      break;
    }
    default:
      resolved = z.any();
      break;
  }

  const decorated = withJsonSchemaDecorators(schema, resolved);
  return nullable ? decorated.nullable() : decorated;
}

function getDynamicToolInputSchema(tool: AgentToolDefinition): RawSchema {
  const schema = toJsonSchemaRecord(tool.inputSchema);
  const properties = schema ? toJsonSchemaRecord(schema.properties) : null;
  if (!schema || !properties) return {};
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

async function registerStaticTools(
  server: McpServer,
  context: PluginMcpContext,
  deps: PublicMcpDependencies,
  dynamicMlb: Awaited<ReturnType<typeof resolveDynamicMlbPublicTools>>,
): Promise<void> {
  for (const tool of buildPublicToolRegistry()) {
    const catalog = buildStaticCatalogEntry(tool);
    server.registerTool(
      tool.name,
      {
        title: catalog.title,
        description: catalog.description,
        inputSchema: tool.inputSchema,
        outputSchema: envelopeOutputSchema,
        securitySchemes: catalog.securitySchemes,
        annotations: {
          title: catalog.title,
          readOnlyHint: catalog.readOnly,
          openWorldHint: catalog.openWorld,
          destructiveHint: catalog.destructive,
        },
        _meta: {
          securitySchemes: catalog.securitySchemes,
          marketplaceVersion: "v2-full",
          access: catalog.access,
          domain: catalog.domain,
          source: catalog.source,
          executionModel: catalog.executionModel,
          confirmationModel: catalog.confirmationModel,
          requiresConfirmation: catalog.requiresConfirmation,
          riskLevel: catalog.riskLevel,
          routeRefs: tool.routeRefs || [],
          fixtureArgs: tool.fixtureArgs,
        },
      } as any,
      async (args: Record<string, unknown>) => {
        if (catalog.access === "oauth" && !context.auth) {
          return pluginMcpAuthError(getPluginOAuthConfig(), {
            error: "invalid_token",
            description: "Connect your Sportfolio account to use this tool.",
          }) as any;
        }

        const startedAt = Date.now();
        try {
          const userId = context.auth?.userId || "plugin-public-user";
          const raw = await withPluginDeadline(
            executePublicTool(
              {
                userId,
                deps,
                dynamicMlb,
              },
              tool.name,
              args || {},
            ),
          );
          const result = toPluginToolResult(raw, `${catalog.title} completed.`);
          observePluginMcpTool({
            tool: tool.name,
            status: "success",
            access: catalog.access,
            durationMs: Date.now() - startedAt,
            outputBytes: outputSize(result),
          });
          return result as any;
        } catch (error) {
          const timeout = error instanceof PluginDeadlineError;
          observePluginMcpTool({
            tool: tool.name,
            status: timeout ? "timeout" : "error",
            access: catalog.access,
            durationMs: Date.now() - startedAt,
          });
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: timeout
                  ? "Sportfolio took too long to respond. Try the request again."
                  : "Sportfolio could not complete this request.",
              },
            ],
            structuredContent: {
              summary: timeout
                ? "The tool exceeded its execution deadline."
                : "The tool could not be completed.",
              data: {
                code: timeout ? "tool_timeout" : "tool_execution_failed",
              },
              warnings: [],
            },
          } as any;
        }
      },
    );
  }
}

async function registerDynamicTools(
  server: McpServer,
  context: PluginMcpContext,
  deps: PublicMcpDependencies,
  dynamicMlb: Awaited<ReturnType<typeof resolveDynamicMlbPublicTools>>,
): Promise<void> {
  if (!dynamicMlb.sourceStatus.available) return;

  for (const tool of dynamicMlb.tools) {
    const catalog = buildDynamicCatalogEntry(tool);
    server.registerTool(
      tool.toolName,
      {
        title: catalog.title,
        description: catalog.description,
        inputSchema: getDynamicToolInputSchema(tool),
        outputSchema: envelopeOutputSchema,
        securitySchemes: catalog.securitySchemes,
        annotations: {
          title: catalog.title,
          readOnlyHint: catalog.readOnly,
          openWorldHint: catalog.openWorld,
          destructiveHint: catalog.destructive,
        },
        _meta: {
          securitySchemes: catalog.securitySchemes,
          marketplaceVersion: "v2-full",
          access: catalog.access,
          domain: catalog.domain,
          source: catalog.source,
          category: tool.category,
          executionModel: catalog.executionModel,
          confirmationModel: catalog.confirmationModel,
          requiresConfirmation: catalog.requiresConfirmation,
          riskLevel: catalog.riskLevel,
          whenToUse: tool.whenToUse,
          whenNotToUse: tool.whenNotToUse,
          examplePrompts: tool.examplePrompts,
          resultShapeHint: tool.resultShapeHint || null,
        },
      } as any,
      async (args: Record<string, unknown>) => {
        if (!context.auth) {
          return pluginMcpAuthError(getPluginOAuthConfig(), {
            error: "invalid_token",
            description: "Connect your Sportfolio account to use this tool.",
          }) as any;
        }

        const startedAt = Date.now();
        try {
          const raw = await withPluginDeadline(
            deps.runInternalMlbMcpToolBounded({
              toolName: tool.toolName,
              args: args || {},
            }),
          );
          const result = toPluginToolResult(
            {
              summary: raw.replyText || `Loaded MLB data via ${raw.remoteToolName}.`,
              remoteToolName: raw.remoteToolName,
              content: Array.isArray(raw.content) ? raw.content : [],
              structuredContent: raw.structuredContent ?? null,
              payloadTruncated: raw.payloadTruncated ?? false,
              truncation: raw.truncation ?? null,
            },
            `${catalog.title} completed.`,
          );
          observePluginMcpTool({
            tool: tool.toolName,
            status: "success",
            access: "oauth",
            durationMs: Date.now() - startedAt,
            outputBytes: outputSize(result),
          });
          return result as any;
        } catch (error) {
          const timeout = error instanceof PluginDeadlineError;
          observePluginMcpTool({
            tool: tool.toolName,
            status: timeout ? "timeout" : "error",
            access: "oauth",
            durationMs: Date.now() - startedAt,
          });
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: timeout
                  ? "Sportfolio took too long to respond. Try the request again."
                  : "Sportfolio could not complete this MLB request.",
              },
            ],
            structuredContent: {
              summary: timeout
                ? "The tool exceeded its execution deadline."
                : "The MLB tool could not be completed.",
              data: {
                code: timeout ? "tool_timeout" : "tool_execution_failed",
              },
              warnings: [],
            },
          } as any;
        }
      },
    );
  }
}

export async function registerPluginMarketplaceSurface(
  server: McpServer,
  context: PluginMcpContext,
  deps: PublicMcpDependencies = createDefaultPublicMcpDependencies(),
): Promise<void> {
  assertPublicMcpSurfaceIntegrity();
  const dynamicMlb = await resolveDynamicMlbPublicTools(deps);

  await registerStaticTools(server, context, deps, dynamicMlb);
  await registerDynamicTools(server, context, deps, dynamicMlb);

  const publicContext = {
    userId: context.auth?.userId || "plugin-public-user",
    deps,
    dynamicMlb,
  };

  for (const prompt of buildPublicPromptRegistry()) {
    server.registerPrompt(
      prompt.name,
      {
        description: prompt.description,
        argsSchema: prompt.argsSchema,
      },
      async (args) => prompt.render(args || {}),
    );
  }

  for (const resource of buildPublicResourceRegistry(publicContext)) {
    server.registerResource(
      resource.id,
      resource.uri,
      {
        mimeType: resource.mimeType,
        description: resource.description,
      },
      async () => resource.read(publicContext),
    );
  }
}
