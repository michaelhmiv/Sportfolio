import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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
  source: "public_registry:tool";
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
  "revoke_api_token",
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
    requiresConfirmation:
      executionModel === "staged_write" || tool.name === "confirm_pending_action",
    riskLevel: riskLevelFor(tool.readOnly, destructive),
    securitySchemes: securitySchemesFor(access),
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

async function registerStaticTools(
  server: McpServer,
  context: PluginMcpContext,
  deps: PublicMcpDependencies,
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
            executePublicTool({ userId, deps }, tool.name, args || {}),
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

export async function registerPluginMarketplaceSurface(
  server: McpServer,
  context: PluginMcpContext,
  deps: PublicMcpDependencies = createDefaultPublicMcpDependencies(),
): Promise<void> {
  assertPublicMcpSurfaceIntegrity();
  await registerStaticTools(server, context, deps);

  const publicContext = {
    userId: context.auth?.userId || "plugin-public-user",
    deps,
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
