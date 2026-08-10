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

const playerBatchResolveInputSchema: RawSchema = {
  queries: z
    .array(
      z
        .object({
          query: z.string().trim().min(1).max(120),
          sport: z.string().trim().min(2).max(16).optional(),
          team: z.string().trim().min(1).max(80).optional(),
          position: z.string().trim().min(1).max(40).optional(),
        })
        .strict(),
    )
    .min(1)
    .max(12),
  limitPerQuery: z.number().int().min(1).max(5).optional().default(3),
};

const scoutBatchInputSchema: RawSchema = {
  assignments: z
    .array(
      z
        .object({
          playerId: z.string().min(1).max(160),
          targetCount: z.number().int().min(0).max(10),
        })
        .strict(),
    )
    .min(1)
    .max(10),
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

function registerPlayerResolutionFastPath(
  server: McpServer,
  context: PluginMcpContext,
  deps: PublicMcpDependencies,
): void {
  const toolName = "resolve_players";
  const title = "Resolve Multiple Players";
  const securitySchemes = [{ type: "noauth" as const }];

  server.registerTool(
    toolName,
    {
      title,
      description:
        "Resolve several player names to canonical Sportfolio player IDs in one bounded call. Use this whenever a request names multiple players instead of calling search_players separately for each name.",
      inputSchema: playerBatchResolveInputSchema,
      outputSchema: envelopeOutputSchema,
      securitySchemes,
      annotations: {
        title,
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      _meta: {
        securitySchemes,
        marketplaceVersion: "v2-fast-path",
        access: "public",
        domain: "players",
        source: "plugin_fast_path",
        executionModel: "read",
        confirmationModel: "immediate",
        requiresConfirmation: false,
        riskLevel: "low",
        routeRefs: [],
        fixtureArgs: {
          queries: [{ query: "Shohei Ohtani", sport: "MLB" }, { query: "Ryan Blaney" }],
          limitPerQuery: 3,
        },
      },
    } as any,
    async (args: Record<string, unknown>) => {
      const startedAt = Date.now();
      try {
        const queries = Array.isArray(args.queries)
          ? args.queries.map((entry) => entry as Record<string, unknown>)
          : [];
        const limitPerQuery = Math.min(5, Math.max(1, Number(args.limitPerQuery) || 3));
        const userId = context.auth?.userId || "plugin-public-user";
        const resolved = await withPluginDeadline(
          Promise.all(
            queries.map(async (query) => ({
              query: String(query.query || ""),
              result: await executePublicTool({ userId, deps }, "search_players", {
                query: String(query.query || ""),
                ...(query.sport ? { sport: String(query.sport) } : {}),
                ...(query.team ? { team: String(query.team) } : {}),
                ...(query.position ? { position: String(query.position) } : {}),
                limit: limitPerQuery,
              }),
            })),
          ),
        );
        const result = toPluginToolResult(
          {
            summary: `Resolved ${resolved.length} player name${resolved.length === 1 ? "" : "s"}.`,
            queries: resolved,
          },
          "Player resolution completed.",
        );
        observePluginMcpTool({
          tool: toolName,
          status: "success",
          access: "public",
          durationMs: Date.now() - startedAt,
          outputBytes: outputSize(result),
        });
        return result as any;
      } catch (error) {
        const timeout = error instanceof PluginDeadlineError;
        observePluginMcpTool({
          tool: toolName,
          status: timeout ? "timeout" : "error",
          access: "public",
          durationMs: Date.now() - startedAt,
        });
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: timeout
                ? "Sportfolio took too long to resolve the requested players. Try again."
                : "Sportfolio could not resolve the requested players.",
            },
          ],
          structuredContent: {
            summary: timeout
              ? "The player resolution request exceeded its execution deadline."
              : "Player resolution could not be completed.",
            data: { code: timeout ? "tool_timeout" : "tool_execution_failed" },
            warnings: [],
          },
        } as any;
      }
    },
  );
}

function registerScoutBatchFastPath(
  server: McpServer,
  context: PluginMcpContext,
  deps: PublicMcpDependencies,
): void {
  const securitySchemes = [{ type: "oauth2" as const, scopes: ["openid"] }];
  const toolName = "stage_scout_assignments";
  const title = "Stage Scout Assignments";

  server.registerTool(
    toolName,
    {
      title,
      description:
        "Stage multiple scout assignment target counts as one exact bundle for a single confirmation. Use this instead of repeated stage_scout_assignment calls when changing more than one player.",
      inputSchema: scoutBatchInputSchema,
      outputSchema: envelopeOutputSchema,
      securitySchemes,
      annotations: {
        title,
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
      },
      _meta: {
        securitySchemes,
        marketplaceVersion: "v2-fast-path",
        access: "oauth",
        domain: "scouting",
        source: "plugin_fast_path",
        executionModel: "staged_write",
        confirmationModel: "staged_confirmation",
        requiresConfirmation: true,
        riskLevel: "medium",
        routeRefs: [],
        fixtureArgs: {
          assignments: [
            { playerId: "player_1", targetCount: 1 },
            { playerId: "player_2", targetCount: 1 },
          ],
        },
      },
    } as any,
    async (args: Record<string, unknown>) => {
      if (!context.auth?.userId) {
        return pluginMcpAuthError(getPluginOAuthConfig(), {
          error: "invalid_token",
          description: "Connect your Sportfolio account to change scout assignments.",
        }) as any;
      }

      const startedAt = Date.now();
      try {
        const assignments = Array.isArray(args.assignments)
          ? args.assignments.map((entry) => {
              const assignment = entry as Record<string, unknown>;
              return {
                playerId: String(assignment.playerId || ""),
                targetCount: Number(assignment.targetCount),
              };
            })
          : [];
        const raw = await withPluginDeadline(
          deps.stageGameplayTransaction({
            userId: context.auth.userId,
            action: { actionType: "scout_set_counts", assignments },
          }),
        );
        const result = toPluginToolResult(raw, "Scout assignment bundle staged for confirmation.");
        observePluginMcpTool({
          tool: toolName,
          status: "success",
          access: "oauth",
          durationMs: Date.now() - startedAt,
          outputBytes: outputSize(result),
        });
        return result as any;
      } catch (error) {
        const timeout = error instanceof PluginDeadlineError;
        observePluginMcpTool({
          tool: toolName,
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
                ? "Sportfolio took too long to stage the scout changes. Try again."
                : "Sportfolio could not stage the scout assignment bundle.",
            },
          ],
          structuredContent: {
            summary: timeout
              ? "The scout staging request exceeded its execution deadline."
              : "The scout assignment bundle could not be staged.",
            data: { code: timeout ? "tool_timeout" : "tool_execution_failed" },
            warnings: [],
          },
        } as any;
      }
    },
  );
}

function registerPluginFastPathTools(
  server: McpServer,
  context: PluginMcpContext,
  deps: PublicMcpDependencies,
): void {
  registerPlayerResolutionFastPath(server, context, deps);
  registerScoutBatchFastPath(server, context, deps);
}

export async function registerPluginMarketplaceSurface(
  server: McpServer,
  context: PluginMcpContext,
  deps: PublicMcpDependencies = createDefaultPublicMcpDependencies(),
): Promise<void> {
  assertPublicMcpSurfaceIntegrity();
  await registerStaticTools(server, context, deps);
  registerPluginFastPathTools(server, context, deps);

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
